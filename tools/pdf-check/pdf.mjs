import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const dir = path.join(root, "test-results/pdf-check");
const input = process.argv[2] ?? "preview-light.html";
const output = process.argv[3] ?? "marklook-print-preview.pdf";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

await page.goto(`file://${path.join(dir, input)}`);
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print" });
await page.screenshot({
  path: path.join(dir, output.replace(/\.pdf$/, ".png")),
  fullPage: false,
});
await page.pdf({
  path: path.join(dir, output),
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();
console.log(`wrote test-results/pdf-check/${output}`);
