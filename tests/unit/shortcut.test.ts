import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../../src/stores/settingsStore";
import { isMacPlatform, shortcutLabel } from "../../src/lib/shortcut";

describe("shortcut 平台文案", () => {
  it("macOS 平台显示 ⌘ 符号", () => {
    expect(isMacPlatform("Macintosh")).toBe(true);
    expect(isMacPlatform("iPhone")).toBe(true);
    expect(shortcutLabel("save", true)).toBe("⌘S");
    expect(shortcutLabel("toggleMode", true)).toBe("⌘E");
    expect(shortcutLabel("exportHtml", true)).toBe("⌘⇧E");
  });

  it("Windows/Linux 平台显示 Ctrl 组合", () => {
    expect(isMacPlatform("Windows")).toBe(false);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
    expect(shortcutLabel("save", false)).toBe("Ctrl+S");
    expect(shortcutLabel("openFile", false)).toBe("Ctrl+O");
    expect(shortcutLabel("exportHtml", false)).toBe("Ctrl+Shift+E");
    expect(shortcutLabel("print", false)).toBe("Ctrl+P");
  });
});

describe("侧栏宽度约束", () => {
  it("钳制在 180–480 并取整", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(300.7)).toBe(301);
    expect(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH)).toBe(
      SIDEBAR_DEFAULT_WIDTH,
    );
  });
});
