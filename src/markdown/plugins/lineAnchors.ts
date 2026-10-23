import type { Element } from "hast";

type AnchorKey =
  "dataLineStart" | "data-line-start" | "dataLineEnd" | "data-line-end";

/**
 * 读取行号锚点属性。
 * 经过 rehypeRaw（parse5）的树属性名是 camelCase（dataLineStart），
 * 直连 remarkRehype 的树保持 kebab-case（data-line-start）——两种都要查。
 */
export function readLineAnchors(...elements: Array<Element | undefined>): {
  dataLineStart?: number | string;
  dataLineEnd?: number | string;
} {
  const pick = (...keys: AnchorKey[]) => {
    for (const element of elements) {
      const properties = element?.properties as
        Record<AnchorKey, number | string | undefined> | undefined;
      for (const key of keys) {
        const value = properties?.[key];
        if (value !== undefined) return value;
      }
    }
    return undefined;
  };

  return {
    dataLineStart: pick("dataLineStart", "data-line-start"),
    dataLineEnd: pick("dataLineEnd", "data-line-end"),
  };
}
