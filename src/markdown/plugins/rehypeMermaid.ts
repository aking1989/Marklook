import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { utf8ToBase64 } from "../../lib/base64";
import { readLineAnchors } from "./lineAnchors";

/**
 * Mermaid 代码块 → 占位元素。
 * 管线只负责占位（sanitize 之后注入），实际渲染由阅读视图的串行队列完成，
 * 避免 Mermaid 全局状态并发冲突，也保证大文档首屏不被图表阻塞。
 */
export const rehypeMermaid: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node, index, parent) => {
    if (node.tagName !== "pre" || !parent || index === undefined) return;

    const code = node.children.find(
      (child): child is Element =>
        child.type === "element" && child.tagName === "code",
    );
    const classes = code?.properties?.className;
    if (
      !code ||
      !Array.isArray(classes) ||
      !classes.includes("language-mermaid")
    ) {
      return;
    }

    let source = "";
    visit(code, "text", (textNode) => {
      source += textNode.value;
    });
    source = source.replace(/\n$/, "");

    const anchors = readLineAnchors(node, code);

    const placeholder: Element = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mermaid-block"],
        dataMermaid: utf8ToBase64(source),
        ...anchors,
      },
      children: [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["mermaid-placeholder"] },
          children: [{ type: "text", value: "正在渲染图表…" }],
        },
      ],
    };

    parent.children[index] = placeholder;
  });
};
