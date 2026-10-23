import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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

  toAssetUrl(absolutePath: string): string {
    // convertFileSrc 负责平台差异（macOS/Linux mdasset://，Windows http://mdasset.localhost）；
    // "local/" 前缀 + base64url 路径由 Rust 端 decode_asset_request 解析。
    const token = utf8ToBase64Url(absolutePath);
    return convertFileSrc(`local/${token}`, "mdasset");
  },
};
