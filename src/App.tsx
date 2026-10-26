import {
  BookOpen,
  FileDown,
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
import {
  buildStandaloneHtml,
  waitForRenderedFigures,
} from "./features/export/exportHtml";
import { renderMarkdown } from "./markdown/pipeline";
import { isTauriRuntime, PlatformError, platform } from "./platform";
import { isMacPlatform, shortcutLabel, type ShortcutId } from "./lib/shortcut";
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

function dirnameOf(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : null;
  return normalized.slice(0, index);
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
    autoSave,
    sidebarWidth,
    setSidebarWidth,
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
  const isMac = isMacPlatform();
  const key = (id: ShortcutId) => shortcutLabel(id, isMac);

  const readerRef = useRef<ReaderHandle>(null);
  const editorRef = useRef<EditorHandle>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  const [activeLine, setActiveLine] = useState(1);
  const [conflict, setConflict] = useState<{
    diskContent: string;
    diskMtimeMs: number;
  } | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<{
    content: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const recentlyWrittenAt = useRef(0);
  const docWatchId = useRef<number | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const draftTimer = useRef<number | null>(null);
  const outlineListRef = useRef<HTMLUListElement>(null);
  const pendingEditLine = useRef(1);
  const pendingReadLine = useRef(1);
  const syncTimer = useRef<number | null>(null);

  // 启动时清理 7 天前的旧草稿。
  useEffect(() => {
    void platform.cleanupDrafts().catch(() => undefined);
  }, []);

  // 文件关联冷启动：打开命令行传入的 .md。
  useEffect(() => {
    void platform
      .takePendingOpen()
      .then((paths) => {
        if (paths.length > 0) void openPath(paths[0] as string);
      })
      .catch(() => undefined);
    // 仅启动时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 应用级事件：原生菜单 / 关闭确认 / 单实例打开。
  const appActionsRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const confirmAndClose = () => {
      if (
        useDocumentStore.getState().dirty &&
        useDocumentStore.getState().path
      ) {
        if (window.confirm("有未保存的修改，关闭前保存吗？")) {
          void (async () => {
            await save();
            await platform.closeWindow();
          })();
          return;
        }
        if (!window.confirm("放弃修改并直接关闭吗？")) return;
      }
      void platform.closeWindow();
    };

    const unsubscribe = platform.onAppEvent((event) => {
      if (event.type === "close-requested") {
        confirmAndClose();
        return;
      }
      if (event.type === "open-paths") {
        const first = event.paths[0];
        if (first) void openPath(first);
        return;
      }
      const actions = appActionsRef.current;
      switch (event.action) {
        case "open-file":
          actions.openFile();
          break;
        case "open-folder":
          actions.openFolder();
          break;
        case "save":
          actions.save();
          break;
        case "export-html":
          actions.exportHtml();
          break;
        case "print":
          actions.printDocument();
          break;
        case "toggle-mode":
          actions.toggleMode();
          break;
        default:
          break;
      }
    });
    return unsubscribe;
    // 动作经 ref/noop 引入避免重建订阅；事件订阅只在挂载时建立一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showNotice(message: string): void {
    setNotice(message);
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 3000);
  }

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty("--font-size", `${fontSize}px`);
    root.style.setProperty("--line-height", String(lineHeight));
    root.style.setProperty("--content-width", `${contentWidth}px`);
    root.style.setProperty("--font-reading", fontStack(readingFont));
    root.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
    root.style.setProperty(
      "--editor-font-size",
      `${Math.max(13, fontSize - 1)}px`,
    );
  }, [theme, fontSize, lineHeight, contentWidth, readingFont, sidebarWidth]);

  useEffect(() => {
    const title = render?.title ? `${render.title} · 墨览` : "墨览";
    document.title = title;
    // 原生窗口标题不自动跟随 document.title，显式同步（Mock 环境无 Tauri API）。
    if (isTauriRuntime) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      );
    }
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
      options: { allowRemoteImages, theme, largeFileMode: largeFile },
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

  // 大文件模式：>2MB 或 >25,000 行（详细设计 §6.7）。
  const largeFile = useMemo(
    () =>
      content.length > 2 * 1024 * 1024 ||
      (content.match(/\n/g)?.length ?? 0) > 25_000,
    [content],
  );

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
          options: { allowRemoteImages, theme, largeFileMode: largeFile },
        });
        pendingReadLine.current = options?.gotoLine ?? 1;
        setConflict(null);
        setDraftPrompt(null);
        if (autoSaveTimer.current !== null) {
          window.clearTimeout(autoSaveTimer.current);
          autoSaveTimer.current = null;
        }
        if (draftTimer.current !== null) {
          window.clearTimeout(draftTimer.current);
          draftTimer.current = null;
        }
        setLoaded(doc, rendered);
        editorRef.current?.setValue(doc.content);
        revealPath(target);
        pushFile(target);
        restartDocWatch(doc.path);
        // 上游解析超线性：大文档提前告知（性能修订记录见开发计划 v0.3）。
        if (doc.size > 512 * 1024) {
          showNotice("大文档渲染可能较慢");
        }

        // 草稿比磁盘新且内容不同时提示恢复。
        try {
          const draft = await platform.loadDraft(target);
          if (
            draft &&
            draft.savedAt > doc.mtimeMs &&
            draft.content !== doc.content
          ) {
            setDraftPrompt({ content: draft.content });
          }
        } catch {
          // 草稿读取失败不影响打开。
        }
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [
      allowRemoteImages,
      dirty,
      largeFile,
      path,
      pushFile,
      revealPath,
      setLoaded,
      setError,
      setLoading,
      theme,
    ],
  );

  /** 单文档监听：监听父目录（非递归）按文件名过滤，捕获 rename 式保存。 */
  async function restartDocWatch(docPath: string): Promise<void> {
    if (docWatchId.current !== null) {
      await platform.unwatchPaths(docWatchId.current);
      docWatchId.current = null;
    }
    const parent = dirnameOf(docPath);
    if (!parent) return;
    try {
      docWatchId.current = await platform.watchPaths([parent], {
        recursive: false,
        markdownOnly: false,
        targetFile: docPath.replace(/\\/g, "/").split("/").pop(),
      });
    } catch {
      // 监听不可用（网络盘等）：降级为工作区刷新与焦点刷新。
    }
  }

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

  // 外部文件变更路由：当前文档 → 冲突检测；其余 → 500ms 去抖刷新工作区树。
  const workspaceRefreshTimer = useRef<number | null>(null);
  const currentPathRef = useRef<string | null>(path);
  currentPathRef.current = path;
  useEffect(() => {
    const unsubscribe = platform.onFsChange((event) => {
      const current = currentPathRef.current;
      const touchesCurrent =
        current !== null &&
        event.paths.some(
          (changed) =>
            changed === current ||
            changed.endsWith(`/${current.split("/").pop()}`),
        );

      if (touchesCurrent) {
        externalHandlerRef.current();
        return;
      }

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
    if (!path || conflict) return;

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
      recentlyWrittenAt.current = Date.now();
      setSaved(nextContent, result.mtimeMs);
      void platform.clearDraft(path).catch(() => undefined);
    } catch (caught) {
      // 保存撞上外部修改：读磁盘内容进入冲突面板，而不是覆盖提示。
      if (caught instanceof PlatformError && caught.code === "CONFLICT") {
        try {
          const disk = await platform.readDocument(path);
          setConflict({
            diskContent: disk.content,
            diskMtimeMs: disk.mtimeMs,
          });
          return;
        } catch {
          // 读取失败则走通用错误提示。
        }
      }
      setError(errorMessage(caught));
    }
  }, [
    bom,
    conflict,
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

  /**
   * 外部变更检测（详细设计 §11.2/11.3）：
   * 本应用 2s 内写入忽略 → mtime 未变忽略 → 内容一致静默同步 baseline →
   * 干净时静默重载（保持滚动位置）→ 脏时弹冲突面板。
   */
  const externalHandlerRef = useRef<() => void>(() => undefined);
  const pathRef = useRef<string | null>(path);
  pathRef.current = path;
  const handleExternalChange = useCallback(async () => {
    if (!path || conflict) return;
    if (Date.now() - recentlyWrittenAt.current < 2000) return;

    try {
      const disk = await platform.readDocument(path);
      if (disk.mtimeMs === mtimeMs) return;

      const current = editorMounted
        ? (editorRef.current?.getValue() ?? content)
        : content;

      if (current === disk.content) {
        setSaved(current, disk.mtimeMs);
        showNotice("文件已在其他程序中修改（内容一致，已同步）");
        return;
      }

      if (!dirty) {
        const topLine = readerRef.current?.getTopLine() ?? 1;
        const rendered = await renderMarkdown({
          source: disk.content,
          docPath: disk.path,
          resolveAsset: platform.toAssetUrl,
          options: { allowRemoteImages, theme, largeFileMode: largeFile },
        });
        pendingReadLine.current = topLine;
        setLoaded(disk, rendered);
        editorRef.current?.setValue(disk.content);
        showNotice("文件已更新");
        return;
      }

      setConflict({
        diskContent: disk.content,
        diskMtimeMs: disk.mtimeMs,
      });
    } catch {
      // 读取失败：保持现状，等下一次事件。
    }
  }, [
    allowRemoteImages,
    conflict,
    content,
    dirty,
    editorMounted,
    largeFile,
    mtimeMs,
    path,
    setLoaded,
    setSaved,
    theme,
  ]);
  externalHandlerRef.current = () => void handleExternalChange();

  // 冲突解决：用当前内容强制覆盖磁盘。
  const resolveConflictOverwrite = useCallback(async () => {
    if (!path || !conflict) return;
    const current = editorMounted
      ? (editorRef.current?.getValue() ?? content)
      : content;
    try {
      const result = await platform.writeDocument(path, current, {
        expectedMtimeMs: conflict.diskMtimeMs,
        force: true,
        eol,
        bom,
      });
      recentlyWrittenAt.current = Date.now();
      setSaved(current, result.mtimeMs);
      setConflict(null);
      void platform.clearDraft(path).catch(() => undefined);
      showNotice("已用当前内容覆盖磁盘文件");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [bom, conflict, content, eol, editorMounted, path, setError, setSaved]);

  // 草稿恢复：用草稿内容替换当前文档并进入脏状态。
  const restoreDraft = useCallback(async () => {
    if (!path || !draftPrompt) return;
    try {
      const rendered = await renderMarkdown({
        source: draftPrompt.content,
        docPath: path,
        resolveAsset: platform.toAssetUrl,
        options: { allowRemoteImages, theme, largeFileMode: largeFile },
      });
      setContent(draftPrompt.content);
      setDirty(true);
      setRender(rendered);
      editorRef.current?.setValue(draftPrompt.content);
      setDraftPrompt(null);
      showNotice("已恢复未保存的草稿");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [
    allowRemoteImages,
    draftPrompt,
    largeFile,
    path,
    setContent,
    setDirty,
    setError,
    setRender,
    theme,
  ]);

  // 丢弃草稿：删除并关闭提示。
  const discardDraft = useCallback(() => {
    if (path) {
      void platform.clearDraft(path).catch(() => undefined);
    }
    setDraftPrompt(null);
  }, [path]);

  // 冲突解决：放弃本地修改，加载磁盘版本。
  const resolveConflictLoadDisk = useCallback(async () => {
    if (!path || !conflict) return;
    try {
      const rendered = await renderMarkdown({
        source: conflict.diskContent,
        docPath: path,
        resolveAsset: platform.toAssetUrl,
        options: { allowRemoteImages, theme, largeFileMode: largeFile },
      });
      setLoaded(
        {
          path,
          content: conflict.diskContent,
          mtimeMs: conflict.diskMtimeMs,
          size: conflict.diskContent.length,
          eol,
          bom,
          encoding: "utf-8",
        },
        rendered,
      );
      editorRef.current?.setValue(conflict.diskContent);
      setConflict(null);
      showNotice("已加载磁盘版本（本地修改已放弃）");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [
    allowRemoteImages,
    bom,
    conflict,
    eol,
    largeFile,
    path,
    setError,
    setLoaded,
    theme,
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
        options: { allowRemoteImages, theme, largeFileMode: largeFile },
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
    largeFile,
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
            options: { allowRemoteImages, theme, largeFileMode: largeFile },
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
    largeFile,
    setContent,
    setDirty,
    setError,
    setMode,
    setRender,
    theme,
  ]);

  /** 导出 HTML：编辑态先切回阅读渲染，等待 Mermaid 完成后组装自包含文档。 */
  const exportHtml = useCallback(async () => {
    if (!path || !render) return;

    // 与打印一致：导出始终基于阅读视图。
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
            options: { allowRemoteImages, theme, largeFileMode: largeFile },
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
      const article = document.querySelector<HTMLElement>(".md-body");
      if (!article) return;
      await waitForRenderedFigures(article);

      const html = await buildStandaloneHtml(article, render.title, theme);
      const defaultName = `${fileName(path).replace(/\.md$/i, "")}.html`;
      const savedTo = await platform.exportSaveHtml(defaultName, html);
      if (savedTo) {
        showNotice(`已导出：${fileName(savedTo)}`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [
    allowRemoteImages,
    content,
    largeFile,
    mode,
    path,
    render,
    savedContent,
    setContent,
    setDirty,
    setError,
    setMode,
    setRender,
    theme,
  ]);

  // 自动保存经 ref 调用最新 save，避免 onChange 回调随保存状态重建。
  const saveRef = useRef(save);
  saveRef.current = save;

  /** 粘贴/拖入图片：保存到文档的 assets/ 并返回相对路径。 */
  const handlePasteImage = useCallback(
    async (
      suggestedName: string,
      bytes: Uint8Array,
    ): Promise<string | null> => {
      if (!path) {
        showNotice("请先打开或保存文档，再粘贴图片");
        return null;
      }
      try {
        const result = await platform.saveAsset(path, suggestedName, bytes);
        return result.relativePath;
      } catch (caught) {
        setError(errorMessage(caught));
        return null;
      }
    },
    [path, setError],
  );

  const writeDraft = useCallback(() => {
    const docPath = pathRef.current;
    if (!docPath) return;
    const current = editorMounted
      ? (editorRef.current?.getValue() ?? content)
      : content;
    void platform
      .saveDraft(docPath, current, mtimeMs ?? 0)
      .catch(() => undefined);
  }, [content, editorMounted, mtimeMs]);

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

    // 自动保存：停止输入 800ms 后触发（设置可关；冲突面板打开时暂停）。
    if (autoSave) {
      if (autoSaveTimer.current !== null) {
        window.clearTimeout(autoSaveTimer.current);
      }
      autoSaveTimer.current = window.setTimeout(() => {
        autoSaveTimer.current = null;
        void saveRef.current();
      }, 800);
    }

    // 草稿：每 2s 去抖落盘（崩溃恢复兜底）。
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current);
    }
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      writeDraft();
    }, 2000);
  }, [autoSave, markDirty, setContent, writeDraft]);

  useEffect(
    () => () => {
      if (syncTimer.current !== null) {
        window.clearTimeout(syncTimer.current);
      }
      if (autoSaveTimer.current !== null) {
        window.clearTimeout(autoSaveTimer.current);
      }
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
      if (draftTimer.current !== null) {
        window.clearTimeout(draftTimer.current);
      }
      if (docWatchId.current !== null) {
        void platform.unwatchPaths(docWatchId.current);
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
        if (event.shiftKey) {
          void exportHtml();
        } else {
          void toggleMode();
        }
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
    exportHtml,
    fontSize,
    openFile,
    printDocument,
    resetFontSize,
    save,
    setFontSize,
    toggleMode,
  ]);

  const ThemeIcon = THEME_ICON[theme];

  // 原生菜单等应用事件调用最新动作（ref 每次渲染刷新）。
  appActionsRef.current = {
    "open-file": () => void openFile(),
    "open-folder": () => void openFolder(),
    save: () => void save(),
    "export-html": () => void exportHtml(),
    print: () => void printDocument(),
    "toggle-mode": () => void toggleMode(),
  };

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
            title={`打开文件 (${key("openFile")})`}
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
            title={`切换阅读 / 源码 (${key("toggleMode")})`}
          >
            {mode === "read" ? <Pencil size={16} /> : <BookOpen size={16} />}
            {mode === "read" ? "源码" : "阅读"}
          </button>
          <button
            className="tool-btn"
            onClick={() => void save()}
            disabled={!path || !dirty}
            title={`保存 (${key("save")})`}
          >
            <Save size={16} />
            保存
          </button>
          <button
            className="tool-btn"
            onClick={() => void exportHtml()}
            disabled={!path || !render}
            title={`导出 HTML 单文件 (${key("exportHtml")})`}
          >
            <FileDown size={16} />
            导出
          </button>
          <button
            className="tool-btn"
            onClick={() => void printDocument()}
            disabled={!path || !render}
            title={`打印 / 导出 PDF (${key("print")})`}
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
              <kbd>{key("openFile")}</kbd>
            </div>
            <div className="shortcut-row">
              <span>阅读 / 源码</span>
              <kbd>{key("toggleMode")}</kbd>
            </div>
            <div className="shortcut-row">
              <span>保存</span>
              <kbd>{key("save")}</kbd>
            </div>
            <div className="shortcut-row">
              <span>导出 HTML</span>
              <kbd>{key("exportHtml")}</kbd>
            </div>
            <div className="shortcut-row">
              <span>打印 / PDF</span>
              <kbd>{key("print")}</kbd>
            </div>
          </section>
        </aside>

        {/* 侧栏拖宽手柄：pointer 事件 + Pointer Capture，宽度入设置持久化 */}
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (
              !(event.currentTarget as HTMLElement).hasPointerCapture(
                event.pointerId,
              )
            ) {
              return;
            }
            const workbench = event.currentTarget.parentElement;
            if (!workbench) return;
            const left = workbench.getBoundingClientRect().left;
            setSidebarWidth(event.clientX - left);
          }}
        />

        <main className="content">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={clearError}>关闭</button>
            </div>
          )}

          {conflict && (
            <div className="conflict-banner" role="alert">
              <span className="conflict-text">
                文件在其他程序中被修改，当前有未保存的更改。
              </span>
              <div className="conflict-actions">
                <button
                  className="primary-btn slim"
                  onClick={() => void resolveConflictOverwrite()}
                >
                  用我的版本覆盖
                </button>
                <button
                  className="text-btn"
                  onClick={() => void resolveConflictLoadDisk()}
                >
                  加载磁盘版本
                </button>
                <button
                  className="text-btn"
                  onClick={() => setConflict(null)}
                  title="保持现状，稍后手动处理"
                >
                  忽略
                </button>
              </div>
            </div>
          )}

          {draftPrompt && !conflict && (
            <div className="conflict-banner draft-banner" role="alert">
              <span className="conflict-text">
                发现未保存的草稿（比磁盘文件新），要恢复吗？
              </span>
              <div className="conflict-actions">
                <button
                  className="primary-btn slim"
                  onClick={() => void restoreDraft()}
                >
                  恢复草稿
                </button>
                <button className="text-btn" onClick={discardDraft}>
                  丢弃
                </button>
              </div>
            </div>
          )}

          {notice && !error && !conflict && (
            <div className="notice-banner" role="status">
              {notice}
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
                  largeFile={largeFile}
                  onChange={handleEditorChange}
                  onPasteImage={handlePasteImage}
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
              <p className="hint">
                {key("openFile")} 打开 · {key("toggleMode")} 切换 ·{" "}
                {key("save")} 保存
              </p>
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
          {largeFile && (
            <span
              className="mode-pill large-file"
              title="文档超过 2MB，已关闭代码高亮等装饰"
            >
              大文件
            </span>
          )}
          <span className="mode-pill">{mode === "read" ? "阅读" : "源码"}</span>
        </span>
      </footer>
    </div>
  );
}
