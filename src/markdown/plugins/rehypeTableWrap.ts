import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/** 表格外包一层横向滚动容器，窄窗口不撑破版心。 */
export const rehypeTableWrap: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node, index, parent) => {
    if (node.tagName !== "table" || !parent || index === undefined) return;
    if (
      parent.type === "element" &&
      parent.tagName === "div" &&
      Array.isArray(parent.properties?.className) &&
      parent.properties.className.includes("table-wrap")
    ) {
      return;
    }

    const wrap: Element = {
      type: "element",
      tagName: "div",
      properties: { className: ["table-wrap"] },
      children: [node],
    };

    parent.children[index] = wrap;
  });
};
