/**
 * 能力探测：保守扫描源文本，决定是否值得加载 KaTeX / Shiki / Mermaid。
 * 数学检测跳过代码围栏内容，避免为普通文档引入额外依赖。
 */
export interface Capabilities {
  math: boolean;
  mermaid: boolean;
  code: boolean;
}

export function detectCapabilities(source: string): Capabilities {
  const noFences = source.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");

  return {
    math: /\$\$[\s\S]+?\$\$|(^|[^\\$])\$[^$\n]+\$/m.test(noFences),
    mermaid: /^```\s*mermaid\b/m.test(source),
    code: /^(```|~~~)/m.test(source),
  };
}
