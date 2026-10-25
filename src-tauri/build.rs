fn main() {
    tauri_build::build();

    // Windows：给 cargo test 的 unittests exe 嵌入声明 comctl32 v6 的 manifest。
    // 正式 app 的 exe 由 tauri-build 生成 manifest，测试 exe 没有——loader 会解析到
    // system32 的 comctl32 5.82，缺 rfd/dialog 依赖的 TaskDialogIndirect 等入口点，
    // 启动即 STATUS_ENTRYPOINT_NOT_FOUND。rustc-link-arg-tests 只作用于测试目标。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test.manifest");
        println!("cargo::rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo::rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
        println!("cargo::rustc-link-arg-tests=/MANIFESTUAC:NO");
    }
}
