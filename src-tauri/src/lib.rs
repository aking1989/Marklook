mod commands;
mod error;
mod io;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::dialog::pick_file_and_allow,
            commands::document::read_document,
            commands::document::write_document,
            commands::document::take_pending_open,
            commands::system::print_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
