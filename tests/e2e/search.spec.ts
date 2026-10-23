import { expect, test } from "@playwright/test";

test("工作区搜索命中并跳转到对应文档", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹" }).first().click();

  const input = page.getByLabel("搜索工作区");
  await expect(input).toBeVisible();

  // Mock 工作区索引建立后可搜索（guide.md 里有「编辑器」文案）。
  await input.fill("编辑器");
  await expect(page.locator(".search-result").first()).toBeVisible({
    timeout: 10_000,
  });

  await expect(
    page.locator(".search-result .result-snippet mark").first(),
  ).toBeVisible();

  // 点击结果打开对应文档：树上出现当前文件高亮。
  await page.locator(".search-result").first().click();
  await expect(page.locator(".md-body")).toBeVisible();
  await expect(page.locator(".tree-row.active")).toHaveCount(1, {
    timeout: 5000,
  });

  // 清空后无结果提示。
  await input.fill("绝不存在的搜索词xyzzy");
  await expect(page.getByText("没有匹配的文档")).toBeVisible();
});
