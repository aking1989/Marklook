import GithubSlugger from "github-slugger";
import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import { parse as parseYaml } from "yaml";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";
import { visit } from "unist-util-visit";
import { sanitizeSchema } from "./schema";
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
}

const remarkCollect: Plugin<[CollectOptions], Root> = (options) => (tree) => {
  const { outline, slugger, frontmatter, warnings } = options;

  visit(tree, (node) => {
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
    }
  });

  visit(tree, "heading", (node) => {
    const text = toString(node).trim();
    if (!text || !node.position) return;
    outline.push({
      id: slugger.slug(text),
      depth: node.depth,
      text,
      line: node.position.start.line,
    });
  });

  visit(tree, (node, _index, parent) => {
    if (parent?.type !== "root" || !node.position) return;
    if (node.type === "yaml") return;

    const withData = node as typeof node & {
      data?: { hProperties?: Record<string, unknown> };
    };
    withData.data ??= {};
    withData.data.hProperties = {
      ...withData.data.hProperties,
      "data-line-start": node.position.start.line,
      "data-line-end": node.position.end.line,
    };
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

export async function renderMarkdown(
  input: RenderInput,
): Promise<RenderResult> {
  const outline: OutlineItem[] = [];
  const warnings: RenderWarning[] = [];
  const frontmatter: Record<string, unknown> = {};
  const slugger = new GithubSlugger();

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkCollect, { outline, slugger, frontmatter, warnings })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  const file = await processor.process(input.source);
  const html = String(file);
  const title = resolveTitle(frontmatter, outline, input.docPath);

  return {
    html,
    outline,
    frontmatter,
    title,
    meta: countWords(input.source),
    warnings,
  };
}
