import GithubSlugger from "github-slugger";
import type { Root } from "mdast";
import { toString } from "mdast-util-to-string";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";
import { visit } from "unist-util-visit";
import { sanitizeSchema } from "./schema";
import type { OutlineItem, RenderResult } from "./types";

interface CollectOptions {
  outline: OutlineItem[];
  slugger: GithubSlugger;
}

const remarkCollect: Plugin<[CollectOptions], Root> = (options) => (tree) => {
  const { outline, slugger } = options;

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

function countWords(source: string): {
  charCount: number;
  wordCount: number;
  readingMinutes: number;
} {
  const cjkPattern = /[㐀-鿿豈-﫿]/g;
  const cjkCount = source.match(cjkPattern)?.length ?? 0;
  const latinCount =
    source
      .replace(cjkPattern, " ")
      .match(/[A-Za-z0-9_]+/g)?.length ?? 0;

  return {
    charCount: source.length,
    wordCount: cjkCount + latinCount,
    readingMinutes: Math.max(1, Math.ceil(cjkCount / 400 + latinCount / 220)),
  };
}

export async function renderMarkdown(
  source: string,
  docPath: string | null,
): Promise<RenderResult> {
  const outline: OutlineItem[] = [];
  const slugger = new GithubSlugger();

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCollect, { outline, slugger })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  const file = await processor.process(source);
  const html = String(file);
  const title =
    outline.find((item) => item.depth === 1)?.text ??
    fileNameTitle(docPath) ??
    "未命名文档";

  return {
    html,
    outline,
    title,
    meta: countWords(source),
  };
}
