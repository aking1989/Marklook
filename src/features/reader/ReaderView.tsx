import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { decodeUrlPath } from "../../lib/docPath";
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

interface LightboxState {
  src: string;
  alt: string;
}

const SCROLL_THROTTLE_MS = 100;
const COPY_FEEDBACK_MS = 1500;

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
    const [lightbox, setLightbox] = useState<LightboxState | null>(null);

    useEffect(() => {
      const article = articleRef.current;
      const scroller = scrollerRef.current;
      if (!article || !scroller) return;

      article.innerHTML = html;
      trackerRef.current?.invalidate();
      trackerRef.current ??= new LineMapTracker(scroller, article);

      // 每个代码块注入复制按钮（绝对定位右上角，样式见 reader.css）。
      for (const pre of article.querySelectorAll<HTMLElement>("pre")) {
        if (pre.querySelector(".code-copy-btn")) continue;
        const button = document.createElement("button");
        button.className = "code-copy-btn";
        button.type = "button";
        button.textContent = "复制";
        pre.appendChild(button);
      }

      // 内容高度变化（图片加载、Mermaid 渲染、字体加载、窗口缩放）都会让锚点失效。
      const observer = new ResizeObserver(() => {
        trackerRef.current?.invalidate();
      });
      observer.observe(article);

      const invalidateOnMedia = () => trackerRef.current?.invalidate();
      // 图片加载失败：替换为失败占位（alt + 路径）。
      const onMediaError = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        const failed = document.createElement("span");
        failed.className = "image-error";
        failed.textContent = `图片加载失败：${
          target.getAttribute("data-abs-src") ??
          target.getAttribute("src") ??
          ""
        }`;
        target.replaceWith(failed);
      };
      const onMediaErrorAndInvalidate = (event: Event) => {
        onMediaError(event);
        invalidateOnMedia();
      };
      article.addEventListener("load", invalidateOnMedia, true);
      article.addEventListener("error", onMediaErrorAndInvalidate, true);

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
        article.removeEventListener("error", onMediaErrorAndInvalidate, true);
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

    // 灯箱：Esc 关闭。
    useEffect(() => {
      if (!lightbox) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setLightbox(null);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [lightbox]);

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

    const handleCopy = useCallback(async (button: HTMLButtonElement) => {
      const pre = button.closest("pre");
      const code = pre?.querySelector("code");
      if (!code) return;

      const text = code.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // 回退方案：临时选中后 execCommand。
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("copy");
        selection?.removeAllRanges();
      }

      button.textContent = "已复制";
      button.disabled = true;
      window.setTimeout(() => {
        button.textContent = "复制";
        button.disabled = false;
      }, COPY_FEEDBACK_MS);
    }, []);

    function handleClick(event: MouseEvent<HTMLElement>) {
      // 代码块复制按钮。
      const copyTarget = (event.target as Element).closest<HTMLButtonElement>(
        ".code-copy-btn",
      );
      if (copyTarget) {
        event.preventDefault();
        void handleCopy(copyTarget);
        return;
      }

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

      // 图片灯箱。
      if (
        event.target instanceof HTMLImageElement &&
        event.target.closest(".md-body")
      ) {
        setLightbox({
          src: event.target.src,
          alt: event.target.alt,
        });
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
        // 标题 id 是原文（中文/大小写），href 可能被编码；data-anchor 已还原。
        const slug =
          anchor.getAttribute("data-anchor") ?? decodeUrlPath(href.slice(1));
        const target = outline.find((item) => item.id === slug);
        if (target) {
          trackerRef.current?.scrollTo(target.line);
          return;
        }
        // 脚注等非标题锚点：按 id 定位。sanitize 会给 id 补 user-content- 前缀，
        // 而脚注自身的 href 已带该前缀，因此两种写法都要试。
        const byId =
          document.getElementById(slug) ??
          document.getElementById(`user-content-${slug}`);
        byId?.scrollIntoView({ block: "start" });
      }
    }

    function handleLightboxClick(event: MouseEvent<HTMLDivElement>) {
      if (event.target === event.currentTarget) setLightbox(null);
    }

    function handleLightboxKey(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (event.key === "Escape") setLightbox(null);
    }

    return (
      <div ref={scrollerRef} className="reader-scroll" hidden={hidden}>
        {html.trim() === "" ? (
          <div className="empty-doc">这篇文档是空的</div>
        ) : (
          <article ref={articleRef} className="md-body" onClick={handleClick} />
        )}

        {lightbox && (
          <div
            className="lightbox-overlay"
            onClick={handleLightboxClick}
            onKeyDown={handleLightboxKey}
            role="dialog"
            aria-modal="true"
            aria-label={lightbox.alt || "图片预览"}
          >
            <img src={lightbox.src} alt={lightbox.alt} />
          </div>
        )}
      </div>
    );
  },
);
