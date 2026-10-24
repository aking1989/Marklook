use std::{fs, path::Path};

use serde::Serialize;
use tauri::State;

use crate::{error::CommandError, io, state::AppState};

/// 图片扩展名白名单：与 mdasset 协议一致，不写其他类型文件。
const IMAGE_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAssetResult {
    pub absolute_path: String,
    /// 相对文档的路径，用于插入 Markdown 语法。
    pub relative_path: String,
}

fn image_extension(name: &str) -> Option<String> {
    let extension = name.rsplit('.').next()?.to_ascii_lowercase();
    if extension == name {
        return None; // 没有扩展名
    }
    IMAGE_EXTENSIONS
        .contains(&extension.as_str())
        .then_some(extension)
}

fn sanitize_stem(name: &str) -> String {
    let stem: String = name
        .chars()
        .map(|ch| {
            // Unicode 字母数字（含中文）合法；其余（空格、路径分隔、控制字符）替换。
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = stem.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
    }
}

/// 保存图片到文档的 assets/ 目录，文件名去重（name-2.png、name-3.png…）。
/// 纯函数便于测试；返回绝对路径与相对路径。
pub fn save_asset_to(
    doc_path: &Path,
    suggested_name: &str,
    bytes: &[u8],
) -> Result<SaveAssetResult, CommandError> {
    let parent = doc_path
        .parent()
        .ok_or_else(|| CommandError::Io("文档没有父目录".to_string()))?;
    let assets_dir = parent.join("assets");
    fs::create_dir_all(&assets_dir).map_err(CommandError::io)?;

    let extension = image_extension(suggested_name).unwrap_or_else(|| "png".to_string());
    let stem = sanitize_stem(
        suggested_name
            .rsplit_once('.')
            .map(|(before, _)| before)
            .unwrap_or(suggested_name),
    );

    let mut counter = 1u32;
    let mut file_name = format!("{stem}.{extension}");
    while assets_dir.join(&file_name).exists() {
        counter += 1;
        file_name = format!("{stem}-{counter}.{extension}");
    }

    let target = assets_dir.join(&file_name);
    io::atomic_write(&target, bytes)?;

    Ok(SaveAssetResult {
        absolute_path: target.to_string_lossy().into_owned(),
        relative_path: format!("assets/{file_name}"),
    })
}

#[tauri::command]
pub fn save_asset(
    doc_path: String,
    suggested_name: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<SaveAssetResult, CommandError> {
    let doc = state.ensure_allowed(&doc_path)?;
    save_asset_to(&doc, &suggested_name, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn saves_into_assets_directory_with_clean_name() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, "x").unwrap();

        // Unicode 清洗：中文保留，空格替换为 '-'。
        let result = save_asset_to(&doc, "截图 2024.png", b"png").unwrap();

        assert!(result.absolute_path.ends_with("assets/截图-2024.png"));
        assert_eq!(result.relative_path, "assets/截图-2024.png");
        assert_eq!(
            fs::read(dir.path().join("assets/截图-2024.png")).unwrap(),
            b"png"
        );
    }

    #[test]
    fn deduplicates_file_names() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, "x").unwrap();

        let first = save_asset_to(&doc, "image.png", b"a").unwrap();
        let second = save_asset_to(&doc, "image.png", b"b").unwrap();

        assert_eq!(first.relative_path, "assets/image.png");
        assert_eq!(second.relative_path, "assets/image-2.png");
    }

    #[test]
    fn rejects_and_normalizes_dangerous_extensions() {
        let dir = tempdir().unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, "x").unwrap();

        // 非图片扩展名按 png 处理。
        let evil = save_asset_to(&doc, "shell.sh", b"x").unwrap();
        assert!(evil.relative_path.ends_with(".png"));

        // 无扩展名同样兜底。
        let noext = save_asset_to(&doc, "pasted-image", b"x").unwrap();
        assert_eq!(noext.relative_path, "assets/pasted-image.png");
    }
}
