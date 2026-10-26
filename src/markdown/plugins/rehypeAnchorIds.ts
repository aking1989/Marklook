import type { Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { decodeUrlPath } from "../../lib/docPath";

/** hast-util-sanitize 给 id 加的前缀（schema.clobberPrefix 的默认值）。 */
const ID_PREFIX = "user-content-";

/**
 * 让页内链接与 sanitize 处理后的 id 对齐。
 *
 * 脚注由 remark-rehype 生成：id 是 `fn-1`，href 是 `#fn-1`。
 * 之后 sanitize 会给 id 补 `user-content-` 前缀（防 DOM clobbering），
 * 但不会改写 href——结果脚注链接指向不存在的 `#fn-1`，点击无反应，
 * 导出的 HTML 同样失效。这里按树里实际存在的 id 补齐前缀。
 */
export const rehypeAnchorIds: Plugin<[], Root> = () => (tree) => {
  const ids = new Set<string>();
  visit(tree, "element", (node) => {
    const id = node.properties?.id;
    if (typeof id === "string") ids.add(id);
  });

  visit(tree, "element", (node) => {
    if (node.tagName !== "a") return;
    const href = node.properties?.href;
    if (typeof href !== "string" || !href.startsWith("#")) return;

    const target = decodeUrlPath(href.slice(1));
    if (target.startsWith(ID_PREFIX) || ids.has(target)) return;
    if (ids.has(`${ID_PREFIX}${target}`)) {
      node.properties.href = `#${ID_PREFIX}${target}`;
    }
  });
};
