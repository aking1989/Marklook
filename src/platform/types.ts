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

export interface Platform {
  pickFile(): Promise<string | null>;
  readDocument(path: string): Promise<TextDocument>;
  writeDocument(
    path: string,
    content: string,
    options: WriteOptions,
  ): Promise<WriteResult>;
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
