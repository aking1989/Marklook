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
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "data-line-start",
      "data-line-end",
    ],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-/],
    ],
  },
};
