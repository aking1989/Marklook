import { create } from "zustand";
import type { VaultEntry } from "../platform/types";
import { platform } from "../platform";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

/** 相对 root 的父目录绝对路径；顶层返回 null。 */
function parentDirOf(absolutePath: string, prefix: string): string | null {
  const relative = absolutePath.slice(prefix.length);
  const slash = relative.lastIndexOf("/");
  if (slash <= 0) return null;
  return `${prefix}${relative.slice(0, slash)}`;
}

/** 由扫描结果构建树：目录在前，`第2章` 排在 `第10章` 前（数字感知排序）。 */
export function buildTree(entries: VaultEntry[], root: string): TreeNode[] {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const dirs = new Map<string, TreeNode>();
  const rootChildren: TreeNode[] = [];

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;

    const relative = dirPath.slice(prefix.length);
    const name = relative.split("/").pop() ?? dirPath;
    const node: TreeNode = { name, path: dirPath, isDir: true, children: [] };
    dirs.set(dirPath, node);

    const parentPath = parentDirOf(dirPath, prefix);
    if (parentPath) {
      const parent = ensureDir(parentPath);
      parent.children.push(node);
    } else {
      rootChildren.push(node);
    }
    return node;
  };

  // 第一遍：建立全部目录骨架（显式目录条目 + 文件路径隐含的中间目录）。
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    if (entry.isDir) {
      ensureDir(entry.path);
      continue;
    }
    const parent = parentDirOf(entry.path, prefix);
    if (parent) ensureDir(parent);
  }

  // 第二遍：挂文件。
  for (const entry of entries) {
    if (entry.isDir || !entry.path.startsWith(prefix)) continue;
    const node: TreeNode = {
      name: entry.name,
      path: entry.path,
      isDir: false,
      children: [],
    };
    const parent = parentDirOf(entry.path, prefix);
    if (parent) {
      dirs.get(parent)?.children.push(node);
    } else {
      rootChildren.push(node);
    }
  }

  const sortTree = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
    for (const node of nodes) sortTree(node.children);
    return nodes;
  };

  return sortTree(rootChildren);
}

interface WorkspaceState {
  root: string | null;
  tree: TreeNode[];
  truncated: boolean;
  scanning: boolean;
  error: string | null;
  expanded: Record<string, boolean>;
  openWorkspace: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  toggleDir: (path: string) => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  root: null,
  tree: [],
  truncated: false,
  scanning: false,
  error: null,
  expanded: {},

  async openWorkspace(root) {
    set({ scanning: true, error: null, root });
    try {
      const scan = await platform.scanVault(root, false);
      set({
        tree: buildTree(scan.entries, scan.root),
        truncated: scan.truncated,
        scanning: false,
        // 展开根下一层，给用户一个初始视野。
        expanded: firstLevelExpanded(scan.root, scan.entries),
      });
    } catch (caught) {
      set({ scanning: false, error: messageOf(caught), tree: [] });
    }
  },

  async refresh() {
    const { root } = get();
    if (!root) return;
    try {
      const scan = await platform.scanVault(root, false);
      set({
        tree: buildTree(scan.entries, scan.root),
        truncated: scan.truncated,
        error: null,
      });
    } catch (caught) {
      set({ error: messageOf(caught) });
    }
  },

  toggleDir(path) {
    const { expanded } = get();
    set({ expanded: { ...expanded, [path]: !expanded[path] } });
  },

  reset() {
    set({ root: null, tree: [], truncated: false, error: null, expanded: {} });
  },
}));

function firstLevelExpanded(root: string, entries: VaultEntry[]) {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const expanded: Record<string, boolean> = {};
  for (const entry of entries) {
    if (!entry.isDir) continue;
    const relative = entry.path.slice(prefix.length);
    if (relative.split("/").length === 1) expanded[entry.path] = true;
  }
  return expanded;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
