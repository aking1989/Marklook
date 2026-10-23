mod asset;
mod commands;
mod draft;
mod error;
mod io;
mod state;
mod vault;
mod watch;

use state::AppState;
use tauri::Manager;
use watch::WatchRegistry;

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
        .manage(WatchRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::asset::save_asset,
            commands::dialog::pick_file_and_allow,
            commands::dialog::pick_folder_and_allow,
            commands::draft::save_draft,
            commands::draft::load_draft,
            commands::draft::clear_draft,
            commands::draft::cleanup_drafts,
            commands::document::read_document,
            commands::document::write_document,
            commands::document::take_pending_open,
            commands::system::print_window,
            commands::vault::scan_vault,
            commands::vault::list_dir,
            commands::watch::watch_paths,
            commands::watch::unwatch_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
