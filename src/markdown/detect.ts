/**
 * 能力探测：保守扫描源文本，决定是否值得加载 KaTeX / Shiki / Mermaid。
 * 数学检测跳过代码围栏内容，避免为普通文档引入额外依赖。
 *
 * 围栏可以出现在列表项、引用块里（缩进或 `> ` 前缀），这是真实笔记的常见写法；
 * 只匹配行首围栏会漏掉这些代码块，导致不加载 Shiki / Mermaid。
 */
export interface Capabilities {
  math: boolean;
  mermaid: boolean;
  code: boolean;
}

const FENCE = /^[ \t>]*(```|~~~)/m;
const MERMAID_FENCE = /^[ \t>]*```[ \t]*mermaid\b/im;
const ANY_FENCE = /^[ \t>]*(```|~~~)[\s\S]*?^[ \t>]*(```|~~~)/gm;

export function detectCapabilities(source: string): Capabilities {
  const noFences = source.replace(ANY_FENCE, "");

  return {
    // 行内代码里的 $ 不算公式（`$HOME`、`price=$5` 很常见）。
    math: /\$\$[\s\S]+?\$\$|(^|[^\\$`])\$[^$\n`]+\$/m.test(
      noFences.replace(/`[^`\n]*`/g, ""),
    ),
    mermaid: MERMAID_FENCE.test(source),
    code: FENCE.test(source),
  };
}
