mod asset;
mod commands;
mod draft;
mod error;
mod io;
mod menu;
mod state;
mod vault;
mod watch;

#[cfg(test)]
mod tests_runtime;

use state::AppState;
use tauri::{Emitter, Manager};
use watch::WatchRegistry;

/// 从命令行参数中收集 Markdown 文件路径（文件关联冷启动 / 单实例转交共用）。
fn collect_markdown_args<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .map(|arg| arg.as_ref().to_string())
        .filter(|arg| {
            let lower = arg.to_lowercase();
            lower.ends_with(".md")
                || lower.ends_with(".markdown")
                || lower.ends_with(".mdown")
                || lower.ends_with(".mkd")
        })
        .collect()
}

/// 应用装配（泛型 Runtime，不含单实例插件——其状态是进程级的，
/// mock-runtime 集成测试同进程多次构建会冲突，故由 run() 单独附加）。
fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
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
            let markdown_paths = collect_markdown_args(std::env::args());
            if !markdown_paths.is_empty() {
                app.state::<AppState>().push_pending_open(
                    markdown_paths
                        .iter()
                        .map(std::path::PathBuf::from)
                        .collect(),
                );
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure(
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 第二个实例启动：把命令行里的 .md 路径转交给首实例。
            let markdown_paths = collect_markdown_args(argv);
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
        })),
    )
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod single_instance_tests {
    use super::collect_markdown_args;

    #[test]
    fn collects_only_markdown_paths_and_skips_program_name() {
        let args = vec![
            "/Applications/Marklook.app/Contents/MacOS/marklook",
            "/docs/a.md",
            "/docs/b.markdown",
            "/tmp/c.txt",
            "/docs/deep/大 文档.MD",
            "--flag",
        ];
        assert_eq!(
            collect_markdown_args(args),
            vec!["/docs/a.md", "/docs/b.markdown", "/docs/deep/大 文档.MD",]
        );
    }

    #[test]
    fn empty_when_no_markdown() {
        assert_eq!(
            collect_markdown_args(vec!["prog", "--help"]),
            Vec::<String>::new()
        );
    }
}
