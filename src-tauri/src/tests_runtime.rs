//! Tauri mock-runtime 集成测试：用与 `run()` 完全相同的装配（configure）
//! 在无 GUI 的 MockRuntime 下真实执行 IPC 命令，覆盖命令注册、参数解包、
//! State 注入与错误序列化——这是 Mock 平台 E2E 之外对 Tauri 装配层的补充。

use std::fs;
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
use tauri::{Manager, webview::InvokeRequest};
use tempfile::tempdir;

use crate::{configure, state::AppState};

fn ipc(cmd: &str, body: serde_json::Value) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

fn call(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(window, ipc(cmd, body)).map(|b| b.deserialize::<serde_json::Value>().unwrap())
}

fn build_app() -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = configure(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("构建 mock 应用失败");

    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("创建 mock 窗口失败");

    (app, window)
}

fn canonical(path: &std::path::Path) -> String {
    dunce::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

#[test]
fn read_write_document_round_trip_via_ipc() {
    let (app, window) = build_app();
    let dir = tempdir().unwrap();
    let doc = dir.path().join("note.md");
    fs::write(&doc, "\u{FEFF}第一行\r\n第二行\r\n").unwrap();
    app.state::<AppState>()
        .allow_file(dunce::canonicalize(&doc).unwrap());

    let path = canonical(&doc);
    let read = call(
        &window,
        "read_document",
        serde_json::json!({ "path": path }),
    )
    .expect("read 应成功");

    // DTO 字段按 camelCase 序列化（前端契约）。
    assert_eq!(read["content"], "第一行\n第二行\n");
    assert_eq!(read["eol"], "crlf");
    assert_eq!(read["bom"], true);
    assert_eq!(read["encoding"], "utf-8");
    assert!(read["mtimeMs"].is_u64());

    let mtime = read["mtimeMs"].as_u64().unwrap();
    let write = call(
        &window,
        "write_document",
        serde_json::json!({
            "path": path,
            "content": "第一行\n第二行\n新增\n",
            "expectedMtimeMs": mtime,
            "force": false,
            "eol": "crlf",
            "bom": true,
        }),
    )
    .expect("write 应成功");

    assert!(write["mtimeMs"].as_u64().unwrap() >= mtime);
    assert_eq!(
        fs::read(&doc).unwrap(),
        "\u{FEFF}第一行\r\n第二行\r\n新增\r\n".as_bytes()
    );

    // 过期 mtime 触发 CONFLICT 错误（code SCREAMING_SNAKE_CASE，data 含当前 mtime）。
    let conflict = call(
        &window,
        "write_document",
        serde_json::json!({
            "path": path,
            "content": "x",
            "expectedMtimeMs": 1,
            "force": false,
            "eol": "lf",
            "bom": false,
        }),
    )
    .expect_err("过期 mtime 应冲突");

    assert_eq!(conflict["code"], "CONFLICT");
    // 变体字段按 snake_case 序列化（前端仅读 code 与通用 message）。
    assert!(conflict["data"]["current_mtime_ms"].is_u64());
}

#[test]
fn unregistered_paths_rejected_with_code() {
    let (_app, window) = build_app();

    let error = call(
        &window,
        "read_document",
        serde_json::json!({ "path": "/etc/passwd" }),
    )
    .expect_err("未授权路径应被拒绝");

    assert_eq!(error["code"], "PATH_OUTSIDE_ROOT");
}

#[test]
fn take_pending_open_returns_and_clears() {
    let (app, window) = build_app();
    app.state::<AppState>().push_pending_open(vec![
        std::path::PathBuf::from("/docs/a.md"),
        std::path::PathBuf::from("/docs/b.md"),
    ]);

    let first = call(&window, "take_pending_open", serde_json::json!({}))
        .expect("take_pending_open 应成功");
    assert_eq!(first, serde_json::json!(["/docs/a.md", "/docs/b.md"]));

    let second =
        call(&window, "take_pending_open", serde_json::json!({})).expect("第二次调用应返回空");
    assert_eq!(second, serde_json::json!([]));
}

#[test]
fn scan_vault_returns_camel_case_tree_entries() {
    let (app, window) = build_app();
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("a.md"), "A").unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub/b.md"), "B 内容").unwrap();
    app.state::<AppState>()
        .allow_root(dunce::canonicalize(dir.path()).unwrap());

    let scan = call(
        &window,
        "scan_vault",
        serde_json::json!({ "root": canonical(dir.path()), "withContent": true }),
    )
    .expect("scan_vault 应成功");

    assert_eq!(scan["truncated"], false);
    let entries = scan["entries"].as_array().unwrap();
    assert!(entries.len() >= 3);

    let file = entries
        .iter()
        .find(|entry| entry["name"] == "b.md")
        .expect("应包含 b.md");
    assert_eq!(file["isDir"], false);
    assert_eq!(file["content"], "B 内容");
    assert!(file["mtimeMs"].is_u64());

    let folder = entries
        .iter()
        .find(|entry| entry["name"] == "sub")
        .expect("应包含 sub 目录");
    assert_eq!(folder["isDir"], true);
}

