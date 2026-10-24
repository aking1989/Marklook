use tauri::{AppHandle, Emitter, State};

use crate::{
    error::CommandError,
    state::AppState,
    watch::{self, FsChangePayload, WatchRegistry},
};

/// 文件变更事件名：前端通过 platform.onFsChange 订阅。
pub const FS_CHANGE_EVENT: &str = "fs://change";

#[tauri::command]
pub fn watch_paths<R: tauri::Runtime>(
    app: AppHandle<R>,
    paths: Vec<String>,
    recursive: bool,
    markdown_only: bool,
    target_file: Option<String>,
    state: State<'_, AppState>,
    registry: State<'_, WatchRegistry>,
) -> Result<u32, CommandError> {
    let mut canonical = Vec::with_capacity(paths.len());
    for path in &paths {
        canonical.push(state.ensure_allowed(path)?);
    }

    watch::register(
        &registry,
        canonical,
        recursive,
        markdown_only,
        target_file,
        move |payload: FsChangePayload| {
            let _ = app.emit(FS_CHANGE_EVENT, &payload);
        },
    )
}

#[tauri::command]
pub fn unwatch_paths(watch_id: u32, registry: State<'_, WatchRegistry>) {
    registry.remove(watch_id);
}
