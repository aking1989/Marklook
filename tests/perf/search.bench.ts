import { describe, expect, it } from "vitest";
import {
  SearchCore,
  type SearchDoc,
} from "../../src/features/search/searchCore";

/** M2 验收基线：1,000 文件索引 < 2s，查询 < 50ms。 */
function buildCorpus(count: number): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (let index = 0; index < count; index += 1) {
    const paragraph = Array.from(
      { length: 12 },
      (_, line) =>
        `第${line}行：这是一段用于搜索基准的中文正文，混排 English words 与技术内容，重复以模拟真实文档。`,
    ).join("\n");
    docs.push({
      id: `/ws/docs/file-${index}.md`,
      path: `/ws/docs/file-${index}.md`,
      title: `file-${index}.md`,
      body: `# 文档 ${index}\n\n关键词编辑器出现在这里。\n\n${paragraph}`,
      mtimeMs: index,
      size: paragraph.length,
    });
  }
  return docs;
}

describe("搜索性能基准（M2 验收）", () => {
  it("1,000 文件索引与查询在本机基线内", () => {
    const corpus = buildCorpus(1000);
    const core = new SearchCore();

    const indexStart = performance.now();
    core.reset(corpus);
    const indexMs = performance.now() - indexStart;

    const queryStart = performance.now();
    const { hits, tookMs } = core.query("编辑器");
    const queryWallMs = performance.now() - queryStart;

    console.info(
      `[bench] 搜索索引 1,000 文件 ${indexMs.toFixed(1)}ms（限额 2000ms），` +
        `查询 ${queryWallMs.toFixed(1)}ms / worker上报 ${tookMs.toFixed(1)}ms（限额 50ms），命中 ${hits.length}`,
    );

    // CI 放宽为 4 倍防抖动。
    const factor = process.env.CI ? 4 : 1;
    expect(indexMs).toBeLessThan(2000 * factor);
    expect(queryWallMs).toBeLessThan(50 * factor);
    expect(hits.length).toBe(200); // 结果上限 200
    expect(hits[0]?.line).toBe(3); // "关键词编辑器" 在第 3 行
  });
});
