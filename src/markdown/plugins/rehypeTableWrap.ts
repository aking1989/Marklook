import type { Element, Root } from "hast";
import { toString } from "hast-util-to-string";
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

/**
 * 可访问性修正：GFM 任务列表的 checkbox 无关联 label——
 * 补 aria-label（取所在列表项文本），屏幕阅读器可读出任务内容。
 */
export const rehypeTaskListA11y: Plugin<[], Root> = () => (tree) => {
  visit(tree, "element", (node) => {
    if (node.tagName !== "li") return;

    let checkbox: Element | undefined;
    visit(node, "element", (child) => {
      if (checkbox) return;
      if (child.tagName === "input" && child.properties?.type === "checkbox") {
        checkbox = child;
      }
    });

    if (checkbox) {
      const label = toString(node).trim().slice(0, 80) || "任务项";
      checkbox.properties.ariaLabel = label;
      checkbox.properties.ariaReadOnly = "true";
    }
  });
};
