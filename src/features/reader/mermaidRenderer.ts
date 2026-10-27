import type { RenderTheme } from "../../markdown/types";
import { base64ToUtf8 } from "../../lib/base64";

/** 主题到 Mermaid base 主题变量的近似映射，与阅读主题色保持一致。 */
const THEME_VARIABLES: Record<RenderTheme, Record<string, string>> = {
  light: {
    background: "#ffffff",
    primaryColor: "#f0f2f5",
    primaryTextColor: "#1f2328",
    primaryBorderColor: "#d0d7de",
    lineColor: "#57606a",
    secondaryColor: "#eaeef2",
    tertiaryColor: "#f6f8fa",
  },
  dark: {
    background: "#14181d",
    primaryColor: "#232a31",
    primaryTextColor: "#e6edf3",
    primaryBorderColor: "#3d444d",
    lineColor: "#9198a1",
    secondaryColor: "#2a323b",
    tertiaryColor: "#1c2228",
  },
  sepia: {
    background: "#f8f1e3",
    primaryColor: "#efe4cd",
    primaryTextColor: "#4a3f2f",
    primaryBorderColor: "#d8c9a8",
    lineColor: "#8a7a5c",
    secondaryColor: "#e8dbc0",
    tertiaryColor: "#f4ead6",
  },
};

const CACHE_CAPACITY = 50;

const svgCache = new Map<string, string>();
let renderCounter = 0;

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let initializedTheme: RenderTheme | null = null;

/**
 * 图表标签宽度上限（px）。Mermaid 默认 120px，对技术文档里的长路径/长命令
 * 会把一行拆成五六段；240 在常见栏宽下换行更自然，窄栏仍能靠 SVG 缩放适应。
 */
const LABEL_WRAP_WIDTH = 240;

async function getMermaid(theme: RenderTheme) {
  mermaidPromise ??= import("mermaid").then((mod) => mod.default);
  const mermaid = await mermaidPromise;

  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: THEME_VARIABLES[theme],
      fontFamily: "var(--font-reading, sans-serif)",
      // 标签用 SVG <text> 而不是 HTML foreignObject：
      // foreignObject 的宽度是渲染前按测量值写死的，WKWebView 实际字体更宽时
      // 超出部分被直接裁掉（Chromium 下测量更准，所以只在 macOS 桌面版暴露）。
      // SVG text 随图形一起缩放，不存在裁切。
      htmlLabels: false,
      flowchart: { htmlLabels: false, wrappingWidth: LABEL_WRAP_WIDTH },
      sequence: { wrap: true, width: LABEL_WRAP_WIDTH },
      class: { htmlLabels: false },
      state: { wrappingWidth: LABEL_WRAP_WIDTH },
      er: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
    });
    initializedTheme = theme;
  }

  return mermaid;
}

/** 仅用于测试：清空 SVG 缓存。 */
export function clearMermaidCache(): void {
  svgCache.clear();
}

/**
 * 渲染单个 Mermaid 占位块。调用方保证串行（Mermaid 内部有全局状态）。
 * 失败时显示错误卡片（错误信息 + 可展开源码），不影响其他块。
 */
export async function renderMermaidBlock(
  block: HTMLElement,
  theme: RenderTheme,
): Promise<void> {
  const encoded = block.dataset.mermaid;
  if (!encoded) return;

  const cacheKey = `${theme}:${encoded}`;
  const cached = svgCache.get(cacheKey);
  if (cached !== undefined) {
    block.innerHTML = cached;
    return;
  }

  let svg: string;
  try {
    const mermaid = await getMermaid(theme);
    renderCounter += 1;
    const result = await mermaid.render(
      `marklook-mermaid-${renderCounter}`,
      base64ToUtf8(encoded),
    );
    svg = result.svg;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const escaped = message.replace(/[&<>]/g, (char) => {
      if (char === "&") return "&amp;";
      if (char === "<") return "&lt;";
      return "&gt;";
    });
    block.innerHTML = [
      '<div class="mermaid-error-card" role="alert">',
      `<p class="mermaid-error-message">图表渲染失败：${escaped}</p>`,
      "<details><summary>查看源码</summary></details>",
      "</div>",
    ].join("");
    const details = block.querySelector("details");
    if (details) {
      const pre = document.createElement("pre");
      pre.textContent = base64ToUtf8(encoded);
      details.appendChild(pre);
    }
    return;
  }

  if (svgCache.has(cacheKey)) svgCache.delete(cacheKey);
  svgCache.set(cacheKey, svg);
  if (svgCache.size > CACHE_CAPACITY) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }

  block.innerHTML = svg;
}
