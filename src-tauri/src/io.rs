use std::{fs, io::Write, path::Path, time::UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

#[derive(Debug)]
pub struct ReadText {
    pub content: String,
    pub eol: Eol,
    pub bom: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

/// 对外（前端 DTO）统一 POSIX 分隔符：Windows 反斜杠会让前端基于 `/`
/// 的树构建、前缀匹配与高亮对比全部失配。Windows API 接受正斜杠路径。
pub fn to_slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_text_file(path: &Path) -> Result<ReadText, CommandError> {
    let bytes = fs::read(path).map_err(CommandError::io)?;
    let size = bytes.len() as u64;
    let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let body = if bom { &bytes[3..] } else { &bytes[..] };

    let text =
        std::str::from_utf8(body).map_err(|error| CommandError::InvalidUtf8(error.to_string()))?;

    let eol = if text.contains("\r\n") {
        Eol::Crlf
    } else {
        Eol::Lf
    };

    // 内部统一使用 LF，保存时按原始 EOL 写回。
    let content = text.replace("\r\n", "\n").replace('\r', "\n");
    let meta = fs::metadata(path).map_err(CommandError::io)?;

    Ok(ReadText {
        content,
        eol,
        bom,
        size,
        mtime_ms: mtime_ms(&meta),
    })
}

pub fn encode_text(content: &str, eol: Eol, bom: bool) -> Vec<u8> {
    let mut output = Vec::with_capacity(content.len() + 3);

    if bom {
        output.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }

    match eol {
        Eol::Lf => output.extend_from_slice(content.as_bytes()),
        Eol::Crlf => {
            for (index, line) in content.split('\n').enumerate() {
                if index > 0 {
                    output.extend_from_slice(b"\r\n");
                }
                output.extend_from_slice(line.as_bytes());
            }
        }
    }

    output
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::Io("路径没有父目录".to_string()))?;

    if !parent.exists() {
        return Err(CommandError::NotFound(
            parent.to_string_lossy().into_owned(),
        ));
    }

    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(CommandError::io)?;
    temp.write_all(bytes).map_err(CommandError::io)?;
    temp.as_file().sync_all().map_err(CommandError::io)?;

    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(temp.path(), meta.permissions());
    }

    temp.persist(path)
        .map_err(|error| CommandError::io(error.error))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_crlf_bom_and_normalizes_to_lf() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("crlf.md");
        fs::write(&path, b"\xEF\xBB\xBFline1\r\nline2\r\n").unwrap();

        let read = read_text_file(&path).unwrap();

        assert_eq!(read.content, "line1\nline2\n");
        assert_eq!(read.eol, Eol::Crlf);
        assert!(read.bom);
    }

    #[test]
    fn encodes_crlf_and_bom() {
        let encoded = encode_text("a\nb\n", Eol::Crlf, true);
        assert_eq!(encoded, b"\xEF\xBB\xBFa\r\nb\r\n");
    }

    #[test]
    fn encodes_lf_without_bom() {
        let encoded = encode_text("a\nb\n", Eol::Lf, false);
        assert_eq!(encoded, b"a\nb\n");
    }

    #[test]
    fn rejects_invalid_utf8() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("invalid.md");
        fs::write(&path, [0xFF, 0xFE, 0x00]).unwrap();

        let error = read_text_file(&path).unwrap_err();

        assert!(matches!(error, CommandError::InvalidUtf8(_)));
    }

    #[test]
    fn atomic_write_replaces_existing_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"old").unwrap();

        atomic_write(&path, b"new content").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new content");
    }

    #[test]
    fn atomic_write_cleans_up_temp_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");

        atomic_write(&path, b"content").unwrap();

        let entries = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(entries, 1);
    }

    /// M0 退出标准：打开 → 编辑 → 保存后，EOL 与 BOM 必须与原文件字节级一致。
    #[test]
    fn to_slash_normalizes_windows_separators() {
        assert_eq!(
            to_slash(Path::new("C:\\docs\\子 目录\\a.md")),
            "C:/docs/子 目录/a.md"
        );
        assert_eq!(
            to_slash(Path::new("/already/posix.md")),
            "/already/posix.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn scan_output_uses_posix_separators_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "a").unwrap();
        let outcome = crate::vault::scan_vault(dir.path(), false).unwrap();
        for entry in &outcome.entries {
            assert!(!entry.path.contains('\\'), "路径含反斜杠：{}", entry.path);
        }
    }

    #[test]
    fn round_trip_preserves_crlf_and_bom_bytes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("crlf-bom.md");
        fs::write(
            &path,
            b"\xEF\xBB\xBF# \xe6\xa0\x87\xe9\xa2\x98\r\n\r\n\xe6\xad\xa3\xe6\x96\x87\r\n",
        )
        .unwrap();

        let first = read_text_file(&path).unwrap();
        let edited = format!("{}new line\n", first.content);
        atomic_write(&path, &encode_text(&edited, first.eol, first.bom)).unwrap();

        let second = read_text_file(&path).unwrap();

        assert_eq!(second.content, edited);
        assert_eq!(second.eol, Eol::Crlf);
        assert!(second.bom);
        assert_eq!(
            fs::read(&path).unwrap(),
            b"\xEF\xBB\xBF# \xe6\xa0\x87\xe9\xa2\x98\r\n\r\n\xe6\xad\xa3\xe6\x96\x87\r\nnew line\r\n"
        );
    }

    #[test]
    fn round_trip_preserves_lf_without_bom_bytes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("lf.md");
        fs::write(&path, b"# title\n\ntext\n").unwrap();

        let first = read_text_file(&path).unwrap();
        let edited = format!("{}extra\n", first.content);
        atomic_write(&path, &encode_text(&edited, first.eol, first.bom)).unwrap();

        let second = read_text_file(&path).unwrap();

        assert_eq!(second.content, edited);
        assert_eq!(second.eol, Eol::Lf);
        assert!(!second.bom);
        assert_eq!(fs::read(&path).unwrap(), b"# title\n\ntext\nextra\n");
    }

    /// 罕见的老式孤立 CR 在读取时统一规范化为 LF，保存后不再出现。
    #[test]
    fn round_trip_normalizes_lone_carriage_returns() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cr.md");
        fs::write(&path, b"a\rb\r\n").unwrap();

        let first = read_text_file(&path).unwrap();

        assert_eq!(first.content, "a\nb\n");
        assert_eq!(first.eol, Eol::Crlf);

        atomic_write(&path, &encode_text(&first.content, first.eol, first.bom)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"a\r\nb\r\n");
    }
}
