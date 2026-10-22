use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::{error::CommandError, state::AppState};

#[tauri::command]
pub async fn pick_file_and_allow(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, CommandError> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| CommandError::Io(error.to_string()))?;

    let canonical = dunce::canonicalize(&path)
        .map_err(|_| CommandError::NotFound(path.to_string_lossy().into_owned()))?;

    state.allow_file(canonical.clone());

    // 允许读取文档所在目录，后续相对图片等资源需要。
    if let Some(parent) = canonical.parent()
        && let Ok(parent) = dunce::canonicalize(parent)
    {
        state.allow_root(parent);
    }

    Ok(Some(canonical.to_string_lossy().into_owned()))
}
