use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use ignore::WalkBuilder;
use serde::Serialize;

use crate::error::CommandError;

/// 工作区扫描的硬上限（详细设计 §8.2）。
pub struct ScanLimits {
    pub max_entries: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_depth: usize,
}

impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            max_entries: 10_000,
            max_file_bytes: 2 * 1024 * 1024,
            max_total_bytes: 50 * 1024 * 1024,
            max_depth: 32,
        }
    }
}

/// 额外忽略目录：即使没有 .gitignore 也不进入。
const IGNORED_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", "out"];

const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntryDto {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: u64,
    /// with_content = true 且文件可读、未超限时返回正文（供搜索索引）。
    pub content: Option<String>,
    /// 文件超过索引上限（2MB）时为 true。
    pub truncated: Option<bool>,
}

#[derive(Debug)]
pub struct ScanOutcome {
    pub entries: Vec<VaultEntryDto>,
    pub truncated: bool,
}

fn mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 扫描工作区：忽略隐藏文件/.gitignore 命中的路径/符号链接，收集 Markdown 文件与目录。
/// 纯函数（不依赖 Tauri 状态），便于单元测试。
pub fn scan_vault(root: &Path, with_content: bool) -> Result<ScanOutcome, CommandError> {
    scan_vault_with_limits(root, with_content, ScanLimits::default())
}

pub fn scan_vault_with_limits(
    root: &Path,
    with_content: bool,
    limits: ScanLimits,
) -> Result<ScanOutcome, CommandError> {
    let mut entries: Vec<VaultEntryDto> = Vec::new();
    let mut truncated = false;
    let mut total_content_bytes: u64 = 0;

    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        // 用户打开的文档目录可能没有 .git，但 .gitignore 的意图仍然成立。
        .require_git(false)
        .follow_links(false)
        .max_depth(Some(limits.max_depth))
        .filter_entry(|entry| {
            // 跳过额外忽略目录（根目录本身永远放行）。
            entry.depth() > 0
                && !(entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                    && entry
                        .file_name()
                        .to_str()
                        .map(|name| IGNORED_DIRS.contains(&name))
                        .unwrap_or(false))
        })
        .build();

    for entry in walker {
        if entries.len() >= limits.max_entries {
            truncated = true;
            break;
        }

        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue, // 单个条目不可读不阻断整体扫描
        };

        if entry.depth() == 0 {
            continue; // 根目录自身不作为条目
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        if !is_dir && !is_markdown(entry.path()) {
            continue;
        }

        let path: PathBuf = entry.path().to_path_buf();
        let name = entry.file_name().to_string_lossy().into_owned();
        let size = metadata.len();
        let mtime = mtime_ms(&metadata);

        let (content, file_truncated) = if is_dir || !with_content {
            (None, None)
        } else if size > limits.max_file_bytes
            || total_content_bytes + size > limits.max_total_bytes
        {
            // 单文件超限或总量预算耗尽：只保留元数据并标记截断。
            (None, Some(true))
        } else {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    total_content_bytes += size;
                    (Some(content), None)
                }
                Err(_) => (None, None), // 非 UTF-8 或读取失败：保留元数据，跳过正文
            }
        };

        entries.push(VaultEntryDto {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir,
            size,
            mtime_ms: mtime,
            content,
            truncated: file_truncated,
        });
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ScanOutcome { entries, truncated })
}

