import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  PlatformError,
  type DraftRecord,
  type SaveAssetResult,
  type FsChangeEvent,
  type Platform,
  type PlatformErrorCode,
  type TextDocument,
  type VaultScan,
  type VaultEntry,
  type WatchOptions,
  type WriteOptions,
  type WriteResult,
} from "./types";

function normalizeError(error: unknown): PlatformError {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const rawCode = typeof record.code === "string" ? record.code : "IO";
    const data = record.data;
    let message = "操作失败";

    if (typeof data === "string") {
      message = data;
    } else if (data && typeof data === "object" && "message" in data) {
      message = String((data as { message: unknown }).message);
    } else if (typeof record.message === "string") {
      message = record.message;
    }

    return new PlatformError(rawCode as PlatformErrorCode, message, data);
  }

  return new PlatformError("IO", String(error));
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const tauriPlatform: Platform = {
  saveAsset: (docPath, suggestedName, bytes) =>
    call<SaveAssetResult>("save_asset", {
      docPath,
      suggestedName,
      bytes: Array.from(bytes),
    }),

  pickFile: () => call<string | null>("pick_file_and_allow"),

  pickFolder: () => call<string | null>("pick_folder_and_allow"),

  readDocument: (path) => call<TextDocument>("read_document", { path }),

  writeDocument: (path: string, content: string, options: WriteOptions) =>
    call<WriteResult>("write_document", {
      path,
      content,
      expectedMtimeMs: options.expectedMtimeMs,
      force: options.force ?? false,
      eol: options.eol,
      bom: options.bom,
    }),

  print: () => call<void>("print_window"),

  readAssetDataUrl: (absolutePath) =>
    call<string | null>("read_asset_data_url", { path: absolutePath }),

  exportSaveHtml: (defaultName, html) =>
    call<string | null>("export_save_html", { defaultName, html }),

  toAssetUrl(absolutePath: string): string {
    // convertFileSrc 负责平台差异（macOS/Linux mdasset://，Windows http://mdasset.localhost）；
    // "local/" 前缀 + base64url 路径由 Rust 端 decode_asset_request 解析。
    const token = utf8ToBase64Url(absolutePath);
    return convertFileSrc(`local/${token}`, "mdasset");
  },

  scanVault: (root, withContent) =>
    call<VaultScan>("scan_vault", { root, withContent }),

  listDir: (path) => call<VaultEntry[]>("list_dir", { path }),

  watchPaths: (paths, options: WatchOptions) =>
    call<number>("watch_paths", {
      paths,
      recursive: options.recursive,
      markdownOnly: options.markdownOnly,
      targetFile: options.targetFile ?? null,
    }),

  unwatchPaths: (watchId) => call<void>("unwatch_paths", { watchId }),

  takePendingOpen: () => call<string[]>("take_pending_open"),

  onAppEvent(callback) {
    const unlisten = Promise.all([
      listen<string>("app://menu", (event) =>
        callback({ type: "menu", action: event.payload }),
      ),
      listen("app://close-requested", () =>
        callback({ type: "close-requested" }),
      ),
      listen<string[]>("app://open-paths", (event) =>
        callback({ type: "open-paths", paths: event.payload }),
      ),
    ]);
    return () => {
      void unlisten.then((handlers) => {
        for (const handler of handlers) handler();
      });
    };
  },

  closeWindow: () => call<void>("close_window"),

  onFsChange(callback) {
    const promise = listen<FsChangeEvent>("fs://change", (event) =>
      callback(event.payload),
    );
    return () => {
      void promise.then((unlisten) => unlisten());
    };
  },

  saveDraft: (path, content, baselineMtimeMs) =>
    call<void>("save_draft", { path, content, baselineMtimeMs }),

  loadDraft: (path) => call<DraftRecord | null>("load_draft", { path }),

  clearDraft: (path) => call<void>("clear_draft", { path }),

  cleanupDrafts: () => call<number>("cleanup_drafts"),
};
