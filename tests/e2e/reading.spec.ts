import { expect, test } from "@playwright/test";

async function openSampleDoc(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用墨览" }),
  ).toBeVisible();
}

/** 外观设置在右侧面板，默认收起。 */
async function openRightPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "外观设置" }).click();
  await expect(page.locator(".rightbar")).toBeVisible();
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
  await openRightPanel(page);

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
  await openRightPanel(page);

  // 默认策略下没有加载按钮。
  await expect(page.locator(".load-remote-btn")).toHaveCount(0);

  await page.getByRole("button", { name: "已阻止" }).click();
  await expect(page.getByRole("button", { name: "点击加载" })).toBeVisible();

  // 策略变化触发重渲染，出现加载按钮。
  await expect(page.locator(".load-remote-btn")).toHaveCount(1, {
    timeout: 5000,
  });
});

test("Mermaid 长标签完整显示（不换行截断）", async ({ page }) => {
  await openSampleDoc(page);

  const block = page.locator(".mermaid-block").first();
  await block.locator("svg").waitFor({ timeout: 20_000 });

  // 长标签确实换行而不是被截断：三行中文说明应完整出现在 SVG 里。
  // （裁切本身由 WebKit 专属用例 tests/e2e/mermaid.webkit.spec.ts 守护。）
  const svgText = (await block.locator("svg").textContent()) ?? "";
  expect(svgText).toContain("按 bins.conf 顺序拼接");
  expect(svgText).toContain("路由到对应分区");
  expect(svgText).toContain("output_NvdataSbr.bin");
});

test("脚注链接可跳转（DF-04）", async ({ page }) => {
  await openSampleDoc(page);

  // 脚注引用与返回链接的 href 必须指向实际存在的 id：
  // sanitize 会给 id 补 user-content- 前缀，href 不跟着改就点不动。
  const targets = await page
    .locator('.md-body a[href^="#"]')
    .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")));
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(
      await page.locator(`.md-body ${target}`).count(),
      `${target} 应有对应元素`,
    ).toBeGreaterThan(0);
  }

  const footnoteRef = page.locator(".md-body a[data-footnote-ref]").first();
  await footnoteRef.click();
  await expect(page.locator(".footnotes li").first()).toBeInViewport();
});
