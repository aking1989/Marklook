export type RenderTheme = "light" | "dark" | "sepia";

export interface RenderOptions {
  allowRemoteImages: boolean;
  enableMath: boolean;
  enableMermaid: boolean;
  enableHighlight: boolean;
  largeFileMode: boolean;
  forExport: boolean;
  theme: RenderTheme;
}

export interface RenderInput {
  source: string;
  docPath: string | null;
  options?: Partial<RenderOptions>;
  /** 绝对路径 → 资源 URL（Tauri 下为 mdasset://），由平台层注入。 */
  resolveAsset?: (absolutePath: string) => string;
}

export interface OutlineItem {
  id: string;
  depth: number;
  text: string;
  line: number;
}

export interface RenderMeta {
  charCount: number;
  wordCount: number;
  readingMinutes: number;
}

export type RenderWarningKind =
  "frontmatter" | "math" | "mermaid" | "highlight" | "link" | "image";

export interface RenderWarning {
  kind: RenderWarningKind;
  message: string;
  line?: number;
}

export interface RenderResult {
  html: string;
  outline: OutlineItem[];
  frontmatter: Record<string, unknown>;
  title: string;
  meta: RenderMeta;
  warnings: RenderWarning[];
}
