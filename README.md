# 墨览 Marklook

跨 macOS / Windows 的本地 Markdown 阅读编辑器。以阅读体验为主，`Cmd/Ctrl+E` 在**阅读视图**与**源码编辑模式**之间切换，交互参照 Typora 的阅读视图 / 源码模式，但不做所见即所得的行内渲染。

> 当前状态：**v0.9.0 RC——M0–M5 全部里程碑完成，功能冻结**。M0：主链路与 PDF 打印验证。M1：完整渲染管线（frontmatter/KaTeX/Shiki/Mermaid/资源协议）、滚动同步与大纲跟随、排版设置。M2：工作区（文件夹扫描/文件树/最近记录）、跨文件搜索（MiniSearch Worker + 中文二元组分词，1,000 文件索引 141ms、查询 3ms）、文件监听（notify 去抖）、外部变更检测与冲突面板（覆盖/加载磁盘/忽略）、自动保存（800ms，可关）、崩溃草稿恢复（2s 去抖落盘，打开时提示恢复）。M3：图片粘贴/拖入自动存入 assets/ 并插入语法、撤销历史与位置跨模式切换保持、IME 组合输入与全局快捷键互斥、大文件模式（>2MB/25k 行降级：跳过高亮与行号装饰，状态栏标识）。M4：HTML 单文件导出（四套样式内联、本地图片 data URI、等待 Mermaid 渲染完成）、原生菜单（文件/系统编辑/视图，动作经事件桥接前端）、单实例与文件关联冷启动（命令行 .md 转交）、脏状态退出三选确认、release workflow（tag 触发 macOS universal + Windows NSIS + GitHub Release）；本地验证 Rust release 编译与 app bundle 产出。M5：22 项安全语料回归、渲染/搜索性能基准入 CI（预算按实测修订，见 CHANGELOG 与开发计划变更记录）、CHANGELOG 建立、版本 0.9.0。质量门禁：Vitest 96 项、Playwright 24 项 E2E（含 axe 可访问性扫描）、cargo fmt/clippy/test 51 项（含 tauri MockRuntime IPC 集成测试）、Windows 交叉编译检查，本地全绿；冷启动实测中位数 195ms（macOS，窗口出现，预算 < 1s）。安装包由 tag 触发的 release workflow 构建（macOS universal dmg + Windows NSIS）。

## 快速开始

```bash
pnpm install
pnpm dev            # 浏览器 + Mock 文件系统，便于快速迭代
pnpm tauri dev      # 桌面应用（需要 Rust 工具链）
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test           # Vitest 单元测试
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
| [PDF 验证报告](./docs/05-pdf-verification.md) | 系统打印路由、打印样式、macOS 实机结果与已知问题 |
| [签名与分发说明](./docs/06-signing.md) | 现状（未签名）、macOS 公证与 Windows 签名的启用步骤 |

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
docs/            设计文档
src/             前端源码（React 19 + TS：渲染管线、阅读/编辑视图、Platform 层、stores）
src-tauri/       Rust 后端（IO、对话框、系统打印、状态与权限）
tests/           单元 / E2E / fixtures
```

## 待确认

产品名已定为**墨览（Marklook）**，bundle id 暂定 `com.marklook.reader`，发布前确认域名与商标。其余需要拍板的事项见[概要设计 §14](./docs/01-architecture.md#14-开放问题评审时确认)，包括远程图片默认策略、代码签名方式、多标签页排期等。
