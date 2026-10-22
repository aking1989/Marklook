# 墨览（Marklook）概要设计

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1（草案） |
| 日期 | 2026-10-21 |
| 状态 | 待评审 |
| 关联文档 | [详细设计](./02-detailed-design.md) · [测试方案](./03-test-plan.md) · [开发计划](./04-development-plan.md) |

---

## 1. 背景与目标

做一个跨 macOS / Windows 的本地 Markdown 阅读编辑器。核心定位是**阅读优先**：以接近纸质排版的阅读视图为主，需要修改时通过快捷键切换到源码编辑模式，退出编辑后回到阅读视图。交互参照 Typora 的"阅读视图 / 源码模式"切换，但不做 Typora 那种所见即所得的在行渲染。

### 1.1 目标

- 打开本地 Markdown 文件或文件夹，获得干净、精致、可长期阅读的排版体验。
- 阅读模式与源码模式一键切换，切换时保持阅读位置和编辑撤销历史。
- 支持技术写作常见内容：GFM、数学公式、Mermaid、代码高亮、图片、脚注。
- 工作区能力：文件树、大纲、跨文件全文搜索。
- 导出：单文件 HTML、通过系统打印导出 PDF。
- 数据安全：原子写入、外部修改检测、冲突处理、崩溃草稿恢复。
- 分发：macOS（Apple Silicon + Intel）与 Windows 10/11 安装包。

### 1.2 非目标（v1.0 明确不做）

- 所见即所得（WYSIWYG）行内渲染、双栏实时预览。
- 云同步、协作、账号体系。
- 插件系统、主题市场。
- 移动端。
- 多标签页、多窗口（列入 v1.1）。
- `[[wikilink]]` / 双链 / 知识图谱（列入 v2）。
- 自动更新（列入 v1.1）。

---

## 2. 用户与核心场景

目标用户：需要长期阅读和轻度编辑本地 Markdown 的开发者、写作者、研究者。

| 场景 | 描述 | 关键需求 |
| --- | --- | --- |
| S1 阅读单篇文档 | 从 Finder / 资源管理器双击 `.md` 打开 | 快速启动、排版舒适、记住阅读位置 |
| S2 浏览一个文档库 | 打开一个文件夹作为工作区 | 文件树、大纲、跨文件搜索 |
| S3 修改一段内容 | 阅读中按 `Cmd/Ctrl+E` 进入源码模式，改完再切回 | 光标定位准确、切换无感、自动保存 |
| S4 阅读技术文档 | 含公式、图表、代码块、图片 | 渲染正确、可复制代码、图片可查看 |
| S5 分享文档 | 导出 HTML 或 PDF | 样式与阅读视图一致、单文件可离线打开 |
| S6 外部修改 | 文档被其他编辑器或同步盘修改 | 不丢数据、冲突可解决 |

---

## 3. 设计原则

1. **阅读优先**：所有技术选择优先服务排版、启动速度和内存占用；编辑能力保持"够用"。
2. **单一数据源**：阅读视图、编辑视图、HTML 导出、打印共用同一套渲染管线和同一套 CSS。
3. **本地优先**：默认不发起任何网络请求；远程图片默认不加载。
4. **最小权限**：WebView 只能读写用户显式打开过的目录；所有路径在 Rust 侧做 allowlist 校验。
5. **平台可替换**：UI 只依赖一个 `Platform` 接口，Electron 迁移或浏览器调试成本可控。
6. **失败安全**：保存原子化；冲突不覆盖；崩溃可恢复；渲染错误不影响应用其余部分。
7. **可测试**：渲染管线、滚动映射、搜索索引等核心逻辑是纯函数，可在 Node 环境中测试。

---

## 4. 范围

### 4.1 v1.0 功能清单

