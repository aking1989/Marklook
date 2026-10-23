export type Eol = "lf" | "crlf";

export interface TextDocument {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
  eol: Eol;
  bom: boolean;
  encoding: "utf-8";
}

export interface WriteOptions {
  expectedMtimeMs: number | null;
  force?: boolean;
  eol: Eol;
  bom: boolean;
}

export interface WriteResult {
  mtimeMs: number;
  size: number;
  eol: Eol;
  bom: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export interface VaultEntry extends DirEntry {
  /** scanVault(withContent) 时返回正文，供搜索索引。 */
  content?: string;
  /** 文件超过索引上限（2MB）时为 true。 */
  truncated?: boolean;
}

export interface VaultScan {
  root: string;
  entries: VaultEntry[];
  truncated: boolean;
}

export interface FsChangeEvent {
  watchId: number;
  paths: string[];
}

export interface DraftRecord {
  path: string;
  content: string;
  baselineMtimeMs: number;
  savedAt: number;
  version: number;
}

export type Unsubscribe = () => void;

export interface WatchOptions {
  recursive: boolean;
  markdownOnly: boolean;
  /** 单文档监听：按文件名过滤（任意扩展名）。 */
  targetFile?: string;
}

export interface Platform {
  pickFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  readDocument(path: string): Promise<TextDocument>;
  writeDocument(
    path: string,
    content: string,
    options: WriteOptions,
  ): Promise<WriteResult>;
  print(): Promise<void>;
  /** 绝对路径 → 可用于 <img src> 的资源 URL（Tauri: mdasset://；Mock: 占位图）。 */
  toAssetUrl(absolutePath: string): string;
  scanVault(root: string, withContent: boolean): Promise<VaultScan>;
  listDir(path: string): Promise<VaultEntry[]>;
  watchPaths(paths: string[], options: WatchOptions): Promise<number>;
  unwatchPaths(watchId: number): Promise<void>;
  onFsChange(callback: (event: FsChangeEvent) => void): Unsubscribe;
  saveDraft(
    path: string,
    content: string,
    baselineMtimeMs: number,
  ): Promise<void>;
  loadDraft(path: string): Promise<DraftRecord | null>;
  clearDraft(path: string): Promise<void>;
  cleanupDrafts(): Promise<number>;
}

export type PlatformErrorCode =
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "INVALID_UTF8"
  | "CONFLICT"
  | "IO"
  | "PATH_OUTSIDE_ROOT"
  | "TOO_LARGE"
  | "UNSUPPORTED"
  | "CANCELLED";

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly detail?: unknown;

  constructor(code: PlatformErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.detail = detail;
  }
}
