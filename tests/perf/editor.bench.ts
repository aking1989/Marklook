// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

/** M3 退出标准：1MB 文档输入无卡顿（单次事务 p95 < 16ms）。 */
function buildLargeMarkdown(sizeBytes: number): string {
  const section = (index: number) =>
    `## 第${index}节\n\n这是一段用于编辑性能基准的中文正文 mixed English。\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- 列表一\n- 列表二\n\n`;
  const parts: string[] = ["# 编辑性能基准\n"];
  for (let index = 0; parts.join("\n").length < sizeBytes; index += 1) {
    parts.push(section(index));
  }
  return parts.join("\n");
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index] as number;
}

describe("CodeMirror 编辑输入性能（jsdom）", () => {
  it("1MB 文档 200 次插入事务 p95 < 16ms", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const createStart = performance.now();
    const view = new EditorView({
      state: EditorState.create({
        doc: buildLargeMarkdown(1024 * 1024),
        extensions: [
          history(),
          keymap.of(defaultKeymap),
          markdown(),
          EditorView.lineWrapping,
        ],
      }),
      parent: host,
    });
    const createMs = performance.now() - createStart;

    // 模拟用户输入：在文档不同位置做单字符插入事务。
    const lineCount = view.state.doc.lines;
    const samples: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      const line = Math.max(
        1,
        Math.min(lineCount, Math.floor((index * 977) % lineCount) + 1),
      );
      const position = view.state.doc.line(line).to;
      const char = "码"[0] as string;

      const start = performance.now();
      view.dispatch({ changes: { from: position, insert: char } });
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const max = samples[samples.length - 1] as number;

    console.info(
      `[bench] CodeMirror 1MB 文档：创建 ${createMs.toFixed(1)}ms，插入事务 ` +
        `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms（200 次）`,
    );

    // jsdom 无真实渲染，实测偏乐观；CI 再放宽一倍。
    const limit = process.env.CI ? 32 : 16;
    expect(p95).toBeLessThan(limit);
    expect(max).toBeLessThan(limit * 3);

    view.destroy();
    host.remove();
  });
});
