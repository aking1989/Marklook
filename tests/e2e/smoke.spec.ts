import { expect, test } from "@playwright/test";

test("打开文件、阅读、切换源码", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "打开一篇 Markdown" })).toBeVisible();
  await page.getByRole("button", { name: "选择文件" }).click();

  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();
  await expect(page.locator(".md-body")).toContainText("本地优先");

  await page.screenshot({ path: "test-results/reader.png" });

  await page.getByRole("button", { name: "源码" }).click();
  await expect(page.locator(".cm-content")).toContainText("欢迎使用墨览");

  await page.screenshot({ path: "test-results/editor.png" });

  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();
});

test("编辑并保存", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\n\n保存测试");

  await expect(page.getByText("未保存")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存")).toBeVisible();

  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(page.locator(".md-body")).toContainText("保存测试");
});