| 编号 | 功能 | 优先级 |
| --- | --- | --- |
| F1 | 打开文件 / 文件夹、最近文件 | P0 |
| F2 | 阅读视图与排版设置（字号、行高、栏宽、字体、主题） | P0 |
| F3 | `Cmd/Ctrl+E` 阅读 / 源码模式切换，位置保持 | P0 |
| F4 | GFM 渲染、代码高亮、KaTeX、Mermaid | P0 |
| F5 | 保存、自动保存、外部修改检测、冲突处理 | P0 |
| F6 | 文件树、大纲、跨文件搜索 | P0 |
| F7 | 图片粘贴/拖入并本地保存 | P1 |
| F8 | HTML 单文件导出、系统打印 / PDF | P1 |
| F9 | 文件关联、单实例、原生菜单、快捷键 | P1 |
| F10 | 草稿恢复、最近工作区、窗口状态记忆 | P1 |
| F11 | 阅读视图页内查找 | P2 |
| F12 | 代码块复制、图片灯箱 | P2 |

### 4.2 内容语法支持

| 语法 | v1.0 |
| --- | --- |
| CommonMark | 支持 |
| GFM（表格、任务列表、删除线、自动链接、脚注） | 支持 |
| 数学公式 `$...$` / `$$...$$` | 支持（KaTeX） |
| Mermaid 代码块 | 支持 |
| YAML frontmatter | 支持（读取 title 等元数据） |
| 内嵌 HTML | 支持，但必须过 sanitize |
| wikilink、MDX、admonition、定义列表 | 不做 |

---

## 5. 技术选型

### 5.1 选型结论

| 领域 | 选择 | 版本（2026-10 核实） | 理由 |
| --- | --- | --- | --- |
| 桌面外壳 | **Tauri 2** | 2.12.x | 复用系统 WebView，安装包约 10MB、内存低、启动快；Rust 后端适合做文件与安全边界 |
| 前端框架 | React + TypeScript | 19.3.x / 6.0.x | 生态最大，问题容易检索；TS 提供接口约束 |
| 构建 | Vite | 8.3.x | Tauri 官方支持，开发热更新快 |
| 包管理 | pnpm | 12.x | 已安装，磁盘占用低 |
| 编辑器内核 | CodeMirror 6 | 6.43.x | 体积远小于 Monaco；Markdown 与语言数据支持好；易于主题化 |
| Markdown 解析 | unified / remark / rehype | unified 11 / remark-parse 11 | AST 可控，插件生态完整，位置信息保留 |
| GFM | remark-gfm | 4.x | 表格、任务列表、脚注、自动链接 |
| 数学 | remark-math + rehype-katex + KaTeX | 6.x / 7.x / 0.19 | 成熟、离线可用、输出可控 |
| 代码高亮 | Shiki（核心 + 按需语言） | 4.5.x | 高亮结果与 VS Code 接近；懒加载控制体积 |
| 图表 | Mermaid | 12.2.x | 事实标准；仅在有 mermaid 代码块时加载 |
| 全文搜索 | MiniSearch + Web Worker | 7.2.x | 轻量、支持前缀/模糊/字段权重；可自定义 CJK 分词 |
| 状态管理 | Zustand | 5.x | 体积小，避免 Context 重渲染 |
| 本地存储 | tauri-plugin-store | 2.5.x | JSON 配置持久化 |
| 窗口状态 | tauri-plugin-window-state | 2.5.x | 记住窗口尺寸位置 |
| 单实例 | tauri-plugin-single-instance（Rust） | 2.x | 文件关联二次打开转发 |
| 原生对话框 | tauri-plugin-dialog（Rust 侧调用） | 2.8.x | 对话框与 allowlist 注册在同一侧完成 |
| 图标 | lucide-react | 最新 | 风格统一、按需引入 |
| 单元测试 | Vitest | 5.x | 与 Vite 同源 |
| E2E | Playwright（Web 构建 + Mock 平台） | 1.64.x | macOS 上无法用 tauri-driver，Web 模式最实际 |
| Rust 测试 | cargo test + tempfile | — | 文件与扫描逻辑 |

