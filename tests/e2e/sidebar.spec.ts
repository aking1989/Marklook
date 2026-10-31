import { expect, test } from "@playwright/test";

test("左侧栏显示工作区与大纲，外观只在右侧面板", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹" }).first().click();
  await expect(page.getByRole("button", { name: "guide.md" })).toBeVisible();

  const sidebar = page.locator(".sidebar");
  // 左栏不再有外观设置
  await expect(sidebar.getByRole("heading", { name: "外观" })).toHaveCount(0);

  // 打开文档后，大纲出现在左栏
  await page.getByRole("button", { name: "guide.md" }).click();
  await expect(sidebar.getByRole("heading", { name: "大纲" })).toBeVisible();
  await expect(sidebar.locator(".file-tree")).toBeVisible();

  // 右侧面板只有外观：没有大纲、没有快捷键表
  const toggle = page.getByRole("button", { name: "外观设置" });
  await toggle.click();
  const right = page.locator(".rightbar");
  await expect(right).toBeVisible();
  await expect(right.getByRole("heading", { name: "外观" })).toBeVisible();
  await expect(right.getByRole("heading", { name: "大纲" })).toHaveCount(0);
  await expect(right.getByRole("heading", { name: "快捷键" })).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // 再点一次收起。
  await toggle.click();
  await expect(page.locator(".rightbar")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("未打开工作区时左侧栏为空", async ({ page }) => {
  await page.goto("/");

  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator(".tree-row")).toHaveCount(0);
  await expect(sidebar.locator("h2")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "选择文件" })).toHaveCount(
    0,
  );
});

test("文件树根节点没有多余左缩进", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹" }).first().click();
  await expect(page.getByRole("button", { name: "guide.md" })).toBeVisible();

  // 回归：根 ul 曾保留浏览器默认 padding-inline-start(40px)，整棵树被推出一大块空白。
  const padding = await page
    .locator(".file-tree")
    .evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(padding).toBe("0px");

  // 顶层文件行 = 6（行内边距）+ 13（对齐目录的 chevron 占位）= 19px。
  // 若根 ul 的 40px 默认缩进回来了，这里会变成 59。
  const rowPadding = await page
    .locator(".tree-row")
    .filter({ hasText: "welcome.md" })
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
  expect(rowPadding).toBeLessThan(25);
});

test("最近文件里已删除的条目在启动时被清理", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "marklook.recents",
      JSON.stringify({
        state: {
          recentFiles: [
            { path: "/mock/gone.md", name: "gone.md", lastOpenedAt: 2 },
            { path: "/mock/welcome.md", name: "welcome.md", lastOpenedAt: 1 },
          ],
          recentWorkspaces: [],
        },
        version: 0,
      }),
    );
  });
  await page.goto("/");

  // 只剩仍然存在的 welcome.md。
  await expect(page.locator(".recent-item")).toHaveCount(1);
  await expect(page.locator(".recent-item")).toContainText("welcome.md");
});
