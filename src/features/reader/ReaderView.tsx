import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type MouseEvent,
} from "react";
import {
  buildLineMap,
  lineAtViewportTop,
  scrollToLine,
} from "../../lib/lineMap";
import type { RenderTheme } from "../../markdown/types";
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
}

export const ReaderView = forwardRef<ReaderHandle, ReaderViewProps>(
  function ReaderView({ html, hidden, theme }, ref) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const articleRef = useRef<HTMLElement>(null);
    const mermaidEpoch = useRef(0);

    useEffect(() => {
      const article = articleRef.current;
      if (!article) return;
      article.innerHTML = html;

      // Mermaid 串行渲染：全局状态不容并发；epoch 防止旧内容覆盖新文档。
      const blocks = Array.from(
        article.querySelectorAll<HTMLElement>(".mermaid-block"),
      );
      if (blocks.length === 0) return;

      const epoch = mermaidEpoch.current + 1;
      mermaidEpoch.current = epoch;

      void (async () => {
        for (const block of blocks) {
          if (mermaidEpoch.current !== epoch) return;
          await renderMermaidBlock(block, theme);
        }
      })();
    }, [html, theme]);

    useImperativeHandle(
      ref,
      () => ({
        getTopLine() {
          const scroller = scrollerRef.current;
          const article = articleRef.current;
          if (!scroller || !article) return 1;
          return lineAtViewportTop(buildLineMap(scroller, article), scroller);
        },

        scrollToLine(line: number) {
          const scroller = scrollerRef.current;
          const article = articleRef.current;
          if (!scroller || !article) return;
          scrollToLine(buildLineMap(scroller, article), scroller, line);
        },
      }),
      [],
    );

    function handleClick(event: MouseEvent<HTMLElement>) {
      const anchor = (event.target as Element).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();

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
        const target = articleRef.current?.querySelector<HTMLElement>(
          `[id="${CSS.escape(href.slice(1))}"]`,
        );
        target?.scrollIntoView({ block: "start" });
      }
    }

    return (
      <div ref={scrollerRef} className="reader-scroll" hidden={hidden}>
        <article ref={articleRef} className="md-body" onClick={handleClick} />
      </div>
    );
  },
);
