import { dropEditorState } from "./editorStateRegistry";

/**
 * 每标签的运行时资源（设计 §5.1）：监听句柄、计时器、自写抑制时间戳。
 * 只在副作用里使用，不进 store——写进 store 会触发无意义的重渲染且无法序列化。
 */
export interface TabRuntime {
  watchId: number | null;
  autoSaveTimer: number | null;
  draftTimer: number | null;
  syncTimer: number | null;
  /** 最近一次本应用写入的时间戳（外部变更检测的回环抑制，每标签一份）。 */
  lastWrittenAt: number;
}

const runtimes = new Map<string, TabRuntime>();

export function runtimeOf(tabId: string): TabRuntime {
  let runtime = runtimes.get(tabId);
  if (!runtime) {
    runtime = {
      watchId: null,
      autoSaveTimer: null,
      draftTimer: null,
      syncTimer: null,
      lastWrittenAt: 0,
    };
    runtimes.set(tabId, runtime);
  }
  return runtime;
}

export function disposeRuntime(
  tabId: string,
  unwatch?: (watchId: number) => Promise<void>,
): void {
  const runtime = runtimes.get(tabId);
  if (!runtime) return;

  if (runtime.autoSaveTimer !== null) {
    window.clearTimeout(runtime.autoSaveTimer);
  }
  if (runtime.draftTimer !== null) {
    window.clearTimeout(runtime.draftTimer);
  }
  if (runtime.syncTimer !== null) {
    window.clearTimeout(runtime.syncTimer);
  }
  runtime.autoSaveTimer = null;
  runtime.draftTimer = null;
  runtime.syncTimer = null;

  const watchId = runtime.watchId;
  runtime.watchId = null;

  dropEditorState(tabId);

  if (unwatch && watchId !== null) {
    void unwatch(watchId).catch(() => undefined);
  }
}

/** 仅用于测试：清空全部运行时。 */
export function clearAllRuntimes(): void {
  runtimes.clear();
}
