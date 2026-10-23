use serde::Serialize;
use tauri::State;

use crate::{
    error::CommandError,
    state::AppState,
    vault::{self, VaultEntryDto},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultScanDto {
    pub root: String,
    pub entries: Vec<VaultEntryDto>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn scan_vault(
    root: String,
    with_content: bool,
    state: State<'_, AppState>,
) -> Result<VaultScanDto, CommandError> {
    let root_path = state.ensure_allowed(&root)?;

    // 阻塞线程执行扫描，避免卡住主线程（大工作区可达数秒）。
    let outcome =
        tauri::async_runtime::spawn_blocking(move || vault::scan_vault(&root_path, with_content))
            .await
            .map_err(|error| CommandError::Io(error.to_string()))??;

    Ok(VaultScanDto {
        root: state.ensure_allowed(&root)?.to_string_lossy().into_owned(),
        entries: outcome.entries,
        truncated: outcome.truncated,
    })
}

#[tauri::command]
pub fn list_dir(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<VaultEntryDto>, CommandError> {
    let path = state.ensure_allowed(&path)?;
    vault::list_dir(&path)
}
