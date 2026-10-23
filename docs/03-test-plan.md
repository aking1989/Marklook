# 墨览（Marklook）测试方案

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1（草案） |
| 日期 | 2026-10-21 |
| 状态 | 待评审 |
| 上游文档 | [概要设计](./01-architecture.md) · [详细设计](./02-detailed-design.md) |
| 关联文档 | [开发计划](./04-development-plan.md) |

---

## 1. 目标与范围

### 1.1 目标

- 验证功能符合[概要设计 §4](./01-architecture.md#41-v10-功能清单)的范围。
- 重点保障：**不丢数据、不越权读写、不执行恶意内容、切换模式位置准确、双平台行为一致**。
- 为性能预算提供可重复的测量方法与基线。
- 在 CI 中自动拦截回归，在发布前完成双平台手动矩阵。

### 1.2 范围

覆盖：Markdown 渲染、阅读/编辑双模式、文档生命周期、保存与冲突、工作区、大纲、搜索、图片、导出、文件关联、设置、安全。

不覆盖（v1）：云同步、协作、移动端、插件系统。

### 1.3 质量目标

| 指标 | 目标 |
| --- | --- |
| 核心纯逻辑行覆盖率 | ≥ 90%（`src/markdown`、`src/lib`、`src/features/search`） |
| 前端整体行覆盖率 | ≥ 70% |
| Rust 命令与 IO 行覆盖率 | ≥ 80% |
| P0/P1 缺陷 | 发布前 0 个 |
| E2E 场景通过率 | 100% |
| 性能预算 | 全部达标，单项不得劣化超过 20% |

---

## 2. 测试策略

采用分层测试，越靠下越自动、越快：

```text
        ┌─────────────────────┐
        │ 手动矩阵（双平台）    │  发布前
        ├─────────────────────┤
        │ E2E（Playwright Web）│  每次 PR
        ├─────────────────────┤
        │ 组件测试（RTL）       │  每次 PR
        ├─────────────────────┤
        │ 单元测试（Vitest）    │  每次提交
        ├─────────────────────┤
        │ Rust 单元/集成测试    │  每次 PR
        └─────────────────────┘
```

### 2.1 工具

| 层 | 工具 | 运行环境 |
| --- | --- | --- |
| 单元 | Vitest 5 | Node 24 |
| 组件 | Vitest + React Testing Library + jsdom | Node 24 |
| E2E | Playwright 1.64（Chromium + WebKit） | Web 构建 + Mock 平台 |
| Rust | `cargo test` + `tempfile` + `assert_fs` | macOS CI / 本地 |
| Rust 静态检查 | `cargo clippy -D warnings`、`cargo fmt --check` | CI |
| 前端静态检查 | TypeScript 6、ESLint、Prettier | CI |
| 可访问性 | `@axe-core/playwright` | E2E |
| 性能 | 自定义基准脚本 + Playwright trace | CI / 手动 |
| 安全 | 固定 XSS 语料 + 断言 | 单元 + E2E |

### 2.2 测试环境

| 环境 | 用途 |
| --- | --- |
| macOS 15（Apple Silicon） | 开发、单元、E2E、Tauri 手动验证 |
| macOS 13/14（Intel/ARM） | 手动兼容矩阵 |
| Windows 10 22H2 / Windows 11 | 手动矩阵、CI 构建 |
| GitHub Actions macOS 14 | 单元、E2E、Rust、构建 |
| GitHub Actions windows-latest | 构建、启动冒烟 |
| Web 模式（Vite + Mock） | 快速 E2E，不依赖 Tauri |

> macOS 不支持 `tauri-driver`，因此 E2E 走 Web 构建 + 平台 Mock；真实的文件/协议/打印行为由 Rust 测试和手动矩阵覆盖。

### 2.3 测试数据（fixtures）

`tests/fixtures/docs/`：

| 文件 | 用途 |
| --- | --- |
| `basic.md` | 标题、段落、列表、引用、链接、图片 |
| `gfm.md` | 表格、任务列表、删除线、自动链接、脚注 |
| `math.md` | 行内/块级公式、转义 `$`、公式错误 |
| `mermaid.md` | 流程图、时序图、错误语法 |
| `code.md` | 多语言代码块、超长行、无语言 |
| `images.md` | 相对路径、中文路径、空格路径、缺失图片、远程图片 |
| `frontmatter.md` | 正常 YAML、无 frontmatter、损坏 YAML |
| `cjk.md` | 中文、标点、中英混排、emoji、长段落 |
| `xss.md` | 安全语料（见 §9） |
| `malformed.md` | 未闭合代码块、异常嵌套、超长行 |
| `crlf.md` / `bom.md` | 换行符与 BOM |
| `empty.md` / `no-headings.md` | 空文档、无标题 |
| `large-1mb.md` / `large-5mb.md` | 性能与降级 |
| `wide-table.md` | 横向滚动与打印 |

`tests/fixtures/vault/`：

- 嵌套目录、中文目录、空格目录。
- `node_modules/`、`.git/`、`dist/` 用于验证忽略规则。
- 1,000 个 Markdown 文件的生成脚本 `generate-vault.mjs`。
- 符号链接（macOS）与 junction（Windows）用于逃逸测试。

---

## 3. 单元测试

### 3.1 Markdown 管线（`src/markdown`）

| 用例 | 输入 | 断言 |
| --- | --- | --- |
| U-MD-01 CommonMark | `basic.md` | HTML 快照；标题、列表、引用、链接正确 |
| U-MD-02 GFM | `gfm.md` | 表格、任务列表、删除线、脚注、自动链接 |
| U-MD-03 数学 | `math.md` | KaTeX 输出；错误公式不抛出；代码中的 `$` 不解析 |
| U-MD-04 Mermaid | `mermaid.md` | 生成占位块，base64 可还原源码 |
| U-MD-05 代码高亮 | `code.md` | 已支持语言有高亮；未知语言回退；无语言为纯文本 |
| U-MD-06 frontmatter | `frontmatter.md` | 解析 title；损坏 YAML 记 warning 且正文正常 |
| U-MD-07 行号锚点 | 所有文档 | 每个顶层块有 `data-line-start/end`；行号与源文件一致 |
| U-MD-08 大纲 | 多级标题 | 顺序、层级、行号、slug 唯一 |
| U-MD-09 标题解析 | frontmatter/H1/文件名 | 优先级正确；空标题回退文件名 |
| U-MD-10 字数统计 | 中英混排 | CJK 逐字 + 拉丁按词；阅读时间合理 |
| U-MD-11 原始 HTML | `<div>`、`<details>` | 允许的标签保留；脚本/事件被移除 |
| U-MD-12 转义 | 行内代码、围栏代码中的 Markdown 字符 | 不被误解析 |
| U-MD-13 空文档 | `empty.md` | 返回空 HTML，无异常，大纲为空 |
| U-MD-14 异常输入 | `malformed.md` | 不抛出；降级输出 |
| U-MD-15 大文件降级 | 传入 `largeFileMode` | 不调用 Shiki/Mermaid |
| U-MD-16 相对图片 | `images.md` | 转为 mdasset URL；越界路径不生成 |
| U-MD-17 外链标记 | 各种链接 | `data-external` / `data-internal-doc` / `data-anchor` 正确 |
| U-MD-18 缓存 | 相同输入两次 | 第二次命中缓存；不同选项不复用 |

快照策略：HTML 快照只针对稳定的结构部分；KaTeX/Shiki 输出用"包含关键 class/文本"断言，避免升级库导致大面积快照失效。

### 3.2 滚动映射（`src/lib/lineMap.ts`）

| 用例 | 断言 |
| --- | --- |
| U-SC-01 空锚点 | 返回第 1 行，不抛异常 |
| U-SC-02 二分边界 | 顶部/底部/锚点正中位置映射正确 |
| U-SC-03 块内插值 | 长代码块中间位置按比例映射，误差 ≤ 3 行 |
| U-SC-04 scrollToLine 越界 | 行号 clamp 到 1..totalLines |
| U-SC-05 锚点乱序 | 构建后按 top 排序，查询稳定 |
| U-SC-06 高度为 0 | 除零保护，返回起始行 |
| U-SC-07 窗口缩放 | 重建后映射随高度变化 |
| U-SC-08 锚点缺失 | 回退到最近的前一个块 |

### 3.3 路径与编码工具

| 用例 | 断言 |
| --- | --- |
| U-PA-01 相对路径 | POSIX/Windows 分隔符都能正确 join |
| U-PA-02 `..` 规范化 | 词法规范化结果正确 |
| U-PA-03 中文/空格 | `encodeURI` 后可还原 |
| U-PA-04 非法字符 | 缺失文件、空路径返回安全结果 |
| U-PA-05 base64url | 往返一致，含 Unicode 与 Windows 盘符 |

> 真正的边界校验在 Rust（canonicalize），TS 工具只做展示与相对路径计算。

### 3.4 搜索（`src/features/search`）

| 用例 | 断言 |
| --- | --- |
| U-SE-01 中文分词 | "编辑器" 产生词与二元组；"编辑" 能命中 |
| U-SE-02 中英混排 | 大小写不敏感 |
| U-SE-03 标点/emoji | 不产生空 token |
| U-SE-04 标题权重 | 标题命中排名高于正文 |
| U-SE-05 AND 语义 | 多词必须同时出现 |
| U-SE-06 前缀 | 拉丁词前缀命中 |
| U-SE-07 摘要 | 命中点前后截取、代理对不被切断 |
| U-SE-08 行号 | 首次命中行号准确（含 CRLF） |
| U-SE-09 增量更新 | add/update/remove 后结果正确 |
| U-SE-10 过期查询 | 只接受最新请求 id 的结果 |
| U-SE-11 超限 | 超过 10,000 文件时截断并报告 |
| U-SE-12 大文件 | 只索引头部 64KB，不阻塞 |

### 3.5 文档状态与冲突（`src/features/document`）

| 用例 | 断言 |
| --- | --- |
| U-DOC-01 脏状态 | 修改后 dirty；撤销回原文后 clean |
| U-DOC-02 冲突矩阵 | 四种组合（见详设 §11.3）行为正确 |
| U-DOC-03 自动保存条件 | clean/conflict/无路径时不触发 |
| U-DOC-04 保存成功 | baseline 更新、草稿删除、状态 clean |
| U-DOC-05 保存冲突 | 进入 conflict，保留内容与脏状态 |
| U-DOC-06 外部内容相同 | 不提示冲突，清除脏状态 |
| U-DOC-07 草稿恢复判断 | 草稿更新且内容不同才提示 |
| U-DOC-08 关闭确认 | dirty 时返回"需确认" |
| U-DOC-09 大文件自动保存 | 间隔切换为 3s |

### 3.6 设置

| 用例 | 断言 |
| --- | --- |
| U-SET-01 默认值 | 空对象合并后等于默认 |
| U-SET-02 非法值 | 越界字号/负延迟回退默认 |
| U-SET-03 未知字段 | 被丢弃 |
| U-SET-04 迁移 | version 0 → 1 保持已有值 |
| U-SET-05 损坏 JSON | 备份并重建 |
| U-SET-06 最近列表 | 去重、上限、最新在前 |

### 3.7 导出

| 用例 | 断言 |
| --- | --- |
| U-EX-01 HTML 模板 | 标题转义、charset、主题变量存在 |
| U-EX-02 图片内联 | 生成 data URL；越界读取被跳过 |
| U-EX-03 Mermaid | 导出前渲染为内联 SVG |
| U-EX-04 无脚本 | 导出内容不含 `<script>` |
| U-EX-05 打印样式 | 包含 `@page`、隐藏应用 chrome |
| U-EX-06 文件名 | 非法字符替换，保留扩展名 |

### 3.8 平台 Mock

| 用例 | 断言 |
| --- | --- |
| U-PL-01 读写 | 内容、mtime、EOL、BOM 往返一致 |
| U-PL-02 错误 | 不存在/冲突映射为正确错误码 |
| U-PL-03 监听 | 变更触发一次去抖事件 |
| U-PL-04 资源 URL | 往返编码一致 |
| U-PL-05 取消 | 对话框取消返回 null，不抛错 |

---

## 4. 组件测试

使用 React Testing Library + jsdom；平台注入 Mock。

| 编号 | 组件 | 断言 |
| --- | --- | --- |
| C-01 | `ReaderView` | 注入 sanitize 后 HTML；存在 data-line；空/错误状态 |
| C-02 | `ReaderView` 链接 | 点击外链调用 `openExternal`；相对 md 调用打开；锚点滚动 |
| C-03 | `ReaderView` 远程图片 | 默认显示占位；点击后替换为 img；不自动请求 |
| C-04 | `OutlinePanel` | 树构建；当前项高亮；点击回调行号 |
| C-05 | `FileTree` | 目录优先排序；展开/折叠；懒加载；键盘导航 |
| C-06 | `SearchPanel` | 防抖；键盘上下/Enter；空结果/索引中状态 |
| C-07 | `SettingsPanel` | 修改即时写入 CSS 变量；恢复默认仅影响当前分区 |
| C-08 | `ConflictBanner` | 三个动作分别调用 reload/force/saveAs |
| C-09 | `EditorViewHost` | 首次挂载创建；隐藏不销毁；重新显示保留撤销 |
| C-10 | `EditorViewHost` | `setValue` 重置历史；`getValue` 与 store 同步 |
| C-11 | `DocumentToolbar` | 保存状态、字数、只读标识 |
| C-12 | `Toast` / `Dialog` | 焦点陷阱、Esc 关闭、aria 属性 |
| C-13 | `EmptyState` | 最近文件点击回调 |
| C-14 | `ErrorBoundary` | 捕获子组件异常并显示恢复入口 |

---

## 5. 集成测试

### 5.1 平台契约

同一套行为断言分别针对 `MockPlatform` 与 `TauriPlatform`（后者仅在 macOS/Windows 本地或手动任务中运行）：

- 读写往返：内容、EOL、BOM、mtime。
- 冲突：mtime 不一致时返回 `CONFLICT`。
- 越权路径：返回 `PATH_OUTSIDE_ROOT`。
- 大文件：返回 `TOO_LARGE`。
- 扫描：忽略规则、扩展名、上限。

CI 只跑 Mock；Tauri 契约测试作为发布前手动清单的一部分。

### 5.2 渲染 + 阅读集成

- 管线输出直接注入 Reader，验证大纲、行号锚点、Mermaid 挂载、图片 URL 全链路。
- 主题切换后 CSS 变量生效，Shiki 不重新渲染，Mermaid 重渲染。

### 5.3 文档 + 监听集成

- Mock 触发外部修改，验证静默重载 / 冲突条 / 保存覆盖全流程。
- 保存后抑制自身监听事件，不产生循环。

---

## 6. E2E 测试（Playwright）

运行方式：Vite 开发服务器 + `?platform=mock`，Chromium 与 WebKit 两个 project 都跑。

| 编号 | 场景 | 关键断言 |
| --- | --- | --- |
| E2E-01 | 打开文件并渲染 | 标题、正文、代码块出现；状态栏显示文件名 |
| E2E-02 | 阅读 ↔ 源码位置保持 | 滚动到中部 → `Mod+E` → 编辑器顶部行与阅读锚点相差 ≤ 1 |
| E2E-03 | 编辑并保存 | 输入文本 → `Mod+S` → 状态 clean；Mock 文件内容更新 |
| E2E-04 | 自动保存 | 输入后等待 1s，Mock 文件自动更新 |
| E2E-05 | 外部修改（干净） | Mock 改文件 → Toast；阅读内容更新；滚动位置保持 |
| E2E-06 | 外部修改（脏） | 本地输入 + Mock 改文件 → 冲突条出现 |
| E2E-07 | 冲突：重新加载 | 点击后本地修改丢弃，内容为磁盘版本 |
| E2E-08 | 冲突：覆盖 | 点击后磁盘内容变为本地版本 |
| E2E-09 | 冲突：另存为 | 新路径写入，当前文档切换 |
| E2E-10 | 打开文件夹 | 树显示；忽略 `node_modules`；中文排序正确 |
| E2E-11 | 搜索 | 输入中文词 → 结果高亮 → Enter 打开并定位到行 |
| E2E-12 | 数学 / Mermaid / 高亮 | 公式、SVG 图表、彩色代码块出现 |
| E2E-13 | 图片粘贴 | 注入剪贴板图片 → Mock assets 出现文件 → 编辑器插入语法 |
| E2E-14 | 导出 HTML | 触发导出 → 捕获下载/Mock 写入 → 断言无 script、图片内联 |
| E2E-15 | 未保存关闭 | 输入后触发关闭 → 出现三选一；取消后仍打开 |
| E2E-16 | 草稿恢复 | 输入后刷新页面 → 出现恢复提示 → 恢复内容 |
| E2E-17 | 大文件模式 | 打开 5MB 文档 → 出现标识；代码不高亮；仍可切换 |
| E2E-18 | 快捷键 | 依次触发打开、切换、保存、侧栏、设置 |
| E2E-19 | XSS 语料 | 无脚本执行（监听 `window.__xss`）；无危险链接 |
| E2E-20 | 远程图片 | 默认无网络请求；点击后才请求 |
| E2E-21 | 空状态与错误 | 打开不存在文件 → 错误提示；重试可用 |
| E2E-22 | 主题与排版 | 切换主题/字号/栏宽 → CSS 变量与布局变化；刷新后保持 |
| E2E-23 | 设置持久化 | 修改设置 → 重载 → 值保留 |
| E2E-24 | 大纲联动 | 点击大纲滚动；滚动时高亮跟随 |

约定：

- 每条用例使用独立 fixture 副本，禁止共享可变状态。
- 使用 `data-testid` 定位交互元素，避免依赖文本（文案会变）。
- 网络断言：`page.on('request')` 收集请求，断言无远程请求。
- 时间相关断言使用可控时钟或宽松阈值（自动保存 ±300ms）。

---

## 7. Rust 测试

### 7.1 单元测试

| 编号 | 模块 | 用例 |
| --- | --- | --- |
| R-IO-01 | `atomic_write` | 新建、覆盖、内容完整 |
| R-IO-02 | `atomic_write` | 临时文件在成功后不存在；失败后清理 |
| R-IO-03 | `atomic_write` | 保留 Unix 权限（0600/0644） |
| R-IO-04 | `text` | LF/CRLF 转换；BOM 保留/去除 |
| R-IO-05 | `text` | 非法 UTF-8 返回 `INVALID_UTF8` |
| R-IO-06 | `write_document` | mtime 不一致且非 force → `CONFLICT` |
| R-IO-07 | `write_document` | force 覆盖成功 |
| R-IO-08 | `write_document` | 只读文件 → `PERMISSION_DENIED` |
| R-ALLOW-01 | `ensure_allowed` | 根目录内文件允许 |
| R-ALLOW-02 | `ensure_allowed` | `..` 逃逸被拒绝 |
| R-ALLOW-03 | `ensure_allowed` | 符号链接指向外部被拒绝 |
| R-ALLOW-04 | `ensure_allowed` | 兄弟目录前缀不误判（`/a/bc` vs `/a/b`） |
| R-ALLOW-05 | `ensure_allowed` | 单独授权的文件允许；其父目录资源允许 |
| R-ALLOW-06 | `ensure_allowed` | UNC / 长路径（Windows） |
| R-SCAN-01 | `scan_vault` | 扩展名过滤、大小写 |
| R-SCAN-02 | `scan_vault` | 隐藏目录与额外忽略目录 |
| R-SCAN-03 | `scan_vault` | `.gitignore` 生效 |
| R-SCAN-04 | `scan_vault` | 条目上限、`truncated` |
| R-SCAN-05 | `scan_vault` | 不跟随符号链接 |
| R-SCAN-06 | `scan_vault` | 内容读取上限 2MB；非 UTF-8 跳过 |
| R-ASSET-01 | 协议 | 合法图片返回正确 MIME |
| R-ASSET-02 | 协议 | 越界路径拒绝 |
| R-ASSET-03 | 协议 | 非图片扩展名拒绝 |
| R-ASSET-04 | 协议 | 超过 20MB 拒绝 |
| R-ASSET-05 | 协议 | SVG 附带严格 CSP 头 |
| R-DRAFT-01 | 草稿 | 保存/读取/删除往返 |
| R-DRAFT-02 | 草稿 | 路径哈希稳定，Unicode 路径 |
| R-DRAFT-03 | 草稿 | 7 天清理 |
| R-OPEN-01 | 待打开队列 | 去重、顺序、取走后清空 |
| R-WATCH-01 | 监听 | 写临时文件 + rename 触发事件（macOS/Windows） |
| R-WATCH-02 | 监听 | 注销后不再触发 |

### 7.2 集成测试

- 使用 `tempfile::TempDir` 构造真实目录。
- 扫描 + 读取 + 写入 + 冲突的完整链路。
- 并发保存：两个任务同时写同一文件，最终内容为其中一次完整写入，不出现半截文件（允许一方冲突失败）。
- 监听 + 原子写：保存后事件可被识别并在前端抑制。

### 7.3 Windows 专项

- 反斜杠、盘符大小写、UNC、长路径。
- 文件被其他程序占用时的写入错误映射。
- 只读属性。
- 路径含中文与空格。
- 安装器文件关联注册/卸载（手动）。

---

## 8. 手动测试矩阵（发布前）

每个平台至少一名测试者，按表格逐项签名。

### 8.1 平台与显示

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| M-01 | macOS 13 / 14 / 15，Apple Silicon | 启动、渲染、保存、导出正常 |
| M-02 | macOS Intel（universal 包） | 同上 |
| M-03 | Windows 10 22H2 x64 | 同上 |
| M-04 | Windows 11 23H2/24H2 x64 | 同上 |
| M-05 | 125% / 150% / 200% 缩放 | 无模糊、无截断、无错位 |
| M-06 | 亮色 / 暗色 / 护眼 / 跟随系统 | 切换即时、对比度可读 |
| M-07 | 窗口最小尺寸 / 超大窗口 | 布局不破、侧栏可收起 |
| M-08 | 多显示器移动窗口 | 位置与尺寸恢复合理 |

### 8.2 输入与内容

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| M-09 | macOS 拼音 / Windows 微软拼音 | 组合输入、候选、标点正常；快捷键不误触 |
| M-10 | 中英混排长文 | 换行、字距、行高正常 |
| M-11 | 含公式/Mermaid/代码的技术文档 | 渲染正确，滚动同步无明显偏差 |
| M-12 | 大表格、超长代码行 | 横向滚动；打印不溢出 |
| M-13 | 图片（中文/空格路径、缺失、远程） | 显示或占位正确；默认无网络请求 |
| M-14 | 脚注、任务列表 | 跳转与样式正确 |
| M-15 | 1MB / 5MB 文档 | 大文件模式触发；操作可接受 |
| M-16 | CRLF / BOM 文件 | 保存后保持原格式 |

### 8.3 文件与系统

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| M-17 | 双击 .md（应用未启动） | 冷启动并打开文件 |
| M-18 | 双击 .md（应用已启动） | 单实例转发并聚焦 |
| M-19 | 文件关联卸载 | 注册项清理干净 |
| M-20 | 外部编辑器修改当前文件 | 干净时重载；脏时冲突 |
| M-21 | 同步盘（OneDrive/iCloud） | 无半截写入；冲突可解决 |
| M-22 | 只读文件 / 只读目录 | 提示清晰；另存为可用 |
| M-23 | 长路径（> 260 字符） | 打开、保存、图片正常 |
| M-24 | 文件被删除后保存 | 提示，不丢内容，可另存为 |
| M-25 | 打印 / PDF | A4 分页合理；代码不截断；中文字体正确 |
| M-26 | 导出 HTML | 断网环境下打开正常，样式/图片/公式完整 |
| M-27 | 安装、覆盖安装、卸载、重装 | 设置与最近记录行为符合预期 |
| M-28 | 首次启动（无配置） | 空状态引导正常 |

---

## 9. 安全测试

### 9.1 XSS 语料

固定文件 `tests/fixtures/security/xss.md`，覆盖：

| 类别 | 样例 |
| --- | --- |
| 脚本标签 | `<script>window.__xss=1</script>`、大小写/嵌套变体 |
| 事件属性 | `<img src=x onerror="window.__xss=1">`、`onload`、`onfocus` |
| 危险协议 | `[x](javascript:window.__xss=1)`、`vbscript:`、`data:text/html` |
| 编码混淆 | HTML 实体、URL 编码、`java\tscript:`、前后空格 |
| SVG/MathML | `<svg onload>`、`<math><mtext><script>` |
| 表单/框架 | `<iframe>`、`<object>`、`<embed>`、`<form action>`、`<base href>` |
| 元信息 | `<meta http-equiv="refresh">`、`<link rel=stylesheet>` |
| 图片 | `srcset`、`data:image/svg+xml`、远程追踪像素 |
| CSS | `<style>` 注入、`style` 属性 |

断言：

1. `window.__xss` 始终未定义。
2. 渲染后的 DOM 中无 `<script>`、`<iframe>`、事件属性。
3. 所有 `href` 不以 `javascript:` / `vbscript:` / `data:` 开头。
4. 默认无任何外部网络请求。
5. 导出 HTML 同样满足以上条件。

### 9.2 路径安全（Rust）

- Markdown 中 `![](../../../../etc/passwd)`、`![](C:\Windows\win.ini)`、`![](//server/share/x.png)`。
- 资源协议请求：URL 编码的 `..`、双重编码、符号链接、大小写、UNC。
- 断言：仅 allowlist 内文件可读；错误码 `PATH_OUTSIDE_ROOT`。
- 单独打开的文件：只允许自身与父目录，不能读取父目录的其他子树（除非也在 allowlist）。

### 9.3 CSP 验证

- 解析 `tauri.conf.json`，断言包含 `object-src 'none'`、`frame-src 'none'`、`script-src 'self'`、无 `'unsafe-eval'`（允许 `'wasm-unsafe-eval'`）。
- 手动在 devtools 中尝试内联脚本，应被拒绝。
- release 包确认 devtools 关闭。

### 9.4 外链与远程内容

- 点击 `http/https` 链接 → 系统浏览器；应用内不导航。
- `file://`、`javascript:`、自定义协议链接 → 拒绝。
- 远程图片默认无请求；点击后仅请求该图片。
- 导出 HTML 不主动下载远程图片。

---

## 10. 性能测试

### 10.1 语料

| 编号 | 内容 | 大小 |
| --- | --- | --- |
| P-01 | 普通技术文档 | 10KB |
| P-02 | 多代码块 + 公式 | 100KB |
| P-03 | 长文 | 1MB |
| P-04 | 极端长文 | 5MB |
| P-05 | 1,000 文件工作区 | 约 20MB |

### 10.2 指标与测量

| 指标 | 方法 | 预算 |
| --- | --- | --- |
| 冷启动 | release 包，记录到可交互时间；3 次取中位数 | mac < 1.0s；Win < 2.0s |
| 打开 100KB | 内部 `performance.measure` | < 150ms |
| 打开 1MB | 同上 | < 600ms |
| 模式切换 100KB / 1MB | 同上 | < 80ms / < 300ms |
| 输入延迟 p95 | Playwright 记录 keydown→paint | < 16ms |
| 索引 1,000 文件 | Worker 计时 | < 2s |
| 查询 | Worker 计时 | < 50ms |
| 空闲内存 | 活动监视器 / 任务管理器 | < 120MB |
| 1MB 文档内存 | 同上 | < 200MB |
| 安装包 | 构建产物 | mac < 25MB；Win < 15MB |

### 10.3 回归策略

- 每个里程碑结束跑一次基准，结果记录在 `docs/perf-baseline.md`（开发期创建）。
- 单项劣化 > 20% 视为回归，必须解释或修复。
- 性能测试不得在 CI 共享 runner 上做硬断言，只记录趋势；阈值断言在本地/专用机器执行。

### 10.4 长稳测试

- 连续打开/关闭 100 个文档，内存不持续增长（关闭后回落到基线 ±20%）。
- 编辑 30 分钟，无内存泄漏、无监听句柄泄漏。
- 反复切换模式 100 次，位置不漂移、渲染缓存不无限增长。

---

## 11. 可访问性测试

| 编号 | 项 | 标准 |
| --- | --- | --- |
| A-01 | axe-core（应用壳 + 阅读视图） | 无 serious/critical 问题 |
| A-02 | 键盘完整操作 | 打开、切换、保存、搜索、设置均可键盘完成 |
| A-03 | 焦点可见 | 所有交互元素有清晰 focus ring |
| A-04 | 对话框焦点陷阱 | 打开后焦点进入，Esc 关闭后返回触发元素 |
| A-05 | 对比度 | 正文与背景 ≥ 4.5:1；大字号 ≥ 3:1 |
| A-06 | 减少动画 | `prefers-reduced-motion` 下关闭平滑滚动 |
| A-07 | 屏幕阅读器冒烟 | VoiceOver / Narrator 能读出标题层级与按钮名称 |
| A-08 | 语义结构 | 侧栏/主区/状态栏有 landmark；大纲为导航列表 |

---

## 12. CI 与质量门禁

### 12.1 每个 PR

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test              # Vitest 单元测试
pnpm test:e2e          # Playwright Chromium（WebKit 在 M5 兼容性阶段加入）
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

工作流见 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)：`frontend` 任务跑前端全部门禁，`rust` 任务在 macOS 与 Windows 上编译并测试；Rust 任务会先构建前端，因为 `generate_context!` 在编译期嵌入 `dist`。

