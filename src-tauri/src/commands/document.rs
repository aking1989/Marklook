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

#[tauri::command]
pub fn read_document(
    path: String,
    state: State<'_, AppState>,
) -> Result<TextDocumentDto, CommandError> {
    let path = state.ensure_allowed(&path)?;
    let file = io::read_text_file(&path)?;

    Ok(TextDocumentDto {
        path: path.to_string_lossy().into_owned(),
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
