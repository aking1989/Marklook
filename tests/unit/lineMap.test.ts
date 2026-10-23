import { describe, expect, it } from "vitest";
import {
  lineAtViewportTop,
  scrollToLine,
  type LineAnchor,
} from "../../src/lib/lineMap";

function scroller(scrollTop: number, clientHeight: number): HTMLElement {
  return { scrollTop, clientHeight } as HTMLElement;
}

const anchors: LineAnchor[] = [
  { startLine: 1, endLine: 5, top: 0, height: 100 },
  { startLine: 6, endLine: 10, top: 200, height: 100 },
  { startLine: 11, endLine: 15, top: 400, height: 100 },
];

describe("lineAtViewportTop", () => {
  it("没有锚点时回退到第一行", () => {
    expect(lineAtViewportTop([], scroller(0, 500))).toBe(1);
  });

  it("在锚点之间按比例插值", () => {
    expect(lineAtViewportTop(anchors, scroller(0, 500))).toBe(2);
  });

  it("正好落在锚点起点时返回该行", () => {
    expect(lineAtViewportTop(anchors, scroller(150, 500))).toBe(6);
  });

  it("超过最后一个锚点时返回末行", () => {
    expect(lineAtViewportTop(anchors, scroller(1000, 500))).toBe(15);
  });
});

describe("scrollToLine", () => {
  it("滚动到锚点起点", () => {
    const element = scroller(0, 500);
    scrollToLine(anchors, element, 6);
    expect(element.scrollTop).toBe(150);
  });

  it("在锚点内部按比例定位", () => {
    const element = scroller(0, 500);
    scrollToLine(anchors, element, 8);
    expect(element.scrollTop).toBe(230);
  });

  it("最后一个锚点内部也能定位", () => {
    const element = scroller(0, 500);
    scrollToLine(anchors, element, 12);
    expect(element.scrollTop).toBe(375);
  });

  it("没有锚点时不动滚动位置", () => {
    const element = scroller(42, 500);
    scrollToLine([], element, 10);
    expect(element.scrollTop).toBe(42);
  });
});
