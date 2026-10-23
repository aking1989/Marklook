import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../../src/stores/settingsStore";

function store() {
  return useSettingsStore.getState();
}

beforeEach(() => {
  useSettingsStore.setState({
    fontSize: 17,
    lineHeight: 1.8,
    contentWidth: 760,
    readingFont: "serif",
    allowRemoteImages: false,
  });
});

describe("settingsStore 边界约束", () => {
  it("字号限制在 13–28", () => {
    store().setFontSize(40);
    expect(store().fontSize).toBe(28);
    store().setFontSize(2);
    expect(store().fontSize).toBe(13);
    store().resetFontSize();
    expect(store().fontSize).toBe(17);
  });

  it("行高限制在 1.4–2.4 且保留一位小数", () => {
    store().setLineHeight(3);
    expect(store().lineHeight).toBe(2.4);
    store().setLineHeight(1);
    expect(store().lineHeight).toBe(1.4);
    store().setLineHeight(1.83);
    expect(store().lineHeight).toBe(1.8);
  });

  it("栏宽限制在 560–1100 且按 20 取整", () => {
    store().setContentWidth(2000);
    expect(store().contentWidth).toBe(1100);
    store().setContentWidth(100);
    expect(store().contentWidth).toBe(560);
    store().setContentWidth(733);
    expect(store().contentWidth).toBe(740);
  });

  it("字体与远程图片开关可切换", () => {
    store().setReadingFont("sans");
    expect(store().readingFont).toBe("sans");
    store().setAllowRemoteImages(true);
    expect(store().allowRemoteImages).toBe(true);
  });
});
