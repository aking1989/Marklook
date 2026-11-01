use serde::Serialize;
use tauri::State;

use crate::{
    error::CommandError,
    io::{self, Eol},
    state::AppState,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentDto {
    pub path: String,
    pub content: String,
    pub mtime_ms: u64,
    pub size: u64,
    pub eol: Eol,
    pub bom: bool,
    pub encoding: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResultDto {
    pub mtime_ms: u64,
    pub size: u64,
    pub eol: Eol,
    pub bom: bool,
}

/// 用户显式打开一个「应用自己记住的」路径时（例如「最近」列表跨会话重开），
/// 把它补进 allowlist —— 这些路径没有经过文件对话框，read_document 会以
/// PATH_OUTSIDE_ROOT 拒绝。
///
/// 只放行已存在、扩展名为 Markdown 的普通文件，并像文件选择器那样连带放行
/// 所在目录（相对路径的图片、文档内相对链接才读得到）；不做成任意文件读取通道。
#[tauri::command]
pub fn allow_path(path: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    let canonical = dunce::canonicalize(&path).map_err(|_| CommandError::NotFound(path.clone()))?;

    if !canonical.is_file() {
        return Err(CommandError::NotFound(path));
    }

    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "mdown" | "mkd") {
        return Err(CommandError::Unsupported(path));
    }

    if let Some(parent) = canonical.parent()
        && let Ok(parent) = dunce::canonicalize(parent)
    {
        state.allow_root(parent);
    }
    state.allow_file(canonical);

    Ok(())
}

#[tauri::command]
pub fn read_document(
    path: String,
    state: State<'_, AppState>,
) -> Result<TextDocumentDto, CommandError> {
    let path = state.ensure_allowed(&path)?;
    let file = io::read_text_file(&path)?;

    Ok(TextDocumentDto {
        path: crate::io::to_slash(&path),
        content: file.content,
        mtime_ms: file.mtime_ms,
        size: file.size,
        eol: file.eol,
        bom: file.bom,
        encoding: "utf-8",
    })
}

#[tauri::command]
pub fn write_document(
    path: String,
    content: String,
    expected_mtime_ms: Option<u64>,
    force: bool,
    eol: Eol,
    bom: bool,
    state: State<'_, AppState>,
) -> Result<WriteResultDto, CommandError> {
    let path = state.ensure_allowed(&path)?;
    let meta = std::fs::metadata(&path).map_err(CommandError::io)?;
    let current_mtime_ms = io::mtime_ms(&meta);

    if !force
        && let Some(expected) = expected_mtime_ms
        && expected != current_mtime_ms
    {
        return Err(CommandError::Conflict { current_mtime_ms });
    }

    let bytes = io::encode_text(&content, eol, bom);
    io::atomic_write(&path, &bytes)?;

    let meta = std::fs::metadata(&path).map_err(CommandError::io)?;

    Ok(WriteResultDto {
        mtime_ms: io::mtime_ms(&meta),
        size: meta.len(),
        eol,
        bom,
    })
}

#[tauri::command]
pub fn take_pending_open(state: State<'_, AppState>) -> Vec<String> {
    state.take_pending_open()
}

#[tauri::command]
pub fn read_asset_data_url(
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, CommandError> {
    // 资产授权（与 mdasset 协议一致）：图片允许位于已打开文档/根的同目录树内，
    // 图片文件本身不一定在 allowlist。
    let canonical = crate::asset::ensure_asset_allowed(&state, &path)?;
    let mime = crate::asset::mime_of(&canonical);
    let bytes = std::fs::read(&canonical).map_err(CommandError::io)?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[tauri::command]
pub async fn export_save_html<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    default_name: String,
    html: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, CommandError> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name(default_name)
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| CommandError::Io(error.to_string()))?;

    let canonical = dunce::canonicalize(&path)
        .map_err(|_| CommandError::NotFound(path.to_string_lossy().into_owned()))?;

    io::atomic_write(&canonical, html.as_bytes())?;
    state.allow_file(canonical.clone());

    Ok(Some(canonical.to_string_lossy().into_owned()))
}
