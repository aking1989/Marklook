import { beforeEach, describe, expect, it } from "vitest";
import type { VaultEntry } from "../../src/platform/types";
import { buildTree } from "../../src/stores/workspaceStore";
import { useRecentsStore } from "../../src/stores/recentsStore";

function entry(path: string, isDir: boolean): VaultEntry {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return { name, path, isDir, size: 10, mtimeMs: 1 };
}

describe("buildTree", () => {
  it("目录在前，数字感知排序", () => {
    const tree = buildTree(
      [
        entry("/ws/第10章.md", false),
        entry("/ws/第2章.md", false),
        entry("/ws/docs", true),
      ],
      "/ws",
    );

    expect(tree.map((node) => node.name)).toEqual([
      "docs",
      "第2章.md",
      "第10章.md",
    ]);
  });

  it("嵌套目录正确归位", () => {
    const tree = buildTree(
      [
        entry("/ws/a/b/deep.md", false),
        entry("/ws/a/top.md", false),
        entry("/ws/root.md", false),
      ],
      "/ws",
    );

    expect(tree.map((node) => node.name)).toEqual(["a", "root.md"]);
    const a = tree[0];
    expect(a?.children.map((node) => node.name)).toEqual(["b", "top.md"]);
    expect(a?.children[0]?.children[0]?.name).toBe("deep.md");
  });

  it("目录节点从文件路径自动推导", () => {
    const tree = buildTree([entry("/ws/x/y.md", false)], "/ws");
    expect(tree[0]?.isDir).toBe(true);
    expect(tree[0]?.name).toBe("x");
    expect(tree[0]?.children[0]?.name).toBe("y.md");
  });
});

describe("recentsStore", () => {
  beforeEach(() => {
    useRecentsStore.setState({ recentFiles: [], recentWorkspaces: [] });
  });

  it("最近文件去重并置顶", () => {
    const store = useRecentsStore.getState();
    store.pushFile("/a/one.md");
    store.pushFile("/a/two.md");
    useRecentsStore.getState().pushFile("/a/one.md");

    const files = useRecentsStore.getState().recentFiles;
    expect(files.map((entry) => entry.path)).toEqual([
      "/a/one.md",
      "/a/two.md",
    ]);
  });

  it("最近文件上限 20 条", () => {
    for (let index = 0; index < 25; index += 1) {
      useRecentsStore.getState().pushFile(`/a/f${index}.md`);
    }
    expect(useRecentsStore.getState().recentFiles.length).toBe(20);
    expect(useRecentsStore.getState().recentFiles[0]?.path).toBe("/a/f24.md");
  });

  it("移除最近文件", () => {
    useRecentsStore.getState().pushFile("/a/one.md");
    useRecentsStore.getState().removeFile("/a/one.md");
    expect(useRecentsStore.getState().recentFiles).toEqual([]);
  });
});