### 5.2 为什么不是 Electron

Electron 生态更成熟，Typora、Obsidian 都是 Electron 应用，证明它完全可以做出优秀阅读体验。放弃它的原因是产品定位：

- 阅读器希望"像原生小工具"：安装包 10MB 级、冷启动 1 秒内、常驻内存低。
- 业务后端只有文件读写、目录扫描、监听、打印，Rust 实现简单，且比 Node 更接近 C/C++ 使用者的知识结构。
- 代价是 WebView 双内核（macOS WebKit / Windows Chromium）需要双端验证，Tauri 生态资料也少一些。通过双平台 CI 与手动矩阵覆盖。

### 5.3 为什么不做 WYSIWYG

Typora 的按行渲染是自研、闭源且复杂度极高。本产品把问题拆成两个稳定视图：

- 阅读视图：渲染好的 HTML，只读。
- 源码视图：CodeMirror 显示原始 Markdown。

这使渲染管线、导出、打印可以完全复用，风险显著降低。若未来要做行内渲染，可在编辑器层增加装饰器，不影响现有架构。

---

## 6. 总体架构

### 6.1 架构图

```text
┌──────────────────────────────────────────────────────────────────┐
│                        WebView（UI 层，无 Node 权限）              │
│  React 19 + TypeScript                                           │
│                                                                  │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Reader    │  │ Editor    │  │ Workspace  │  │ Settings/UI │  │
│  │ 渲染 HTML │  │ CM6 源码  │  │ 树/搜索/大纲│  │ 菜单/通知   │  │
│  └─────┬─────┘  └─────┬─────┘  └─────┬──────┘  └──────┬──────┘  │
│        └──────────────┴──────────────┴────────────────┘          │
│                              │                                   │
│                    Platform Adapter（接口层）                     │
└──────────────────────────────┼───────────────────────────────────┘
                               │ Tauri IPC（invoke / emit）
┌──────────────────────────────┴───────────────────────────────────┐
│                       Rust Core（Tauri 2）                       │
│                                                                  │
│  allowlist 校验 │ 文档 I/O │ 目录扫描 │ 文件监听 │ 打印 │ 导出    │
│  自定义资源协议 mdasset:// │ 草稿存储 │ 路径与编码处理             │
│                                                                  │
│  插件：dialog(原生对话框) · store(设置) · window-state ·           │
│        single-instance                                           │
└──────────────────────────────┬───────────────────────────────────┘
                               │
          ┌────────────────────┴────────────────────┐
          │                                         │
   macOS: WKWebView                          Windows: WebView2
   (WebKit)                                  (Chromium)
```

### 6.2 分层职责

| 层 | 职责 | 不做什么 |
| --- | --- | --- |
| 视图层（React） | 布局、交互、面板、快捷键分发、状态展示 | 不直接访问文件系统 |
| 领域层（TS 纯逻辑） | Markdown 管线、大纲、滚动映射、搜索索引、设置迁移 | 不依赖 DOM 以外的浏览器能力 |
| 平台适配层 | 把平台能力抽象成 `Platform` 接口 | 不包含业务逻辑 |
| Rust Core | 文件、路径、监听、打印、资源协议、安全边界 | 不做 Markdown 解析 |
| 系统 WebView | 渲染 DOM 与执行 JS | — |

### 6.3 进程与线程模型

- **Rust 主进程**：窗口、菜单、命令、监听。文件操作在异步任务中执行，避免阻塞 UI。
- **WebView 渲染进程**：React、CodeMirror、渲染管线、Mermaid。
- **Web Worker**（前端）：搜索索引构建与查询，避免长任务卡顿。
- **文件监听线程**：Rust 侧 `notify` 工作线程 + 去抖，事件通过 `emit` 推送给前端。

---

## 7. 模块划分

### 7.1 源码目录

