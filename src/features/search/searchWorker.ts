import { SearchCore, type SearchDoc, type SearchHit } from "./searchCore";

export type SearchRequest =
  | { id: number; type: "reset"; docs: SearchDoc[] }
  | { id: number; type: "add"; docs: SearchDoc[] }
  | { id: number; type: "update"; doc: SearchDoc }
  | { id: number; type: "remove"; idToRemove: string }
  | { id: number; type: "query"; query: string };

export type SearchResponse =
  | { id: number; type: "progress"; indexed: number; total: number }
  | { id: number; type: "done"; indexed: number }
  | {
      id: number;
      type: "results";
      hits: SearchHit[];
      tookMs: number;
      fileCount: number;
    }
  | { id: number; type: "error"; message: string };

const BATCH_SIZE = 100;
const core = new SearchCore();

/** 分批建索引，每批上报进度，避免大工作区阻塞 Worker 消息循环。 */
async function resetInBatches(id: number, docs: SearchDoc[]): Promise<void> {
  core.reset([]);
  let indexed = 0;
  for (let start = 0; start < docs.length; start += BATCH_SIZE) {
    const batch = docs.slice(start, start + BATCH_SIZE) as SearchDoc[];
    core.add(batch);
    indexed += batch.length;
    postMessage({
      id,
      type: "progress",
      indexed,
      total: docs.length,
    } satisfies SearchResponse);
    // 让出消息循环，保持 worker 响应。
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  postMessage({ id, type: "done", indexed } satisfies SearchResponse);
}

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "reset":
        void resetInBatches(request.id, request.docs);
        break;
      case "add":
        core.add(request.docs);
        postMessage({
          id: request.id,
          type: "done",
          indexed: core.size,
        } satisfies SearchResponse);
        break;
      case "update":
        core.update(request.doc);
        postMessage({
          id: request.id,
          type: "done",
          indexed: core.size,
        } satisfies SearchResponse);
        break;
      case "remove":
        core.remove(request.idToRemove);
        postMessage({
          id: request.id,
          type: "done",
          indexed: core.size,
        } satisfies SearchResponse);
        break;
      case "query": {
        const { hits, tookMs } = core.query(request.query);
        postMessage({
          id: request.id,
          type: "results",
          hits,
          tookMs,
          fileCount: core.size,
        } satisfies SearchResponse);
        break;
      }
    }
  } catch (error) {
    postMessage({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies SearchResponse);
  }
};

export {};
