import MiniSearch from "minisearch";

export interface SearchDoc {
  id: string;
  path: string;
  title: string;
  body: string;
  mtimeMs: number;
  size: number;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  /** 首次命中所在行（1 起）。 */
  line: number;
  snippet: string;
  /** snippet 内高亮区间 [start, end)，字符级。 */
  ranges: Array<[number, number]>;
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

function pushWithBigrams(out: string[], term: string): void {
  if (!term) return;
  out.push(term);
  if (CJK.test(term) && term.length > 1) {
    for (let index = 0; index < term.length - 1; index += 1) {
      out.push(term.slice(index, index + 2));
    }
  }
}

/**
 * 中英混排分词：Intl.Segmenter 切词 + CJK 二元组（"编辑器"可命中"编辑"）。
 * 索引与查询走同一 tokenize，保证对称。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  if (!segmenter) {
    // 降级：按空白/标点切分，对中文串补充二元组。
    for (const part of text.split(/[\s\p{P}\p{S}]+/u)) {
      pushWithBigrams(tokens, part.toLowerCase());
    }
    return tokens;
  }

  for (const seg of segmenter.segment(text)) {
    if (!seg.isWordLike) continue;
    pushWithBigrams(tokens, seg.segment.toLowerCase());
  }
  return tokens;
}

/** 结果上限与摘要窗口（详细设计 §10.6/10.5）。 */
const RESULT_LIMIT = 200;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 100;

/**
 * 搜索内核：MiniSearch 索引 + 命中定位。
 * 纯逻辑（不依赖 Worker/浏览器 API），Worker 只是它的宿主。
 */
export class SearchCore {
  private mini: MiniSearch<SearchDoc>;
  private docs = new Map<string, SearchDoc>();

  constructor() {
    this.mini = new MiniSearch<SearchDoc>({
      idField: "id",
      fields: ["title", "body"],
      storeFields: ["path", "title"],
      tokenize,
      processTerm: (term) => term.toLowerCase(),
      searchOptions: {
        boost: { title: 4 },
        prefix: true,
        fuzzy: 0.15,
        combineWith: "AND",
      },
    });
  }

  get size(): number {
    return this.docs.size;
  }

  /** 重置索引（同一路径重复 add 前先 discard）。 */
  reset(docs: SearchDoc[]): void {
    this.mini.removeAll();
    this.docs.clear();
    this.add(docs);
  }

  add(docs: SearchDoc[]): void {
    for (const doc of docs) {
      this.remove(doc.id);
      this.docs.set(doc.id, doc);
    }
    this.mini.addAll(docs);
  }

  update(doc: SearchDoc): void {
    this.remove(doc.id);
    this.docs.set(doc.id, doc);
    this.mini.add(doc);
  }

  remove(id: string): void {
    if (!this.docs.has(id)) return;
    this.mini.discard(id);
    this.docs.delete(id);
  }

  query(rawQuery: string): { hits: SearchHit[]; tookMs: number } {
    const query = rawQuery.trim();
    if (!query) return { hits: [], tookMs: 0 };

    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    let raw;
    try {
      raw = this.mini.search(query).slice(0, RESULT_LIMIT);
    } catch {
      return { hits: [], tookMs: 0 };
    }

    const hits: SearchHit[] = [];
    for (const result of raw) {
      const doc = this.docs.get(String(result.id));
      if (!doc) continue;
      hits.push(buildHit(doc, query, result.score));
    }

    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    return { hits, tookMs: end - start };
  }
}

/** 命中定位：优先完整查询串，其次二元组；行号 = 命中点前换行数 + 1。 */
function buildHit(doc: SearchDoc, query: string, score: number): SearchHit {
  const lowerBody = doc.body.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let index = lowerBody.indexOf(lowerQuery);
  if (index < 0) {
    // 退而求其次：任一二元组/词片命中。
    for (const token of tokenize(query)) {
      if (token.length < 2) continue;
      const found = lowerBody.indexOf(token);
      if (found >= 0 && (index < 0 || found < index)) index = found;
    }
  }

  if (index < 0) {
    return {
      path: doc.path,
      title: doc.title,
      score,
      line: 1,
      snippet: doc.body.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER),
      ranges: [],
    };
  }

  const line = countLines(doc.body, index) + 1;
  const from = index - SNIPPET_BEFORE;
  const snippetStart = Math.max(0, from);
  const rawSnippet = doc.body.slice(
    snippetStart,
    Math.min(doc.body.length, index + SNIPPET_AFTER),
  );
  const snippet = rawSnippet.replace(/\s+/g, " ").trim();

  // 摘要内高亮：对所有查询 token 做不区分大小写匹配（在清洗后的 snippet 上，保证区间对齐）。
  const ranges: Array<[number, number]> = [];
  const lowerSnippet = snippet.toLowerCase();
  for (const token of new Set([lowerQuery, ...tokenize(query)])) {
    if (token.length < 1) continue;
    let cursor = 0;
    for (;;) {
      const found = lowerSnippet.indexOf(token, cursor);
      if (found < 0) break;
      ranges.push([found, found + token.length]);
      cursor = found + token.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  return {
    path: doc.path,
    title: doc.title,
    score,
    line,
    snippet,
    ranges,
  };
}

function countLines(body: string, upTo: number): number {
  let lines = 0;
  for (let cursor = 0; cursor < upTo; cursor += 1) {
    if (body.charCodeAt(cursor) === 10) lines += 1;
  }
  return lines;
}
