use tauri::{
    AppHandle, Emitter, Runtime,
    menu::{Menu, MenuItem, SubmenuBuilder},
};

/// 原生菜单：文件动作经 app://menu 事件交给前端执行；
/// 编辑菜单用系统预置项（WebView 内 Cmd+C/V 等需要它们存在）。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open_file = MenuItem::with_id(app, "open-file", "打开文件…", true, None::<&str>)?;
    let open_folder = MenuItem::with_id(app, "open-folder", "打开文件夹…", true, None::<&str>)?;
    let save = MenuItem::with_id(app, "save", "保存", true, None::<&str>)?;
    let export_html = MenuItem::with_id(app, "export-html", "导出 HTML…", true, None::<&str>)?;
    let print = MenuItem::with_id(app, "print", "打印 / PDF…", true, None::<&str>)?;
    let toggle_mode = MenuItem::with_id(app, "toggle-mode", "切换阅读 / 源码", true, None::<&str>)?;

    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&open_file)
        .item(&open_folder)
        .separator()
        .item(&save)
        .item(&export_html)
        .item(&print)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "视图")
        .item(&toggle_mode)
        .build()?;

    let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu])?;

    app.on_menu_event(|handle, event| {
        let _ = handle.emit("app://menu", event.id().as_ref());
    });

    Ok(menu)
}
