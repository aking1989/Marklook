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

test("侧栏可拖宽并持久化", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹" }).first().click();

  const root = page.locator("html");
  const before = await root.evaluate((el) =>
    Number.parseInt(el.style.getPropertyValue("--sidebar-width"), 10),
  );

  const resizer = page.getByRole("separator", { name: "调整侧栏宽度" });
  await expect(resizer).toBeVisible();
  const box = await resizer.boundingBox();
  if (!box) throw new Error("找不到拖宽手柄");

  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 8 });
  await page.mouse.up();

  const after = await root.evaluate((el) =>
    Number.parseInt(el.style.getPropertyValue("--sidebar-width"), 10),
  );
  expect(after).toBeGreaterThanOrEqual(before + 100);

  // 内容区不能因 grid 塌陷（回归：resizer 插入后 content 被挤到第二行高度归零）。
  const layout = await page.evaluate(() => {
    const content = document.querySelector(".content");
    const empty = document.querySelector(".empty-state");
    return {
      contentHeight: content?.getBoundingClientRect().height ?? 0,
      emptyVisible: !!empty && empty.getBoundingClientRect().height > 100,
    };
  });
  expect(layout.contentHeight).toBeGreaterThan(300);
  expect(layout.emptyVisible).toBe(true);

  // 重载后宽度保留（zustand persist）。
  await page.reload();
  await expect
    .poll(() =>
      root.evaluate((el) =>
        Number.parseInt(el.style.getPropertyValue("--sidebar-width"), 10),
      ),
    )
    .toBe(after);
});

test("快捷键文案随运行平台显示", async ({ page }) => {
  // macOS 显示 ⌘，其他平台显示 Ctrl——断言跟随运行平台而非硬编码。
  const modifier = process.platform === "darwin" ? "⌘" : "Ctrl";
  const combo = (key: string) =>
    new RegExp(`${modifier.replace("+", "\\+")}${key}`);

  await page.goto("/");
  await expect(page.locator('button[title^="打开文件 ("]')).toHaveAttribute(
    "title",
    combo("O"),
  );
  await expect(page.locator(".shortcut-row kbd").first()).toHaveText(
    combo("O"),
  );
});
