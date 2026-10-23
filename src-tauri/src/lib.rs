mod asset;
mod commands;
mod error;
mod io;
mod state;
mod vault;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("mdasset", |ctx, request| {
            let state = ctx.app_handle().state::<AppState>();
            match asset::decode_asset_request(request.uri().path()) {
                Some(path) => asset::serve_asset(&state, &path),
                None => asset::serve_asset_missing(),
            }
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::dialog::pick_file_and_allow,
            commands::dialog::pick_folder_and_allow,
            commands::document::read_document,
            commands::document::write_document,
            commands::document::take_pending_open,
            commands::system::print_window,
            commands::vault::scan_vault,
            commands::vault::list_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
