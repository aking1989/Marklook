import katexCss from "katex/dist/katex.min.css?raw";
import type { RenderTheme } from "../../markdown/types";
import { platform } from "../../platform";
import baseCss from "../../styles/base.css?raw";
import readerCss from "../../styles/reader.css?raw";
import tokensCss from "../../styles/tokens.css?raw";

/** 主题 class（tokens.css 按 [data-theme] 切换变量）。 */
const THEME_BACKGROUND: Record<RenderTheme, string> = {
  light: "#ffffff",
  dark: "#14181d",
  sepia: "#f8f1e3",
};

/**
 * 组装自包含 HTML：样式内联、本地图片转 data URI、KaTeX/Mermaid 已是静态输出。
 * 字体说明：KaTeX 字体文件不内嵌（体积），离线打开时公式回退系统 serif，仍可读。
 */
export async function buildStandaloneHtml(
  articleElement: HTMLElement,
  title: string,
  theme: RenderTheme,
): Promise<string> {
  const cloned = articleElement.cloneNode(true) as HTMLElement;

  // 去掉导出不需要的交互元素（复制按钮）。
  for (const button of cloned.querySelectorAll(".code-copy-btn")) {
    button.remove();
  }

  // 本地图片 → data URI（远程图片保持原 URL，由查看端决定加载）。
  const images = Array.from(cloned.querySelectorAll<HTMLImageElement>("img"));
  for (const img of images) {
    const abs = img.getAttribute("data-abs-src");
    if (!abs) continue;
    try {
      const dataUrl = await platform.readAssetDataUrl(abs);
      if (dataUrl) img.setAttribute("src", dataUrl);
    } catch {
      // 单张失败保留占位（alt）。
    }
  }

  const bodyHtml = cloned.innerHTML;
  const background = THEME_BACKGROUND[theme];

  return [
    "<!DOCTYPE html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style data-marklook="tokens">${minify(tokensCss)}</style>`,
    `<style data-marklook="base">${minify(baseCss)}</style>`,
    `<style data-marklook="reader">${minify(readerCss)}</style>`,
    `<style data-marklook="katex">${minify(katexCss)}</style>`,
    "<style>body{margin:0;background:" + background + ";}</style>",
    "</head>",
    `<body data-theme="${theme}">`,
    '<article class="md-body">',
    bodyHtml,
    "</article>",
    "</body>",
    "</html>",
  ].join("\n");
}

/** 等待 Mermaid 渲染队列完成（占位块被替换为 svg），最多 timeout 毫秒。 */
export async function waitForRenderedFigures(
  article: HTMLElement,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pending = article.querySelectorAll(
      ".mermaid-block:not(:has(svg))",
    ).length;
    if (pending === 0 || Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function minify(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}
