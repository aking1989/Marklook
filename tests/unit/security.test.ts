import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/markdown/pipeline";

/**
 * M5 安全语料回归：所有 payload 经渲染管线后不得产生可执行内容。
 * 判定标准：
 * - 输出不含 <script / <iframe / <object / <embed / <form / <base；
 * - 不含 on* 事件属性；
 * - href/src 不含 javascript: / data:text/html / vbscript:。
 */
const PAYLOADS: Array<{ name: string; source: string }> = [
  { name: "script 标签", source: "<script>alert(1)</script>\n\n正文" },
  {
    name: "img onerror",
    source: '<img src=x onerror="alert(1)">',
  },
  {
    name: "javascript 链接（HTML）",
    source: '<a href="javascript:alert(1)">点我</a>',
  },
  {
    name: "javascript 链接（Markdown）",
    source: "[点我](javascript:alert(1))",
  },
  {
    name: "data:text/html 链接",
    source:
      "[点我](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  },
  { name: "iframe", source: '<iframe src="https://evil.example"></iframe>' },
  {
    name: "iframe srcdoc",
    source: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  },
  {
    name: "object",
    source: '<object data="https://evil.example/x.swf"></object>',
  },
  { name: "embed", source: '<embed src="https://evil.example/x.svg">' },
  {
    name: "form 注入",
    source: '<form action="https://evil.example"><input type="submit"></form>',
  },
  { name: "base 劫持", source: '<base href="https://evil.example/">' },
  {
    name: "onmouseover",
    source: '<div onmouseover="alert(1)">悬停</div>',
  },
  {
    name: "style 属性注入",
    source: '<div style="background:url(javascript:alert(1))">样式</div>',
  },
  {
    name: "SVG onload",
    source: '<svg onload="alert(1)"><circle r="8"/></svg>',
  },
  {
    name: "details ontoggle",
    source: '<details open ontoggle="alert(1)"><summary>x</summary></details>',
  },
  {
    name: "vbscript 链接",
    source: "[点我](vbscript:msgbox(1))",
  },
  {
    name: "data 图片（用户内容禁止）",
    source: "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+)",
  },
  {
    name: "URL 内联脚本协议变体",
    source: "[x](JaVaScRiPt:alert(1))",
  },
  {
    name: "锚点脚本伪协议",
    source: '<a href="&#106;avascript:alert(1)">实体编码</a>',
  },
  {
    name: "mermaid 块内脚本",
    source: '```mermaid\ngraph TD\n  A--"<script>alert(1)</script>"-->B\n```',
  },
];

const DANGEROUS_TAGS = /<script|<iframe|<object|<embed|<form|<base/i;
const EVENT_ATTR = /\son[a-z]+\s*=/i;
const DANGEROUS_PROTOCOL =
  /(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data:text\/html)/i;

describe("安全语料回归（M5）", () => {
  for (const payload of PAYLOADS) {
    it(`拦截：${payload.name}`, async () => {
      const result = await renderMarkdown({
        source: payload.source,
        docPath: "/tmp/security.md",
      });

      expect(result.html).not.toMatch(DANGEROUS_TAGS);
      expect(result.html).not.toMatch(EVENT_ATTR);
      expect(result.html).not.toMatch(DANGEROUS_PROTOCOL);
    });
  }

  it("整批混合 payload 一次性回归", async () => {
    const source = PAYLOADS.map((payload) => payload.source).join("\n\n");
    const result = await renderMarkdown({ source, docPath: null });

    expect(result.html).not.toMatch(DANGEROUS_TAGS);
    expect(result.html).not.toMatch(EVENT_ATTR);
    expect(result.html).not.toMatch(DANGEROUS_PROTOCOL);
  });

  it("正常内容不被误杀（链接、图片、复选框）", async () => {
    const result = await renderMarkdown({
      source:
        "[官网](https://example.com) ![图](pic.png)\n\n- [x] 完成\n\n<kbd>⌘S</kbd>",
      docPath: "/docs/note.md",
    });

    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).toContain("<img");
    expect(result.html).toContain("<kbd>");
  });
});
