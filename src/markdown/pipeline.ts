import GithubSlugger from "github-slugger";
import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import { parse as parseYaml } from "yaml";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";
import { visit } from "unist-util-visit";
import { detectCapabilities } from "./detect";
import { sanitizeSchema } from "./schema";
import { rehypeResolveUrls } from "./plugins/rehypeResolveUrls";
import { rehypeTableWrap, rehypeTaskListA11y } from "./plugins/rehypeTableWrap";
import type {
  OutlineItem,
  RenderInput,
  RenderOptions,
  RenderResult,
  RenderWarning,
} from "./types";

export function defaultRenderOptions(): RenderOptions {
  return {
    allowRemoteImages: false,
    enableMath: true,
    enableMermaid: true,
    enableHighlight: true,
    largeFileMode: false,
    forExport: false,
    theme: "light",
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CollectOptions {
  outline: OutlineItem[];
  slugger: GithubSlugger;
  frontmatter: Record<string, unknown>;
  warnings: RenderWarning[];
  largeFileMode: boolean;
}

const remarkCollect: Plugin<[CollectOptions], Root> = (options) => (tree) => {
  const { outline, slugger, frontmatter, warnings } = options;
  let outlineTruncated = false;

  // 单次遍历同时完成：frontmatter 解析、大纲收集、顶层块行号锚点。
  visit(tree, (node, _index, parent) => {
    // 顶层块（除 frontmatter）加行号锚点。
    if (parent?.type === "root" && node.position && node.type !== "yaml") {
      const withData = node as typeof node & {
        data?: { hProperties?: Record<string, unknown> };
      };
      withData.data ??= {};
      withData.data.hProperties = {
        ...withData.data.hProperties,
        "data-line-start": node.position.start.line,
        "data-line-end": node.position.end.line,
      };
    }

    if (node.type === "yaml") {
      try {
        const parsed = parseYaml(String(node.value ?? "")) as unknown;
        if (isPlainObject(parsed)) {
          Object.assign(frontmatter, parsed);
        } else if (parsed !== null && parsed !== undefined) {
          warnings.push({
            kind: "frontmatter",
            message: "frontmatter 必须是键值结构，已忽略",
          });
        }
      } catch {
        warnings.push({
          kind: "frontmatter",
          message: "frontmatter YAML 解析失败，已忽略",
        });
      }
      return;
    }

    if (node.type === "heading") {
      const text = toString(node).trim();
      if (!text || !node.position) return;
      // 大文件：大纲截断，避免数万标题拖慢 slugger 与 UI。
      if (options.largeFileMode && outline.length >= 500) {
        if (!outlineTruncated) {
          outlineTruncated = true;
          warnings.push({
            kind: "frontmatter",
            message: "文档过大，大纲仅显示前 500 个标题",
          });
        }
        return;
      }
      outline.push({
        id: slugger.slug(text),
        depth: node.depth,
        text,
        line: node.position.start.line,
      });
    }
  });
};

function fileNameTitle(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name.replace(/\.(md|markdown|mdown|mkd)$/i, "") || null;
}

function resolveTitle(
  frontmatter: Record<string, unknown>,
  outline: OutlineItem[],
  docPath: string | null,
): string {
  const metaTitle = frontmatter.title;
  if (typeof metaTitle === "string" && metaTitle.trim()) {
    return metaTitle.trim();
  }
  return (
    outline.find((item) => item.depth === 1)?.text ??
    fileNameTitle(docPath) ??
    "未命名文档"
  );
}

function countWords(source: string): {
  charCount: number;
  wordCount: number;
  readingMinutes: number;
} {
  const cjkPattern = /[㐀-鿿豈-﫿]/g;
  const cjkCount = source.match(cjkPattern)?.length ?? 0;
  const latinCount =
    source.replace(cjkPattern, " ").match(/[A-Za-z0-9_]+/g)?.length ?? 0;

  return {
    charCount: source.length,
    wordCount: cjkCount + latinCount,
    readingMinutes: Math.max(1, Math.ceil(cjkCount / 400 + latinCount / 220)),
  };
}

/** 渲染结果 LRU 缓存（容量 8）：编辑↔阅读来回切换、远程图片策略切换时复用。 */
const RENDER_CACHE_CAPACITY = 8;
const renderCache = new Map<string, RenderResult>();

/** 仅用于测试：清空渲染缓存。 */
export function clearRenderCache(): void {
  renderCache.clear();
}

function optionsKey(options: RenderOptions): string {
  return [
    options.allowRemoteImages,
    options.enableMath,
    options.enableMermaid,
    options.enableHighlight,
    options.largeFileMode,
    options.forExport,
    options.theme,
  ].join("|");
}

export async function renderMarkdown(
  input: RenderInput,
): Promise<RenderResult> {
  const outline: OutlineItem[] = [];
  const warnings: RenderWarning[] = [];
  const frontmatter: Record<string, unknown> = {};
  const slugger = new GithubSlugger();
  const options = { ...defaultRenderOptions(), ...input.options };
  const capabilities = detectCapabilities(input.source);

  const cacheKey = `${input.docPath ?? ""}\u{0}${optionsKey(options)}\u{0}${input.source}`;
  const cached = renderCache.get(cacheKey);
  if (cached) {
    renderCache.delete(cacheKey);
    renderCache.set(cacheKey, cached);
    return cached;
  }

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml"]);

  // enableMath 关闭时不挂 remark-math，$ 保持字面文本。
  if (options.enableMath) {
    processor.use(remarkMath);
  }

  processor
    .use(remarkCollect, {
      outline,
      slugger,
      frontmatter,
      warnings,
      largeFileMode: options.largeFileMode,
    })
    .use(remarkRehype, { allowDangerousHtml: true });

  // rehypeRaw 需要 serialize + parse5 重解析，是管线最贵的阶段之一；
  // 文档不含 "<" 时不可能有内嵌 HTML，直接跳过（raw 字符串按文本保留）。
  if (input.source.includes("<")) {
    processor.use(rehypeRaw);
  }

  processor.use(rehypeSanitize, sanitizeSchema);

  // 数学渲染在 sanitize 之后注入，KaTeX 输出不再过 schema；
  // rehype-katex v7 固定不抛错，单条公式失败渲染为错误文本。
  // 大文件模式跳过 KaTeX：$ 语法保留为原文。
  if (options.enableMath && !options.largeFileMode && capabilities.math) {
    const { default: rehypeKatex } = await import("rehype-katex");
    processor.use(rehypeKatex);
  }

  // 代码高亮同样在 sanitize 之后注入；大文件模式跳过以保护性能。
  if (options.enableHighlight && capabilities.code && !options.largeFileMode) {
    const { rehypeShiki } = await import("./plugins/rehypeShiki");
    processor.use(rehypeShiki, { warnings });
  }

  // Mermaid 只替换为占位块，实际渲染在阅读视图挂载后串行执行。
  if (options.enableMermaid && capabilities.mermaid) {
    const { rehypeMermaid } = await import("./plugins/rehypeMermaid");
    processor.use(rehypeMermaid);
  }

  // 资源解析与表格包装固定执行（可信生成阶段）。
  processor
    .use(rehypeResolveUrls, {
      docPath: input.docPath,
      allowRemoteImages: options.allowRemoteImages,
      resolveAsset: input.resolveAsset,
      forExport: options.forExport,
    })
    .use(rehypeTaskListA11y)
    .use(rehypeTableWrap)
    .use(rehypeStringify);
  const file = await processor.process(input.source);
  const html = String(file);
  const title = resolveTitle(frontmatter, outline, input.docPath);

  const result: RenderResult = {
    html,
    outline,
    frontmatter,
    title,
    meta: countWords(input.source),
    warnings,
  };

  if (renderCache.has(cacheKey)) renderCache.delete(cacheKey);
  renderCache.set(cacheKey, result);
  if (renderCache.size > RENDER_CACHE_CAPACITY) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }

  return result;
}
