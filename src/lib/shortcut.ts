/**
 * 快捷键显示文案：macOS 用符号（⌘），其他平台用 Ctrl 组合。
 * 只影响 UI 文案；实际按键监听始终接受 metaKey 或 ctrlKey。
 */
export type ShortcutId =
  "openFile" | "openFolder" | "toggleMode" | "save" | "exportHtml" | "print";

const MAC_LABELS: Record<ShortcutId, string> = {
  openFile: "⌘O",
  openFolder: "⌘⇧O",
  toggleMode: "⌘E",
  save: "⌘S",
  exportHtml: "⌘⇧E",
  print: "⌘P",
};

const OTHER_LABELS: Record<ShortcutId, string> = {
  openFile: "Ctrl+O",
  openFolder: "Ctrl+Shift+O",
  toggleMode: "Ctrl+E",
  save: "Ctrl+S",
  exportHtml: "Ctrl+Shift+E",
  print: "Ctrl+P",
};

/** 判定平台：优先 userAgentData，其次 platform，最后 userAgent。 */
export function isMacPlatform(source?: string): boolean {
  if (source !== undefined) return /mac|iphone|ipad/i.test(source);
  if (typeof navigator === "undefined") return false;
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const hint = data?.platform ?? navigator.platform ?? navigator.userAgent;
  return /mac|iphone|ipad/i.test(hint);
}

export function shortcutLabel(id: ShortcutId, mac = isMacPlatform()): string {
  return (mac ? MAC_LABELS : OTHER_LABELS)[id];
}
