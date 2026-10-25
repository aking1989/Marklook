import { expect, test } from "@playwright/test";

async function openSampleDoc(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();
}

test("公式、表格与远程图片占位", async ({ page }) => {
  await openSampleDoc(page);

  await expect(page.locator(".md-body .katex").first()).toBeVisible();
  await expect(page.locator(".md-body .katex-display").first()).toBeVisible();
  await expect(page.locator(".md-body .table-wrap table")).toBeVisible();
  // 默认零网络：远程图片渲染为阻止占位，不存在真实 img 请求。
  await expect(
    page.getByText("远程图片已阻止：https://example.com/remote.png"),
  ).toBeVisible();

  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.com")) requested.push(request.url());
  });
  expect(requested).toEqual([]);
});

test("代码块复制按钮", async ({ page }) => {
  await test.step("授予剪贴板权限", async () => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  await openSampleDoc(page);

  const firstPre = page.locator(".md-body pre").first();
  await firstPre.hover();
  await firstPre.locator(".code-copy-btn").click();
  await expect(firstPre.locator(".code-copy-btn")).toContainText("已复制");

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("greeting");

  // 1.5s 后按钮恢复。
  await expect(firstPre.locator(".code-copy-btn")).toContainText("复制", {
    timeout: 4000,
  });
});

test("大纲点击跳转与当前项高亮", async ({ page }) => {
  await openSampleDoc(page);

  await page.getByRole("button", { name: "渲染能力" }).click();
  await page.waitForTimeout(400);

  const activeItem = page.locator(".outline li.active button");
  await expect(activeItem).toHaveText(/渲染能力|一段代码/);

  // 滚动回顶部后，高亮回到第一个标题。
  await page.evaluate(() => {
    const scroller = document.querySelector(".reader-scroll");
    if (scroller) scroller.scrollTop = 0;
  });
  await expect(page.locator(".outline li.active button")).toHaveText(
    "欢迎使用墨览",
    { timeout: 3000 },
  );
});

test("排版设置即时生效", async ({ page }) => {
  await openSampleDoc(page);

  const root = page.locator("html");
  const fontVar = (name: string) =>
    root.evaluate((el, key) => el.style.getPropertyValue(key), name);

  await expect.poll(() => fontVar("--font-size")).toBe("17px");

  await page.getByRole("button", { name: "增大字号" }).click();
  await expect.poll(() => fontVar("--font-size")).toBe("18px");

  await expect
    .poll(() =>
      root.evaluate((el) => el.style.getPropertyValue("--line-height")),
    )
    .toBe("1.8");

  await page.getByRole("button", { name: "增大行高" }).click();
  await expect
    .poll(() =>
      root.evaluate((el) => el.style.getPropertyValue("--line-height")),
    )
    .toBe("1.9");

  await page.getByRole("button", { name: "衬线", exact: true }).click();
  await expect
    .poll(() =>
      root.evaluate((el) => el.style.getPropertyValue("--font-reading")),
    )
    .toContain("PingFang SC");

  // 字号重置。
  await page.keyboard.press("ControlOrMeta+0");
  await expect
    .poll(() => root.evaluate((el) => el.style.getPropertyValue("--font-size")))
    .toBe("17px");
});

test("远程图片点击加载（策略开启后）", async ({ page }) => {
  await openSampleDoc(page);

  // 默认策略下没有加载按钮。
  await expect(page.locator(".load-remote-btn")).toHaveCount(0);

  await page.getByRole("button", { name: "已阻止" }).click();
  await expect(page.getByRole("button", { name: "点击加载" })).toBeVisible();

  // 策略变化触发重渲染，出现加载按钮。
  await expect(page.locator(".load-remote-btn")).toHaveCount(1, {
    timeout: 5000,
  });
});
