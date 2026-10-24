import { beforeEach, describe, expect, it, vi } from "vitest";

// 拦截 @tauri-apps/api：只验证 TauriPlatform 与 Rust 侧的 IPC 契约，
// 不真正调用 Tauri（真实调用由 MockRuntime 集成测试覆盖）。
const invokeMock = vi.fn();
const convertFileSrcMock = vi.fn(
  (path: string, protocol = "asset") => `converted://${protocol}/${path}`,
);
const listenMock = vi.fn(
  async (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ): Promise<() => void> => {
    listenMock.handlers.set(event, handler);
    return () => {
      listenMock.handlers.delete(event);
    };
  },
);
listenMock.handlers = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (...args: unknown[]) => convertFileSrcMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import { tauriPlatform } from "../../src/platform/tauri";

function lastCall(): { command: string; args: Record<string, unknown> } {
  const [command, args] = invokeMock.mock.calls.at(-1) as [
    string,
    Record<string, unknown> | undefined,
  ];
  return { command, args: args ?? {} };
}

function fakeInvoke(result: unknown, error?: unknown): void {
  invokeMock.mockImplementationOnce(async () => {
    if (error !== undefined) throw error;
    return result;
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  convertFileSrcMock.mockClear();
  listenMock.mockClear();
  listenMock.handlers.clear();
});

describe("TauriPlatform IPC 契约", () => {
  it("每个方法的命令名与参数名（camelCase）与 Rust 命令一致", async () => {
    fakeInvoke("/tmp/a.md");
    await tauriPlatform.pickFile();
    expect(lastCall()).toEqual({ command: "pick_file_and_allow", args: {} });

    fakeInvoke("/ws");
    await tauriPlatform.pickFolder();
    expect(lastCall()).toEqual({ command: "pick_folder_and_allow", args: {} });

    fakeInvoke(null);
    await tauriPlatform.readDocument("/tmp/a.md");
    expect(lastCall()).toEqual({
      command: "read_document",
      args: { path: "/tmp/a.md" },
    });

    fakeInvoke(null);
    await tauriPlatform.writeDocument("/tmp/a.md", "内容", {
      expectedMtimeMs: 123,
      eol: "crlf",
      bom: true,
    });
    expect(lastCall()).toEqual({
      command: "write_document",
      args: {
        path: "/tmp/a.md",
        content: "内容",
        expectedMtimeMs: 123,
        force: false, // 未传时默认 false，与 Rust 参数对齐
        eol: "crlf",
        bom: true,
      },
    });

    fakeInvoke([]);
    await tauriPlatform.scanVault("/ws", true);
    expect(lastCall()).toEqual({
      command: "scan_vault",
      args: { root: "/ws", withContent: true },
    });

    fakeInvoke([]);
    await tauriPlatform.listDir("/ws/docs");
    expect(lastCall()).toEqual({
      command: "list_dir",
      args: { path: "/ws/docs" },
    });

    fakeInvoke(7);
    await tauriPlatform.watchPaths(["/ws"], {
      recursive: true,
      markdownOnly: true,
      targetFile: "note.md",
    });
    expect(lastCall()).toEqual({
      command: "watch_paths",
      args: {
        paths: ["/ws"],
        recursive: true,
        markdownOnly: true,
        targetFile: "note.md",
      },
    });

    // targetFile 缺省时传 null（Rust Option<String> 的 serde None）。
    fakeInvoke(8);
    await tauriPlatform.watchPaths(["/ws"], {
      recursive: false,
      markdownOnly: true,
    });
    expect(lastCall().args).toMatchObject({ targetFile: null });

    fakeInvoke(undefined);
    await tauriPlatform.unwatchPaths(7);
    expect(lastCall()).toEqual({
      command: "unwatch_paths",
      args: { watchId: 7 },
    });

    fakeInvoke(undefined);
    await tauriPlatform.saveDraft("/tmp/a.md", "草稿", 99);
    expect(lastCall()).toEqual({
      command: "save_draft",
      args: { path: "/tmp/a.md", content: "草稿", baselineMtimeMs: 99 },
    });

    fakeInvoke(null);
    await tauriPlatform.loadDraft("/tmp/a.md");
    expect(lastCall()).toEqual({
      command: "load_draft",
      args: { path: "/tmp/a.md" },
    });

    fakeInvoke(undefined);
    await tauriPlatform.clearDraft("/tmp/a.md");
    expect(lastCall()).toEqual({
      command: "clear_draft",
      args: { path: "/tmp/a.md" },
    });

    fakeInvoke(0);
    await tauriPlatform.cleanupDrafts();
    expect(lastCall()).toEqual({ command: "cleanup_drafts", args: {} });

    fakeInvoke([]);
    await tauriPlatform.takePendingOpen();
    expect(lastCall()).toEqual({ command: "take_pending_open", args: {} });

    fakeInvoke(undefined);
    await tauriPlatform.closeWindow();
    expect(lastCall()).toEqual({ command: "close_window", args: {} });

    fakeInvoke(null);
    await tauriPlatform.readAssetDataUrl("/docs/pic.png");
    expect(lastCall()).toEqual({
      command: "read_asset_data_url",
      args: { path: "/docs/pic.png" },
    });

    fakeInvoke(null);
    await tauriPlatform.exportSaveHtml("note.html", "<html>");
    expect(lastCall()).toEqual({
      command: "export_save_html",
      args: { defaultName: "note.html", html: "<html>" },
    });

    fakeInvoke(null);
    await tauriPlatform.saveAsset(
      "/docs/note.md",
      "图.png",
      new Uint8Array([1, 2]),
    );
    expect(lastCall()).toEqual({
      command: "save_asset",
      args: {
        docPath: "/docs/note.md",
        suggestedName: "图.png",
        bytes: [1, 2], // Rust Vec<u8> 经 JSON 数组传输
      },
    });
  });

  it("invoke 错误归一化为 PlatformError（code 与 message 提取）", async () => {
    fakeInvoke(undefined, {
      code: "CONFLICT",
      data: { current_mtime_ms: 42 },
    });
    const conflict = await tauriPlatform
      .writeDocument("/tmp/a.md", "x", {
        expectedMtimeMs: 1,
        eol: "lf",
        bom: false,
      })
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(Error);
    expect(conflict).toHaveProperty("code", "CONFLICT");

    fakeInvoke(undefined, "裸字符串错误");
    const plain = await tauriPlatform
      .readDocument("/tmp/a.md")
      .catch((error: unknown) => error);
    expect(plain).toMatchObject({ code: "IO", message: "裸字符串错误" });

    fakeInvoke(undefined, 42);
    const weird = await tauriPlatform
      .readDocument("/tmp/a.md")
      .catch((error: unknown) => error);
    expect(weird).toMatchObject({ code: "IO", message: "42" });
  });

  it("toAssetUrl：base64url 编码（UTF-8 安全）+ convertFileSrc 的 local/ 前缀", () => {
    const url = tauriPlatform.toAssetUrl("/docs/图 片.png");
    const [calledPath, protocol] = convertFileSrcMock.mock.calls[0] as [
      string,
      string,
    ];

    expect(protocol).toBe("mdasset");
    expect(calledPath.startsWith("local/")).toBe(true);
    const token = calledPath.slice("local/".length);
    // base64url 字符集：无 + / =。
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 还原校验。
    const bytes = Uint8Array.from(
      atob(token.replace(/-/g, "+").replace(/_/g, "/")),
      (ch) => ch.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe("/docs/图 片.png");
    expect(url).toBe(`converted://mdasset/${calledPath}`);
  });

  it("onFsChange：订阅 fs://change 并转发 payload，退订调用 unlisten", async () => {
    const received: unknown[] = [];
    const unsubscribe = tauriPlatform.onFsChange((event) =>
      received.push(event),
    );

    await vi.waitFor(() =>
      expect(listenMock.handlers.has("fs://change")).toBe(true),
    );

    const handler = listenMock.handlers.get("fs://change");
    handler?.({ payload: { watchId: 3, paths: ["/ws/a.md"] } });
    expect(received).toEqual([{ watchId: 3, paths: ["/ws/a.md"] }]);

    unsubscribe();
    await vi.waitFor(() =>
      expect(listenMock.handlers.has("fs://change")).toBe(false),
    );
  });

  it("onAppEvent：一次订阅三个应用事件并按类型转发", async () => {
    const events: string[] = [];
    const unsubscribe = tauriPlatform.onAppEvent((event) => {
      events.push(
        event.type === "menu"
          ? `menu:${event.action}`
          : event.type === "open-paths"
            ? `open:${event.paths[0]}`
            : "close",
      );
    });

    await vi.waitFor(() => expect(listenMock.handlers.size).toBe(3));
    expect([...listenMock.handlers.keys()].sort()).toEqual([
      "app://close-requested",
      "app://menu",
      "app://open-paths",
    ]);

    listenMock.handlers.get("app://menu")?.({ payload: "open-file" });
    listenMock.handlers.get("app://open-paths")?.({
      payload: ["/docs/a.md"],
    });
    listenMock.handlers.get("app://close-requested")?.({ payload: undefined });
    expect(events).toEqual(["menu:open-file", "open:/docs/a.md", "close"]);

    unsubscribe();
  });
});
