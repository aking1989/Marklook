import { expect, test } from "@playwright/test";

async function openTwoTabs(page: import("@playwright/test").Page) {
  await page.goto("/");
  // 第一个：默认打开 welcome.md
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(page.locator(".tab")).toHaveCount(1);
  // 第二个：工作区打开 guide.md（Mock pickFolder → /mock）
  await page.getByRole("button", { name: "打开文件夹" }).first().click();
  await page.getByRole("button", { name: "guide.md" }).click();
  await expect(page.locator(".tab")).toHaveCount(2);
}

test("打开两个文件得到两个标签，重复打开不新增", async ({ page }) => {
  await openTwoTabs(page);
  await expect(page.locator(".tab.active")).toContainText("guide.md");

  // 重复打开 welcome.md：激活已有标签
  await page.locator('button[title^="打开文件"]').first().click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab.active")).toContainText("welcome.md");
});

test("切换标签保持撤销历史", async ({ page }) => {
  await openTwoTabs(page);
  // 在 guide.md（当前）输入
  await page.getByRole("button", { name: "源码" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("标签A的输入");

  // 切到 welcome.md 再切回
  await page.locator(".tab").first().click();
  await expect(page.locator(".tab.active")).toContainText("welcome.md");
  await page.locator(".tab").nth(1).click();
  await expect(page.locator(".tab.active")).toContainText("guide.md");

  // 撤销生效（EditorState 交换保留了撤销历史）
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("标签A的输入");
});

test("后台标签自动保存", async ({ page }) => {
  await openTwoTabs(page);
  await page.getByRole("button", { name: "源码" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("后台自动保存内容");

  // 输入后立即切走（800ms 自动保存计时器在后台触发）
  await page.locator(".tab").first().click();
  await page.waitForTimeout(1500);

  // 切回：内容已在（自动保存不丢）
  await page.locator(".tab").nth(1).click();
  await expect(editor).toContainText("后台自动保存内容");
});

test("关闭脏标签弹出确认，取消后标签保留", async ({ page }) => {
  await openTwoTabs(page);
  await page.getByRole("button", { name: "源码" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("未保存内容");

  // 关闭脏标签：确认对话框出现
  page.on("dialog", (dialog) => dialog.dismiss()); // 取消保存
  await page.locator(".tab.active .tab-close").click();
  // 两步确认：第二问"放弃并关闭吗"→ dismiss（取消）→ 标签保留
  await expect(page.locator(".tab")).toHaveCount(2);
});

test("关闭最后一个标签回到空状态", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(page.locator(".tab")).toHaveCount(1);

  await page.locator(".tab .tab-close").click();
  await expect(page.locator(".tab")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "打开一篇 Markdown" }),
  ).toBeVisible();
});

test("标签栏只占一行高度，不挤压工作区", async ({ page }) => {
  await openTwoTabs(page);

  const bar = await page.locator(".tab-bar-row").boundingBox();
  const bench = await page.locator(".workbench").boundingBox();
  const shell = await page.locator(".app-shell").boundingBox();
  expect(bar).not.toBeNull();
  expect(bench).not.toBeNull();
  expect(shell).not.toBeNull();

  // 回归：.app-shell 曾用固定 3 行 grid，标签栏作为第 4 个子元素被 1fr 行拉满整窗。
  expect(bar!.height).toBeLessThanOrEqual(40);
  // 顶栏（标签 + 工具合并后）36px + 状态栏 28px，其余高度归工作区。
  expect(bench!.height).toBeGreaterThan(shell!.height - 36 - 28 - 4);
});
