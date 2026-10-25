// @vitest-environment jsdom
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import mermaid from "mermaid";

/**
 * 设计文档中的所有 mermaid 图做语法校验：
 * 文档图改错语法会直接在这里失败，避免"打开才发现渲染失败"。
 * 目录树 / 配置清单等非图内容保留 ```text，不进本测试。
 */
const DOCS_DIR = path.resolve(__dirname, "../../docs");

beforeAll(() => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // jsdom 下没有真实排版，parse 不需要主题渲染。
  });
});

async function collectMermaidBlocks(): Promise<
  Array<{ file: string; index: number; code: string }>
> {
  const files = (await readdir(DOCS_DIR)).filter((name) =>
    name.endsWith(".md"),
  );
  const blocks: Array<{ file: string; index: number; code: string }> = [];

  for (const file of files) {
    const content = await readFile(path.join(DOCS_DIR, file), "utf-8");
    const lines = content.split("\n");
    let index = 0;
    let cursor = 0;
    while (cursor < lines.length) {
      if (lines[cursor]?.trim() === "```mermaid") {
        const start = cursor + 1;
        let end = start;
        while (end < lines.length && lines[end]?.trim() !== "```") end += 1;
        blocks.push({
          file,
          index: index + 1,
          code: lines.slice(start, end).join("\n"),
        });
        index += 1;
        cursor = end + 1;
        continue;
      }
      cursor += 1;
    }
  }
  return blocks;
}

describe("设计文档 mermaid 图语法", () => {
  it("文档中确实存在 mermaid 图（防止测试空转）", async () => {
    const blocks = await collectMermaidBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  it("每个 mermaid 块都能被 mermaid.parse 接受", async () => {
    const blocks = await collectMermaidBlocks();
    const failures: string[] = [];

    for (const block of blocks) {
      try {
        await mermaid.parse(block.code);
      } catch (error) {
        failures.push(
          `${block.file} 第 ${block.index} 个图：${
            error instanceof Error
              ? error.message.split("\n")[0]
              : String(error)
          }`,
        );
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
