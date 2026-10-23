import { expect, test } from "@playwright/test";

/** 在编辑器内派发带图片文件的 paste 事件。 */
async function pasteImage(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(() => {
    const editorHost = document.querySelector(".editor-host .cm-content");
    if (!editorHost) throw new Error("编辑器未挂载");
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      "截图.png",
      {
        type: "image/png",
      },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    editorHost.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

test("粘贴图片写入 assets 并插入 Markdown 语法", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "源码" }).click();

  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+End");

  await pasteImage(page);

  await expect(editor).toContainText("![截图.png](assets/image-1.png)", {
    timeout: 5000,
  });
  await expect(page.getByText("未保存", { exact: true })).toBeVisible();

  // 切回阅读视图后图片语法生效（Mock 占位图渲染）。
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  const img = page.locator(".md-body img");
  await expect(img).toHaveCount(1);
  await expect(img.first()).toHaveAttribute("src", /data:image\/svg\+xml/);
});