```text
marklook/
├── docs/                          # 设计文档
├── src/
│   ├── main.tsx                   # 入口
│   ├── app/
│   │   ├── App.tsx                # 应用壳与布局
│   │   ├── providers/             # 主题、Toast、错误边界
│   │   └── commands.ts            # 应用命令注册与分发
│   ├── features/
│   │   ├── document/              # 文档会话、打开、保存、冲突
│   │   ├── reader/                # 阅读视图、页内查找、图片灯箱
│   │   ├── editor/                # CodeMirror、键位、粘贴
│   │   ├── workspace/             # 文件树、最近、工作区
│   │   ├── outline/               # 大纲
│   │   ├── search/                # 搜索面板与 Worker
│   │   ├── export/                # HTML / 打印
│   │   └── settings/              # 设置面板
│   ├── markdown/                  # 渲染管线（纯逻辑）
│   │   ├── pipeline.ts
│   │   ├── plugins/
│   │   └── schema.ts
│   ├── platform/                  # 平台适配
│   │   ├── types.ts
│   │   ├── tauri.ts
│   │   └── mock.ts
│   ├── stores/                    # Zustand stores
│   ├── styles/                    # 设计变量、阅读样式、编辑器样式
│   ├── lib/                       # 滚动映射、路径、防抖、哈希
│   └── i18n/                      # 文案表
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── commands/              # 命令
│   │   ├── io/                    # 原子写、编码
│   │   ├── scan/                  # 目录扫描与忽略规则
│   │   ├── watch/                 # 文件监听
│   │   ├── assets/                # mdasset:// 协议
│   │   ├── menu.rs
│   │   └── open.rs                # 文件关联 / 单实例 / argv
│   ├── capabilities/
│   └── tauri.conf.json
├── tests/
│   ├── unit/
│   ├── e2e/
│   └── fixtures/
└── package.json
```

### 7.2 模块职责表

| 模块 | 职责 | 关键产出 |
| --- | --- | --- |
| `document` | 文档生命周期、脏状态、保存、冲突、草稿 | `documentStore`、`DocumentSession` |
| `markdown` | Markdown → 安全 HTML、大纲、元数据 | `renderMarkdown()` 纯函数 |
| `reader` | 展示 HTML、链接/图片交互、页内查找 | `ReaderView` |
| `editor` | CodeMirror 实例、语法高亮、粘贴图片、查找替换 | `EditorViewHost` |
| `workspace` | 文件夹打开、文件树、最近记录 | `workspaceStore` |
| `outline` | 标题树与当前位置联动 | `OutlinePanel` |
| `search` | 索引构建、查询、结果定位 | `search.worker.ts` |
| `export` | HTML 导出、打印/PDF | `exportHtml()`、`printDocument()` |
| `settings` | 设置面板、持久化、迁移 | `settingsStore` |
| `platform` | 平台能力接口与实现 | `Platform`、`TauriPlatform`、`MockPlatform` |
| Rust `io` | 原子写、编码/EOL 检测、冲突检测 | `write_document` |
| Rust `scan` | 目录遍历、忽略规则、内容读取 | `scan_vault` |
| Rust `watch` | 文件变更监听、去抖、事件推送 | `fs://change` |
| Rust `assets` | 本地图片协议 | `mdasset://local/...` |
| Rust `open` | 文件关联、单实例、命令行参数 | 待打开路径队列 |

---

## 8. 核心数据流

### 8.1 打开并阅读

```text
用户双击 .md / 菜单打开
        │
        ▼
Rust：校验路径 → 加入 allowlist → 读取字节
        │  返回 { content, mtimeMs, size, eol, bom }
        ▼
documentStore：状态 loading → clean，记录基准 mtime
        │
        ▼
renderMarkdown(content, docDir, options)  ← 纯函数
        │  返回 { html, outline, frontmatter, meta }
        ▼
ReaderView：innerHTML + 事件委托
        │
        ▼
滚动映射建立 line-map（data-line-start/end）
```

### 8.2 编辑并保存

