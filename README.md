<div align="center">

# 墨览 Marklook

**以阅读为中心的本地 Markdown 阅读器**

排版优先，安静可靠 · Tauri 2 · macOS & Windows

[![CI](https://github.com/aking1989/Marklook/actions/workflows/ci.yml/badge.svg)](https://github.com/aking1989/Marklook/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/aking1989/Marklook?include_prereleases)](https://github.com/aking1989/Marklook/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

<img src="docs/screenshots/reader.png" alt="墨览阅读视图" width="820"/>

*阅读视图：衬线排版、大纲跟随、字数统计、可调字号/行高/栏宽*

<p>
<a href="README.en.md">English</a> | 简体中文
</p>

</div>

---

墨览把「读」放在第一位：打开一篇 Markdown，得到干净、可调、安静的排版；需要修改时按 `Cmd/Ctrl+E` 进入源码模式（CodeMirror），改完再切回来——位置不丢、撤销历史不丢。

不做所见即所得，不做双栏预览，不做云同步。它是本地的、单机的、面向你自己的文档。

> **墨**，取自 Markdown 与纸墨；**览**，取自浏览与一览。它首先是一个阅读器，其次才是一个编辑器。

## ✨ 特性

**阅读体验**

- GFM 全支持：表格、任务列表、脚注、删除线；YAML frontmatter
- 数学公式（KaTeX）、代码高亮（Shiki，亮/暗双主题随主题切换）、图表（Mermaid）
- 大纲面板，滚动时当前章节自动跟随高亮，点击跳转
- 排版全部可调：字号、行高、栏宽、衬线/无衬线字体；亮色 / 暗色 / 护眼三主题
- 代码块一键复制、图片灯箱、加载失败占位

**编辑**

- CodeMirror 6 源码模式，与阅读视图一键切换，**位置与撤销历史全程保持**
- 输入法（IME）组合输入不触发全局快捷键
- 图片粘贴/拖入自动存入文档同级 `assets/` 目录并插入语法
- 大文件模式（> 2MB 自动关闭行号与高亮装饰，保持流畅）

**工作区**

- 打开文件夹即成文档库：文件树（尊重 `.gitignore`）、最近文件/工作区
- 跨文件全文搜索：中文二元组分词，「编辑器」能搜到「编辑」；1,000 文件索引约 140ms、查询约 3ms
- 文件监听：工作区文件变动自动刷新树
- 外部程序修改当前文件：干净时自动重载（保持阅读位置）；有未保存修改时弹冲突面板三选（覆盖 / 加载磁盘 / 忽略），**绝不静默丢内容**

**数据安全**

- 自动保存（800ms 去抖，可关闭）、原子写入、CRLF 与 UTF-8 BOM 原样保持
- 崩溃草稿：编辑中每 2 秒落盘，异常退出后重新打开可一键恢复

**导出与系统集成**

- HTML 单文件导出（样式、公式、高亮、本地图片全部内联，离线可开）
- 系统打印 / 导出 PDF（`Cmd/Ctrl+P`）
- `.md` 文件关联、双击打开、单实例（重复启动转交给已运行窗口）
- 原生应用菜单

## 🔒 隐私与安全

- **默认零网络**：不发起任何网络请求；远程图片显示为占位块，需手动逐张点击加载
- Markdown 中的 HTML 经 sanitize 白名单过滤，配合严格 CSP——[22 项 XSS 语料回归](tests/unit/security.test.ts)持续拦截脚本注入
- 文件访问基于 allowlist：只有你打开过的文件/文件夹（及其资源目录）可读；资源协议 `mdasset://` 仅允许图片扩展名，路径经规范化与符号链接逃逸校验

## 📊 性能

以下为开发机（Apple Silicon）实测，基准随仓库内测试持续运行：

| 指标 | 实测 | 预算 |
| --- | --- | --- |
| 冷启动到窗口出现（macOS） | ~195ms | < 1s |
| 100KB 文档渲染 | ~200ms | < 200ms |
| 1,000 文件搜索索引 / 单次查询 | 141ms / 3ms | < 2s / < 50ms |
| 1MB 文档内打字（单次事务 p95） | 0.32ms | < 16ms |

## ⬇️ 下载安装

从 [Releases](https://github.com/aking1989/Marklook/releases) 下载对应平台安装包：

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| macOS 12+（Apple Silicon / Intel） | `Marklook_x.y.z_universal.dmg` | 拖入 Applications |
| Windows 10 22H2+ / 11（x64） | `Marklook_x.y.z_x64-setup.exe` | NSIS 安装向导，含 WebView2 引导 |

当前为未签名构建，首次打开：

- **macOS**：右键 Marklook.app → 打开 → 再点「打开」；或 `xattr -d com.apple.quarantine /Applications/Marklook.app`
- **Windows**：SmartScreen 提示时选「仍要运行」

安装包完整性见 Release 内附的 `SHA256SUMS.txt`。签名与公证的启用计划见 [docs/06-signing.md](docs/06-signing.md)。

## ⌨️ 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Cmd/Ctrl+O` | 打开文件 |
| `Cmd/Ctrl+E` | 阅读视图 ⇄ 源码模式 |
| `Cmd/Ctrl+S` | 保存 |
| `Cmd/Ctrl+P` | 打印 / 导出 PDF |
| `Cmd/Ctrl+Shift+E` | 导出 HTML 单文件 |
| `Cmd/Ctrl+=` / `-` / `0` | 放大 / 缩小 / 重置字号 |

## 🛠 从源码构建

要求：Node.js 24+、pnpm 12+、Rust stable（macOS 需 Xcode CLT；Windows 需 VS Build Tools 与 WebView2）。

```bash
git clone https://github.com/aking1989/Marklook.git
cd Marklook
pnpm install

pnpm dev           # 浏览器 + Mock 文件系统（无需 Rust，快速预览 UI）
pnpm tauri dev     # 桌面应用开发模式
pnpm tauri build   # 产出当前平台安装包（src-tauri/target/release/bundle/）
```

## 🧪 开发与测试

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test              # Vitest：单元测试 + 安全语料 + 性能基准 + 文档 mermaid 校验
pnpm test:e2e          # Playwright 端到端
cd src-tauri
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

- 前端：Vitest 117 项（渲染管线、搜索、安全语料、性能基准、设置边界、狗粮回归）+ Playwright 25 项 E2E（含 axe 可访问性扫描）
- Rust：52 项（IO/EOL-BOM 往返、allowlist 与路径逃逸、mdasset 协议、文件监听、草稿、MockRuntime IPC 集成）
- CI：ubuntu 跑前端全量门禁，macOS 与 Windows 双平台跑 Rust（`.github/workflows/ci.yml`）；打 `v*` tag 自动构建双平台安装包并发布 Release

深入设计见 [docs/](docs/)：[概要设计](docs/01-architecture.md)（架构/ADR/风险）、[详细设计](docs/02-detailed-design.md)（渲染管线/平台层/工作区/安全）、[测试方案](docs/03-test-plan.md)、[开发计划](docs/04-development-plan.md)、[PDF 验证报告](docs/05-pdf-verification.md)、[签名说明](docs/06-signing.md)、[狗粮记录](docs/07-dogfood.md)。设计文档中的图均为 Mermaid，可直接阅读渲染效果。

## 🗺 路线图

- **v1.1**：页内查找、命令面板、多标签页、冲突差异对比视图、自定义字体导入、自动更新（含签名）
- **v1.2**：`[[wikilink]]` 双链、标签检索、导出更多格式、打印页眉页脚模板
- 明确不做：WYSIWYG、双栏预览、云同步/协作、插件系统、移动端

## ⚠️ 已知限制

- **超大文档渲染慢**：上游 `remark-parse` 对 1MB 级混合文档解析呈超线性（实测约 9s，纯列表最坏更久）。应用已做降级（跳过高亮/公式、大纲截断、打开提示），根治需替换解析器，列入 v1.1 评估
- 导出 HTML 不内嵌 KaTeX 字体文件（体积考虑），离线打开时公式回退系统衬线字体，仍可读
- 搜索索引在工作区打开时全量构建，暂不增量更新
- 安装包当前未签名（见上文下载说明）

## 🤝 贡献

欢迎 issue 与 PR！开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)（环境搭建、提交规范、完成定义）。特别欢迎：真实文档的渲染 bug（附最小复现源码）、Windows 平台问题、中文排版改进。

## 📄 许可证

[MIT](LICENSE) © 2026 aking1989 and Marklook contributors

## 🙏 致谢

墨览站在这些优秀项目的肩膀上：

[Tauri](https://tauri.app/) · [CodeMirror 6](https://codemirror.net/) · [unified / remark / rehype](https://unifiedjs.com/) · [Shiki](https://shiki.style/) · [Mermaid](https://mermaid.js.org/) · [KaTeX](https://katex.org/) · [MiniSearch](https://lucaong.github.io/minisearch/) · [Zustand](https://zustand.docs.pmnd.rs/)

> 本项目的设计文档即用墨览自身阅读与渲染——所有图（Mermaid）都经过它的渲染管线验证。
