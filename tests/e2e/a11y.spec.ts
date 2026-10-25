import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** 断言页面无 critical/serious 可访问性违规（moderate/minor 仅记录）。 */
async function assertNoCriticalViolations(
  page: Page,
  state: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact ?? ""),
  );

  const summary = serious
    .map(
      (violation) =>
        `${violation.id}(${violation.impact}): ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join("; ")}`,
    )
    .join(" | ");

  expect(
    serious,
    `状态「${state}」存在 critical/serious 违规：${summary}`,
  ).toEqual([]);

  if (results.violations.length > 0) {
    console.info(
      `[a11y:${state}] 非阻断违规：`,
      results.violations
        .map((v) => `${v.id}(${v.impact})×${v.nodes.length}`)
        .join(", "),
    );
  }
}

test("关键界面状态无 critical 可访问性违规", async ({ page }) => {
  await page.goto("/");

  // 空态。
  await expect(
    page.getByRole("heading", { name: "打开一篇 Markdown" }),
  ).toBeVisible();
  await assertNoCriticalViolations(page, "空态");

  // 阅读态。
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();
  await assertNoCriticalViolations(page, "阅读");

  // 源码编辑态。
  await page.getByRole("button", { name: "源码" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await assertNoCriticalViolations(page, "编辑");

  // 工作区 + 搜索面板。
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await page.getByRole("button", { name: "打开文件夹" }).first().click();
  await expect(page.getByLabel("搜索工作区")).toBeVisible();
  await assertNoCriticalViolations(page, "工作区+搜索");

  // 冲突横幅。
  await page.evaluate(() => {
    window.__marklookMock?.externalChange("/mock/welcome.md", "# 外部版本\n");
  });
  await page.getByRole("button", { name: "源码" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n本地修改");
  await page.evaluate(() => {
    window.__marklookMock?.externalChange(
      "/mock/welcome.md",
      "# 又一个外部版本\n",
    );
  });
  await expect(page.locator(".conflict-banner")).toBeVisible({
    timeout: 5000,
  });
  await assertNoCriticalViolations(page, "冲突横幅");
});
