import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __marklookMock?: {
      externalChange: (path: string, newContent?: string) => void;
    };
  }
}

test("外部修改干净文档时静默重载", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.__marklookMock?.externalChange("/mock/welcome.md", "# 外部新标题\n");
  });

  await expect(page.getByRole("status")).toContainText("文件已更新", {
    timeout: 5000,
  });
  await expect(page.getByRole("heading", { name: "外部新标题" })).toBeVisible();
  await expect(page.getByText("未保存", { exact: true })).toBeHidden();
});

test("脏文档外部修改触发冲突面板并可覆盖", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n本地未保存的修改");
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();

  // 立即触发外部修改（早于 800ms 自动保存）。
  await page.evaluate(() => {
    window.__marklookMock?.externalChange(
      "/mock/welcome.md",
      "# 磁盘版本\n\n其他程序写入的内容。\n",
    );
  });

  await expect(page.locator(".conflict-banner")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();

  // 用我的版本覆盖：状态回到已保存，冲突消失。
  await page.getByRole("button", { name: "用我的版本覆盖" }).click();
  await expect(page.locator(".conflict-banner")).toBeHidden();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible({
    timeout: 5000,
  });

  // 覆盖后的内容包含本地修改，不含磁盘版本。
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(page.locator(".md-body")).toContainText("本地未保存的修改");
  await expect(page.locator(".md-body")).not.toContainText("磁盘版本");
});

test("冲突面板加载磁盘版本放弃本地修改", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n将要被放弃的本地修改");
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();

  await page.evaluate(() => {
    window.__marklookMock?.externalChange("/mock/welcome.md", "# 磁盘新版本\n");
  });
  await expect(page.locator(".conflict-banner")).toBeVisible({
    timeout: 5000,
  });

  await page.getByRole("button", { name: "加载磁盘版本" }).click();
  await expect(page.locator(".conflict-banner")).toBeHidden();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible({
    timeout: 5000,
  });

  // setLoaded 会回到阅读模式，直接断言磁盘版本内容。
  await expect(page.getByRole("heading", { name: "磁盘新版本" })).toBeVisible({
    timeout: 5000,
  });
});