```text
Cmd/Ctrl+E
   │ 阅读位置（顶部行）→ CodeMirror scrollIntoView
   ▼
编辑：CM6 为内容的权威来源，变更去抖镜像到 store
   │
   ├── Cmd/Ctrl+S / 自动保存
   ▼
write_document(path, content, expectedMtime, force=false)
   │
   ├── mtime 一致 → 临时文件 + fsync + rename → 返回新 mtime
   └── mtime 不一致 → CONFLICT → 前端弹出解决面板
```

### 8.3 外部修改

```text
notify 事件（去抖 300ms）
   │
   ▼
前端收到 fs://change
   │
   ├── 非当前文件 → 更新文件树/搜索索引（去抖）
   └── 当前文件 → stat + 读内容
          │
          ├── 本地无未保存修改 → 静默重载，保持阅读行
          └── 本地有未保存修改
                 ├── 磁盘内容 == 本地内容 → 清除脏状态
                 └── 不同 → conflict 状态，显示解决条
```

### 8.4 导出

```text
当前内容（编辑态取 CM 文档，阅读态取 store）
        │
        ▼
同一渲染管线 → RenderResult.html
        │
        ├── HTML：内联 CSS、KaTeX 字体、Shiki 样式、图片 base64/同目录资源
        │         → Rust 打开保存对话框并写入
        └── PDF：确保阅读视图已渲染 → Rust WebviewWindow::print()
                  → 系统打印对话框 → 另存为 PDF
```

---

## 9. 状态模型

### 9.1 文档状态机

```text
             OPEN                LOADED
  empty ──────────▶ loading ──────────────▶ clean
                                              │
                                    EDIT / 修改内容
                                              ▼
                                           ┌───────┐
                              SAVE_OK      │ dirty │
                         ┌──────────────────┤       │
                         │                  └───┬───┘
                         ▼                      │ 外部内容不同
                      clean                     ▼
                                           ┌──────────┐
                                           │ conflict │
                                           └────┬─────┘
                              覆盖 / 重载 / 另存为│
                                                ▼
                                           clean / 新文档
```

补充规则：

- `dirty` 的判定是"当前内容 ≠ 上次成功保存的内容"，不是简单的"发生过输入"，因此撤销回原状会自动变干净。
- `saving` 是 `dirty` 的子状态，保存失败回到 `dirty` 并提示。
- 关闭窗口、切换文件、退出应用前若为 `dirty`，必须经过保存确认。

### 9.2 Zustand Store 划分

| Store | 内容 | 持久化 |
| --- | --- | --- |
| `settingsStore` | 主题、排版、编辑器、文件、UI 偏好 | `store` 插件，防抖 300ms |
| `workspaceStore` | 根目录、文件树、展开状态、最近文件/文件夹 | 部分持久化（最近记录） |
| `documentStore` | 路径、内容、基准 mtime、脏状态、模式、大纲、冲突 | 草稿单独持久化 |
| `uiStore` | 侧栏、面板、Toast、对话框 | 部分持久化（侧栏宽度） |

约束：编辑模式下**每次按键不写入 React store**。CodeMirror 是权威内容源，store 只在以下时机同步：去抖 300ms 的状态检查、自动保存、模式切换、导出、关闭。避免大文档输入时整棵树重渲染。

---

## 10. 模式切换与位置保持（设计约束）

- 阅读 → 编辑：取阅读视口顶部对应的源码行，光标放到该行行首，CodeMirror 滚动到该行，并聚焦。
- 编辑 → 阅读：取编辑器视口顶部行（或光标行，可配置，默认光标行），渲染后滚动到对应块。
- CodeMirror 实例**首次进入编辑模式时创建，之后保持挂载并隐藏**，以保留撤销历史和滚动位置；重新显示时调用 `requestMeasure()`。
- 阅读视图重渲染后需等待字体与图片加载完成再恢复位置，避免布局跳动导致偏移。

