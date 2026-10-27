import { create } from "zustand";
import type { Eol, TextDocument } from "../platform/types";
import type { RenderResult } from "../markdown/types";

export type DocMode = "read" | "edit";

export type DocStatus =
  "loading" | "clean" | "dirty" | "saving" | "conflict" | "error";

export interface TabConflict {
  diskContent: string;
  diskMtimeMs: number;
}

export interface TabState {
  /** 稳定 id，与路径解耦：同一路径关闭后重开是新标签。 */
  id: string;
  /** 规范化绝对路径（POSIX 分隔符），与 platform 返回一致。 */
  path: string;
  /** 显示名：文件名，标签栏与窗口标题用。 */
  title: string;

  content: string;
  savedContent: string;
  mtimeMs: number | null;
  eol: Eol;
  bom: boolean;

  mode: DocMode;
  status: DocStatus;
  dirty: boolean;
  render: RenderResult | null;
  error: string | null;

  /** 该标签自己的冲突与草稿提示（狗粮链路的冲突矩阵按标签归属）。 */
  conflict: TabConflict | null;
  draftPrompt: { content: string } | null;

  /** 切走时快照的阅读位置与光标行（高频值存 tabRuntime，见设计 §4.1 注）。 */
  readLine: number;
  readScrollTop: number;
  editLine: number;
}

export function tabTitleOf(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

let nextTabId = 1;

export function makeTabId(): string {
  return `tab-${nextTabId++}`;
}

export function makeTab(doc: TextDocument, render: RenderResult): TabState {
  return {
    id: makeTabId(),
    path: doc.path,
    title: tabTitleOf(doc.path),
    content: doc.content,
    savedContent: doc.content,
    mtimeMs: doc.mtimeMs,
    eol: doc.eol,
    bom: doc.bom,
    mode: "read",
    status: "clean",
    dirty: false,
    render,
    error: null,
    conflict: null,
    draftPrompt: null,
    readLine: 1,
    readScrollTop: 0,
    editLine: 1,
  };
}

interface TabsState {
  tabs: TabState[];
  activeId: string | null;

  /** 打开文档：已打开（按路径）则激活并返回其 id，否则追加到末尾并激活。 */
  openTab(
    doc: TextDocument,
    render: RenderResult,
  ): { id: string; reused: boolean };
  activate(id: string): void;
  /** 从集合移除标签；若移除的是活动标签则激活右侧，无右侧激活左侧。 */
  remove(id: string): void;
  /** 用新文档整体替换一个标签的内容（当前标签内替换语义）。 */
  replace(id: string, doc: TextDocument, render: RenderResult): void;
  update(id: string, patch: Partial<TabState>): void;
  findByPath(path: string): TabState | undefined;
  get(id: string): TabState | undefined;
  move(from: number, to: number): void;
}

export const useTabsStore = create<TabsState>()((set, get) => ({
  tabs: [],
  activeId: null,

  openTab(doc, render) {
    const existing = get().findByPath(doc.path);
    if (existing) {
      set({ activeId: existing.id });
      return { id: existing.id, reused: true };
    }
    const tab = makeTab(doc, render);
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeId: tab.id,
    }));
    return { id: tab.id, reused: false };
  },

  activate(id) {
    if (!get().tabs.some((tab) => tab.id === id)) return;
    set({ activeId: id });
  },

  remove(id) {
    const { tabs, activeId } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    const nextTabs = tabs.filter((tab) => tab.id !== id);
    let nextActive = activeId;
    if (activeId === id) {
      // 右侧优先，无右侧激活左侧，都没有则回空状态。
      nextActive = nextTabs[index]?.id ?? nextTabs[index - 1]?.id ?? null;
    }
    set({ tabs: nextTabs, activeId: nextActive });
  },

  replace(id, doc, render) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              path: doc.path,
              title: tabTitleOf(doc.path),
              content: doc.content,
              savedContent: doc.content,
              mtimeMs: doc.mtimeMs,
              eol: doc.eol,
              bom: doc.bom,
              status: "clean" as DocStatus,
              dirty: false,
              render,
              error: null,
              conflict: null,
              draftPrompt: null,
              readLine: 1,
              readScrollTop: 0,
              editLine: 1,
            }
          : tab,
      ),
    }));
  },

  update(id, patch) {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, ...patch } : tab,
      ),
    }));
  },

  findByPath(path) {
    return get().tabs.find((tab) => tab.path === path);
  },

  get(id) {
    return get().tabs.find((tab) => tab.id === id);
  },

  move(from, to) {
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      if (!moved) return state;
      tabs.splice(to, 0, moved);
      return { tabs };
    });
  },
}));

/** 活动标签（派生值）。 */
export function activeTabOf(state: Pick<TabsState, "tabs" | "activeId">) {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}
