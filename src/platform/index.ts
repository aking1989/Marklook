import { mockPlatform } from "./mock";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

export const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const platform: Platform = isTauriRuntime
  ? tauriPlatform
  : mockPlatform;

export * from "./types";
