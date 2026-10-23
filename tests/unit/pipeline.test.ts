import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/markdown/pipeline";

describe("renderMarkdown", () => {
  it("提取大纲、标题与行号锚点", async () => {
    const result = await renderMarkdown(
      "# 标题\n\n## 子标题\n\n正文",
      "/tmp/note.md",
    );

    expect(result.title).toBe("标题");
    expect(result.outline).toEqual([
      { id: "标题", depth: 1, text: "标题", line: 1 },
      { id: "子标题", depth: 2, text: "子标题", line: 3 },
    ]);
    expect(result.html).toContain('data-line-start="1"');
  });

  it("支持 GFM 表格与追认列表", async () => {
    const result = await renderMarkdown(
      "| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] 完成",
      null,
    );

    expect(result.html).toContain("<table");
    expect(result.html).toContain('type="checkbox"');
  });

  it("去掉不安全的 HTML", async () => {
    const result = await renderMarkdown(
      '<script>alert("xss")</script>\n\n# 安全',
      null,
    );

    expect(result.html).not.toContain("<script");
    expect(result.title).toBe("安全");
  });

  it("没有一级标题时用文件名兜底", async () => {
    const result = await renderMarkdown("正文", "/tmp/my-note.md");
    expect(result.title).toBe("my-note");
  });

  it("统计中英文字数并估算阅读时间", async () => {
    const result = await renderMarkdown("中文 abc 123", null);

    expect(result.meta.wordCount).toBe(4);
    expect(result.meta.readingMinutes).toBe(1);
  });
});