/// 单层目录列表（文件树懒加载用）。
pub fn list_dir(path: &Path) -> Result<Vec<VaultEntryDto>, CommandError> {
    let reader = fs::read_dir(path).map_err(CommandError::io)?;
    let mut entries = Vec::new();

    for entry in reader {
        let entry = entry.map_err(CommandError::io)?;
        let metadata = entry.metadata().map_err(CommandError::io)?;
        let name = entry.file_name().to_string_lossy().into_owned();

        entries.push(VaultEntryDto {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            mtime_ms: mtime_ms(&metadata),
            content: None,
            truncated: None,
        });
    }

    // 目录在前，同类按名称。
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(path: &Path, content: &str) {
        fs::write(path, content).unwrap();
    }

    #[test]
    fn collects_markdown_files_and_directories() {
        let dir = tempdir().unwrap();
        write(&dir.path().join("a.md"), "A");
        fs::create_dir(dir.path().join("sub")).unwrap();
        write(&dir.path().join("sub/b.markdown"), "B");
        write(&dir.path().join("c.txt"), "not markdown");

        let outcome = scan_vault(dir.path(), false).unwrap();

        let paths: Vec<String> = outcome
            .entries
            .iter()
            .map(|entry| entry.path.replace('\\', "/"))
            .collect();
        assert!(paths.iter().any(|p| p.ends_with("a.md")));
        assert!(paths.iter().any(|p| p.ends_with("sub")));
        assert!(paths.iter().any(|p| p.ends_with("sub/b.markdown")));
        assert!(!paths.iter().any(|p| p.ends_with("c.txt")));
        assert!(!outcome.truncated);
    }

    #[test]
    fn skips_ignored_and_hidden_directories() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        write(&dir.path().join("node_modules/pkg/x.md"), "x");
        fs::create_dir_all(dir.path().join(".hidden")).unwrap();
        write(&dir.path().join(".hidden/y.md"), "y");
        write(&dir.path().join("keep.md"), "keep");

        let outcome = scan_vault(dir.path(), false).unwrap();

        let paths: Vec<&str> = outcome
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.contains(".hidden")));
        assert!(paths.iter().any(|p| p.ends_with("keep.md")));
    }

    #[test]
    fn respects_gitignore() {
        let dir = tempdir().unwrap();
        write(&dir.path().join(".gitignore"), "ignored.md\n");
        write(&dir.path().join("ignored.md"), "no");
        write(&dir.path().join("kept.md"), "yes");

        let outcome = scan_vault(dir.path(), false).unwrap();

        let paths: Vec<&str> = outcome
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        assert!(!paths.iter().any(|p| p.ends_with("ignored.md")));
        assert!(paths.iter().any(|p| p.ends_with("kept.md")));
    }

    #[test]
    fn with_content_returns_body_and_truncates_oversized() {
        let dir = tempdir().unwrap();
        write(&dir.path().join("small.md"), "正文内容");
        let big_path = dir.path().join("big.md");
        fs::write(&big_path, vec![b'x'; 3 * 1024 * 1024]).unwrap();

        let outcome = scan_vault(dir.path(), true).unwrap();

        let small = outcome
            .entries
            .iter()
            .find(|entry| entry.path.ends_with("small.md"))
            .unwrap();
        assert_eq!(small.content.as_deref(), Some("正文内容"));

        let big = outcome
            .entries
            .iter()
            .find(|entry| entry.path.ends_with("big.md"))
            .unwrap();
        assert_eq!(big.content, None);
        assert_eq!(big.truncated, Some(true));
    }

    #[test]
    fn skips_non_utf8_content_but_keeps_metadata() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("binary.md"), [0xFF, 0xFE, 0x00]).unwrap();

        let outcome = scan_vault(dir.path(), true).unwrap();

        let entry = &outcome.entries[0];
        assert!(entry.content.is_none());
        assert_eq!(entry.size, 3);
    }

    #[test]
    fn entry_limit_marks_truncated() {
        let dir = tempdir().unwrap();
        for index in 0..5 {
            write(&dir.path().join(format!("f{index}.md")), "x");
        }

        let outcome = scan_vault_with_limits(
            dir.path(),
            false,
            ScanLimits {
                max_entries: 3,
                ..ScanLimits::default()
            },
        )
        .unwrap();

        assert_eq!(outcome.entries.len(), 3);
        assert!(outcome.truncated);
    }

    #[test]
    fn list_dir_returns_sorted_single_level() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("z-dir")).unwrap();
        write(&dir.path().join("a.md"), "a");
        write(&dir.path().join("b.txt"), "b");

        let entries = list_dir(dir.path()).unwrap();

        assert_eq!(entries[0].name, "z-dir"); // 目录在前
        assert!(entries.iter().any(|entry| entry.name == "a.md"));
        assert!(entries.iter().any(|entry| entry.name == "b.txt")); // 非 Markdown 也返回，前端过滤
    }

    #[test]
    fn max_depth_is_respected() {
        let dir = tempdir().unwrap();
        let deep = dir.path().join("a/b/c/d");
        fs::create_dir_all(&deep).unwrap();
        write(&deep.join("deep.md"), "deep");

        let outcome = scan_vault_with_limits(
            dir.path(),
            false,
            ScanLimits {
                max_depth: 2,
                ..ScanLimits::default()
            },
        )
        .unwrap();

        assert!(
            !outcome
                .entries
                .iter()
                .any(|entry| entry.path.ends_with("deep.md"))
        );
    }
}
