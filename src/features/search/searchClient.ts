import type { SearchDoc, SearchHit } from "./searchCore";
import type { SearchRequest, SearchResponse } from "./searchWorker";

/** Omit 对 union 类型不分发，这里手动分发去掉请求 id。 */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type SearchRequestWithoutId = WithoutId<SearchRequest>;

export interface SearchStatus {
  indexed: number;
  total: number;
  fileCount: number;
}

/**
 * 搜索 Worker 的主线程封装：
 * - 请求带自增 id，查询结果只保留最新一次（丢弃过期响应）。
 * - 索引/更新返回 Promise；查询通过订阅回调推送。
 */
export class SearchClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: SearchStatus) => void; reject: (error: Error) => void }
  >();
  private queryId = 0;
  private listeners = new Set<(hits: SearchHit[], tookMs: number) => void>();
  private statusListeners = new Set<(status: SearchStatus) => void>();
  private status: SearchStatus = { indexed: 0, total: 0, fileCount: 0 };

  constructor() {
    this.worker = new Worker(new URL("./searchWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      this.handleResponse(event.data);
    };
    this.worker.onerror = (event) => {
      for (const entry of this.pending.values()) {
        entry.reject(new Error(`搜索线程错误：${event.message}`));
      }
      this.pending.clear();
    };
  }

  private handleResponse(response: SearchResponse): void {
    switch (response.type) {
      case "progress":
        this.status = {
          indexed: response.indexed,
          total: response.total,
          fileCount: this.status.fileCount,
        };
        this.emitStatus();
        break;
      case "done":
        this.status = {
          indexed: response.indexed,
          total: this.status.total,
          fileCount: response.indexed,
        };
        this.emitStatus();
        this.pending.get(response.id)?.resolve(this.status);
        this.pending.delete(response.id);
        break;
      case "results": {
        // 只接受最新查询 id 的结果。
        if (response.id !== this.queryId) return;
        for (const listener of this.listeners) {
          listener(response.hits, response.tookMs);
        }
        break;
      }
      case "error": {
        const entry = this.pending.get(response.id);
        if (entry) {
          entry.reject(new Error(response.message));
          this.pending.delete(response.id);
        }
        break;
      }
    }
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) {
      listener(this.status);
    }
  }

  private send(request: SearchRequest): number {
    const id = request.id;
    this.worker.postMessage(request);
    return id;
  }

  private call(request: SearchRequestWithoutId): Promise<SearchStatus> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ ...request, id });
    });
  }

  reset(docs: SearchDoc[]): Promise<SearchStatus> {
    return this.call({ type: "reset", docs });
  }

  update(doc: SearchDoc): Promise<SearchStatus> {
    return this.call({ type: "update", doc });
  }

  remove(path: string): Promise<SearchStatus> {
    return this.call({ type: "remove", idToRemove: path });
  }

  /** 查询（结果经 onResults 推送，自动丢弃过期查询）。 */
  query(query: string): void {
    this.queryId += 1;
    this.send({ id: this.queryId, type: "query", query });
  }

  onResults(listener: (hits: SearchHit[], tookMs: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: SearchStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
    this.listeners.clear();
    this.statusListeners.clear();
  }
}
