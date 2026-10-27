# 狗粮记录（Dogfood）

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-10-26 |
| 版本 | v0.9.0 RC 起，持续至 v0.9.2 |
| 范围 | 真实文档渲染管线、阅读视图交互、导出/打印前置链路、双平台实机 |
| 结论 | 发现 8 项问题，修复 7 项，1 项转为已知问题；新增 22 条回归用例（19 单元 + 3 E2E） |

## 1. 方法与语料

自动化门禁（Vitest 98 / Playwright 24 / cargo 52）在 v0.9.0 时已全绿，狗粮的目标是找**测试没覆盖到的真实写法**，因此不用示例文档，而是：

1. **仓库自身文档**：`README.md`、`README.en.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`docs/*.md`（10 篇，含 2,700 行的详细设计）。
2. **真实笔记**：本机 Obsidian 库中的 4 篇笔记（含嵌套列表 + 缩进代码块、中文文件名、空文档）。
3. **边界语料**：约 90 条手工构造的 Markdown 片段（setext 标题、开头分隔线、脚注、嵌套围栏、表格转义、中文/空格路径、emoji 标题、HTML 内嵌等）。

检查方式是先用脚本把每篇文档过一遍 `renderMarkdown`，断言输出中的三类引用都能落地：

- `data-anchor` / `href="#..."` → 页面里存在对应 `id`；
- `data-internal-doc` → 磁盘上存在该文件；
- `data-abs-src` → 磁盘上存在该图片。

再用 Chrome 打开渲染结果复核浏览器层行为（属性是否被编码、点击是否滚动）。这套断言后来固化成了 `tests/unit/dogfood.test.ts` 与一条 E2E。

## 2. 问题清单

| ID | 严重度 | 问题 | 根因 | 状态 |
| --- | --- | --- | --- | --- |
| DF-01 | P1 | 中文/空格路径的图片加载失败，内部链接打开失败 | 链接与图片地址在 URL 层被百分号编码后直接当作磁盘路径 | 已修复 |
| DF-02 | P1 | 中文标题锚点、含大写锚点点不动 | `href` 被编码 / 大小写与标题 id 不一致 | 已修复 |
| DF-03 | P1 | 以分隔线开头的文档，正文被整段吞掉 | `remark-frontmatter` 把任意开头的 `---` 当 frontmatter | 已修复 |
| DF-04 | P1 | 脚注引用与返回链接点击无反应（导出 HTML 同样失效） | sanitize 给 `id` 加 `user-content-` 前缀，`href` 未同步 | 已修复 |
| DF-05 | P2 | 列表/引用里的代码块不高亮，Mermaid 不渲染 | 能力探测只匹配行首围栏 | 已修复 |
| DF-06 | P2 | 每个 ` ```text ` 块都产生“未知代码语言”警告 | Shiki 不内置 `text`，未做纯文本白名单 | 已修复 |
| DF-07 | P3 | 渲染 warning 没有任何 UI 出口 | `RenderResult.warnings` 只被收集，未被消费 | 已知问题（见 §4） |
| DF-08 | P1 | Mermaid 图表里的长文字只显示前半截（macOS 桌面版） | 标签用 HTML `<foreignObject>`，宽度按测量值写死，WKWebView 实际字体更宽时被裁 | 已修复（v0.9.2） |

严重度按“用户能否绕过”划分：P1 无绕过路径（内容看不到或链接必然失效），P2 有降级但体验明显受损，P3 不影响正确性。

## 3. 详细说明

### DF-01 非 ASCII 路径被百分号编码后当作磁盘路径

**现象**：`![图](笔记/图.png)` 渲染出的 `data-abs-src` 是 `/docs/%E7%AC%94%E8%AE%B0/%E5%9B%BE.png`，`mdasset://` 请求 404，图片显示为“加载失败”。`[笔记](笔记/其他.md)` 点击后打开 `/docs/%E7%AC%94%E8%AE%B0/...`，报文件不存在。

**根因**：`mdast-util-to-hast` 对 `link` / `image` 的 `url` 调用 `normalizeUri`，把非 ASCII 与空格编码。`rehypeResolveUrls` 直接拿 `href` / `src` 做 `joinPath`，编码后的字符串就成了“路径”。

**修复**：新增 `decodeUrlPath`（[`src/lib/docPath.ts`](../src/lib/docPath.ts)），在拼接磁盘路径前还原；非法百分号序列原样返回，不抛错。`href` 本身保持编码（浏览器需要），只改 `data-*` 与 `src`。

**回归**：`dogfood.test.ts` → “DF-01 非 ASCII 路径的链接与图片”。

### DF-02 锚点编码与大小写

**现象**：`[跳转](#中文标题)` 点击无反应；`[跳转](#My-Heading)` 同样无反应，而大纲里对应项是 `my-heading`。

**根因**：`data-anchor` 取的是编码后的 `href`（`%E4%B8%AD...`），大纲 id 是标题原文；`github-slugger` 会把大写转小写，而作者写的锚点保留了大写。

**修复**：`data-anchor` 存解码后的值；`ReaderView` 的点击处理优先读 `data-anchor`，其次才解码 `href`。大小写不做归一——与 GitHub 行为一致，作者需要写对 slug。

**回归**：`dogfood.test.ts` → “DF-02 中文与大小写锚点”。

### DF-03 开头的分隔线吃掉正文

**现象**：`---` 开头、正文中间再用 `---` 分隔的文档（设计文档、手写笔记都很常见），渲染结果只剩最后一节；标题回退成文件名，并冒出一条“frontmatter 必须是键值结构”的警告。

**根因**：`remark-frontmatter` 的语法规则是“文档开头 `---` 到下一个 `---`”，不校验中间是不是 YAML。两条分隔线之间的内容被解析成 yaml 节点，随后在 `remarkCollect` 中被丢弃。

**修复**：`hasFrontmatter`（[`src/markdown/pipeline.ts`](../src/markdown/pipeline.ts)）先做判定：开头 `---` 之后、闭合 `---` 之前为空（含空行/注释），或以 `key: value` / `- ` 列表项开头，才挂 `remark-frontmatter`；否则按普通 Markdown 解析。

**回归**：`dogfood.test.ts` → “DF-03 开头的分隔线不会被当成 frontmatter”（含空 frontmatter、纯注释 frontmatter、真 frontmatter 三类）。

### DF-04 脚注锚点对不上

**现象**：脚注角标点击无反应；导出 HTML 中同样。检查输出可见 `href="#user-content-fn-1"` 但 `<li id="user-content-user-content-fn-1">`。

**根因**：两处前缀叠加。`remark-rehype` 生成脚注时默认加 `user-content-`，`hast-util-sanitize` 又给所有 `id` 加一次；`href` 只被加了前者。标题锚点不受影响（标题 id 只由 sanitize 加前缀），所以问题只在脚注暴露。

**修复**：

- `remarkRehype` 传 `clobberPrefix: ""`，让 sanitize 成为唯一加前缀的一方；
- 新增 `rehypeAnchorIds`（[`src/markdown/plugins/rehypeAnchorIds.ts`](../src/markdown/plugins/rehypeAnchorIds.ts)），在 sanitize 之后按树里实际存在的 `id` 修正页内 `href`；
- `ReaderView` 对非标题锚点回退到 `getElementById`，支持导出/脚注这类不由大纲管理的跳转。

**回归**：`dogfood.test.ts` → “DF-04 脚注链接与 sanitize 的 id 前缀对齐”（断言所有 `href="#..."` 都能在 `id` 集合里找到）；E2E `reading.spec.ts` → “脚注链接可跳转（DF-04）”点击角标后断言脚注区进入视口。

### DF-05 嵌套围栏漏检

**现象**：列表项里的代码块不高亮、` ```mermaid ` 不渲染，只显示普通 `pre`。真实笔记（本机 Obsidian 库）里几乎都是这种写法。

**根因**：`detectCapabilities` 用 `^```` 匹配围栏，列表项里的围栏有 4 空格缩进、引用块里的有 `> ` 前缀，都匹配不到；能力探测为 false 时管线根本不加载 Shiki / Mermaid。

**修复**：围栏正则允许 `[ \t>]*` 前缀；数学检测的“去围栏”也同步放宽。

**回归**：`dogfood.test.ts` → “DF-05 列表与引用里的代码围栏”。

### DF-06 `text` 围栏刷警告

**现象**：`docs/01-architecture.md` 有 1 个、`02-detailed-design.md` 有 4 个 ` ```text ` 块，每块产生一条“未知代码语言：text”。设计文档、README 里用 `text` 画目录树是常态。

**根因**：Shiki 不内置 `text` / `plaintext`，`resolveLanguage` 查不到就记 warning 并降级。

**修复**：`PLAIN_LANGUAGES` 白名单（`text`、`plaintext`、`plain`、`txt`、`output`、`log`、`tree`、`none`）直接按普通代码块处理，不加载语法、不记 warning。真正未知的语言仍然记录。

**回归**：`dogfood.test.ts` → “DF-06 纯文本代码块不报未知语言”。

### DF-08 Mermaid 长标签在 WKWebView 下被裁切（v0.9.2）

**现象**：一张 `flowchart TD` 里，节点与连线上的长文字只显示前半截，例如 `ps3_generate_package.py` 之后的 `pack nvdatasbr` 与中文说明整段消失。同一份文档在浏览器预览（Chromium）里正常。

**根因**：Mermaid 默认用 HTML `<foreignObject>` 承载标签，宽度在渲染前按文本测量值写死；WKWebView 的实际字体更宽，超出部分被直接裁掉。Chromium 的测量恰好够宽，所以只在 macOS 桌面版暴露——这类“引擎测量差异”用 Mock E2E 永远测不到。

**修复**：`mermaid.initialize` 设 `htmlLabels: false`（flowchart / class 一并），标签改用 SVG `<text>`，随图形一起缩放；同时把 `wrappingWidth` 从默认 120px 提到 240px，长路径不再被拆成五六段。

**回归**：

- `tests/e2e/mermaid.webkit.spec.ts`——WebKit 专属，断言渲染结果里没有 `foreignObject`，且每个节点的文字宽度不超过自身形状（留 4px 描边边距）。这是唯一能复现该 bug 的引擎。
- `tests/e2e/reading.spec.ts` → “Mermaid 长标签完整显示”——Chromium 侧确认长标签换行而非截断。
- `playwright.config.ts` 增加 `webkit` project（只跑 `*.webkit.spec.ts`），CI 安装 Chromium + WebKit。

### 顺带修正

- Mermaid 围栏识别改为大小写不敏感（` ```Mermaid ` 也能渲染）。
- 行内代码里的 `$` 不再触发 KaTeX 加载（`` `$HOME` ``、`` `price=$5` `` 曾导致整篇文档多加载一个 ~280KB 的 KaTeX chunk）。

## 4. 已知问题（本轮不修）

### DF-07 渲染 warning 没有 UI 出口

`RenderResult.warnings` 目前只在测试里被断言，应用层没有展示。后果：代码块语言写错、frontmatter 写坏时用户无感知，只是“看起来没高亮”。

建议（M5 之后的体验项）：状态栏加一个可展开的提示条，最多展示 3 条并按 `kind` 去重；或在侧栏“文档”分区显示 warning 计数。**不修的理由**：属于产品交互设计，需要与通知/错误条的整体样式一起定，不宜在狗粮修复里临时加。

### 已确认的“非问题”

| 写法 | 行为 | 说明 |
| --- | --- | --- |
| Obsidian callout `> [!note]` | 渲染为普通引用 | 非 CommonMark/GFM，按原文显示，信息不丢失 |
| `[[wiki link]]` / `![[embed]]` | 原样文本 | 同上；后续若要支持，走渲染管线插件 |
| `#标签` | 原样文本 | 同上 |
| `==高亮==`、`^上标^` | 原样文本（`H~2~O` 会被 GFM 解析为删除线） | 非标准语法；`~~` 删除线正常 |
| 标题里含 `<kbd>` | 大纲 id 变成 `kbdcmdkbdkbdkkbd` | 与 GitHub 的 slug 规则一致（先取文本再 slug），不单独处理 |
| `H~2~O` | 显示为 `H~~2~~O` 的删除线 | GFM 删除线优先，属预期 |

## 5. 回归资产

| 文件 | 覆盖 |
| --- | --- |
| [`tests/unit/dogfood.test.ts`](../tests/unit/dogfood.test.ts) | DF-01 ~ DF-06，19 条用例（含 `text` 语言表驱动 4 条） |
| [`tests/e2e/reading.spec.ts`](../tests/e2e/reading.spec.ts) | 脚注跳转（DF-04），并断言页面内所有 `href="#..."` 都有落点；Mermaid 长标签不被截断（DF-08） |
| [`tests/e2e/mermaid.webkit.spec.ts`](../tests/e2e/mermaid.webkit.spec.ts) | DF-08 的 WebKit 专属回归：无 `foreignObject`、文字不溢出节点 |
| [`tests/unit/detect.test.ts`](../tests/unit/detect.test.ts) | 既有能力探测用例，覆盖数学/围栏基础行为 |

复跑：

```bash
pnpm test
pnpm test:e2e
```

## 6. 待人工

- Windows 实机 GUI 矩阵（CI 的 cargo test 已在 Windows runner 全绿，GUI 行为仍需实机）。
- 安装 / 升级 / 卸载在干净环境验证。
- 本记录中的修复需要在 Windows 上确认中文路径（`mdasset://` 走 `http://mdasset.localhost`）行为一致。
