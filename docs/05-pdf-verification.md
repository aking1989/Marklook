# PDF 技术验证报告

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-10-22 |
| 状态 | 通过（macOS）；Windows 待验证 |
| 关联 | [详细设计 §13.2](./02-detailed-design.md) · [开发计划 T0.7](./04-development-plan.md) |
| 验证文档 | `tests/fixtures/pdf-check.md` |

## 1. 结论摘要

系统打印路线可用。Tauri 2.12.5 的 `WebviewWindow::print()` 在 macOS 上由 wry 0.57 调用 `WKWebView.printOperationWithPrintInfo:`，走 `NSPrintOperation`，标准打印面板自带“存储为 PDF”。实机输出 3 页 A4，正文、表格、代码、引用、脚注完整，分页合理。

因此继续采用系统打印面板，不启用 Typst 备选方案。Windows 与 Linux 的 wry 实现分别转发到 `window.print()` 和 GTK 打印对话框，代码路径已通用，但尚未在 Windows 实机验证。

## 2. 实现内容

- Rust：`print_window` 命令（`src-tauri/src/commands/system.rs`），调用 `WebviewWindow::print()`。
- 前端：`Platform.print()` 接口，Tauri 与 Mock 两套实现；`Cmd/Ctrl+P` 与工具栏“打印”按钮触发。
- 源码模式下打印会先渲染并切回阅读视图，等待字体就绪与两帧绘制后再打开打印面板。
- 打印样式集中在 `src/styles/print.css`，在 `main.tsx` 中**最后导入**：隐藏应用外壳、A4 页边距、表格与代码块不跨页、长代码折行、暗色/护眼主题强制浅色。

> 关键点：打印样式必须晚于 `app.css` 加载。应用布局里的 `.reader-scroll { position: absolute }`、`.content { overflow: hidden }` 与打印规则同优先级，加载更晚时会把 `@media print` 的覆盖全部顶掉，导致原生打印只输出可视区域。

## 3. 验证方法

### 3.1 浏览器打印预览

用与渲染管线相同的 remark/rehype 处理 `tests/fixtures/pdf-check.md`，按 `main.tsx` 的顺序内联样式，由 Playwright 调用 Chrome 以 A4 生成 PDF，再渲染为图片逐页检查。亮色与暗色主题各一份。

产物在 `test-results/pdf-check/`（gitignore），可重复生成：

```bash
node tools/pdf-check/render.mjs light
node tools/pdf-check/pdf.mjs preview-light.html marklook-print-preview.pdf
swift tools/pdf-check/render-pages.swift test-results/pdf-check/marklook-print-preview.pdf test-results/pdf-check/light
```

### 3.2 原生打印面板

运行 `pnpm tauri dev`，打开验证文档，`Cmd+P`，在系统面板选择 `PDF ▾ → 存储为 PDF`。共进行两轮：

1. 首轮输出 1 页，只有标题，正文被裁切 → 定位为打印样式被 `app.css` 覆盖。
2. 拆出 `print.css` 最后加载后复测，输出 3 页完整内容。

自动化限制：本机 shell 未获辅助功能权限，AppleScript 无法发送按键；脱离应用窗口的 WKWebView 脚本在当前 macOS 上出现无限分页，无法作为自动验证手段。最终以应用内实机结果为准。

## 4. 验证结果

### 4.1 浏览器打印预览

| 检查项 | 结果 |
| --- | --- |
| 页面尺寸与页边距 | A4，18mm / 16mm，正确 |
| 分页 | 3 页，标题不与正文分离 |
| 中文字体与换行 | 正常，无孤字或截断 |
| 长代码行 | 自动折行，未被页边裁切 |
| 表格 | 完整位于同一页，未跨页截断 |
| 引用块 | 左侧竖线保留 |
| 脚注 | 文末正确显示 |
| 暗色主题 | 强制浅色输出，无黑底 |

### 4.2 原生打印面板（macOS 26）

| 检查项 | 结果 |
| --- | --- |
| 打印面板 | 正常弹出，“存储为 PDF”可用 |
| 页数 | 3 页，与浏览器预览一致 |
| 应用外壳 | 标题栏、侧栏、状态栏均未打印 |
| 中文与字体 | 正常，字重和字号清晰 |
| 表格 | 未跨页截断 |
| 长代码行 | 自动折行 |
| 任务列表、脚注、超长 URL | 完整显示 |

原生 PDF 保留在 `test-results/pdf-check/marklook-native.pdf`（gitignore）。

## 5. 发现的问题

| 问题 | 影响 | 处理 |
| --- | --- | --- |
| 打印样式被 `app.css` 覆盖，首轮只打印标题 | 原生 PDF 不可用 | 已拆出 `print.css` 并最后加载，复测通过 |
| WebKit 未完全遵守 `break-after: avoid`，个别标题可能落在页尾 | 排版瑕疵 | 记入 M4 打印样式细化，必要时补 `page-break-*` 旧属性 |
| 脚注标题显示英文 “Footnotes” | 中文界面不协调 | 记入 M1，渲染管线替换为“脚注” |
| 公式、Mermaid、代码高亮尚未接入 | 无法验证打印效果 | M1 接入后补一轮打印验证 |
| Windows 打印未验证 | 平台差异风险 | M4 前在 Windows 实机或虚拟机上补测 |

## 6. 结论与后续

1. 采用“系统打印面板 → 存储为 PDF”路线，暂不引入 Typst。
2. M1 接入 KaTeX / Shiki / Mermaid 后，用同一份 fixture 扩充公式、图表、代码高亮用例再验证。
3. M4 打包阶段在 Windows 上执行一次同样的打印检查，并细化标题与代码块的跨页规则。