门禁：

- 任一失败阻止合并。
- 覆盖率低于阈值阻止合并（核心模块 ≥ 90%，整体 ≥ 70%）。覆盖率统计在 M1 核心渲染管线稳定后接入。
- 新增文件若属于核心纯逻辑，必须附带单元测试。

### 12.2 每晚

- 双平台构建冒烟（macOS universal、Windows NSIS）。
- Playwright 全量回归。
- 性能基准记录（非阻断）。

### 12.3 发布前

- 手动矩阵全部通过并签字。
- 安全语料回归通过。
- 安装包在干净用户环境冒烟。
- 变更记录与已知问题更新。

---

## 13. 缺陷管理

### 13.1 严重级别

| 级别 | 定义 | 示例 |
| --- | --- | --- |
| P0 | 数据丢失、崩溃、安全漏洞、越权读写 | 保存覆盖了错误内容；XSS 执行 |
| P1 | 核心功能不可用或结果错误 | 无法保存；冲突处理失效；渲染大面积失败 |
| P2 | 次要功能异常，有规避方式 | 搜索排序不佳；导出图片缺失一张 |
| P3 | 视觉/文案/体验问题 | 间距不一致；提示语错别字 |

发布标准：P0/P1 为 0；P2 有明确规避方案并记录；P3 可延后。

