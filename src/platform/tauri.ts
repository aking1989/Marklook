import { invoke } from "@tauri-apps/api/core";
import {
  PlatformError,
  type Platform,
  type PlatformErrorCode,
  type TextDocument,
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

export const tauriPlatform: Platform = {
  pickFile: () => call<string | null>("pick_file_and_allow"),

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
};
