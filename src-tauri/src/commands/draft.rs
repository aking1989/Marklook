use tauri::{AppHandle, State};

use crate::{draft, error::CommandError, state::AppState};

#[tauri::command]
pub fn save_draft(
    app: AppHandle,
    path: String,
    content: String,
    baseline_mtime_ms: u64,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let canonical = state.ensure_allowed(&path)?;
    let record = draft::DraftRecord {
        path: canonical.to_string_lossy().into_owned(),
        content,
        baseline_mtime_ms,
        saved_at: now_millis(),
        version: 1,
    };
    draft::save_draft(&draft::drafts_dir(&app)?, record)
}

#[tauri::command]
pub fn load_draft(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<draft::DraftRecord>, CommandError> {
    let canonical = state.ensure_allowed(&path)?;
    Ok(draft::load_draft(
        &draft::drafts_dir(&app)?,
        &canonical.to_string_lossy(),
    ))
}

#[tauri::command]
pub fn clear_draft(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let canonical = state.ensure_allowed(&path)?;
    draft::clear_draft(&draft::drafts_dir(&app)?, &canonical.to_string_lossy());
    Ok(())
}

#[tauri::command]
pub fn cleanup_drafts(app: AppHandle) -> Result<usize, CommandError> {
    Ok(draft::cleanup_old_drafts(&draft::drafts_dir(&app)?))
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
