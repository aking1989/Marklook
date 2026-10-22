# 墨览 Marklook

跨 macOS / Windows 的本地 Markdown 阅读编辑器。以阅读体验为主，`Cmd/Ctrl+E` 在**阅读视图**与**源码编辑模式**之间切换，交互参照 Typora 的阅读视图 / 源码模式，但不做所见即所得的行内渲染。

> 当前状态：**M0 开发中**。Tauri 应用可启动，已跑通打开（Mock）→ 阅读 → `Cmd/Ctrl+E` 源码 → 保存的主链路；原生文件对话框与 Windows 构建待验证。

## 快速开始

```bash
pnpm install
pnpm dev            # 浏览器 + Mock 文件系统，便于快速迭代
pnpm tauri dev      # 桌面应用（需要 Rust 工具链）
pnpm typecheck
pnpm test:e2e       # Playwright，使用本机 Chrome
cd src-tauri && cargo test
```

Rust 通过 rustup 安装后，如终端找不到 `cargo`，执行 `source ~/.cargo/env` 或重新打开终端。项目内 `.cargo/config.toml` 是本机 Cargo 镜像配置（已 gitignore）。

## 命名

**墨览（Marklook）**：墨指 Markdown 与纸墨，览指浏览、阅读，强调这是一款阅读器，而不是编辑器。

| 用途 | 名称 |
| --- | --- |
| 应用显示名 | 墨览 |
| 英文名 / 可执行文件 | Marklook |
| bundle id（暂定） | `com.marklook.reader` |
| 日志与配置目录 | Marklook |

## 核心决策

| 项 | 选择 |
| --- | --- |
| 桌面外壳 | Tauri 2（复用系统 WebView，安装包约 10MB） |
| 前端 | React 19 + TypeScript 6 + Vite 8 |
| 编辑器 | CodeMirror 6（源码模式） |
| 渲染 | unified / remark / rehype + KaTeX + Shiki + Mermaid |
| 搜索 | MiniSearch + Web Worker（中文分词） |
| 安全 | HTML sanitize + 严格 CSP + 路径 allowlist |
| PDF | 系统打印对话框（备选：Rust + Typst） |
| 分发 | macOS universal / Windows NSIS |

## 文档

| 文档 | 内容 |
| --- | --- |
| [概要设计](./docs/01-architecture.md) | 背景、目标、技术选型、总体架构、模块划分、数据流、状态模型、ADR、风险 |
| [详细设计](./docs/02-detailed-design.md) | 工程结构、平台接口、渲染管线、阅读/编辑视图、滚动同步、工作区、搜索、保存与冲突、导出、安全、性能、构建 |
| [测试方案](./docs/03-test-plan.md) | 测试分层、单元/组件/E2E/Rust 用例、安全与性能测试、双平台手动矩阵、CI 门禁 |
| [开发计划](./docs/04-development-plan.md) | 里程碑、WBS、周计划、风险登记、质量门禁、发布计划、后续路线图 |

## v1.0 范围

- 打开文件 / 文件夹，文件树、大纲、跨文件搜索、最近记录。
- 阅读排版：字号、行高、栏宽、字体、亮/暗/护眼主题。
- GFM、YAML frontmatter、KaTeX、Mermaid、Shiki 代码高亮、脚注、任务列表。
- 阅读 / 源码双模式切换，保持位置与撤销历史。
- 保存、自动保存、外部修改检测、冲突解决、崩溃草稿恢复。
- 图片粘贴并保存到 `assets/`。
- HTML 单文件导出、系统打印 / PDF。
- 文件关联、单实例、原生菜单、快捷键、窗口状态记忆。

## 明确不做（v1.0）

- 所见即所得（WYSIWYG）、双栏实时预览。
- 云同步、协作、账号。
- 插件系统、主题市场。
- 多标签页、移动端。
- `[[wikilink]]` / 双链。

## 开发前置条件

- macOS：Xcode Command Line Tools、Rust stable、Node.js 24、pnpm 12。
- Windows 构建：Visual Studio Build Tools（C++）、Rust MSVC 工具链、WebView2 Runtime。
- 跨平台安装包通过 GitHub Actions 构建。

具体步骤在设计评审通过后补充到 `CONTRIBUTING.md`。

## 目录

```text
docs/            设计文档（当前）
src/             前端源码（待实现）
src-tauri/       Rust 后端（待实现）
tests/           单元 / E2E / fixtures（待实现）
```

## 待确认

产品名已定为**墨览（Marklook）**，bundle id 暂定 `com.marklook.reader`，发布前确认域名与商标。其余需要拍板的事项见[概要设计 §14](./docs/01-architecture.md#14-开放问题评审时确认)，包括远程图片默认策略、代码签名方式、多标签页排期等。
