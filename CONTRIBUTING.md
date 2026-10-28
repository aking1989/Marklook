# 贡献指南（Contributing）

感谢考虑为墨览（Marklook）做贡献！本文档说明开发环境搭建、代码规范与提交流程。

## 开发环境

| 要求    | 版本                                                                             |
| ------- | -------------------------------------------------------------------------------- |
| Node.js | 24+                                                                              |
| pnpm    | 12+                                                                              |
| Rust    | stable（rustup 安装，`aarch64/x86_64-apple-darwin` 与 `x86_64-pc-windows-msvc`） |
| 系统    | macOS 需 Xcode Command Line Tools；Windows 需 VS Build Tools（C++）与 WebView2   |

```bash
pnpm install
pnpm tauri dev      # 桌面应用开发模式
pnpm dev            # 浏览器 + Mock 文件系统（无需 Rust，快速迭代 UI）
```

## 开发流程

1. 从 `main` 拉出特性分支（如 `feat/outline-search`）。
2. 开发并保持提交粒度清晰——**一个功能点一个 commit**，便于审查。
3. 本地跑完全部门禁再提交：

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test              # Vitest 单元测试（含文档 mermaid 语法校验、性能基准）
pnpm test:e2e          # Playwright E2E
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

4. 提交 PR 到 `main`。CI 会跑同样的门禁（ubuntu 前端全量 + macOS/Windows Rust）。

## 打包资源

macOS 安装窗口的背景图 `src-tauri/icons/dmg-background.png` 由脚本生成，改文案或配色后重跑即可
（需要 Pillow，中文字体用系统的 Hiragino Sans GB）：

```bash
python3 tools/generate-dmg-background.py
```

应用图标源图 `design/icon-1024.png` 同样由脚本生成，改完重跑再导出全平台图标：

```bash
python3 tools/generate-app-icon.py          # 生成 design/icon-1024.png
pnpm tauri icon design/icon-1024.png        # 导出 icns / ico / 各尺寸 png
rm -rf src-tauri/icons/android src-tauri/icons/ios   # 桌面项目用不到
```

**不要手工替换单个尺寸的图标**——历史上 `icon.icns`（带深色底板）和各 PNG（纯透明）
就是这样变得不一致的。统一从源图重新导出。

图中图标位置必须与 `src-tauri/tauri.conf.json` 的 `bundle.macOS.dmg.appPosition` /
`applicationFolderPosition` 保持一致——它们是**图标中心点**，不是左上角。窗口 660×400 含标题栏，
内容区实际约 361pt，所以底部留白给裁切，正文内容不要画到 350pt 以下。

画箭头时注意：**不要按 128pt 格子边界算端点**。实测应用图标可见右缘在 233pt、
Applications 文件夹可见左缘在 418pt（文件夹图标比格子更宽，且两者视觉中心分别比格子中心
低约 1.25pt / 4.25pt）。箭头取 `233+8 → 418-8`、垂直取 172.5 才左右对称、上下居中。

## 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，描述用中文：

```
feat(m1): Shiki 双主题代码高亮（懒加载 + LRU 缓存）
fix(ci): 测试 exe 嵌入 comctl32 v6 manifest
docs: 概要设计 6 个 ASCII 图转 Mermaid
```

类型：`feat` / `fix` / `docs` / `test` / `refactor` / `perf` / `ci` / `chore`。括号内为里程碑或模块 scope。

## 完成定义（DoD）

- 核心逻辑有单元测试；交互有组件或 E2E 测试。
- 性能路径的改动记录一次基准（`tests/perf/`）。
- 用户可见错误有中文提示，不暴露堆栈。
- 涉及架构/接口的改动，同步更新 `docs/` 下对应设计文档——**代码与文档必须一致**。
- 涉及文档中的图，使用 Mermaid（语法由 `docsMermaid` 测试校验）。

## 报告问题

提 issue 时请附：系统与版本、复现步骤、期望/实际行为、最小复现文档（Markdown 源码而非截图）、日志（日志目录见「帮助 → 打开日志目录」）。安全类问题（XSS、路径逃逸等）请勿公开提 issue，先通过仓库主页联系方式私下报告。

## 行为准则

保持友善与专业。对事不对人，讨论以改进项目为目标。
