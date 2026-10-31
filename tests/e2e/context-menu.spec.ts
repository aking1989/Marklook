import { expect, test } from "@playwright/test";

/** Mock 平台把「在文件管理器中显示」的调用记在 window.__mockReveals。 */
async function revealedPaths(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __mockReveals?: string[] }).__mockReveals ?? [],
  );
}

test("标签右键 → 在文件管理器中显示", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(page.locator(".tab")).toHaveCount(1);

  await page.locator(".tab").first().click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  await menu.getByRole("menuitem", { name: "在文件管理器中显示" }).click();
  await expect(menu).toBeHidden();

  expect(await revealedPaths(page)).toContain("/mock/welcome.md");
});

test("文件树右键 → 在文件管理器中显示", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹" }).first().click();
  const row = page.locator(".tree-row").filter({ hasText: "guide.md" });
  await expect(row).toBeVisible();

  await row.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "在文件管理器中显示" }).click();

  expect(await revealedPaths(page)).toContain("/mock/docs/guide.md");
});

test("Esc 关闭右键菜单，且不触发左键行为", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(page.locator(".tab")).toHaveCount(1);

  await page.locator(".tab").first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // 右键不应关闭标签。
  await expect(page.locator(".tab")).toHaveCount(1);
});
