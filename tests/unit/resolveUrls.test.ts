import { describe, expect, it } from "vitest";
import {
  dirname,
  isMarkdownPath,
  joinPath,
  normalizeSegments,
} from "../../src/lib/docPath";
import { renderMarkdown } from "../../src/markdown/pipeline";

describe("docPath 工具", () => {
  it("POSIX 与 Windows 分隔符都能正确 join", () => {
    expect(joinPath("/a/b", "c.png")).toBe("/a/b/c.png");
    expect(joinPath("C:\\docs", "img\\x.png")).toBe("C:/docs/img/x.png");
  });

  it("词法规范化解析 . 与 .. 段", () => {
    expect(normalizeSegments("/a/b/../c/./d")).toBe("/a/c/d");
    expect(normalizeSegments("../x")).toBe("../x");
    expect(dirname("/a/b/note.md")).toBe("/a/b");
  });

  it("识别 Markdown 扩展名", () => {
    expect(isMarkdownPath("a/b.MD")).toBe(true);
    expect(isMarkdownPath("a/b.markdown")).toBe(true);
    expect(isMarkdownPath("a/b.txt")).toBe(false);
  });
});

describe("rehypeResolveUrls + rehypeTableWrap", () => {
  it("相对图片经 resolver 转为资源 URL 并带绝对路径", async () => {
    const result = await renderMarkdown({
      source: "![图](assets/img.png)",
      docPath: "/docs/note.md",
      resolveAsset: (path) => `mdasset://${path}`,
    });

    expect(result.html).toContain('src="mdasset:///docs/assets/img.png"');
    expect(result.html).toContain('data-abs-src="/docs/assets/img.png"');
  });

  it("相对图片支持 ../ 与无 resolver 时保留相对 src", async () => {
    const withUp = await renderMarkdown({
      source: "![图](../shared/a.png)",
      docPath: "/docs/sub/note.md",
      resolveAsset: (path) => `mdasset://${path}`,
    });
    // ../ 从 /docs/sub 退一级是 /docs
    expect(withUp.html).toContain('src="mdasset:///docs/shared/a.png"');

    const noResolver = await renderMarkdown({
      source: "![图](a.png)",
      docPath: "/docs/note.md",
    });
    expect(noResolver.html).toContain('src="a.png"');
    expect(noResolver.html).toContain('data-abs-src="/docs/a.png"');
  });

  it("docPath 为空时相对图片保持原样", async () => {
    const result = await renderMarkdown({
      source: "![图](a.png)",
      docPath: null,
    });

    expect(result.html).toContain('src="a.png"');
    expect(result.html).not.toContain("data-abs-src");
  });

  it("远程图片默认替换为阻止占位块", async () => {
    const result = await renderMarkdown({
      source: "![远程](https://example.com/x.png)",
      docPath: "/docs/note.md",
    });

    expect(result.html).toContain("remote-image");
    expect(result.html).toContain("远程图片已阻止");
    expect(result.html).not.toMatch(/<img[^>]*src="https:/);
    expect(result.html).not.toContain("load-remote-btn");
  });

  it("allowRemoteImages 时提供点击加载按钮，forExport 保留原 src", async () => {
    const allowed = await renderMarkdown({
      source: "![远程](https://example.com/x.png)",
      docPath: null,
      options: { allowRemoteImages: true },
    });
    expect(allowed.html).toContain("load-remote-btn");
    expect(allowed.html).toContain("点击加载");

    const exported = await renderMarkdown({
      source: "![远程](https://example.com/x.png)",
      docPath: null,
      options: { allowRemoteImages: true, forExport: true },
    });
    expect(exported.html).toContain('src="https://example.com/x.png"');
  });

  it("内部 .md 链接解析为绝对路径并加 data-internal-doc", async () => {
    const result = await renderMarkdown({
      source: "[下一章](./ch2.md) [上级](../index.md)",
      docPath: "/docs/ch1.md",
    });

    expect(result.html).toContain('data-internal-doc="/docs/ch2.md"');
    expect(result.html).toContain('data-internal-doc="/index.md"');
  });

  it("外链与锚点正确标记", async () => {
    const result = await renderMarkdown({
      source: "[官网](https://example.com) [页内](#section)",
      docPath: null,
    });

    expect(result.html).toContain("data-external");
    expect(result.html).toContain('target="_blank"');
    expect(result.html).toContain('rel="noopener noreferrer"');
    expect(result.html).toContain('data-anchor="section"');
  });

  it("表格外包 table-wrap 容器", async () => {
    const result = await renderMarkdown({
      source: "| A | B |\n| - | - |\n| 1 | 2 |",
      docPath: null,
    });

    expect(result.html).toContain('class="table-wrap"');
    expect(result.html).toMatch(/<div class="table-wrap">\s*<table/);
  });

  it("用户手写的内嵌 HTML 图片同样被解析", async () => {
    const result = await renderMarkdown({
      source: '<img src="pic.png" alt="内嵌">',
      docPath: "/docs/note.md",
      resolveAsset: (path) => `mdasset://${path}`,
    });

    expect(result.html).toContain('src="mdasset:///docs/pic.png"');
  });
});
