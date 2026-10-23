import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import {
  dirname,
  isExternalUrl,
  isMarkdownPath,
  joinPath,
} from "../../lib/docPath";

export interface RehypeResolveUrlsOptions {
  docPath: string | null;
  allowRemoteImages: boolean;
  /** 绝对路径 → 可用于 <img src> 的 URL（如 mdasset://）。缺省时保留原相对 src。 */
  resolveAsset?: (absolutePath: string) => string;
  /** 导出模式：远程图片保留原 src，离线 HTML 由浏览器自行加载。 */
  forExport?: boolean;
}

/**
 * 相对链接/图片解析与外链标记（sanitize 之后运行，输出可信）：
 * - 页内锚点 → data-anchor，点击按大纲行号滚动
 * - 相对 .md → data-internal-doc（绝对路径），点击由应用打开
 * - 外链 → data-external + 安全的 target/rel
 * - 相对图片 → resolveAsset 转 mdasset://，带 data-abs-src
 * - 远程图片 → 占位 figure；allowRemoteImages 时提供点击加载按钮
 */
export const rehypeResolveUrls: Plugin<[RehypeResolveUrlsOptions], Root> =
  (options) => (tree) => {
    const { docPath, allowRemoteImages, resolveAsset, forExport } = options;
    const baseDir = docPath ? dirname(docPath) : null;

    visit(tree, "element", (node) => {
      if (node.tagName === "a") {
        resolveAnchor(node, baseDir);
        return;
      }
      if (node.tagName === "img") {
        resolveImage(node, {
          baseDir,
          allowRemoteImages,
          resolveAsset,
          forExport: forExport ?? false,
        });
      }
    });
  };

function resolveAnchor(node: Element, baseDir: string | null): void {
  const href =
    typeof node.properties?.href === "string" ? node.properties.href : null;
  if (!href) return;

  if (href.startsWith("#")) {
    node.properties.dataAnchor = href.slice(1);
    return;
  }

  if (isExternalUrl(href)) {
    node.properties.dataExternal = true;
    node.properties.target = "_blank";
    node.properties.rel = ["noopener", "noreferrer"];
    return;
  }

  // 相对 Markdown 文档：解析为绝对路径，交给应用在当前窗口打开；
  // 其余相对路径（附件等）保留原样，点击交给系统处理。
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    const path = href.split(/[?#]/)[0] ?? href;
    if (path && isMarkdownPath(path)) {
      node.properties.dataInternalDoc = baseDir
        ? joinPath(baseDir, path)
        : path;
    }
  }
}

interface ImageContext {
  baseDir: string | null;
  allowRemoteImages: boolean;
  resolveAsset?: (absolutePath: string) => string;
  forExport: boolean;
}

function resolveImage(node: Element, context: ImageContext): void {
  const src =
    typeof node.properties?.src === "string" ? node.properties.src : null;
  if (!src) return;
  const alt =
    typeof node.properties?.alt === "string" ? node.properties.alt : "";

  if (isExternalUrl(src)) {
    if (context.forExport) {
      node.properties.dataRemoteSrc = src;
      return;
    }

    // 默认零网络：远程图片替换为占位块，允许时提供点击加载按钮。
    const placeholderChildren: import("hast").ElementContent[] = [
      {
        type: "element",
        tagName: "span",
        properties: {},
        children: [
          {
            type: "text",
            value: context.allowRemoteImages
              ? `远程图片（点击加载）：${src}`
              : `远程图片已阻止：${src}`,
          },
        ],
      },
    ];

    if (context.allowRemoteImages) {
      placeholderChildren.push({
        type: "element",
        tagName: "button",
        properties: { className: ["load-remote-btn"], type: "button" },
        children: [{ type: "text", value: "加载图片" }],
      });
    }

    const figureChildren: import("hast").ElementContent[] = [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["remote-image-placeholder"] },
        children: placeholderChildren,
      },
    ];

    if (alt) {
      figureChildren.push({
        type: "element",
        tagName: "figcaption",
        properties: {},
        children: [{ type: "text", value: alt }],
      });
    }

    // hast 节点没有父指针，直接把原 img 改写为 figure（保留树中位置）。
    node.tagName = "figure";
    node.properties = { className: ["remote-image"], dataRemoteSrc: src };
    node.children = figureChildren;
    return;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return; // mdasset 等已解析协议，原样保留

  if (context.baseDir) {
    const absolute = joinPath(context.baseDir, src.split(/[?#]/)[0] ?? src);
    node.properties.dataAbsSrc = absolute;
    if (context.resolveAsset) {
      node.properties.src = context.resolveAsset(absolute);
    }
  }
}
