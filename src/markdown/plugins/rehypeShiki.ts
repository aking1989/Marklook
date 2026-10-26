import { fromHtml } from "hast-util-from-html";
import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { readLineAnchors } from "./lineAnchors";
import type { RenderWarning } from "../types";

/** 预置语言：覆盖绝大多数技术文档，首屏一次加载。 */
const PRESET_LANGS = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "bash",
  "sh",
  "python",
  "rust",
  "go",
  "c",
  "cpp",
  "java",
  "csharp",
  "sql",
  "yaml",
  "toml",
  "html",
  "css",
  "markdown",
  "diff",
  "ini",
  "dockerfile",
] as const;

/** 亮/暗双主题一次生成，切主题只切 CSS 变量，不重新高亮。 */
const THEMES = { light: "github-light", dark: "github-dark" } as const;

const CACHE_CAPACITY = 500;

const htmlCache = new Map<string, string>();

function cacheGet(key: string): string | null {
  const hit = htmlCache.get(key);
  if (hit !== undefined) {
    htmlCache.delete(key);
    htmlCache.set(key, hit);
    return hit;
  }
  return null;
}

function cacheSet(key: string, html: string): void {
  if (htmlCache.has(key)) htmlCache.delete(key);
  htmlCache.set(key, html);
  if (htmlCache.size > CACHE_CAPACITY) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
}

/** 仅用于测试：清空 LRU 缓存。 */
export function clearHighlightCache(): void {
  htmlCache.clear();
}

let highlighterPromise: Promise<import("shiki").Highlighter> | null = null;

async function getHighlighter(): Promise<import("shiki").Highlighter> {
  highlighterPromise ??= import("shiki").then((shiki) =>
    shiki.createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: [...PRESET_LANGS],
    }),
  );
  return highlighterPromise;
}

interface CodeBlock {
  parent: Root | Element;
  index: number;
  pre: Element;
  code: Element;
  lang: string;
  source: string;
}

export interface RehypeShikiOptions {
  warnings: RenderWarning[];
}

/**
 * 代码高亮：pre > code.language-X 整块替换为 Shiki 双主题输出。
 * 在 sanitize 之后运行，输出为可信生成内容；失败时降级为普通代码块。
 * 行号锚点（data-line-*）迁移到新节点，保证 line-map 不受影响。
 */
export const rehypeShiki: Plugin<[RehypeShikiOptions], Root> =
  (options) => async (tree) => {
    const blocks: CodeBlock[] = [];

    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;

      const code = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "code",
      );
      if (!code) return;

      const langClass = (code.properties?.className ?? []).find(
        (name): name is string =>
          typeof name === "string" && name.startsWith("language-"),
      );
      if (!langClass) return;

      blocks.push({
        parent,
        index,
        pre: node,
        code,
        lang: langClass.slice("language-".length),
        source: collectText(code),
      });
    });

    if (blocks.length === 0) return;

    let highlighter: import("shiki").Highlighter;
    try {
      highlighter = await getHighlighter();
    } catch {
      options.warnings.push({
        kind: "highlight",
        message: "代码高亮初始化失败，已降级为普通代码块",
      });
      return;
    }

    for (const block of blocks) {
      if (block.lang === "mermaid") continue; // Mermaid 块由专门插件接管

      const resolved = await resolveLanguage(
        highlighter,
        block.lang,
        options.warnings,
      );
      if (resolved === null) continue; // 未知语言：保持普通代码块

      const cacheKey = `${resolved}\u{0}${block.source}`;
      let html = cacheGet(cacheKey);

      if (html === null) {
        try {
          html = highlighter.codeToHtml(block.source, {
            lang: resolved,
            themes: { light: THEMES.light, dark: THEMES.dark },
            // 只输出 CSS 变量（--shiki-light / --shiki-dark），
            // 由主题选择变量，避免内联 color 无法被主题覆盖。
            defaultColor: false,
          });
          cacheSet(cacheKey, html);
        } catch {
          options.warnings.push({
            kind: "highlight",
            message: `代码块语言 ${block.lang} 高亮失败，已降级为普通代码块`,
          });
          continue;
        }
      }

      const shikiPre = fromHtml(html, { fragment: true }).children.find(
        (child): child is Element => child.type === "element",
      );
      if (!shikiPre) continue;

      // 行号锚点可能落在 pre 或内层 code 上，且 key 有 camel/kebab 两种形态
      //（取决于是否经过 rehypeRaw）；统一读取后迁移到 shiki 的 pre。
      const anchors = readLineAnchors(block.pre, block.code);
      shikiPre.properties = { ...shikiPre.properties, ...anchors };

      block.parent.children[block.index] = shikiPre;
    }
  };

/**
 * 无需高亮的纯文本语言别名。Shiki 不内置 text/plaintext，
 * 技术文档里大量 ` ```text ` 块会被当成未知语言并刷 warning（还会污染 warnings）。
 * 这类块按普通代码块保留，不加载语法、不报 warning。
 */
const PLAIN_LANGUAGES = new Set([
  "text",
  "plaintext",
  "plain",
  "txt",
  "output",
  "log",
  "tree",
  "none",
]);

async function resolveLanguage(
  highlighter: import("shiki").Highlighter,
  lang: string,
  warnings: RenderWarning[],
): Promise<string | null> {
  if (PLAIN_LANGUAGES.has(lang.toLowerCase())) return null;
  if (highlighter.getLoadedLanguages().includes(lang)) return lang;

  const shiki = await import("shiki");
  const bundle = (
    shiki.bundledLanguages as Record<
      string,
      import("shiki").LanguageInput | undefined
    >
  )[lang];
  if (!bundle) {
    warnings.push({ kind: "highlight", message: `未知代码语言：${lang}` });
    return null;
  }

  try {
    await highlighter.loadLanguage(bundle);
    return lang;
  } catch {
    warnings.push({ kind: "highlight", message: `未知代码语言：${lang}` });
    return null;
  }
}

function collectText(code: Element): string {
  let text = "";
  visit(code, "text", (node) => {
    text += node.value;
  });
  return text.replace(/\n$/, "");
}
