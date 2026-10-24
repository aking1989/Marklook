use crate::error::CommandError;

/// 打开系统打印面板。macOS 走 NSPrintOperation（面板内含“存储为 PDF”），
/// Windows 与 Linux 由 wry 转发到 WebView 的 `window.print()`。
#[tauri::command]
pub fn print_window<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<(), CommandError> {
    window
        .print()
        .map_err(|error| CommandError::Io(error.to_string()))
}

/// 前端确认关闭后调用：置 force_close 并真正关窗。
#[tauri::command]
pub fn close_window<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<crate::state::AppState>,
) -> Result<(), CommandError> {
    state.set_force_close(true);
    window
        .close()
        .map_err(|error| CommandError::Io(error.to_string()))
}
