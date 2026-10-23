import {
  BookOpen,
  FileText,
  FolderOpen,
  Moon,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EditorViewHost,
  type EditorHandle,
} from "./features/editor/EditorViewHost";
import { ReaderView, type ReaderHandle } from "./features/reader/ReaderView";
import { SearchPanel } from "./features/search/SearchPanel";
import { FileTree } from "./features/workspace/FileTree";
import { renderMarkdown } from "./markdown/pipeline";
import { PlatformError, platform } from "./platform";
import { useDocumentStore, type DocStatus } from "./stores/documentStore";
import { useRecentsStore } from "./stores/recentsStore";
import {
  fontStack,
  useSettingsStore,
  type Theme,
} from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";

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

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

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

  const {
    theme,
    fontSize,
    lineHeight,
    contentWidth,
    readingFont,
    allowRemoteImages,
    cycleTheme,
    setFontSize,
    resetFontSize,
    setLineHeight,
    setContentWidth,
    setReadingFont,
    setAllowRemoteImages,
  } = useSettingsStore();

  const {
    root: workspaceRoot,
    tree,
    truncated: workspaceTruncated,
    scanning,
    expanded,
    openWorkspace,
    refresh: refreshWorkspace,
    toggleDir,
    revealPath,
  } = useWorkspaceStore();
  const { recentFiles, pushFile, pushWorkspace } = useRecentsStore();

  const readerRef = useRef<ReaderHandle>(null);
  const editorRef = useRef<EditorHandle>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  const [activeLine, setActiveLine] = useState(1);
  const outlineListRef = useRef<HTMLUListElement>(null);
  const pendingEditLine = useRef(1);
  const pendingReadLine = useRef(1);
  const syncTimer = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty("--font-size", `${fontSize}px`);
    root.style.setProperty("--line-height", String(lineHeight));
    root.style.setProperty("--content-width", `${contentWidth}px`);
    root.style.setProperty("--font-reading", fontStack(readingFont));
    root.style.setProperty(
      "--editor-font-size",
      `${Math.max(13, fontSize - 1)}px`,
    );
  }, [theme, fontSize, lineHeight, contentWidth, readingFont]);

  useEffect(() => {
    document.title = render?.title ? `${render.title} · 墨览` : "墨览";
  }, [render?.title]);

  // 远程图片策略影响渲染产物：设置变化时对当前内容重渲染。
  // 主题切换走 CSS 变量（Shiki/Mermaid 各自处理），不触发这里。
  const policyFirstRun = useRef(true);
  useEffect(() => {
    if (policyFirstRun.current) {
      policyFirstRun.current = false;
      return;
    }
    if (!render) return;

    const source = editorMounted
      ? (editorRef.current?.getValue() ?? content)
      : content;
    void renderMarkdown({
      source,
      docPath: path,
      resolveAsset: platform.toAssetUrl,
      options: { allowRemoteImages, theme },
    })
      .then((next) => setRender(next))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowRemoteImages]);

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

  // 大纲跟随：取"行号 <= 当前行"的最后一个标题，高亮并滚动进侧栏视野。
  const handleTopLineChange = useCallback((line: number) => {
    setActiveLine(line);
  }, []);

  const activeOutlineId = useMemo(() => {
    if (!render) return null;
    let current: string | null = null;
    for (const item of render.outline) {
      if (item.line <= activeLine) current = item.id;
      else break;
    }
    return current;
  }, [render, activeLine]);

  useEffect(() => {
    const list = outlineListRef.current;
    if (!list) return;
    list
      .querySelector<HTMLLIElement>("li.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeOutlineId]);

  const openPath = useCallback(
    async (
      target: string,
      options?: { skipDirtyConfirm?: boolean; gotoLine?: number },
    ) => {
      if (
        !options?.skipDirtyConfirm &&
        dirty &&
        path &&
        !window.confirm("当前文档有未保存的修改，仍要打开其他文件吗？")
      ) {
        return;
      }

      try {
        setLoading();
        const doc = await platform.readDocument(target);
        const rendered = await renderMarkdown({
          source: doc.content,
          docPath: doc.path,
          resolveAsset: platform.toAssetUrl,
          options: { allowRemoteImages, theme },
        });
        pendingReadLine.current = options?.gotoLine ?? 1;
        setLoaded(doc, rendered);
        editorRef.current?.setValue(doc.content);
        revealPath(target);
        pushFile(target);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [
      allowRemoteImages,
      dirty,
      path,
      pushFile,
      revealPath,
      setLoaded,
      setError,
      setLoading,
      theme,
    ],
  );

  /** 搜索面板的索引数据源：带正文扫描当前工作区。 */
  const requestSearchIndex = useCallback(async () => {
    if (!workspaceRoot) return [];
    const scan = await platform.scanVault(workspaceRoot, true);
    return scan.entries
      .filter((entry) => !entry.isDir && entry.content !== undefined)
      .map((entry) => ({
        path: entry.path,
        title: entry.name,
        body: entry.content ?? "",
        mtimeMs: entry.mtimeMs,
        size: entry.size,
      }));
  }, [workspaceRoot]);

  const openFolder = useCallback(async () => {
    try {
      const picked = await platform.pickFolder();
      if (!picked) return;
      pushWorkspace(picked);
      await openWorkspace(picked);
      // 工作区树刷新：递归监听，只关心 Markdown 扩展名。
      await platform.watchPaths([picked], {
        recursive: true,
        markdownOnly: true,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [openWorkspace, pushWorkspace, setError]);

  // 外部文件变更 → 500ms 去抖刷新工作区树（当前文档的处理见文档变更检测）。
  const workspaceRefreshTimer = useRef<number | null>(null);
  useEffect(() => {
    const unsubscribe = platform.onFsChange(() => {
      if (workspaceRefreshTimer.current !== null) return;
      workspaceRefreshTimer.current = window.setTimeout(() => {
        workspaceRefreshTimer.current = null;
        void refreshWorkspace();
      }, 500);
    });
    return () => {
      unsubscribe();
      if (workspaceRefreshTimer.current !== null) {
        window.clearTimeout(workspaceRefreshTimer.current);
      }
    };
  }, [refreshWorkspace]);

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
      if (picked) {
        await openPath(picked, { skipDirtyConfirm: true });
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [dirty, path, openPath, setError]);

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
      const rendered = await renderMarkdown({
        source: nextContent,
        docPath: path,
        resolveAsset: platform.toAssetUrl,
        options: { allowRemoteImages, theme },
      });
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
    allowRemoteImages,
    setContent,
    setDirty,
    setError,
    setMode,
    setRender,
    theme,
  ]);

  const printDocument = useCallback(async () => {
    if (!path || !render) return;

    // 打印始终使用阅读视图：源码模式下先渲染并切回阅读，等下一帧绘制完成。
    if (mode === "edit") {
      pendingReadLine.current = editorRef.current?.getCursorLine() ?? 1;
      const nextContent = editorRef.current?.getValue() ?? content;
      setContent(nextContent);
      setDirty(nextContent !== savedContent);
      try {
        setRender(
          await renderMarkdown({
            source: nextContent,
            docPath: path,
            resolveAsset: platform.toAssetUrl,
            options: { allowRemoteImages, theme },
          }),
        );
      } catch (caught) {
        setError(errorMessage(caught));
        return;
      }
      setMode("read");
      await nextPaint();
    }

    try {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 2000);
        }),
      ]);
      await platform.print();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [
    content,
    mode,
    path,
    render,
    savedContent,
    allowRemoteImages,
    setContent,
    setDirty,
    setError,
    setMode,
    setRender,
    theme,
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
      } else if (key === "p") {
        event.preventDefault();
        void printDocument();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setFontSize(fontSize + 1);
      } else if (event.key === "-") {
        event.preventDefault();
        setFontSize(fontSize - 1);
      } else if (key === "0") {
        event.preventDefault();
        resetFontSize();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    fontSize,
    openFile,
    printDocument,
    resetFontSize,
    save,
    setFontSize,
    toggleMode,
  ]);

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
            className="tool-btn icon-only"
            onClick={() => void openFolder()}
            title="打开文件夹（工作区）"
            aria-label="打开文件夹"
          >
            <FolderOpen size={16} />
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
            className="tool-btn"
            onClick={() => void printDocument()}
            disabled={!path || !render}
            title="打印 / 导出 PDF (⌘P)"
          >
            <Printer size={16} />
            打印
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
          <section className="side-section workspace-section">
            <h2>工作区</h2>
            {workspaceRoot ? (
              <>
                <div className="workspace-toolbar">
                  <span className="workspace-root" title={workspaceRoot}>
                    {fileName(workspaceRoot)}
                  </span>
                  <button
                    className="icon-btn"
                    onClick={() => void refreshWorkspace()}
                    title="刷新工作区"
                    aria-label="刷新工作区"
                    disabled={scanning}
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div className="file-tree-scroll">
                  <FileTree
                    nodes={tree}
                    expanded={expanded}
                    activePath={path}
                    onToggleDir={toggleDir}
                    onOpenFile={(filePath) => void openPath(filePath)}
                  />
                </div>
                {workspaceTruncated && (
                  <p className="tree-truncated">仅显示前 10,000 个条目</p>
                )}
                <SearchPanel
                  key={workspaceRoot}
                  onOpenResult={(resultPath, line) =>
                    void openPath(resultPath, { gotoLine: line })
                  }
                  onRequestIndex={requestSearchIndex}
                />
              </>
            ) : (
              <button
                className="primary-btn slim"
                onClick={() => void openFolder()}
              >
                <FolderOpen size={14} />
                打开文件夹
              </button>
            )}
          </section>

          {recentFiles.length > 0 && !workspaceRoot && (
            <section className="side-section">
              <h2>最近</h2>
              <ul className="recent-list">
                {recentFiles.slice(0, 5).map((entry) => (
                  <li key={entry.path}>
                    <button
                      className="recent-item"
                      onClick={() => void openPath(entry.path)}
                      title={entry.path}
                    >
                      <FileText size={12} />
                      <span>{entry.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
              <ul ref={outlineListRef}>
                {render.outline.map((item) => (
                  <li
                    key={`${item.line}-${item.id}`}
                    className={item.id === activeOutlineId ? "active" : ""}
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
              <span>行高</span>
              <div className="stepper">
                <button
                  onClick={() => setLineHeight(lineHeight - 0.1)}
                  aria-label="减小行高"
                >
                  −
                </button>
                <span>{lineHeight.toFixed(1)}</span>
                <button
                  onClick={() => setLineHeight(lineHeight + 0.1)}
                  aria-label="增大行高"
                >
                  +
                </button>
              </div>
            </div>
            <div className="setting-row">
              <span>栏宽</span>
              <div className="stepper">
                <button
                  onClick={() => setContentWidth(contentWidth - 40)}
                  aria-label="减小栏宽"
                >
                  −
                </button>
                <span>{contentWidth}</span>
                <button
                  onClick={() => setContentWidth(contentWidth + 40)}
                  aria-label="增大栏宽"
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
            <div className="setting-row">
              <span>字体</span>
              <button
                className="text-btn"
                onClick={() =>
                  setReadingFont(readingFont === "serif" ? "sans" : "serif")
                }
              >
                {readingFont === "serif" ? "衬线" : "无衬线"}
              </button>
            </div>
            <div className="setting-row">
              <span>远程图片</span>
              <button
                className="text-btn"
                onClick={() => setAllowRemoteImages(!allowRemoteImages)}
                title="默认阻止所有网络图片请求；开启后仍需逐张点击加载"
              >
                {allowRemoteImages ? "点击加载" : "已阻止"}
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
            <div className="shortcut-row">
              <span>打印 / PDF</span>
              <kbd>⌘P</kbd>
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
                theme={theme}
                outline={render.outline}
                onOpenInternalDoc={(docPath) => void openPath(docPath)}
                onTopLineChange={handleTopLineChange}
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
              <button className="primary-btn" onClick={() => void openFile()}>
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
          <span className="mode-pill">{mode === "read" ? "阅读" : "源码"}</span>
        </span>
      </footer>
    </div>
  );
}
