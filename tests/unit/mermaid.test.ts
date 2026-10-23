import { describe, expect, it } from "vitest";
import { base64ToUtf8, utf8ToBase64 } from "../../src/lib/base64";
import { renderMarkdown } from "../../src/markdown/pipeline";

describe("base64 工具", () => {
  it("Unicode 往返一致", () => {
    const samples = ["graph TD\nA-->B", "中文图表「引号」✓", ""];
    for (const sample of samples) {
      expect(base64ToUtf8(utf8ToBase64(sample))).toBe(sample);
    }
  });
});

describe("Mermaid 占位", () => {
  it("mermaid 代码块替换为携带 base64 源码的占位块", async () => {
    const source = "```mermaid\ngraph TD\n  A-->B\n```";
    const result = await renderMarkdown({ source, docPath: null });

    expect(result.html).toContain("mermaid-block");
    expect(result.html).not.toContain("language-mermaid");

    const match = result.html.match(/data-mermaid="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(base64ToUtf8(match![1] as string)).toBe("graph TD\n  A-->B");
  });

  it("占位块保留行号锚点", async () => {
    const result = await renderMarkdown({
      source: "# 标题\n\n```mermaid\ngraph TD\n  A-->B\n```",
      docPath: null,
    });

    expect(result.html).toMatch(
      /class="mermaid-block"[^>]*data-line-start="\d+"/,
    );
  });

  it("enableMermaid 关闭时保留普通代码块", async () => {
    const result = await renderMarkdown({
      source: "```mermaid\ngraph TD\n```",
      docPath: null,
      options: { enableMermaid: false },
    });

    expect(result.html).not.toContain("mermaid-block");
    expect(result.html).toContain("language-mermaid");
  });

  it("占位块源码不会把 HTML 注入进属性", async () => {
    const result = await renderMarkdown({
      source: '```mermaid\ngraph TD\n  A--"<img src=x onerror=1>"-->B\n```',
      docPath: null,
    });

    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("onerror=1");
  });
});
