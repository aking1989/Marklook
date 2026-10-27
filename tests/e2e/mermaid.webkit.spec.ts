import { expect, test } from "@playwright/test";

/**
 * WebKit 专属回归：macOS 桌面版用 WKWebView，Chromium 测不出这些差异。
 *
 * Mermaid 默认用 HTML <foreignObject> 承载标签，宽度在渲染前按测量值写死；
 * WKWebView 的实际字体更宽，超出的文字被直接裁掉（长命令、中文说明最明显）。
 * 修复是改用 SVG <text>（htmlLabels: false）。这里直接断言渲染结果，
 * 不依赖具体实现——只要标签被裁，测试就失败。
 */
test("Mermaid 长标签在 WebKit 下不被裁切", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();

  const block = page.locator(".mermaid-block").first();
  await block.locator("svg").waitFor({ timeout: 20_000 });

  const result = await block.evaluate((el) => {
    const svg = el.querySelector("svg")!;
    const nodes = Array.from(svg.querySelectorAll("g.node")).map((node) => {
      const shape = node.querySelector(
        "rect, polygon",
      ) as SVGGraphicsElement | null;
      const texts = Array.from(
        node.querySelectorAll("text"),
      ) as SVGGraphicsElement[];
      const box = shape?.getBBox();
      const textWidth = Math.max(0, ...texts.map((t) => t.getBBox().width));
      return {
        shapeWidth: box ? Math.round(box.width) : null,
        textWidth: Math.round(textWidth),
      };
    });
    return {
      usesForeignObject: svg.querySelector("foreignObject") !== null,
      nodes,
    };
  });

  expect(result.usesForeignObject).toBe(false);
  expect(result.nodes.length).toBeGreaterThan(0);
  expect(
    result.nodes.filter(
      (node) =>
        node.shapeWidth !== null && node.textWidth > node.shapeWidth - 4,
    ),
  ).toEqual([]);
});