### 13.2 缺陷模板

```text
标题：
环境：OS / 版本 / 架构 / 显示缩放 / 主题
前置条件：
复现步骤：
期望：
实际：
附件：截图 / 日志 / 文档样本
严重级别：
是否稳定复现：
```

缺陷必须附带最小复现文档，禁止只贴截图。

---

## 14. 需求—测试追踪

| 需求 | 单元 | 组件 | E2E | 手动 |
| --- | --- | --- | --- | --- |
| F1 打开文件/文件夹 | U-DOC-* | C-13 | E2E-01, E2E-10 | M-17, M-18, M-28 |
| F2 阅读排版 | U-MD-* | C-01 | E2E-01, E2E-22 | M-06, M-10 |
| F3 模式切换 | U-SC-* | C-09, C-10 | E2E-02 | M-11 |
| F4 渲染增强 | U-MD-03~05 | C-01 | E2E-12 | M-11, M-14 |
| F5 保存/冲突 | U-DOC-* | C-08 | E2E-03~09 | M-20~M-24 |
| F6 树/大纲/搜索 | U-SE-*, U-PA-* | C-04~C-06 | E2E-10, E2E-11, E2E-24 | M-01~M-04 |
| F7 图片粘贴 | U-PL-01 | C-09 | E2E-13 | M-13 |
| F8 导出/PDF | U-EX-* | — | E2E-14 | M-25, M-26 |
| F9 菜单/快捷键/关联 | — | — | E2E-18 | M-17~M-19 |
| F10 草稿/最近/窗口 | U-DOC-07, U-SET-06 | — | E2E-16 | M-27 |
| F11 页内查找 | U-MD-07 | C-01 | E2E-02 | M-11 |
| F12 代码复制/灯箱 | — | C-01 | E2E-01 | M-11, M-13 |

---

## 15. 发布验收清单

- [ ] 所有自动化测试通过，覆盖率达标
- [ ] 双平台手动矩阵完成
- [ ] 性能预算全部达标，无 > 20% 回归
- [ ] 安全语料全部通过
- [ ] 安装/升级/卸载在干净环境验证
- [ ] 文件关联冷启动与单实例验证
- [ ] 打印/PDF 双平台验证
- [ ] 已知问题列表评审完成
- [ ] 发布说明、CHANGELOG、版本号一致
- [ ] 安装包校验和记录
