import {
  BookOpen,
  FileText,
  Moon,
  Pencil,
  Save,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EditorViewHost,
  type EditorHandle,
} from "./features/editor/EditorViewHost";
import { ReaderView, type ReaderHandle } from "./features/reader/ReaderView";
import { renderMarkdown } from "./markdown/pipeline";
import { PlatformError, platform } from "./platform";
import {
  useDocumentStore,
  type DocStatus,
} from "./stores/documentStore";
import {
  useSettingsStore,
  type Theme,
} from "./stores/settingsStore";

function errorMessage(error: unknown): string {
  if (error instanceof PlatformError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function fileName(path: string | null): string {
  if (!path) return "未打开文档";
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function statusLabel(status: DocStatus, dirty: boolean): string {
  switch (status) {
    case "loading":
      return "正在打开…";
    case "saving":
      return "正在保存…";
    case "error":
      return "出错了";
    case "dirty":
      return dirty ? "未保存" : "已保存";
    case "clean":
      return "已保存";
    case "empty":
      return "就绪";
  }
}

const THEME_ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  sepia: BookOpen,
};

const THEME_LABEL: Record<Theme, string> = {
  light: "亮色",
  dark: "暗色",
  sepia: "护眼",
};

export default function App() {
  const {
    path,
    content,
    savedContent,
    mtimeMs,
    eol,
    bom,
    mode,
    status,
    dirty,
    render,
    error,
    setLoading,
    setLoaded,
    setContent,
    setDirty,
    markDirty,
    setMode,
    setRender,
    setSaving,
    setSaved,
    setError,
    clearError,
  } = useDocumentStore();

  const { theme, fontSize, lineHeight, contentWidth, cycleTheme, setFontSize } =
    useSettingsStore();

  const readerRef = useRef<ReaderHandle>(null);
  const editorRef = useRef<EditorHandle>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  const pendingEditLine = useRef(1);
  const pendingReadLine = useRef(1);
  const syncTimer = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty("--font-size", `${fontSize}px`);
    root.style.setProperty("--line-height", String(lineHeight));
    root.style.setProperty("--content-width", `${contentWidth}px`);
    root.style.setProperty(
      "--editor-font-size",
      `${Math.max(13, fontSize - 1)}px`,
    );
  }, [theme, fontSize, lineHeight, contentWidth]);

  useEffect(() => {
    document.title = render?.title ? `${render.title} · 墨览` : "墨览";
  }, [render?.title]);

  useEffect(() => {
    if (mode === "edit" && editorMounted) {
      const frame = requestAnimationFrame(() => {
        editorRef.current?.scrollToLine(pendingEditLine.current);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (mode === "read") {
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          readerRef.current?.scrollToLine(pendingReadLine.current);
        });
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }

    return undefined;
  }, [mode, editorMounted, render?.html]);

  const openFile = useCallback(async () => {
    if (
      dirty &&
      path &&
      !window.confirm("当前文档有未保存的修改，仍要打开其他文件吗？")
    ) {
      return;
    }

    try {
      const picked = await platform.pickFile();
      if (!picked) return;

      setLoading();
      const doc = await platform.readDocument(picked);
      const rendered = await renderMarkdown(doc.content, doc.path);
      pendingReadLine.current = 1;
      setLoaded(doc, rendered);
      editorRef.current?.setValue(doc.content);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [dirty, path, setLoaded, setError, setLoading]);

  const save = useCallback(async () => {
    if (!path) return;

    const nextContent = editorMounted
      ? (editorRef.current?.getValue() ?? content)
      : content;

    if (nextContent === savedContent) {
      setDirty(false);
      return;
    }

    setSaving();
    try {
      const result = await platform.writeDocument(path, nextContent, {
        expectedMtimeMs: mtimeMs,
        eol,
        bom,
      });
      setSaved(nextContent, result.mtimeMs);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [
    bom,
    content,
    editorMounted,
    eol,
    mtimeMs,
    path,
    savedContent,
    setDirty,
    setError,
    setSaved,
    setSaving,
  ]);

  const toggleMode = useCallback(async () => {
    if (!path || !render) return;

    if (mode === "read") {
      pendingEditLine.current = readerRef.current?.getTopLine() ?? 1;
      setEditorMounted(true);
      setMode("edit");
      return;
    }

    const nextContent = editorRef.current?.getValue() ?? content;
    const cursorLine = editorRef.current?.getCursorLine() ?? 1;
    pendingReadLine.current = cursorLine;
    setContent(nextContent);
    setDirty(nextContent !== savedContent);

    try {
      const rendered = await renderMarkdown(nextContent, path);
      setRender(rendered);
      setMode("read");
    } catch (caught) {
      setError(errorMessage(caught));
      setMode("read");
    }
  }, [
    content,
    mode,
    path,
    render,
    savedContent,
    setContent,
    setDirty,
    setError,
    setMode,
    setRender,
  ]);

  const handleEditorChange = useCallback(() => {
    // 输入时只更新脏标记，避免每次按键都进入 React 状态。
    markDirty();
    if (syncTimer.current !== null) {
      window.clearTimeout(syncTimer.current);
    }
    syncTimer.current = window.setTimeout(() => {
      const value = editorRef.current?.getValue();
      if (value !== undefined) {
        setContent(value);
      }
      syncTimer.current = null;
    }, 300);
  }, [markDirty, setContent]);

  useEffect(
    () => () => {
      if (syncTimer.current !== null) {
        window.clearTimeout(syncTimer.current);
      }
    },
    [],
  );

  const jumpTo = useCallback(
    (line: number) => {
      if (mode === "read") {
        readerRef.current?.scrollToLine(line);
      } else {
        editorRef.current?.scrollToLine(line);
      }
    },
    [mode],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;

      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        void openFile();
      } else if (key === "e") {
        event.preventDefault();
        void toggleMode();
      } else if (key === "s") {
        event.preventDefault();
        void save();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setFontSize(fontSize + 1);
      } else if (event.key === "-") {
        event.preventDefault();
        setFontSize(fontSize - 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fontSize, openFile, save, setFontSize, toggleMode]);

  const ThemeIcon = THEME_ICON[theme];

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">墨</span>
          <span className="brand-name">墨览</span>
        </div>
        <div className="doc-title" title={path ?? undefined}>
          {render?.title ?? fileName(path)}
        </div>
        <div className="toolbar">
          <button
            className="tool-btn"
            onClick={() => void openFile()}
            title="打开文件 (⌘O)"
          >
            <FileText size={16} />
            打开
          </button>
          <button
            className="tool-btn"
            onClick={() => void toggleMode()}
            disabled={!path || !render}
            title="切换阅读 / 源码 (⌘E)"
          >
            {mode === "read" ? <Pencil size={16} /> : <BookOpen size={16} />}
            {mode === "read" ? "源码" : "阅读"}
          </button>
          <button
            className="tool-btn"
            onClick={() => void save()}
            disabled={!path || !dirty}
            title="保存 (⌘S)"
          >
            <Save size={16} />
            保存
          </button>
          <button
            className="tool-btn icon-only"
            onClick={cycleTheme}
            title={`主题：${THEME_LABEL[theme]}`}
          >
            <ThemeIcon size={16} />
          </button>
        </div>
      </header>

      <div className="workbench">
        <aside className="sidebar">
          <section className="side-section">
            <h2>文档</h2>
            {path ? (
              <>
                <div className="file-path" title={path}>
                  {fileName(path)}
                </div>
                <dl className="doc-stats">
                  <div>
                    <dt>字数</dt>
                    <dd>{render?.meta.wordCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>阅读</dt>
                    <dd>{render?.meta.readingMinutes ?? 0} 分钟</dd>
                  </div>
                  <div>
                    <dt>编码</dt>
                    <dd>{bom ? "UTF-8 BOM" : "UTF-8"}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="muted">还没有打开文档</p>
            )}
          </section>

          {render && render.outline.length > 0 && (
            <section className="side-section outline">
              <h2>大纲</h2>
              <ul>
                {render.outline.map((item) => (
                  <li
                    key={`${item.line}-${item.id}`}
                    style={{ paddingLeft: (item.depth - 1) * 12 }}
                  >
                    <button onClick={() => jumpTo(item.line)}>
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="side-section">
            <h2>外观</h2>
            <div className="setting-row">
              <span>字号</span>
              <div className="stepper">
                <button
                  onClick={() => setFontSize(fontSize - 1)}
                  aria-label="减小字号"
                >
                  −
                </button>
                <span>{fontSize}</span>
                <button
                  onClick={() => setFontSize(fontSize + 1)}
                  aria-label="增大字号"
                >
                  +
                </button>
              </div>
            </div>
            <div className="setting-row">
              <span>主题</span>
              <button className="text-btn" onClick={cycleTheme}>
                {THEME_LABEL[theme]}
              </button>
            </div>
          </section>

          <section className="side-section shortcuts">
            <h2>快捷键</h2>
            <div className="shortcut-row">
              <span>打开</span>
              <kbd>⌘O</kbd>
            </div>
            <div className="shortcut-row">
              <span>阅读 / 源码</span>
              <kbd>⌘E</kbd>
            </div>
            <div className="shortcut-row">
              <span>保存</span>
              <kbd>⌘S</kbd>
            </div>
          </section>
        </aside>

        <main className="content">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={clearError}>关闭</button>
            </div>
          )}

          {render ? (
            <>
              <ReaderView
                ref={readerRef}
                html={render.html}
                hidden={mode === "edit"}
              />
              {editorMounted && (
                <EditorViewHost
                  ref={editorRef}
                  initialValue={content}
                  visible={mode === "edit"}
                  theme={theme}
                  onChange={handleEditorChange}
                />
              )}
            </>
          ) : (
            <div className="empty-state">
              <BookOpen size={44} strokeWidth={1.2} />
              <h1>打开一篇 Markdown</h1>
              <p>阅读优先，需要时再进入源码。</p>
              <button
                className="primary-btn"
                onClick={() => void openFile()}
              >
                <FileText size={16} />
                选择文件
              </button>
              <p className="hint">⌘O 打开 · ⌘E 切换 · ⌘S 保存</p>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span className="status-left">
          <span className={`dot ${dirty ? "is-dirty" : ""}`} />
          {statusLabel(status, dirty)}
        </span>
        <span className="status-right">
          {render && (
            <span>
              {render.meta.wordCount} 字 · {render.meta.readingMinutes} 分钟
            </span>
          )}
          <span className="mode-pill">
            {mode === "read" ? "阅读" : "源码"}
          </span>
        </span>
      </footer>
    </div>
  );
}
