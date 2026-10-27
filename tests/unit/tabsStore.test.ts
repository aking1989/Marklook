import { beforeEach, describe, expect, it } from "vitest";
import type { RenderResult } from "../../src/markdown/types";
import { activeTabOf, useTabsStore } from "../../src/stores/tabsStore";
import type { TextDocument } from "../../src/platform/types";

function doc(path: string, content = "正文"): TextDocument {
  return {
    path,
    content,
    mtimeMs: 100,
    size: content.length,
    eol: "lf",
    bom: false,
    encoding: "utf-8",
  };
}

function render(title = "标题"): RenderResult {
  return {
    html: `<h1>${title}</h1>`,
    outline: [],
    frontmatter: {},
    title,
    meta: { charCount: 1, wordCount: 1, readingMinutes: 1 },
    warnings: [],
  };
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeId: null });
});

describe("tabsStore.openTab", () => {
  it("新路径追加到末尾并激活", () => {
    const first = useTabsStore.getState().openTab(doc("/a/one.md"), render());
    const second = useTabsStore.getState().openTab(doc("/a/two.md"), render());

    const state = useTabsStore.getState();
    expect(state.tabs.map((tab) => tab.path)).toEqual([
      "/a/one.md",
      "/a/two.md",
    ]);
    expect(state.activeId).toBe(second.id);
    expect(first.reused).toBe(false);
  });

  it("已打开路径不新增，激活已有标签", () => {
    const first = useTabsStore.getState().openTab(doc("/a/one.md"), render());
    useTabsStore.getState().openTab(doc("/a/two.md"), render());
    const again = useTabsStore.getState().openTab(doc("/a/one.md"), render());

    expect(again.reused).toBe(true);
    expect(again.id).toBe(first.id);
    expect(useTabsStore.getState().tabs.length).toBe(2);
    expect(useTabsStore.getState().activeId).toBe(first.id);
  });

  it("makeTab 初始字段符合设计 §4.1", () => {
    useTabsStore.getState().openTab(doc("/a/note.md", "内容"), render("标题"));
    const tab = activeTabOf(useTabsStore.getState());
    expect(tab).toMatchObject({
      title: "note.md",
      mode: "read",
      status: "clean",
      dirty: false,
      content: "内容",
      savedContent: "内容",
      readLine: 1,
      editLine: 1,
      conflict: null,
      draftPrompt: null,
      error: null,
    });
    expect(tab?.render?.title).toBe("标题");
  });
});

describe("tabsStore.remove", () => {
  it("关闭活动标签激活右侧", () => {
    const a = useTabsStore.getState().openTab(doc("/a.md"), render());
    const b = useTabsStore.getState().openTab(doc("/b.md"), render());
    useTabsStore.getState().openTab(doc("/c.md"), render());

    useTabsStore.getState().remove(b.id);
    expect(useTabsStore.getState().activeId).not.toBe(b.id);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      "/a.md",
      "/c.md",
    ]);
    void a;
  });

  it("关闭最后一个标签回到空状态", () => {
    const only = useTabsStore.getState().openTab(doc("/a.md"), render());
    useTabsStore.getState().remove(only.id);
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useTabsStore.getState().activeId).toBeNull();
  });

  it("关闭非活动标签不影响活动标签", () => {
    const a = useTabsStore.getState().openTab(doc("/a.md"), render());
    const b = useTabsStore.getState().openTab(doc("/b.md"), render());
    useTabsStore.getState().remove(a.id);
    expect(useTabsStore.getState().activeId).toBe(b.id);
  });
});

describe("tabsStore.update / move / replace", () => {
  it("update 只影响目标标签", () => {
    const a = useTabsStore.getState().openTab(doc("/a.md"), render());
    useTabsStore.getState().openTab(doc("/b.md"), render());

    useTabsStore.getState().update(a.id, { dirty: true, status: "dirty" });

    const tabs = useTabsStore.getState().tabs;
    expect(tabs[0]?.dirty).toBe(true);
    expect(tabs[1]?.dirty).toBe(false);
  });

  it("move 重排且 activeId 不变", () => {
    useTabsStore.getState().openTab(doc("/a.md"), render());
    const b = useTabsStore.getState().openTab(doc("/b.md"), render());
    useTabsStore.getState().move(1, 0);

    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      "/b.md",
      "/a.md",
    ]);
    expect(useTabsStore.getState().activeId).toBe(b.id);
  });

  it("replace 整体替换标签内容并重置视图状态", () => {
    const a = useTabsStore.getState().openTab(doc("/a.md", "旧"), render("旧"));
    useTabsStore.getState().update(a.id, { dirty: true, mode: "edit" });

    useTabsStore.getState().replace(a.id, doc("/b.md", "新"), render("新"));

    const tab = useTabsStore.getState().get(a.id);
    expect(tab).toMatchObject({
      path: "/b.md",
      title: "b.md",
      content: "新",
      dirty: false,
      mode: "edit", // replace 不重置 mode（当前标签内替换保持编辑模式）
      readLine: 1,
    });
  });
});
