import type { Schema } from "hast-util-sanitize";
import { defaultSchema } from "rehype-sanitize";

/**
 * 以 GitHub 默认 schema 为基础：
 * - 允许滚动同步所需的 data-line-* 属性
 * - 允许代码围栏的语言 class
 * 生成内容（KaTeX/Shiki/Mermaid）在 sanitize 之后注入，因此不需要放宽 style 等属性。
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // rehype-raw 会把 data-* 规范化成 camelCase，两种写法都要放行。
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "data-line-start",
      "data-line-end",
      "dataLineStart",
      "dataLineEnd",
    ],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-/],
    ],
    // remark-math v6 在 sanitize 之前生成的占位 class，KaTeX 在 sanitize 之后注入最终结果。
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", "language-math", "math", "math-inline", "math-display"],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "language-math", "math", "math-inline", "math-display"],
    ],
  },
};
