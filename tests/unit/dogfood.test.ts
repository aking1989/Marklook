import { describe, expect, it } from "vitest";
import { detectCapabilities } from "../../src/markdown/detect";
import { decodeUrlPath, joinPath } from "../../src/lib/docPath";
import { renderMarkdown } from "../../src/markdown/pipeline";

/**
 * 狗粮回归（docs/07-dogfood.md）：
 * 每条用例对应一次真实文档暴露的问题，修复后必须长期保持。
 */

describe("DF-01 非 ASCII 路径的链接与图片", () => {
  it("相对图片路径还原为磁盘原文，而不是百分号编码", async () => {
    const result = await renderMarkdown({
      source: "![图](笔记/图.png)",
      docPath: "/docs/note.md",
      resolveAsset: (path) => `mdasset://${path}`,
    });

    expect(result.html).toContain('data-abs-src="/docs/笔记/图.png"');
    expect(result.html).toContain('src="mdasset:///docs/笔记/图.png"');
  });

  it("相对文档链接还原为可打开的磁盘路径", async () => {
    const result = await renderMarkdown({
      source: "[笔记](笔记/其他.md) [带空格](my%20note.md)",
      docPath: "/docs/note.md",
    });

    expect(result.html).toContain('data-internal-doc="/docs/笔记/其他.md"');
    expect(result.html).toContain('data-internal-doc="/docs/my note.md"');
  });

  it("非法百分号序列不抛错，按原文保留", () => {
    expect(decodeUrlPath("100% 完成.md")).toBe("100% 完成.md");
    expect(decodeUrlPath("%E4%B8%AD.md")).toBe("中.md");
    expect(joinPath("/docs", decodeUrlPath("%E4%B8%AD.md"))).toBe(
      "/docs/中.md",
    );
  });
});

describe("DF-02 中文与大小写锚点", () => {
  it("中文锚点还原为标题原文，可在大纲中命中", async () => {
    const result = await renderMarkdown({
      source: "# 中文标题\n\n[跳转](#中文标题)",
      docPath: null,
    });

    expect(result.outline[0]?.id).toBe("中文标题");
    expect(result.html).toContain('data-anchor="中文标题"');
  });

  it("大小写不同的锚点按原文保留", async () => {
    const result = await renderMarkdown({
      source: "# My Heading\n\n[跳转](#My-Heading)",
      docPath: null,
    });

    expect(result.outline[0]?.id).toBe("my-heading");
    expect(result.html).toContain('data-anchor="My-Heading"');
  });
});

describe("DF-03 开头的分隔线不会被当成 frontmatter", () => {
  it("两条 --- 之间的正文完整保留", async () => {
    const result = await renderMarkdown({
      source: "---\n\n# 标题\n\n正文一\n\n---\n\n## 第二节\n\n正文二",
      docPath: null,
    });

    expect(result.outline.map((item) => item.text)).toEqual(["标题", "第二节"]);
    expect(result.html).toContain("正文一");
    expect(result.html).toContain("正文二");
    expect(result.warnings).toEqual([]);
  });

  it("开头只有一条分隔线时按普通 Markdown 渲染", async () => {
    const result = await renderMarkdown({
      source: "---\n\n正文",
      docPath: null,
    });

    expect(result.html).toContain("<hr");
    expect(result.html).toContain("正文");
    expect(result.warnings).toEqual([]);
  });

  it("真正的 frontmatter 仍然解析", async () => {
    const result = await renderMarkdown({
      source: "---\ntitle: 手写标题\ntags:\n  - a\n---\n\n# 正文",
      docPath: null,
    });

    expect(result.title).toBe("手写标题");
    expect(result.frontmatter.tags).toEqual(["a"]);
  });

  it("空 frontmatter 与注释 frontmatter 仍被识别", async () => {
    for (const source of [
      "---\n---\n\n# 正文",
      "---\n# 只是注释\n---\n\n# 正文",
    ]) {
      const result = await renderMarkdown({ source, docPath: null });
      expect(result.html).not.toContain("<hr");
      expect(result.outline[0]?.text).toBe("正文");
    }
  });
});

describe("DF-04 脚注链接与 sanitize 的 id 前缀对齐", () => {
  it("脚注引用与返回链接都指向实际存在的 id", async () => {
    const result = await renderMarkdown({
      source: "正文[^1]\n\n[^1]: 脚注内容",
      docPath: null,
    });

    const ids = [...result.html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const targets = [...result.html.matchAll(/href="#([^"]+)"/g)].map(
      (m) => m[1],
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(ids).toContain(target);
    // 前缀只出现一次。
    expect(result.html).not.toContain("user-content-user-content-");
  });
});

describe("DF-05 列表与引用里的代码围栏", () => {
  it("能力探测识别缩进与引用前缀的围栏", () => {
    expect(detectCapabilities("- 项\n\n    ```js\n    1\n    ```").code).toBe(
      true,
    );
    expect(detectCapabilities("> ```js\n> 1\n> ```").code).toBe(true);
    expect(
      detectCapabilities("- 图\n\n    ```mermaid\n    graph TD\n    ```")
        .mermaid,
    ).toBe(true);
  });

  it("Mermaid 围栏大小写不敏感", () => {
    expect(detectCapabilities("```Mermaid\ngraph TD\n```").mermaid).toBe(true);
  });

  it("行内代码里的 $ 不触发数学渲染", () => {
    expect(detectCapabilities("价格 `$5` 与 `$10`").math).toBe(false);
    expect(detectCapabilities("公式 $a+b$").math).toBe(true);
  });

  it("嵌套在列表里的代码块照常高亮，mermaid 照常占位", async () => {
    const code = await renderMarkdown({
      source: "- 项目\n\n    ```js\n    const a = 1;\n    ```\n",
      docPath: null,
    });
    expect(code.html).toContain("shiki");

    const mermaid = await renderMarkdown({
      source: "- 图\n\n    ```mermaid\n    graph TD\n    A-->B\n    ```\n",
      docPath: null,
    });
    expect(mermaid.html).toContain("mermaid-block");
  });
});

describe("DF-06 纯文本代码块不报未知语言", () => {
  it.each(["text", "plaintext", "txt", "output"])(
    "```%s 保持普通代码块且无 warning",
    async (lang) => {
      const result = await renderMarkdown({
        source: `\`\`\`${lang}\nhello\n\`\`\``,
        docPath: null,
      });

      expect(result.html).toContain("<pre");
      expect(result.html).toContain("hello");
      expect(result.warnings).toEqual([]);
    },
  );

  it("真正未知的语言仍然记录 warning", async () => {
    const result = await renderMarkdown({
      source: "```no-such-lang\nx\n```",
      docPath: null,
    });

    expect(result.warnings.some((w) => w.kind === "highlight")).toBe(true);
  });
});