#[test]
fn save_asset_via_ipc_writes_assets_directory() {
    let (app, window) = build_app();
    let dir = tempdir().unwrap();
    let doc = dir.path().join("note.md");
    fs::write(&doc, "x").unwrap();
    app.state::<AppState>()
        .allow_file(dunce::canonicalize(&doc).unwrap());

    let result = call(
        &window,
        "save_asset",
        serde_json::json!({
            "docPath": canonical(&doc),
            "suggestedName": "粘贴图片.png",
            "bytes": [1, 2, 3, 4],
        }),
    )
    .expect("save_asset 应成功");

    assert_eq!(result["relativePath"], "assets/粘贴图片.png");
    assert_eq!(
        fs::read(dir.path().join("assets/粘贴图片.png")).unwrap(),
        vec![1, 2, 3, 4]
    );
}

#[test]
fn read_asset_data_url_returns_png() {
    let (app, window) = build_app();
    let dir = tempdir().unwrap();
    let doc = dir.path().join("note.md");
    let image = dir.path().join("pic.png");
    fs::write(&doc, "x").unwrap();
    fs::write(&image, [0x89, 0x50, 0x4E, 0x47]).unwrap();
    app.state::<AppState>()
        .allow_file(dunce::canonicalize(&doc).unwrap());

    let url = call(
        &window,
        "read_asset_data_url",
        serde_json::json!({ "path": canonical(&image) }),
    )
    .expect("read_asset_data_url 应成功");

    let data_url = url.as_str().unwrap();
    assert!(data_url.starts_with("data:image/png;base64,iVBOR"));
}

#[test]
fn watch_and_unwatch_round_trip() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("note.md"), "x").unwrap();

    // 监听需要 allowlist 授权（真实场景由 pick_folder_and_allow 对话框完成，
    // 测试中直接注入授权）。
    let (app, window) = build_app();
    app.state::<AppState>()
        .allow_root(dunce::canonicalize(dir.path()).unwrap());

    let id = call(
        &window,
        "watch_paths",
        serde_json::json!({
            "paths": [canonical(dir.path())],
            "recursive": false,
            "markdownOnly": true,
            "targetFile": null,
        }),
    )
    .expect("watch_paths 应成功");
    let watch_id = id.as_u64().unwrap();
    assert!(watch_id > 0);

    call(
        &window,
        "unwatch_paths",
        serde_json::json!({ "watchId": watch_id }),
    )
    .expect("unwatch_paths 应成功");
}

#[test]
fn draft_commands_round_trip() {
    let (app, window) = build_app();
    let dir = tempdir().unwrap();
    let doc = dir.path().join("note.md");
    fs::write(&doc, "磁盘内容").unwrap();
    let canonical_doc = dunce::canonicalize(&doc).unwrap();
    app.state::<AppState>().allow_file(canonical_doc.clone());

    let path = canonical_doc.to_string_lossy().into_owned();
    call(
        &window,
        "save_draft",
        serde_json::json!({
            "path": path,
            "content": "草稿内容",
            "baselineMtimeMs": 123,
        }),
    )
    .expect("save_draft 应成功");

    // 草稿目录在 app_data_dir（mock runtime 下为临时目录），直接经 IPC 读回。
    let loaded = call(&window, "load_draft", serde_json::json!({ "path": path }))
        .expect("load_draft 应成功");
    assert_eq!(loaded["content"], "草稿内容");
    assert_eq!(loaded["baselineMtimeMs"], 123);
    assert_eq!(loaded["version"], 1);

    call(&window, "clear_draft", serde_json::json!({ "path": path })).expect("clear_draft 应成功");

    let after = call(&window, "load_draft", serde_json::json!({ "path": path }))
        .expect("load_draft 应成功");
    assert!(after.is_null());
}
