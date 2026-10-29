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
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorState } from "@codemirror/state";
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
import { toPosixPath } from "./lib/docPath";
import { useRecentsStore } from "./stores/recentsStore";
import { activeTabOf, useTabsStore, type DocStatus } from "./stores/tabsStore";
import {
  fontStack,
  useSettingsStore,
  type Theme,
} from "./stores/settingsStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { runtimeOf, disposeRuntime } from "./features/tabs/tabRuntime";
import {
  saveEditorState,
  peekEditorState,
  takeEditorState,
  dropEditorState,
} from "./features/tabs/editorStateRegistry";

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
    case "conflict":
      return "有冲突";
    case "dirty":
      return dirty ? "未保存" : "已保存";
    case "clean":
      return "已保存";
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

/** 大文件判定（详细设计 §6.7）：>2MB 或 >25,000 行。 */
export function isLargeContent(content: string): boolean {
  return (
    content.length > 2 * 1024 * 1024 ||
    (content.match(/\n/g)?.length ?? 0) > 25_000
  );
}

export default function App() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const openTabInStore = useTabsStore((s) => s.openTab);
  const activateInStore = useTabsStore((s) => s.activate);
  const removeInStore = useTabsStore((s) => s.remove);
  const replaceInStore = useTabsStore((s) => s.replace);
  const updateTab = useTabsStore((s) => s.update);
  const getTab = useTabsStore((s) => s.get);

  const activeTab = useTabsStore((s) => activeTabOf(s));

  // 活动标签的派生状态（无标签时为空态）。
  const path = activeTab?.path ?? null;
  const content = activeTab?.content ?? "";
  const bom = activeTab?.bom ?? false;
  const mode = activeTab?.mode ?? "read";
  const status: DocStatus = activeTab?.status ?? "clean";
  const dirty = activeTab?.dirty ?? false;
  const render = activeTab?.render ?? null;
  const error = activeTab?.error ?? null;
  const conflict = activeTab?.conflict ?? null;
  const draftPrompt = activeTab?.draftPrompt ?? null;
  const editorMounted = mode === "edit";

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
  const [activeLine, setActiveLine] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreState, setRestoreState] = useState<EditorState | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const outlineListRef = useRef<HTMLUListElement>(null);
  const pendingEditLine = useRef(1);
  const pendingReadLine = useRef(1);
  const workspaceRefreshTimer = useRef<number | null>(null);
  /** 最近关闭的标签路径（⌘⇧T 重开，保留 10 个）。 */
  const closedTabsRef = useRef<string[]>([]);
  const appActionsRef = useRef<Record<string, () => void>>({});

  const showNotice = useCallback((message: string): void => {
    setNotice(message);
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 3000);
  }, []);

  // 启动时清理 7 天前的旧草稿。
  useEffect(() => {
    void platform.cleanupDrafts().catch(() => undefined);
  }, []);

  // 文件关联冷启动：打开命令行传入的 .md（多路径 = 多标签）。
  const openPathRef = useRef<(target: string) => Promise<void>>(
    async () => undefined,
  );
  const confirmQuitRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    void platform
      .takePendingOpen()
      .then((paths) => {
        for (const p of paths) void openPathRef.current(p);
      })
      .catch(() => undefined);
    // 仅启动时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 应用级事件：原生菜单 / 关闭确认 / macOS Opened 打开。
  useEffect(() => {
    const unsubscribe = platform.onAppEvent((event) => {
      if (event.type === "close-requested") {
        void confirmQuitRef.current();
        return;
      }
      if (event.type === "open-paths") {
        for (const p of event.paths) void openPathRef.current(p);
        return;
      }
      const handler = appActionsRef.current[event.action];
      if (handler) handler();
    });
    return unsubscribe;
  }, []);

  /** 标签切换流程（设计 §6.2）：flush → 快照 → 激活 → 恢复。 */
  const activateTabId = useCallback(
    (id: string) => {
      const state = useTabsStore.getState();
      if (state.activeId === id) return;
      const prevId = state.activeId;

      if (prevId !== null) {
        // flush：syncTimer 清 + 编辑器内容写回
        const prevRuntime = runtimeOf(prevId);
        if (prevRuntime.syncTimer !== null) {
          window.clearTimeout(prevRuntime.syncTimer);
          prevRuntime.syncTimer = null;
        }
        const prevTab = state.get(prevId);
        const editorLive =
          editorRef.current !== null && prevTab?.mode === "edit";
        if (editorLive && editorRef.current) {
          const value = editorRef.current.getValue();
          if (value !== prevTab?.content) {
            updateTab(prevId, { content: value });
          }
          // EditorState（含撤销历史）存注册表；视图快照进标签
          saveEditorState(prevId, editorRef.current.getState());
        }
        updateTab(prevId, {
          readLine: prevRuntime.readLine,
          readScrollTop: prevRuntime.readScrollTop,
          editLine:
            editorLive && editorRef.current
              ? editorRef.current.getCursorLine()
              : (prevTab?.editLine ?? 1),
        });
      }

      activateInStore(id);

      // 恢复新标签：edit 模式恢复 EditorState（编辑器已挂载则原地交换，
      // 未挂载则经 restoreState 供挂载时采用）。
      const next = useTabsStore.getState().get(id);
      if (next?.mode === "edit") {
        if (editorRef.current) {
          const state = takeEditorState(id);
          if (state) editorRef.current.setState(state);
          editorRef.current.focus();
        } else {
          setRestoreState(peekEditorState(id) ?? null);
        }
      }
    },
    [activateInStore, updateTab],
  );

  // ---- 保存 ----
  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = getTab(tabId);
      if (!tab || !tab.path || tab.conflict) return false;

      // 编辑器是该标签且活动时，内容以编辑器为准（flush）。
      const editorLive =
        useTabsStore.getState().activeId === tabId &&
        tab.mode === "edit" &&
        editorRef.current !== null;
      const nextContent = editorLive
        ? (editorRef.current?.getValue() ?? tab.content)
        : tab.content;

      if (nextContent === tab.savedContent) {
        updateTab(tabId, { dirty: false, status: "clean" });
        return true;
      }

      updateTab(tabId, { status: "saving" });
      try {
        const result = await platform.writeDocument(tab.path, nextContent, {
          expectedMtimeMs: tab.mtimeMs,
          eol: tab.eol,
          bom: tab.bom,
        });
        runtimeOf(tabId).lastWrittenAt = Date.now();
        updateTab(tabId, {
          content: nextContent,
          savedContent: nextContent,
          mtimeMs: result.mtimeMs,
          dirty: false,
          status: "clean",
          error: null,
        });
        void platform.clearDraft(tab.path).catch(() => undefined);
        return true;
      } catch (caught) {
        // 保存撞上外部修改：读磁盘内容进入冲突面板，而不是覆盖提示。
        if (caught instanceof PlatformError && caught.code === "CONFLICT") {
          try {
            const disk = await platform.readDocument(tab.path);
            updateTab(tabId, {
              conflict: {
                diskContent: disk.content,
                diskMtimeMs: disk.mtimeMs,
              },
              status: "conflict",
            });
            return false;
          } catch {
            // 读取失败则走通用错误提示。
          }
        }
        updateTab(tabId, { error: errorMessage(caught), status: "error" });
        return false;
      }
    },
    [getTab, updateTab],
  );

  const save = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    if (id === null) return;
    await saveTab(id);
  }, [saveTab]);

  // ---- 单文档监听（每标签一个，存 tabRuntime） ----
  const restartDocWatch = useCallback(
    async (tabId: string, docPath: string): Promise<void> => {
      const runtime = runtimeOf(tabId);
      if (runtime.watchId !== null) {
        await platform.unwatchPaths(runtime.watchId).catch(() => undefined);
        runtime.watchId = null;
      }
      const parent = dirnameOf(docPath);
      if (!parent) return;
      try {
        runtime.watchId = await platform.watchPaths([parent], {
          recursive: false,
          markdownOnly: false,
          targetFile: docPath.replace(/\\/g, "/").split("/").pop(),
        });
      } catch {
        // 监听不可用（网络盘等）：降级为工作区刷新。
      }
    },
    [],
  );

  // ---- 打开（设计 §7.1） ----
  const openPath = useCallback(
    async (
      target: string,
      options?: {
        gotoLine?: number;
        /** 当前标签内替换（文档内相对链接的默认行为）。 */
        replaceCurrent?: boolean;
      },
    ) => {
      const normalized = toPosixPath(target);
      const state = useTabsStore.getState();
      const existing = state.findByPath(normalized);

      // 已打开：激活并定位（不产生重复标签）。
      if (existing && !options?.replaceCurrent) {
        activateTabId(existing.id);
        revealPath(normalized);
        if (options?.gotoLine) {
          pendingReadLine.current = options.gotoLine;
          const tab = useTabsStore.getState().get(existing.id);
          requestAnimationFrame(() => {
            if (tab?.mode === "read") {
              readerRef.current?.scrollToLine(options.gotoLine as number);
            } else {
              editorRef.current?.scrollToLine(options.gotoLine as number);
            }
          });
        }
        return;
      }

      // 当前标签内替换：唯一的脏检查点（新标签不覆盖任何未保存内容）。
      if (options?.replaceCurrent) {
        const current = useTabsStore.getState().activeId;
        const cur = current !== null ? state.get(current) : undefined;
        if (cur?.dirty && path && cur.path === path) {
          if (!window.confirm("当前文档有未保存的修改，仍要打开其他文件吗？")) {
            return;
          }
        }
      }

      try {
        const d = await platform.readDocument(target);
        const rendered = await renderMarkdown({
          source: d.content,
          docPath: d.path,
          resolveAsset: platform.toAssetUrl,
          options: {
            allowRemoteImages,
            theme,
            largeFileMode: isLargeContent(d.content),
          },
        });

        let tabId: string;
        if (options?.replaceCurrent && state.activeId !== null) {
          // 当前标签内替换：旧文件的运行时资源整体清理。
          disposeRuntime(state.activeId, (wid) =>
            platform.unwatchPaths(wid).catch(() => undefined),
          );
          replaceInStore(state.activeId, d, rendered);
          tabId = state.activeId;
        } else {
          const opened = openTabInStore(d, rendered);
          tabId = opened.id;
        }

        pendingReadLine.current = options?.gotoLine ?? 1;
        void restartDocWatch(tabId, d.path);
        revealPath(toPosixPath(d.path));
        pushFile(d.path);
        if (d.size > 512 * 1024) {
          showNotice("大文档渲染可能较慢");
        }

        // 草稿比磁盘新且内容不同时提示恢复。
        try {
          const draft = await platform.loadDraft(d.path);
          if (
            draft &&
            draft.savedAt > d.mtimeMs &&
            draft.content !== d.content
          ) {
            updateTab(tabId, { draftPrompt: { content: draft.content } });
          }
        } catch {
          // 草稿读取失败不影响打开。
        }
      } catch (caught) {
        const message = errorMessage(caught);
        const activeNow = useTabsStore.getState().activeId;
        if (activeNow !== null) {
          updateTab(activeNow, { error: message });
        } else {
          // 无打开文档时错误无处挂（如「最近」里的失效条目），用通知显示。
          showNotice(`打开失败：${message}`);
        }
      }
    },
    [
      activateTabId,
      allowRemoteImages,
      openTabInStore,
      path,
      pushFile,
      replaceInStore,
      restartDocWatch,
      revealPath,
      showNotice,
      theme,
      updateTab,
    ],
  );

  const openFile = useCallback(async () => {
    try {
      const picked = await platform.pickFile();
      if (picked) {
        await openPath(picked);
      }
    } catch (caught) {
      const activeNow = useTabsStore.getState().activeId;
      if (activeNow !== null) {
        updateTab(activeNow, { error: errorMessage(caught) });
      }
    }
  }, [openPath, updateTab]);

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
      showNotice(errorMessage(caught));
    }
  }, [openWorkspace, pushWorkspace]);

  // ---- 外部变更路由（设计 §7.4）：按标签路径分发，剩余走工作区刷新 ----
  const handleExternalChangeForRef = useRef<(tabId: string) => void>(
    () => undefined,
  );
  useEffect(() => {
    const unsubscribe = platform.onFsChange((event) => {
      const state = useTabsStore.getState();
      const touched = state.tabs.filter((tab) =>
        event.paths.some((changed) => toPosixPath(changed) === tab.path),
      );
      for (const tab of touched) {
        handleExternalChangeForRef.current(tab.id);
      }
      const others = event.paths.filter(
        (changed) =>
          !state.tabs.some((tab) => tab.path === toPosixPath(changed)),
      );
      if (others.length > 0 || touched.length === 0) {
        if (workspaceRefreshTimer.current !== null) return;
        workspaceRefreshTimer.current = window.setTimeout(() => {
          workspaceRefreshTimer.current = null;
          void refreshWorkspace();
        }, 500);
      }
    });
    return () => {
      unsubscribe();
      if (workspaceRefreshTimer.current !== null) {
        window.clearTimeout(workspaceRefreshTimer.current);
      }
    };
  }, [refreshWorkspace]);

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

  // ---- 关闭标签（设计 §7.2）----
  const closeTabById = useCallback(
    async (id: string): Promise<boolean> => {
      const tab = getTab(id);
      if (!tab) return true;

      if (tab.dirty) {
        const saveAndClose = window.confirm(
          `「${tab.title}」有未保存的修改，保存后关闭吗？\n\n确定 = 保存并关闭\n取消 = 继续选择`,
        );
        if (saveAndClose) {
          const ok = await saveTab(id);
          if (!ok) return false;
        } else {
          const discard = window.confirm(
            `放弃「${tab.title}」的未保存修改并关闭吗？\n\n确定 = 放弃修改并关闭\n取消 = 不关闭`,
          );
          if (!discard) return false;
        }
      }

      // 关闭前 flush 同步计时器（设计 §7.2：避免"关掉了但草稿还留着"）。
      const runtime = runtimeOf(id);
      if (runtime.syncTimer !== null) {
        window.clearTimeout(runtime.syncTimer);
        runtime.syncTimer = null;
      }

      disposeRuntime(id, (wid) =>
        platform.unwatchPaths(wid).catch(() => undefined),
      );
      await platform.clearDraft(tab.path).catch(() => undefined);
      removeInStore(id);

      // 记录到重开列表（⌘⇧T）。
      closedTabsRef.current = [
        tab.path,
        ...closedTabsRef.current.filter((p) => p !== tab.path),
      ].slice(0, 10);
      return true;
    },
    [getTab, removeInStore, saveTab],
  );

  const reopenClosedTab = useCallback(() => {
    const [last, ...rest] = closedTabsRef.current;
    if (!last) return;
    closedTabsRef.current = rest;
    void openPath(last);
  }, [openPath]);

  // ---- 窗口关闭：对所有脏标签汇总确认（设计 §7.3）----
  const confirmAndCloseWindow = useCallback(async () => {
    const dirtyTabs = useTabsStore.getState().tabs.filter((tab) => tab.dirty);

    if (dirtyTabs.length > 0) {
      const names = dirtyTabs.map((tab) => tab.title).join("、");
      const saveAll = window.confirm(
        `有 ${dirtyTabs.length} 个标签未保存：${names}\n\n全部保存并关闭吗？`,
      );
      if (saveAll) {
        for (const tab of dirtyTabs) {
          const ok = await saveTab(tab.id);
          if (!ok) {
            activateInStore(tab.id);
            showNotice(`「${tab.title}」保存失败，已停止关闭`);
            return;
          }
        }
      } else {
        const discardAll = window.confirm("放弃所有未保存的修改并关闭窗口吗？");
        if (!discardAll) return;
      }
    }
    await platform.closeWindow();
  }, [activateInStore, saveTab, showNotice]);

  // ---- 外部变更矩阵（设计 §11.3，按标签） ----
  const handleExternalChangeFor = useCallback(
    async (tabId: string) => {
      const tab = getTab(tabId);
      if (!tab || tab.conflict) return;
      const runtime = runtimeOf(tabId);
      if (Date.now() - runtime.lastWrittenAt < 2000) return;

      try {
        const disk = await platform.readDocument(tab.path);
        if (disk.mtimeMs === tab.mtimeMs) return;

        const isLive =
          useTabsStore.getState().activeId === tabId &&
          tab.mode === "edit" &&
          editorRef.current !== null;
        const current = isLive
          ? (editorRef.current?.getValue() ?? tab.content)
          : tab.content;

        if (current === disk.content) {
          updateTab(tabId, {
            savedContent: disk.content,
            mtimeMs: disk.mtimeMs,
            dirty: false,
            status: "clean",
          });
          if (useTabsStore.getState().activeId === tabId) {
            showNotice("文件已在其他程序中修改（内容一致，已同步）");
          }
          return;
        }

        const rendered = await renderMarkdown({
          source: disk.content,
          docPath: tab.path,
          resolveAsset: platform.toAssetUrl,
          options: {
            allowRemoteImages,
            theme,
            largeFileMode: isLargeContent(disk.content),
          },
        });

        if (!tab.dirty) {
          // 干净：静默重载（活动标签保持阅读位置；后台标签切回即见新内容）。
          updateTab(tabId, {
            content: disk.content,
            savedContent: disk.content,
            mtimeMs: disk.mtimeMs,
            render: rendered,
            status: "clean",
          });
          // 内容已变，旧撤销历史失去意义。
          dropEditorState(tabId);
          if (useTabsStore.getState().activeId === tabId) {
            showNotice("文件已更新");
          }
          return;
        }

        // 脏（前台或后台）：标记冲突；后台标签切回时展示冲突面板，标签栏有红点。
        updateTab(tabId, {
          conflict: {
            diskContent: disk.content,
            diskMtimeMs: disk.mtimeMs,
          },
          status: "conflict",
        });
      } catch {
        // 读取失败：保持现状，等下一次事件。
      }
    },
    [allowRemoteImages, getTab, showNotice, theme, updateTab],
  );
  handleExternalChangeForRef.current = (tabId) =>
    void handleExternalChangeFor(tabId);

  // ---- 冲突解决（按活动标签） ----
  const resolveConflictOverwrite = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab || !tab.conflict) return;
    const current =
      tab.mode === "edit" && editorRef.current
        ? (editorRef.current.getValue() ?? tab.content)
        : tab.content;
    try {
      const result = await platform.writeDocument(tab.path, current, {
        expectedMtimeMs: tab.conflict.diskMtimeMs,
        force: true,
        eol: tab.eol,
        bom: tab.bom,
      });
      runtimeOf(id as string).lastWrittenAt = Date.now();
      updateTab(id as string, {
        content: current,
        savedContent: current,
        mtimeMs: result.mtimeMs,
        dirty: false,
        status: "clean",
        conflict: null,
      });
      void platform.clearDraft(tab.path).catch(() => undefined);
      showNotice("已用当前内容覆盖磁盘文件");
    } catch (caught) {
      updateTab(id as string, { error: errorMessage(caught) });
    }
  }, [getTab, showNotice, updateTab]);

  const resolveConflictLoadDisk = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab || !tab.conflict) return;
    try {
      const rendered = await renderMarkdown({
        source: tab.conflict.diskContent,
        docPath: tab.path,
        resolveAsset: platform.toAssetUrl,
        options: {
          allowRemoteImages,
          theme,
          largeFileMode: isLargeContent(tab.conflict.diskContent),
        },
      });
      dropEditorState(id as string);
      updateTab(id as string, {
        content: tab.conflict.diskContent,
        savedContent: tab.conflict.diskContent,
        mtimeMs: tab.conflict.diskMtimeMs,
        render: rendered,
        dirty: false,
        status: "clean",
        conflict: null,
        mode: "read",
        readLine: 1,
        readScrollTop: 0,
      });
      showNotice("已加载磁盘版本（本地修改已放弃）");
    } catch (caught) {
      updateTab(id as string, { error: errorMessage(caught) });
    }
  }, [allowRemoteImages, getTab, showNotice, theme, updateTab]);

  // ---- 草稿恢复（按活动标签） ----
  const restoreDraft = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab || !tab.draftPrompt) return;
    try {
      const rendered = await renderMarkdown({
        source: tab.draftPrompt.content,
        docPath: tab.path,
        resolveAsset: platform.toAssetUrl,
        options: {
          allowRemoteImages,
          theme,
          largeFileMode: isLargeContent(tab.draftPrompt.content),
        },
      });
      updateTab(id as string, {
        content: tab.draftPrompt.content,
        dirty: true,
        status: "dirty",
        render: rendered,
        draftPrompt: null,
      });
      showNotice("已恢复未保存的草稿");
    } catch (caught) {
      updateTab(id as string, { error: errorMessage(caught) });
    }
  }, [allowRemoteImages, getTab, showNotice, theme, updateTab]);

  const discardDraft = useCallback(() => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (tab) {
      void platform.clearDraft(tab.path).catch(() => undefined);
      updateTab(tab.id, { draftPrompt: null });
    }
  }, [getTab, updateTab]);

  // ---- 模式切换（按活动标签） ----
  const toggleMode = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab || !tab.render) return;

    if (tab.mode === "read") {
      pendingEditLine.current = readerRef.current?.getTopLine() ?? 1;
      updateTab(id as string, {
        mode: "edit",
        editLine: pendingEditLine.current,
      });
      // 编辑器挂载后恢复 EditorState（若该标签之前编辑过）并聚焦。
      setRestoreState(peekEditorState(id as string) ?? null);
      return;
    }

    // edit → read：flush + 保存 EditorState + 渲染。
    if (editorRef.current) {
      const value = editorRef.current.getValue();
      if (value !== tab.content) {
        updateTab(id as string, { content: value });
      }
      saveEditorState(id as string, editorRef.current.getState());
      pendingReadLine.current = editorRef.current.getCursorLine();
    }
    const currentContent = getTab(id as string)?.content ?? "";

    try {
      const rendered = await renderMarkdown({
        source: currentContent,
        docPath: tab.path,
        resolveAsset: platform.toAssetUrl,
        options: {
          allowRemoteImages,
          theme,
          largeFileMode: isLargeContent(currentContent),
        },
      });
      updateTab(id as string, {
        render: rendered,
        mode: "read",
        status: getTab(id as string)?.dirty ? "dirty" : "clean",
      });
    } catch (caught) {
      updateTab(id as string, { error: errorMessage(caught), mode: "read" });
    }
  }, [allowRemoteImages, getTab, showNotice, theme, updateTab]);

  // ---- 打印（活动标签；源码模式先渲染并切回阅读） ----
  const printDocument = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab || !tab.render) return;

    if (tab.mode === "edit" && editorRef.current) {
      pendingReadLine.current = editorRef.current.getCursorLine();
      const nextContent = editorRef.current.getValue();
      updateTab(id as string, { content: nextContent });
      try {
        const rendered = await renderMarkdown({
          source: nextContent,
          docPath: tab.path,
          resolveAsset: platform.toAssetUrl,
          options: {
            allowRemoteImages,
            theme,
            largeFileMode: isLargeContent(nextContent),
          },
        });
        updateTab(id as string, { render: rendered, mode: "read" });
      } catch (caught) {
        updateTab(id as string, { error: errorMessage(caught) });
        return;
      }
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
      updateTab(id as string, { error: errorMessage(caught) });
    }
  }, [allowRemoteImages, getTab, theme, updateTab]);

  // ---- 导出 HTML（活动标签） ----
  const exportHtml = useCallback(async () => {
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab || !tab.render) return;

    if (tab.mode === "edit" && editorRef.current) {
      pendingReadLine.current = editorRef.current.getCursorLine();
      const nextContent = editorRef.current.getValue();
      updateTab(id as string, { content: nextContent });
      try {
        const rendered = await renderMarkdown({
          source: nextContent,
          docPath: tab.path,
          resolveAsset: platform.toAssetUrl,
          options: {
            allowRemoteImages,
            theme,
            largeFileMode: isLargeContent(nextContent),
          },
        });
        updateTab(id as string, { render: rendered, mode: "read" });
      } catch (caught) {
        updateTab(id as string, { error: errorMessage(caught) });
        return;
      }
      await nextPaint();
    }

    try {
      const article = document.querySelector<HTMLElement>(".md-body");
      if (!article) return;
      await waitForRenderedFigures(article);

      const title =
        useTabsStore.getState().get(id as string)?.render?.title ?? tab.title;
      const html = await buildStandaloneHtml(article, title, theme);
      const defaultName = `${fileName(tab.path).replace(/\.md$/i, "")}.html`;
      const savedTo = await platform.exportSaveHtml(defaultName, html);
      if (savedTo) {
        showNotice(`已导出：${fileName(savedTo)}`);
      }
    } catch (caught) {
      updateTab(id as string, { error: errorMessage(caught) });
    }
  }, [allowRemoteImages, getTab, showNotice, theme, updateTab]);

  // ---- 编辑器事件（按活动标签路由到 runtime） ----
  const saveRef = useRef<(tabId: string) => Promise<boolean>>(
    async () => false,
  );
  saveRef.current = saveTab;

  const writeDraftFor = useCallback(
    (tabId: string) => {
      const tab = getTab(tabId);
      if (!tab) return;
      void platform
        .saveDraft(tab.path, tab.content, tab.mtimeMs ?? 0)
        .catch(() => undefined);
    },
    [getTab],
  );

  /** 粘贴/拖入图片：保存到活动文档的 assets/ 并返回相对路径。 */
  const handlePasteImage = useCallback(
    async (
      suggestedName: string,
      bytes: Uint8Array,
    ): Promise<string | null> => {
      const id = useTabsStore.getState().activeId;
      const tab = id !== null ? getTab(id) : undefined;
      if (!tab) {
        showNotice("请先打开或保存文档，再粘贴图片");
        return null;
      }
      try {
        const result = await platform.saveAsset(tab.path, suggestedName, bytes);
        return result.relativePath;
      } catch (caught) {
        updateTab(id as string, { error: errorMessage(caught) });
        return null;
      }
    },
    [getTab, updateTab],
  );

  const handleEditorChange = useCallback(() => {
    const id = useTabsStore.getState().activeId;
    if (id === null) return;
    const tab = getTab(id);
    if (!tab || tab.mode !== "edit") return;

    updateTab(id, { dirty: true, status: "dirty" });

    const runtime = runtimeOf(id);
    if (runtime.syncTimer !== null) {
      window.clearTimeout(runtime.syncTimer);
    }
    runtime.syncTimer = window.setTimeout(() => {
      runtime.syncTimer = null;
      const value = editorRef.current?.getValue();
      if (value !== undefined) {
        updateTab(id, { content: value });
      }
    }, 300);

    // 自动保存：停止输入 800ms 后触发（设计 §3.4；后台标签照常）。
    if (autoSave) {
      if (runtime.autoSaveTimer !== null) {
        window.clearTimeout(runtime.autoSaveTimer);
      }
      runtime.autoSaveTimer = window.setTimeout(() => {
        runtime.autoSaveTimer = null;
        void saveRef.current(id);
      }, 800);
    }

    // 草稿：每 2s 去抖落盘（崩溃恢复兜底）。
    if (runtime.draftTimer !== null) {
      window.clearTimeout(runtime.draftTimer);
    }
    runtime.draftTimer = window.setTimeout(() => {
      runtime.draftTimer = null;
      writeDraftFor(id);
    }, 2000);
  }, [autoSave, getTab, updateTab, writeDraftFor]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
      if (workspaceRefreshTimer.current !== null) {
        window.clearTimeout(workspaceRefreshTimer.current);
      }
      // 卸载时清理所有标签的运行时（测试/HMR 场景）。
      for (const tab of useTabsStore.getState().tabs) {
        disposeRuntime(tab.id, (wid) =>
          platform.unwatchPaths(wid).catch(() => undefined),
        );
      }
    };
  }, []);

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

  // ---- 快捷键（设计 §8） ----
  const nextTab = useCallback(() => {
    const state = useTabsStore.getState();
    if (state.activeId === null || state.tabs.length < 2) return;
    const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
    const next = state.tabs[(index + 1) % state.tabs.length];
    if (next) activateTabId(next.id);
  }, [activateTabId]);

  const prevTab = useCallback(() => {
    const state = useTabsStore.getState();
    if (state.activeId === null || state.tabs.length < 2) return;
    const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
    const prev =
      state.tabs[(index - 1 + state.tabs.length) % state.tabs.length];
    if (prev) activateTabId(prev.id);
  }, [activateTabId]);

  const activateTabByIndex = useCallback(
    (n: number) => {
      const state = useTabsStore.getState();
      // 第 9 个为"最后一个标签"。
      const index = n >= state.tabs.length ? state.tabs.length - 1 : n - 1;
      const tab = state.tabs[index];
      if (tab) activateTabId(tab.id);
    },
    [activateTabId],
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
      } else if (key === "w") {
        // 关标签：阻止系统默认的关窗口（macOS）。
        event.preventDefault();
        const id = useTabsStore.getState().activeId;
        if (id !== null) void closeTabById(id);
      } else if (key === "t" && event.shiftKey) {
        event.preventDefault();
        reopenClosedTab();
      } else if (event.key === "]" && event.shiftKey) {
        event.preventDefault();
        nextTab();
      } else if (event.key === "[" && event.shiftKey) {
        event.preventDefault();
        prevTab();
      } else if (event.key === "Tab") {
        // Ctrl+Tab / Ctrl+Shift+Tab（Windows/Linux 惯例）。
        event.preventDefault();
        if (event.shiftKey) {
          prevTab();
        } else {
          nextTab();
        }
      } else if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        activateTabByIndex(Number(event.key));
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
    activateTabByIndex,
    closeTabById,
    exportHtml,
    fontSize,
    nextTab,
    openFile,
    prevTab,
    printDocument,
    reopenClosedTab,
    resetFontSize,
    save,
    setFontSize,
    toggleMode,
  ]);

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

  // 外观设置 → 根元素 CSS 变量（排版与侧栏即时生效）。
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

  // 窗口标题跟随活动标签（设计 §9.1）。
  useEffect(() => {
    const title = render?.title ? `${render.title} · 墨览` : "墨览";
    document.title = title;
    if (isTauriRuntime) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      );
    }
  }, [render?.title, activeId]);

  // 远程图片策略影响渲染产物：设置变化时对活动标签内容重渲染。
  const policyFirstRun = useRef(true);
  useEffect(() => {
    if (policyFirstRun.current) {
      policyFirstRun.current = false;
      return;
    }
    const id = useTabsStore.getState().activeId;
    const tab = id !== null ? getTab(id) : undefined;
    if (!tab) return;

    const source =
      tab.mode === "edit" && editorRef.current
        ? (editorRef.current.getValue() ?? tab.content)
        : tab.content;
    void renderMarkdown({
      source,
      docPath: tab.path,
      resolveAsset: platform.toAssetUrl,
      options: {
        allowRemoteImages,
        theme,
        largeFileMode: isLargeContent(source),
      },
    })
      .then((next) => updateTab(id as string, { render: next }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowRemoteImages]);

  // 大纲跟随：取"行号 <= 当前行"的最后一个标题；滚动快照写 runtime（高频）。
  const handleViewportChange = useCallback(
    (line: number, scrollTop: number) => {
      setActiveLine(line);
      const id = useTabsStore.getState().activeId;
      if (id === null) return;
      const runtime = runtimeOf(id);
      runtime.readLine = line;
      runtime.readScrollTop = scrollTop;
    },
    [],
  );

  const largeFile = useMemo(() => isLargeContent(content), [content]);
  const ThemeIcon = THEME_ICON[theme];
  const hasTabs = tabs.length > 0;

  // ref 每次渲染刷新，事件订阅与冷启动始终调用最新实现。
  openPathRef.current = openPath;
  confirmQuitRef.current = confirmAndCloseWindow;

  // 原生菜单等应用事件调用最新动作（ref 每次渲染刷新）。
  appActionsRef.current = {
    "open-file": () => void openFile(),
    "open-folder": () => void openFolder(),
    save: () => void save(),
    "export-html": () => void exportHtml(),
    print: () => void printDocument(),
    "toggle-mode": () => void toggleMode(),
    "close-tab": () => {
      const id = useTabsStore.getState().activeId;
      if (id !== null) void closeTabById(id);
    },
    "reopen-tab": () => reopenClosedTab(),
  };

  return (
    <div className="app-shell">
      {/* 顶栏合并：标签 + ＋ + 工具栏，取代原来的「标题栏 + 标签栏」两行。
          文档标题已经由窗口标题（`xxx · 墨览`）和活动标签承载，不再单独占一行。 */}
      <div className={"tab-bar-row" + (hasTabs ? " has-tabs" : "")}>
        {hasTabs && (
          /* tablist 的直接子元素必须全是 tab：＋ 按钮放在 tablist 外 */
          <div className="tab-bar" role="tablist" aria-label="打开的文档">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                role="tab"
                aria-selected={tab.id === activeId}
                aria-controls="tab-panel"
                tabIndex={tab.id === activeId ? 0 : -1}
                className={
                  "tab" +
                  (tab.id === activeId ? " active" : "") +
                  (tab.conflict ? " has-conflict" : "")
                }
                onClick={() => activateTabId(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === "Delete") {
                    event.stopPropagation();
                    void closeTabById(tab.id);
                  }
                }}
                title={tab.path}
              >
                <span
                  className={
                    "tab-dot" +
                    (tab.conflict ? " conflict" : tab.dirty ? " dirty" : "")
                  }
                  aria-label={
                    tab.conflict
                      ? `${tab.title} 有冲突`
                      : tab.dirty
                        ? `${tab.title} 未保存`
                        : undefined
                  }
                />
                <span className="tab-name">{tab.title}</span>
                {/* 键盘关闭走 tab 的 Delete（WAI-ARIA tabs 扩展惯例）；
                  span 不构成嵌套交互元素，axe nested-interactive 通过 */}
                <span
                  className="tab-close"
                  role="presentation"
                  title={`关闭 ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTabById(tab.id);
                  }}
                >
                  <X size={12} />
                </span>
              </div>
            ))}
          </div>
        )}
        {hasTabs && (
          <button
            className="tab-add"
            onClick={() => void openFile()}
            aria-label="打开文件到新标签"
            title={`打开文件到新标签 (${key("openFile")})`}
          >
            ＋
          </button>
        )}
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
      </div>

      <div className="workbench" id="tab-panel">
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
            <div className="shortcut-row">
              <span>关闭标签</span>
              <kbd>{key("closeTab")}</kbd>
            </div>
            <div className="shortcut-row">
              <span>上 / 下一个标签</span>
              <kbd>{isMac ? "⌘⇧[ ]" : "Ctrl+Tab"}</kbd>
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
              <button
                onClick={() => {
                  if (activeId !== null) {
                    updateTab(activeId, { error: null });
                  }
                }}
              >
                关闭
              </button>
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
                  onClick={() => {
                    if (activeId !== null) {
                      updateTab(activeId, { conflict: null });
                    }
                  }}
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

          {activeTab && render ? (
            <>
              <ReaderView
                key={activeTab.id}
                ref={readerRef}
                html={render.html}
                hidden={mode === "edit"}
                theme={theme}
                outline={render.outline}
                onOpenInternalDoc={(docPath, { newTab }) =>
                  void openPath(docPath, newTab ? {} : { replaceCurrent: true })
                }
                onViewportChange={handleViewportChange}
                initialScroll={{
                  line: activeTab.readLine,
                  scrollTop: activeTab.readScrollTop,
                }}
              />
              {editorMounted && (
                <EditorViewHost
                  ref={editorRef}
                  initialValue={content}
                  restoreState={restoreState}
                  visible={mode === "edit"}
                  theme={theme}
                  largeFile={largeFile}
                  onChange={handleEditorChange}
                  onPasteImage={handlePasteImage}
                />
              )}
            </>
          ) : activeTab ? (
            <div className="empty-doc">正在打开…</div>
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
