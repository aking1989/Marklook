import { describe, expect, it } from "vitest";
import {
  SearchCore,
  tokenize,
  type SearchDoc,
} from "../../src/features/search/searchCore";

function doc(path: string, title: string, body: string): SearchDoc {
  return { id: path, path, title, body, mtimeMs: 1, size: body.length };
}

describe("tokenize 中文分词", () => {
  it("CJK 词与二元组，拉丁按词切分", () => {
    const tokens = tokenize("Markdown 编辑器入门");
    // Segmenter 会把"编辑器"细分为"编辑"+"器"，二元组保证子串命中。
    expect(tokens).toContain("markdown");
    expect(tokens).toContain("编辑");
    expect(tokens).toContain("器");
    expect(tokens).toContain("入门");
  });

  it("标点与空白不产生 token", () => {
    expect(tokenize("你好，世界！")).not.toContain("，");
    expect(tokenize("  \n\t")).toEqual([]);
  });
});

describe("SearchCore", () => {
  it("中文子串可命中（编辑器 → 编辑）", () => {
    const core = new SearchCore();
    core.reset([
      doc("/a/intro.md", "intro.md", "这是一款以阅读为中心的编辑器。"),
      doc("/a/other.md", "other.md", "完全无关的内容。"),
    ]);

    const { hits } = core.query("编辑");
    expect(hits.map((hit) => hit.path)).toContain("/a/intro.md");
    expect(hits.map((hit) => hit.path)).not.toContain("/a/other.md");
  });

  it("命中定位行号与摘要高亮", () => {
    const core = new SearchCore();
    core.reset([
      doc("/a/note.md", "note.md", "第一行\n第二行说到 markdown 渲染\n第三行"),
    ]);

    const { hits } = core.query("markdown");
    const hit = hits.find((entry) => entry.path === "/a/note.md");
    expect(hit?.line).toBe(2);
    expect(hit?.snippet).toContain("markdown");
    expect(hit?.ranges.length).toBeGreaterThan(0);

    const [start, end] = hit?.ranges[0] ?? [];
    expect(hit?.snippet.slice(start, end).toLowerCase()).toBe("markdown");
  });

  it("标题命中权重更高", () => {
    const core = new SearchCore();
    core.reset([
      doc("/a/alpha.md", "搜索算法.md", "正文里没有关键词"),
      doc("/a/beta.md", "别的.md", "正文里提到 搜索算法 一次"),
    ]);

    const { hits } = core.query("搜索算法");
    expect(hits[0]?.path).toBe("/a/alpha.md");
  });

  it("update 与 remove 维护索引", () => {
    const core = new SearchCore();
    core.reset([doc("/a/x.md", "x.md", "旧内容 key")]);

    expect(core.query("key").hits.length).toBe(1);

    core.update(doc("/a/x.md", "x.md", "新内容 value"));
    expect(core.query("key").hits.length).toBe(0);
    expect(core.query("value").hits.length).toBe(1);

    core.remove("/a/x.md");
    expect(core.query("value").hits.length).toBe(0);
    expect(core.size).toBe(0);
  });

  it("空查询与异常查询安全", () => {
    const core = new SearchCore();
    core.reset([doc("/a/x.md", "x.md", "内容")]);

    expect(core.query("").hits).toEqual([]);
    expect(core.query("  ").hits).toEqual([]);
    expect(core.query("\\").hits).toEqual([]);
  });
});
