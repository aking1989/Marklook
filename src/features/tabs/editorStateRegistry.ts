import type { EditorState } from "@codemirror/state";

/**
 * 每标签的 CodeMirror EditorState 注册表（设计 §4.3）。
 * EditorState 含文档、选区与撤销历史（1MB 文档可达数 MB），不可变：
 * 切走时 view.getState() 存入，切回时 view.setState() 恢复——
 * history 是 StateField，随 state 一起保留。
 */
const states = new Map<string, EditorState>();

export function saveEditorState(tabId: string, state: EditorState): void {
  states.set(tabId, state);
}

export function peekEditorState(tabId: string): EditorState | undefined {
  return states.get(tabId);
}

/** 取出并移除（切回时使用，避免 Map 无限增长）。 */
export function takeEditorState(tabId: string): EditorState | undefined {
  const state = states.get(tabId);
  states.delete(tabId);
  return state;
}

export function dropEditorState(tabId: string): void {
  states.delete(tabId);
}
