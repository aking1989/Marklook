import { expect, test, type Page } from "@playwright/test";

const OPEN_FILE_BUTTON = 'button[title="打开文件 (⌘O)"]';

/** 草稿场景需要关闭自动保存（否则 800ms 后文件已被保存、草稿被清除）。 */
async function disableAutoSave(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "marklook.settings",
      JSON.stringify({ state: { autoSave: false }, version: 0 }),
    );
  });
}

test("崩溃草稿恢复：重新打开时提示并可恢复", async ({ page }) => {
  await disableAutoSave(page);
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\n崩溃前未保存的草稿内容");
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();

  // 草稿 2s 去抖落盘；等待写入完成（不保存，模拟崩溃后重新打开）。
  await page.waitForTimeout(2600);

  // 再次打开同一文件（Mock pickFile 固定返回同一路径）。
  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator(OPEN_FILE_BUTTON).click();

  // 出现草稿恢复提示。
  await expect(page.getByText("发现未保存的草稿")).toBeVisible({
    timeout: 5000,
  });

  await page.getByRole("button", { name: "恢复草稿" }).click();
  await expect(page.getByText("未保存", { exact: true })).toBeVisible({
    timeout: 5000,
  });

  // 恢复的内容直接出现在阅读视图（重开后即为阅读模式）。
  await expect(page.locator(".md-body")).toContainText(
    "崩溃前未保存的草稿内容",
    { timeout: 5000 },
  );
});

test("丢弃草稿后不再提示", async ({ page }) => {
  await disableAutoSave(page);
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\n将被丢弃的草稿");
  await page.waitForTimeout(2600);

  await page.on("dialog", (dialog) => dialog.accept());
  await page.locator(OPEN_FILE_BUTTON).click();

  await expect(page.getByText("发现未保存的草稿")).toBeVisible({
    timeout: 5000,
  });
  await page.getByRole("button", { name: "丢弃" }).click();
  await expect(page.getByText("发现未保存的草稿")).toBeHidden();

  // 再次打开不再提示（草稿已删除）。
  await page.locator(OPEN_FILE_BUTTON).click();
  await page.waitForTimeout(800);
  await expect(page.getByText("发现未保存的草稿")).toBeHidden();
});

test("保存成功后草稿被清除", async ({ page }) => {
  await disableAutoSave(page);
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\n保存后不应有草稿");
  await page.waitForTimeout(2600);

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible({
    timeout: 5000,
  });

  await page.locator(OPEN_FILE_BUTTON).click();
  await page.waitForTimeout(800);
  await expect(page.getByText("发现未保存的草稿")).toBeHidden();
});
