mod asset;
mod commands;
mod draft;
mod error;
mod io;
mod menu;
mod state;
mod vault;
mod watch;

use state::AppState;
use tauri::{Emitter, Manager};
use watch::WatchRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 第二个实例启动：把命令行里的 .md 路径转交给首实例。
            let markdown_paths: Vec<String> = argv
                .into_iter()
                .skip(1)
                .filter(|arg| {
                    let lower = arg.to_lowercase();
                    lower.ends_with(".md")
                        || lower.ends_with(".markdown")
                        || lower.ends_with(".mdown")
                        || lower.ends_with(".mkd")
                })
                .collect();

            let state = app.state::<AppState>();
            state.push_pending_open(
                markdown_paths
                    .iter()
                    .map(std::path::PathBuf::from)
                    .collect(),
            );
            let _ = app.emit("app://open-paths", markdown_paths);

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
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
        .setup(|app| {
            // 文件关联冷启动：命令行中的 .md 文件排队待打开。
            let markdown_paths: Vec<std::path::PathBuf> = std::env::args()
                .skip(1)
                .filter(|arg| {
                    let lower = arg.to_lowercase();
                    lower.ends_with(".md")
                        || lower.ends_with(".markdown")
                        || lower.ends_with(".mdown")
                        || lower.ends_with(".mkd")
                })
                .map(std::path::PathBuf::from)
                .collect();
            if !markdown_paths.is_empty() {
                app.state::<AppState>().push_pending_open(markdown_paths);
            }

            // 原生菜单（macOS 顶部 / Windows 窗口菜单）。
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 退出确认：脏状态由前端裁决，确认后经 close_window 放行。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if !state.take_force_close() {
                    api.prevent_close();
                    let _ = window.app_handle().emit("app://close-requested", ());
                }
            }
        })
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
            commands::document::read_asset_data_url,
            commands::document::export_save_html,
            commands::system::print_window,
            commands::system::close_window,
            commands::vault::scan_vault,
            commands::vault::list_dir,
            commands::watch::watch_paths,
            commands::watch::unwatch_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
