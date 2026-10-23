import { expect, test } from "@playwright/test";

test("打开工作区、浏览文件树并打开文档", async ({ page }) => {
  await page.goto("/");

  // Mock 环境 pickFolder 固定返回 /mock。
  await page.getByRole("button", { name: "打开文件夹" }).first().click();

  // 一级目录默认展开：docs 可见，其下 guide.md / deep 直接可见。
  await expect(
    page.getByRole("treeitem").filter({ hasText: "docs" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "guide.md" })).toBeVisible();

  // 点击文件打开。
  await page.getByRole("button", { name: "guide.md" }).click();
  await expect(page.getByRole("heading", { name: "工作区指南" })).toBeVisible();

  // 当前文件在树中高亮。
  await expect(page.locator(".tree-row.active").first()).toContainText(
    "guide.md",
  );
});

test("最近文件记录", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();

  // 打开过文件后，最近列表出现记录（工作区未打开时展示）。
  await expect(page.locator(".recent-item").first()).toContainText(
    "welcome.md",
  );
});

test("工作区树可以折叠与展开", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹" }).first().click();

  const docsRow = page.locator(".tree-row").filter({ hasText: "docs" }).first();
  await docsRow.click();
  await expect(page.getByRole("button", { name: "guide.md" })).toBeHidden();

  await docsRow.click();
  await expect(page.getByRole("button", { name: "guide.md" })).toBeVisible();
});
