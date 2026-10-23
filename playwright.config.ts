import { defineConfig } from "@playwright/test";

// CI 上没有本机 Chrome，改用 Playwright 自带的 Chromium。
const channel = process.env.CI ? undefined : "chrome";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/playwright",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel,
    headless: true,
    viewport: { width: 1200, height: 800 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
