import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __marklookMock?: {
      getLastExport: () => { defaultName: string; html: string } | null;
    };
  }
}

test("导出 HTML 单文件：自包含样式与已渲染内容", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();

  await expect(page.locator(".md-body .katex").first()).toBeVisible();

  await page.getByRole("button", { name: "导出" }).click();

  await expect(page.getByRole("status")).toContainText("已导出", {
    timeout: 5000,
  });

  const exported = await page.evaluate(
    () => window.__marklookMock?.getLastExport() ?? null,
  );
  expect(exported).not.toBeNull();
  expect(exported?.defaultName).toBe("welcome.html");

  const html = exported?.html ?? "";
  // 自包含：内联样式与静态渲染结果。
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain('data-marklook="tokens"');
  expect(html).toContain('data-marklook="katex"');
  expect(html).toContain("katex");
  expect(html).toContain("欢迎使用墨览");
  // 复制按钮不进导出。
  expect(html).not.toContain('class="code-copy-btn"');
});

test("源码模式下导出先切回阅读渲染", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("\n导出前的最新编辑");

  await page.getByRole("button", { name: "导出" }).click();
  await expect(page.getByRole("status")).toContainText("已导出", {
    timeout: 5000,
  });

  const exported = await page.evaluate(
    () => window.__marklookMock?.getLastExport() ?? null,
  );
  expect(exported?.html).toContain("导出前的最新编辑");
  // 导出基于阅读视图（自动切回）。
  await expect(page.getByRole("button", { name: "源码" })).toBeVisible({
    timeout: 5000,
  });
});
