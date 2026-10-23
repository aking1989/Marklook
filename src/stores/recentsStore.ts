import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentEntry {
  path: string;
  name: string;
  lastOpenedAt: number;
}

interface RecentsState {
  recentFiles: RecentEntry[];
  recentWorkspaces: RecentEntry[];
  pushFile: (path: string) => void;
  pushWorkspace: (path: string) => void;
  removeFile: (path: string) => void;
  removeWorkspace: (path: string) => void;
}

const MAX_FILES = 20;
const MAX_WORKSPACES = 10;

function push(list: RecentEntry[], path: string, cap: number): RecentEntry[] {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const next = [
    { path, name, lastOpenedAt: Date.now() },
    ...list.filter((entry) => entry.path !== path),
  ];
  return next.slice(0, cap);
}

export const useRecentsStore = create<RecentsState>()(
  persist(
    (set, get) => ({
      recentFiles: [],
      recentWorkspaces: [],

      pushFile: (path) =>
        set({ recentFiles: push(get().recentFiles, path, MAX_FILES) }),

      pushWorkspace: (path) =>
        set({
          recentWorkspaces: push(get().recentWorkspaces, path, MAX_WORKSPACES),
        }),

      removeFile: (path) =>
        set({
          recentFiles: get().recentFiles.filter((entry) => entry.path !== path),
        }),

      removeWorkspace: (path) =>
        set({
          recentWorkspaces: get().recentWorkspaces.filter(
            (entry) => entry.path !== path,
          ),
        }),
    }),
    { name: "marklook.recents" },
  ),
);
