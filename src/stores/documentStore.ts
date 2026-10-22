import { create } from "zustand";
import type { RenderResult } from "../markdown/types";
import type { Eol, TextDocument } from "../platform/types";

export type DocMode = "read" | "edit";
export type DocStatus =
  | "empty"
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "error";

interface DocumentState {
  path: string | null;
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

  setLoading: () => void;
  setLoaded: (doc: TextDocument, render: RenderResult) => void;
  setContent: (content: string) => void;
  setDirty: (dirty: boolean) => void;
  markDirty: () => void;
  setMode: (mode: DocMode) => void;
  setRender: (render: RenderResult) => void;
  setSaving: () => void;
  setSaved: (content: string, mtimeMs: number) => void;
  setError: (message: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

const EMPTY_STATE = {
  path: null,
  content: "",
  savedContent: "",
  mtimeMs: null,
  eol: "lf" as Eol,
  bom: false,
  mode: "read" as DocMode,
  status: "empty" as DocStatus,
  dirty: false,
  render: null,
  error: null,
};

export const useDocumentStore = create<DocumentState>()((set) => ({
  ...EMPTY_STATE,

  setLoading: () => set({ status: "loading", error: null }),

  setLoaded: (doc, render) =>
    set({
      path: doc.path,
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
    }),

  setContent: (content) =>
    set((state) => ({
      content,
      dirty: content !== state.savedContent,
      status:
        state.status === "error"
          ? "error"
          : content === state.savedContent
            ? "clean"
            : "dirty",
    })),

  setDirty: (dirty) =>
    set((state) => {
      if (state.dirty === dirty) return state;
      return { dirty, status: dirty ? "dirty" : "clean" };
    }),

  markDirty: () =>
    set((state) =>
      state.dirty ? state : { dirty: true, status: "dirty" },
    ),

  setMode: (mode) => set({ mode }),

  setRender: (render) => set({ render }),

  setSaving: () => set({ status: "saving", error: null }),

  setSaved: (content, mtimeMs) =>
    set({
      content,
      savedContent: content,
      mtimeMs,
      dirty: false,
      status: "clean",
      error: null,
    }),

  setError: (message) =>
    set({ status: "error", error: message }),

  clearError: () =>
    set((state) => ({
      error: null,
      status: state.dirty
        ? "dirty"
        : state.path
          ? "clean"
          : "empty",
    })),

  reset: () => set({ ...EMPTY_STATE }),
}));