详细算法见[详细设计 §7](./02-detailed-design.md#7-模式切换与滚动同步)。

---

## 11. 非功能需求

### 11.1 性能预算

| 指标 | 目标 | 测量方式 |
| --- | --- | --- |
| 冷启动到可交互 | macOS < 1.0s；Windows < 2.0s | release 包，三次取中位数 |
| 打开 100KB 文档并完成渲染 | < 150ms | 内部 `performance.mark` |
| 打开 1MB 文档并完成渲染 | < 600ms | 同上 |
| 模式切换 | 100KB < 80ms；1MB < 300ms | 同上 |
| 输入延迟 p95 | < 16ms | Playwright 输入轨迹 + 内部计时 |
| 1,000 文件索引构建 | < 2s | Worker 内计时 |
| 搜索查询 | < 50ms | Worker 内计时 |
| 空闲常驻内存 | < 120MB | 活动监视器 / 任务管理器 |
| 安装包 | macOS universal < 25MB；Windows x64 < 15MB | 构建产物 |

### 11.2 兼容性

| 项 | 要求 |
| --- | --- |
| macOS | 12 Monterey 及以上；Apple Silicon 与 Intel（universal 包） |
| Windows | 10 1809+ / 11，x64；依赖常青版 WebView2 |
| 显示缩放 | 100% / 125% / 150% / 200% |
| 输入法 | macOS 拼音、Windows 微软拼音完整可用 |
| 路径 | 中文、空格、长路径、OneDrive 同步目录 |
| 主题 | 亮色、暗色、护眼；跟随系统 |
| 语言 | v1 中文界面，文案表结构支持后续英文 |

### 11.3 安全

- 威胁模型：恶意 Markdown 文件、内嵌 HTML、指向本地/远程资源的链接、路径穿越。
- 控制措施：HTML sanitize、严格 CSP、路径 allowlist、自定义资源协议校验、默认不加载远程内容、外链仅允许 http/https 且交给系统浏览器。
- 详见[详细设计 §17](./02-detailed-design.md#17-安全设计)。

### 11.4 可观测性

- Rust 使用 `tracing` 写滚动日志（单个文件上限 5MB，保留 3 个）。
- 前端错误边界捕获并上报到 Rust 日志。
- 开发模式提供诊断面板（渲染耗时、line-map 重建次数、索引状态、allowlist）。

---

## 12. 架构决策记录（ADR）

### ADR-001：使用 Tauri 2 而非 Electron

- **背景**：阅读器需要小体积、低内存、快启动；开发者只熟悉 C/C++。
- **决策**：Tauri 2 + Rust 后端 + React 前端。
- **理由**：系统 WebView 复用；Rust 与 C/C++ 知识结构接近；文件能力集中在一处便于审计。
- **代价**：双 WebView 内核兼容性测试；Tauri 生态资料少于 Electron；Windows 安装需 WebView2。

### ADR-002：编辑模式为源码模式，不做 WYSIWYG

- **决策**：阅读视图与 CodeMirror 源码视图二选一，快捷键切换。
- **理由**：Typora 式即时渲染实现成本极高且闭源；双视图可最大化复用渲染管线与导出样式。
- **代价**：编辑时看不到排版效果，需要切换查看。

### ADR-003：渲染管线输出 HTML 字符串，而非 React 节点树

- **决策**：unified → rehype → 字符串，经 sanitize 后一次性注入阅读容器。
- **理由**：导出、打印、阅读共用同一产物；避免把大文档映射成 React 元素树带来的开销；事件通过委托处理。
- **代价**：需要自己管理注入后的交互与位置恢复；不能使用 React 组件渲染自定义块（Mermaid 等通过后处理解决）。

### ADR-004：文件 I/O 使用自定义 Rust 命令 + allowlist

- **决策**：不使用 `plugin-fs` 作为主要文件接口；所有读写、扫描、监听、资源访问都经自定义命令，路径必须落在用户显式打开过的根目录内。
- **理由**：原子写需要自定义；运行时打开任意目录时静态 scope 不便；集中校验路径穿越与符号链接逃逸。
- **代价**：Rust 代码量增加（约 500–700 行），需要自己测试边界。

### ADR-005：PDF 通过系统打印对话框导出

- **决策**：调用 `WebviewWindow::print()`，由用户在系统打印面板选择"存储为 PDF" / "Microsoft Print to PDF"。
- **理由**：Tauri 2.12 没有 `printToPDF` 类 API；系统打印保真度最高且无需引入 Chromium。
- **代价**：多一步用户操作；无法程序化控制页眉页脚；需要专门的 `@media print` 样式。
- **备选**：若验收不达标，改用 Rust 集成 Typst 生成 PDF（工作量约 3–5 人日）。

### ADR-006：单窗口、单文档

- **决策**：v1 同一时间只打开一个文档；切换文件时若有未保存修改先确认。
- **理由**：降低状态复杂度，先保证阅读与保存的正确性。
- **代价**：频繁对照阅读不便；v1.1 增加标签页。

---

## 13. 风险摘要

| 编号 | 风险 | 影响 | 应对 | 详见 |
| --- | --- | --- | --- | --- |
| R1 | PDF 导出保真度不足或系统打印 API 行为不一致 | 高 | M0 做技术验证；失败则启用 Typst 备选 | 详设 §13 |
| R2 | WKWebView 与 WebView2 渲染差异 | 中 | 双端早期验证；Playwright WebKit 项目；避免前沿 CSS | 测试 §7 |
| R3 | 文件监听在 Windows、网络盘、同步盘上不可靠 | 中 | 去抖 + 窗口聚焦时校验 + 手动刷新 | 详设 §11 |
| R4 | 中文/大文件性能 | 中 | 预算约束、懒加载、Worker、大文件模式 | 详设 §18 |
| R5 | 文件关联与单实例冷启动事件丢失 | 中 | 待打开路径队列 + `take_pending_open` | 详设 §15 |
| R6 | 恶意 Markdown 导致 XSS / 越权读写 | 高 | sanitize + CSP + allowlist + 安全测试语料 | 详设 §17 |
| R7 | Tauri / 插件版本升级破坏兼容 | 低 | 锁定版本、升级窗口、冒烟测试 | 开发计划 §6 |

---

## 14. 开放问题（评审时确认）

| 编号 | 问题 | 建议默认值 |
| --- | --- | --- |
| Q1 | 产品名与 bundle identifier | 已定：墨览 / Marklook；bundle id 暂定 `com.marklook.reader`（发布前确认域名与商标） |
| Q2 | 文件树是否显示非 Markdown 文件 | 不显示，设置项可开 |
| Q3 | 远程图片是否允许 | 默认禁止；设置项开启后仍不自动加载 |
| Q4 | 是否携带思源等开源字体 | 不携带，使用系统字体，支持用户导入字体（v1.1） |
| Q5 | Windows 是否使用自定义标题栏 | 否，使用原生标题栏 |
| Q6 | 是否做自动更新 | v1.1，需要签名与更新服务器 |
| Q7 | 代码签名与公证 | 个人使用暂不签名；分发需 Apple 开发者账号 |
| Q8 | 多标签页 | v1.1 |

---

## 15. 术语

| 术语 | 含义 |
| --- | --- |
| 阅读模式 | 渲染后的只读 HTML 视图 |
| 源码模式 | CodeMirror 显示原始 Markdown 的编辑视图 |
| 文档会话 | 当前打开文档的全部运行时状态（内容、mtime、草稿、撤销栈） |
| line-map | 阅读视图块元素与源码行号的映射表，用于滚动同步 |
| allowlist | Rust 侧维护的、用户显式打开过的路径白名单 |
| 草稿 | 未保存内容写入应用数据目录的副本，用于崩溃恢复 |
| 大文件模式 | 超过阈值时关闭高亮、自动 Mermaid 等重负载能力的降级模式 |
