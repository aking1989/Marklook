import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type MouseEvent,
} from "react";
import { LineMapTracker } from "../../lib/lineMap";
import type { OutlineItem, RenderTheme } from "../../markdown/types";
import { isTauriRuntime } from "../../platform";
import { renderMermaidBlock } from "./mermaidRenderer";

export interface ReaderHandle {
  getTopLine(): number;
  scrollToLine(line: number): void;
}

interface ReaderViewProps {
  html: string;
  hidden: boolean;
  theme: RenderTheme;
  outline: OutlineItem[];
  onOpenInternalDoc: (absolutePath: string) => void;
  /** 视口顶部所在行变化（100ms 节流），供大纲高亮跟随。 */
  onTopLineChange?: (line: number) => void;
}

const SCROLL_THROTTLE_MS = 100;

export const ReaderView = forwardRef<ReaderHandle, ReaderViewProps>(
  function ReaderView(
    { html, hidden, theme, outline, onOpenInternalDoc, onTopLineChange },
    ref,
  ) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const articleRef = useRef<HTMLElement>(null);
    const trackerRef = useRef<LineMapTracker | null>(null);
    const mermaidEpoch = useRef(0);
    const topLineCallback = useRef(onTopLineChange);
    topLineCallback.current = onTopLineChange;

    useEffect(() => {
      const article = articleRef.current;
      const scroller = scrollerRef.current;
      if (!article || !scroller) return;

      article.innerHTML = html;
      trackerRef.current?.invalidate();
      trackerRef.current ??= new LineMapTracker(scroller, article);

      // 内容高度变化（图片加载、Mermaid 渲染、字体加载、窗口缩放）都会让锚点失效。
      const observer = new ResizeObserver(() => {
        trackerRef.current?.invalidate();
      });
      observer.observe(article);

      // 图片加载完成/失败后高度可能变化：主动失效一次。
      const invalidateOnMedia = () => trackerRef.current?.invalidate();
      article.addEventListener("load", invalidateOnMedia, true);
      article.addEventListener("error", invalidateOnMedia, true);

      // Mermaid 串行渲染：全局状态不容并发；epoch 防止旧内容覆盖新文档。
      const blocks = Array.from(
        article.querySelectorAll<HTMLElement>(".mermaid-block"),
      );
      const epoch = mermaidEpoch.current + 1;
      mermaidEpoch.current = epoch;
      if (blocks.length > 0) {
        void (async () => {
          for (const block of blocks) {
            if (mermaidEpoch.current !== epoch) return;
            await renderMermaidBlock(block, theme);
            trackerRef.current?.invalidate();
          }
        })();
      }

      return () => {
        observer.disconnect();
        article.removeEventListener("load", invalidateOnMedia, true);
        article.removeEventListener("error", invalidateOnMedia, true);
      };
    }, [html, theme]);

    // 滚动 → 当前行回调（节流），驱动大纲高亮。
    useEffect(() => {
      const scroller = scrollerRef.current;
      if (!scroller || !onTopLineChange) return;

      let timer: number | null = null;
      const emit = () => {
        timer = null;
        const tracker = trackerRef.current;
        if (tracker) topLineCallback.current?.(tracker.topLine());
      };

      const onScroll = () => {
        if (timer !== null) return;
        timer = window.setTimeout(emit, SCROLL_THROTTLE_MS);
      };

      scroller.addEventListener("scroll", onScroll, { passive: true });
      emit();
      return () => {
        scroller.removeEventListener("scroll", onScroll);
        if (timer !== null) window.clearTimeout(timer);
      };
    }, [onTopLineChange]);

    useImperativeHandle(
      ref,
      () => ({
        getTopLine() {
          return trackerRef.current?.topLine() ?? 1;
        },

        scrollToLine(line: number) {
          trackerRef.current?.scrollTo(line);
        },
      }),
      [],
    );

    function handleClick(event: MouseEvent<HTMLElement>) {
      // 远程图片"点击加载"：占位 figure 替换为真实 img。
      const loadButton = (event.target as Element).closest(".load-remote-btn");
      if (loadButton) {
        const figure = loadButton.closest<HTMLElement>(".remote-image");
        const remoteSrc = figure?.dataset.remoteSrc;
        if (figure && remoteSrc) {
          const alt =
            figure.querySelector("figcaption")?.textContent ?? "远程图片";
          const img = document.createElement("img");
          img.src = remoteSrc;
          img.alt = alt;
          img.loading = "lazy";
          figure.replaceWith(img);
          trackerRef.current?.invalidate();
        }
        return;
      }

      const anchor = (event.target as Element).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      event.preventDefault();

      // 相对 Markdown 文档：交给应用层（脏检查后当前窗口打开）。
      const internalDoc = anchor.getAttribute("data-internal-doc");
      if (internalDoc) {
        onOpenInternalDoc(internalDoc);
        return;
      }

      if (/^(https?:|mailto:)/i.test(href)) {
        if (isTauriRuntime) {
          void openUrl(href).catch((error) => {
            console.warn("打开外部链接失败", error);
          });
        } else {
          window.open(href, "_blank", "noopener,noreferrer");
        }
        return;
      }

      if (href.startsWith("#")) {
        const slug = href.slice(1);
        const target = outline.find((item) => item.id === slug);
        if (target) {
          trackerRef.current?.scrollTo(target.line);
        }
      }
    }

    return (
      <div ref={scrollerRef} className="reader-scroll" hidden={hidden}>
        <article ref={articleRef} className="md-body" onClick={handleClick} />
      </div>
    );
  },
);
