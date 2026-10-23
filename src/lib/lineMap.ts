export interface LineAnchor {
  startLine: number;
  endLine: number;
  top: number;
  height: number;
}

export function buildLineMap(
  scroller: HTMLElement,
  article: HTMLElement,
): LineAnchor[] {
  const scrollerRect = scroller.getBoundingClientRect();
  const scrollTop = scroller.scrollTop;

  return Array.from(article.querySelectorAll<HTMLElement>("[data-line-start]"))
    .map((element) => {
      const startLine = Number(element.dataset.lineStart);
      const endLine = Number(
        element.dataset.lineEnd ?? element.dataset.lineStart,
      );
      if (!Number.isFinite(startLine)) return null;

      const rect = element.getBoundingClientRect();
      return {
        startLine,
        endLine: Number.isFinite(endLine) ? endLine : startLine,
        top: rect.top - scrollerRect.top + scrollTop,
        height: rect.height,
      };
    })
    .filter((anchor): anchor is LineAnchor => anchor !== null)
    .sort((a, b) => a.top - b.top);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lineAtViewportTop(
  anchors: LineAnchor[],
  scroller: HTMLElement,
): number {
  if (anchors.length === 0) return 1;

  const y = scroller.scrollTop + scroller.clientHeight * 0.1;
  let low = 0;
  let high = anchors.length - 1;
  let index = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (anchors[mid].top <= y) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const anchor = anchors[index];
  const next = anchors[index + 1];
  const span = next
    ? Math.max(1, next.top - anchor.top)
    : Math.max(1, anchor.height);
  const ratio = clamp01((y - anchor.top) / span);
  const endLine = next ? next.startLine : anchor.endLine;

  return Math.max(
    1,
    Math.round(
      anchor.startLine + ratio * Math.max(0, endLine - anchor.startLine),
    ),
  );
}

export function scrollToLine(
  anchors: LineAnchor[],
  scroller: HTMLElement,
  line: number,
): void {
  if (anchors.length === 0) return;

  let index = 0;
  for (let i = 0; i < anchors.length; i += 1) {
    if (anchors[i].startLine <= line) index = i;
    else break;
  }

  const anchor = anchors[index];
  const next = anchors[index + 1];
  const span = Math.max(
    1,
    (next ? next.startLine : anchor.endLine) - anchor.startLine,
  );
  const ratio = clamp01((line - anchor.startLine) / span);
  const targetTop = next
    ? anchor.top + ratio * (next.top - anchor.top)
    : anchor.top + ratio * anchor.height;

  scroller.scrollTop = Math.max(0, targetTop - scroller.clientHeight * 0.1);
}

/**
 * 带缓存与失效的行号映射：
 * 内容替换、尺寸变化（窗口缩放/字体加载/图片加载/Mermaid 渲染）时调用 invalidate，
 * 避免每次滚动都全量 querySelectorAll + getBoundingClientRect。
 */
export class LineMapTracker {
  private anchors: LineAnchor[] | null = null;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly article: HTMLElement,
  ) {}

  invalidate(): void {
    this.anchors = null;
  }

  private resolve(): LineAnchor[] {
    this.anchors ??= buildLineMap(this.scroller, this.article);
    return this.anchors;
  }

  topLine(): number {
    return lineAtViewportTop(this.resolve(), this.scroller);
  }

  scrollTo(line: number): void {
    scrollToLine(this.resolve(), this.scroller, line);
  }
}
