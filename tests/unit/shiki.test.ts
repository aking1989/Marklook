import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/markdown/pipeline";

describe("代码高亮（Shiki）", () => {
  it("高亮 TypeScript 代码块并保留行号锚点", async () => {
    const result = await renderMarkdown({
      source: "```ts\nconst x: number = 1;\n```",
      docPath: null,
    });

    expect(result.html).toContain("shiki-themes");
    expect(result.html).toContain("github-light");
    expect(result.html).toMatch(/data-line-start="\d+"/);
    expect(result.html).toContain("--shiki-light");
    expect(result.html).toContain("--shiki-dark");
  });

  it("同一代码块命中 LRU 缓存时输出一致", async () => {
    const source = '```js\nconsole.log("hi");\n```';
    const first = await renderMarkdown({ source, docPath: null });
    const second = await renderMarkdown({ source, docPath: null });

    expect(first.html).toBe(second.html);
  });

  it("未知语言回退普通代码块并记录 warning", async () => {
    const result = await renderMarkdown({
      source: "```no-such-lang\nplain text\n```",
      docPath: null,
    });

    expect(result.html).toContain("<pre");
    expect(result.html).toContain("plain text");
    expect(result.html).not.toContain("shiki");
    expect(result.warnings.some((w) => w.kind === "highlight")).toBe(true);
  });

  it("enableHighlight 关闭或大文件模式时跳过高亮", async () => {
    const disabled = await renderMarkdown({
      source: "```ts\nconst a = 1;\n```",
      docPath: null,
      options: { enableHighlight: false },
    });
    expect(disabled.html).not.toContain("shiki");

    const large = await renderMarkdown({
      source: "```ts\nconst a = 1;\n```",
      docPath: null,
      options: { largeFileMode: true },
    });
    expect(large.html).not.toContain("shiki");
  });

  it("HTML 转义的内容在高亮后仍是安全的", async () => {
    const result = await renderMarkdown({
      source: '```html\n<img src=x onerror="alert(1)">\n```',
      docPath: null,
    });

    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("onerror=");
    expect(result.html).toContain("&#x3C;");
  });
});
