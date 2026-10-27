import { defineConfig, devices } from "@playwright/test";

// CI 上没有本机 Chrome，改用 Playwright 自带的 Chromium。
const channel = process.env.CI ? undefined : "chrome";

/** 只在 WebKit 下运行的用例：WKWebView 是 macOS 桌面版的真实引擎。 */
const WEBKIT_ONLY = /webkit\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
    viewport: { width: 1200, height: 800 },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: WEBKIT_ONLY,
      use: {
        channel,
        ...devices["Desktop Chrome"],
        viewport: { width: 1200, height: 800 },
      },
    },
    {
      // macOS 桌面版跑 WKWebView，Chromium 测不出这类差异
      // （例如 Mermaid 的 foreignObject 标签在 WebKit 下会被裁切）。
      name: "webkit",
      testMatch: WEBKIT_ONLY,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1200, height: 800 },
      },
    },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
