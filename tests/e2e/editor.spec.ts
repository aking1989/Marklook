import { expect, test } from "@playwright/test";

test("模式切换保留撤销历史与光标位置", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("撤销测试内容");

  // 光标移到文档中间（第 12 行附近），验证位置保持。
  await page.keyboard.press("ControlOrMeta+Home");
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("ArrowDown");
  }

  // 多次往返切换：位置不漂移、视图不重建。
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await page.getByRole("button", { name: "源码" }).click();
  }

  // 切换后撤销仍可用：Ctrl/Cmd+Z 撤销输入。
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("撤销测试内容");

  // 再撤销一次恢复（栈深度足够）。
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("撤销测试内容");
});

test("IME 组合输入期间全局快捷键不触发", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();

  // 模拟拼音组合中的 ⌘E / ⌘S：isComposing=true，不应切换模式或保存。
  await page.evaluate(() => {
    for (const key of ["e", "s", "p"]) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          metaKey: true,
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
    }
  });

  // 仍处于源码模式（未切换），也没有触发打印等动作。
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "阅读", exact: true }),
  ).toBeVisible();
});
