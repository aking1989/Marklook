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

export interface RenderResult {
  html: string;
  outline: OutlineItem[];
  title: string;
  meta: RenderMeta;
}
