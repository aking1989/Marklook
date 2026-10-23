import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __marklookMock?: { setPickFile: (target: string) => void };
  }
}

test("大文件模式：状态标识 + 跳过代码高亮", async ({ page }) => {
  await page.addInitScript(() => {
    (
      window as unknown as { __mockPickFileTarget?: string }
    ).__mockPickFileTarget = "/mock/big.md";
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();

  // 阅读视图出现，状态栏显示大文件标识。
  await expect(page.locator(".md-body")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".mode-pill.large-file")).toBeVisible();

  // 大文件模式跳过 Shiki：无高亮代码块。
  await expect(page.locator(".md-body pre.shiki")).toHaveCount(0);

  // 源码模式关闭行号装饰。
  await page.getByRole("button", { name: "源码" }).click();
  await expect(page.locator(".cm-gutters")).toHaveCount(0);
});
