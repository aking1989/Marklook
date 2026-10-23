import { describe, expect, it } from "vitest";
import { detectCapabilities } from "../../src/markdown/detect";

describe("detectCapabilities", () => {
  it("识别行内与块级公式", () => {
    expect(detectCapabilities("$E=mc^2$")).toEqual({
      math: true,
      mermaid: false,
      code: false,
    });
    expect(detectCapabilities("$$\n\\int x\n$$").math).toBe(true);
  });

  it("代码围栏里的 $ 不算公式", () => {
    const source = "```bash\nprice=$5 and $10\n```\n\n正文";
    expect(detectCapabilities(source).math).toBe(false);
  });

  it("普通金额文本不触发数学加载", () => {
    // 单个 $ 或不成对的 $ 不算公式；成对 $ 属保守误报，代价只是多加载一次 KaTeX。
    expect(detectCapabilities("价格是 $100。").math).toBe(false);
    expect(detectCapabilities("无特殊字符的正文").math).toBe(false);
  });

  it("识别代码围栏与 mermaid", () => {
    expect(detectCapabilities("```ts\nx\n```").code).toBe(true);
    expect(detectCapabilities("```mermaid\ngraph TD\n```")).toEqual({
      math: false,
      mermaid: true,
      code: true,
    });
  });
});
