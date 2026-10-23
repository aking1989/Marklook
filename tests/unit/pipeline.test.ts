import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/markdown/pipeline";

describe("renderMarkdown", () => {
  it("提取大纲、标题与行号锚点", async () => {
    const result = await renderMarkdown({
      source: "# 标题\n\n## 子标题\n\n正文",
      docPath: "/tmp/note.md",
    });

    expect(result.title).toBe("标题");
    expect(result.outline).toEqual([
      { id: "标题", depth: 1, text: "标题", line: 1 },
      { id: "子标题", depth: 2, text: "子标题", line: 3 },
    ]);
    expect(result.html).toContain('data-line-start="1"');
  });

  it("支持 GFM 表格与任务列表", async () => {
    const result = await renderMarkdown({
      source: "| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] 完成",
      docPath: null,
    });

    expect(result.html).toContain("<table");
    expect(result.html).toContain('type="checkbox"');
  });

  it("去掉不安全的 HTML", async () => {
    const result = await renderMarkdown({
      source: '<script>alert("xss")</script>\n\n# 安全',
      docPath: null,
    });

    expect(result.html).not.toContain("<script");
    expect(result.title).toBe("安全");
  });

  it("没有一级标题时用文件名兜底", async () => {
    const result = await renderMarkdown({
      source: "正文",
      docPath: "/tmp/my-note.md",
    });
    expect(result.title).toBe("my-note");
  });

  it("统计中英文字数并估算阅读时间", async () => {
    const result = await renderMarkdown({
      source: "中文 abc 123",
      docPath: null,
    });

    expect(result.meta.wordCount).toBe(4);
    expect(result.meta.readingMinutes).toBe(1);
  });

  it("解析 YAML frontmatter，且不渲染进正文", async () => {
    const result = await renderMarkdown({
      source: "---\ntitle: 手写标题\ntags: [a, b]\n---\n\n# 正文标题\n",
      docPath: "/tmp/fm.md",
    });

    expect(result.frontmatter).toEqual({ title: "手写标题", tags: ["a", "b"] });
    expect(result.title).toBe("手写标题");
    expect(result.html).not.toContain("手写标题");
  });

  it("frontmatter YAML 非法时降级并记录 warning", async () => {
    const result = await renderMarkdown({
      source: "---\ntitle: [未闭合\n---\n\n# 标题\n",
      docPath: "/tmp/bad-fm.md",
    });

    expect(result.frontmatter).toEqual({});
    expect(result.title).toBe("标题");
    expect(result.warnings).toEqual([
      { kind: "frontmatter", message: "frontmatter YAML 解析失败，已忽略" },
    ]);
  });

  it("frontmatter 不是键值结构时忽略并记录 warning", async () => {
    const result = await renderMarkdown({
      source: "---\n- 只是\n- 列表\n---\n\n正文",
      docPath: null,
    });

    expect(result.frontmatter).toEqual({});
    expect(result.warnings[0]?.kind).toBe("frontmatter");
  });

  it("frontmatter title 优先于一级标题与文件名", async () => {
    const withH1 = await renderMarkdown({
      source: "---\ntitle: 元标题\n---\n\n# 文内标题\n",
      docPath: "/tmp/x.md",
    });
    expect(withH1.title).toBe("元标题");
  });
});
