import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

const root = path.resolve(import.meta.dirname, "../..");
const theme = process.argv[2] ?? "light";
const outDir = path.join(root, "test-results/pdf-check");
fs.mkdirSync(outDir, { recursive: true });

const source = fs.readFileSync(
  path.join(root, "tests/fixtures/pdf-check.md"),
  "utf8",
);

const rendered = String(
  await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify)
    .process(source),
);

// 与 main.tsx 保持相同的样式加载顺序，否则打印规则会被应用布局覆盖。
const css = [
  "tokens.css",
  "base.css",
  "reader.css",
  "editor.css",
  "app.css",
  "print.css",
]
  .map((file) => fs.readFileSync(path.join(root, "src/styles", file), "utf8"))
  .join("\n");

const html = `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<title>墨览打印验证文档</title>
<style>${css}</style>
</head>
<body>
<div id="root">
  <div class="app-shell">
    <header class="titlebar">
      <div class="brand"><span class="brand-mark">墨</span><span class="brand-name">墨览</span></div>
      <div class="doc-title">墨览打印验证文档</div>
      <div class="toolbar"><button class="tool-btn">打开</button><button class="tool-btn">源码</button><button class="tool-btn">保存</button><button class="tool-btn">打印</button></div>
    </header>
    <div class="workbench">
      <aside class="sidebar">
        <section class="side-section"><h2>文档</h2><div class="file-path">pdf-check.md</div></section>
        <section class="side-section outline"><h2>大纲</h2><ul><li><button>墨览打印验证文档</button></li></ul></section>
      </aside>
      <main class="content">
        <div class="reader-scroll">
          <article class="md-body">${rendered}</article>
        </div>
      </main>
    </div>
    <footer class="statusbar"><span class="status-left">已保存</span></footer>
  </div>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, `preview-${theme}.html`), html);
console.log(`wrote test-results/pdf-check/preview-${theme}.html`);
