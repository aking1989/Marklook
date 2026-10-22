use tauri::WebviewWindow;

use crate::error::CommandError;

/// 打开系统打印面板。macOS 走 NSPrintOperation（面板内含“存储为 PDF”），
/// Windows 与 Linux 由 wry 转发到 WebView 的 `window.print()`。
#[tauri::command]
pub fn print_window(window: WebviewWindow) -> Result<(), CommandError> {
    window
        .print()
        .map_err(|error| CommandError::Io(error.to_string()))
}
