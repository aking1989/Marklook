import {
  PlatformError,
  type DraftRecord,
  type FsChangeEvent,
  type Platform,
  type TextDocument,
  type VaultEntry,
  type VaultScan,
  type WatchOptions,
  type WriteOptions,
  type WriteResult,
} from "./types";

interface MockFile {
  content: string;
  mtimeMs: number;
}

const SAMPLE_DOCUMENT = [
  "---",
  "title: 欢迎使用墨览",
  "---",
  "",
  "# 欢迎使用墨览",
  "",
  "**墨览（Marklook）** 是一个以阅读为中心的本地 Markdown 阅读器。",
  "按 `Cmd/Ctrl+E` 可以在阅读视图与源码之间切换。",
  "",
  "## 为什么是阅读器",
  "",
  "- 排版优先：字号、行高、栏宽都可以调",
  "- 本地优先：默认不发起任何网络请求",
  "- 修改只是附属能力，不是主界面",
  "",
  "> 阅读是一种需要被认真对待的界面。",
  "",
  "## 渲染能力",
  "",
  "| 能力 | 状态 |",
  "| --- | --- |",
  "| CommonMark / GFM | 已支持 |",
  "| 数学公式 | 已支持 |",
  "| Mermaid | 已支持 |",
  "| 代码高亮 | 已支持 |",
  "",
  "行内公式 $E=mc^2$ 与块级公式：",
  "",
  "$$",
  "\\int_0^1 x\\,dx = \\frac{1}{2}",
  "$$",
  "",
  "远程图片默认不加载：",
  "",
  "![示例远程图片](https://example.com/remote.png)",
  "",
  "## 一段代码",
  "",
  "```ts",
  "export function greeting(name: string): string {",
  "  return `你好，${name}`;",
  "}",
  "```",
  "",
  "## 一段列表",
  "",
  "1. 打开一个 Markdown 文件",
  "2. 安静地读",
  "3. 需要修改时再进入源码模式",
  "",
  "## 一段引用",
  "",
  "> 好的阅读器应该消失在文字后面。",
  "",
  "## 脚注与任务列表",
  "",
  "- [x] 阅读视图",
  "- [ ] 工作区与搜索",
  "- [ ] 导出",
  "",
  "这里有一个脚注[^1]。",
  "",
  "[^1]: 脚注已支持。",
  "",
].join("\n");

const GUIDE_DOCUMENT = [
  "# 工作区指南",
  "",
  "打开文件夹后可以浏览整个文档库。",
  "",
  "## 搜索",
  "",
  "支持中文分词搜索，试试搜「编辑器」。",
  "",
].join("\n");

const DEEP_DOCUMENT = [
  "# 深层笔记",
  "",
  "嵌套目录中的文档。编辑器草稿与冲突检测都会覆盖这里。",
  "",
].join("\n");

/** 约 2.1MB 的大文档（行数控制在 25k 以内，触发字节阈值）。 */
function largeDocument(): string {
  const paragraph =
    "这是一段用于大文件模式验证的正文，包含中文与 English 单词 mixed content。\n\n";
  const sectionBody = paragraph.repeat(8);
  const parts: string[] = ["# 大文件模式验证\n\n"];
  for (let index = 0; index < 4200; index += 1) {
    parts.push(`## 第${index}节\n\n${sectionBody}`);
  }
  return parts.join("");
}

const files = new Map<string, MockFile>();
const drafts = new Map<string, DraftRecord>();
const fsListeners = new Set<(event: FsChangeEvent) => void>();
let watchCounter = 0;
let openRoots = new Set<string>(["/mock"]);

function now(): number {
  return Date.now();
}

/** 仅用于开发与 E2E：重置 Mock 文件系统与草稿。 */
export function resetMockFileSystem(): void {
  files.clear();
  drafts.clear();
  openRoots = new Set(["/mock"]);
  seedFiles();
}

function seedFiles(): void {
  files.set("/mock/welcome.md", { content: SAMPLE_DOCUMENT, mtimeMs: now() });
  files.set("/mock/docs/guide.md", { content: GUIDE_DOCUMENT, mtimeMs: now() });
  files.set("/mock/docs/deep/note.md", {
    content: DEEP_DOCUMENT,
    mtimeMs: now(),
  });
  files.set("/mock/big.md", { content: largeDocument(), mtimeMs: now() });
}

seedFiles();

function readFile(path: string): MockFile {
  const file = files.get(path);
  if (!file) {
    throw new PlatformError("NOT_FOUND", `文件不存在：${path}`);
  }
  return file;
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

/** Mock 工作区树：从扁平文件推导目录。 */
function scanEntries(root: string, withContent: boolean): VaultEntry[] {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const dirs = new Map<string, VaultEntry>();
  const entries: VaultEntry[] = [];

  for (const [path, file] of files) {
    if (!path.startsWith(prefix)) continue;
    if (!isMarkdown(path)) continue;

    const segments = path.slice(prefix.length).split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const dirPath = prefix + segments.slice(0, depth).join("/");
      if (!dirs.has(dirPath)) {
        const entry: VaultEntry = {
          name: segments[depth - 1] as string,
          path: dirPath,
          isDir: true,
          size: 0,
          mtimeMs: file.mtimeMs,
        };
        dirs.set(dirPath, entry);
        entries.push(entry);
      }
    }

    entries.push({
      name: segments[segments.length - 1] as string,
      path,
      isDir: false,
      size: new TextEncoder().encode(file.content).byteLength,
      mtimeMs: file.mtimeMs,
      content: withContent ? file.content : undefined,
    });
  }

  return entries;
}

let assetCounter = 0;
let pickFileTarget = "/mock/welcome.md";

export const mockPlatform: Platform = {
  async saveAsset(docPath, suggestedName) {
    assetCounter += 1;
    const extension = suggestedName.includes(".")
      ? (suggestedName.split(".").pop() ?? "png")
      : "png";
    const relativePath = `assets/image-${assetCounter}.${extension}`;
    return {
      absolutePath: `${docPath.slice(0, docPath.lastIndexOf("/"))}/${relativePath}`,
      relativePath,
    };
  },

  async pickFile() {
    // addInitScript 场景（E2E）下模块尚未加载，从全局变量读取预设。
    const preset = (window as unknown as { __mockPickFileTarget?: string })
      .__mockPickFileTarget;
    return preset ?? pickFileTarget;
  },

  async pickFolder() {
    return "/mock";
  },

  async readDocument(path: string): Promise<TextDocument> {
    const file = readFile(path);
    return {
      path,
      content: file.content,
      mtimeMs: file.mtimeMs,
      size: new TextEncoder().encode(file.content).byteLength,
      eol: "lf",
      bom: false,
      encoding: "utf-8",
    };
  },

  async writeDocument(
    path: string,
    content: string,
    options: WriteOptions,
  ): Promise<WriteResult> {
    const file = readFile(path);
    if (
      !options.force &&
      options.expectedMtimeMs !== null &&
      options.expectedMtimeMs !== file.mtimeMs
    ) {
      throw new PlatformError("CONFLICT", "文件已在其他程序中被修改", {
        currentMtimeMs: file.mtimeMs,
      });
    }

    const mtimeMs = now();
    files.set(path, { content, mtimeMs });
    return {
      mtimeMs,
      size: new TextEncoder().encode(content).byteLength,
      eol: options.eol,
      bom: options.bom,
    };
  },

  async print() {
    // 浏览器预览下交给浏览器自带打印。
    window.print();
  },

  toAssetUrl(absolutePath: string): string {
    // Mock 环境没有真实文件系统：返回占位 SVG，保证阅读视图布局不破。
    const safePath = absolutePath
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60">` +
      `<rect width="100%" height="100%" fill="#e8e8e8" rx="6"/>` +
      `<text x="50%" y="50%" font-size="10" text-anchor="middle" fill="#888" ` +
      `font-family="sans-serif">${safePath}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  },

  async scanVault(root: string, withContent: boolean): Promise<VaultScan> {
    if (!openRoots.has(root)) {
      throw new PlatformError("PATH_OUTSIDE_ROOT", "目录未授权");
    }
    return { root, entries: scanEntries(root, withContent), truncated: false };
  },

  async listDir(path: string): Promise<VaultEntry[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const result: VaultEntry[] = [];
    const seen = new Set<string>();

    for (const [filePath, file] of files) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const first = rest.split("/")[0] as string;
      const key = `${prefix}${first}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isDir = rest.includes("/");
      result.push({
        name: first,
        path: key,
        isDir,
        size: isDir ? 0 : new TextEncoder().encode(file.content).byteLength,
        mtimeMs: file.mtimeMs,
      });
    }

    return result.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
  },

  async watchPaths(_paths: string[], _options: WatchOptions): Promise<number> {
    watchCounter += 1;
    return watchCounter;
  },

  async unwatchPaths(): Promise<void> {
    // Mock 不需要真实监听。
  },

  onFsChange(callback) {
    fsListeners.add(callback);
    return () => fsListeners.delete(callback);
  },

  async saveDraft(path, content, baselineMtimeMs) {
    drafts.set(path, {
      path,
      content,
      baselineMtimeMs,
      savedAt: now(),
      version: 1,
    });
  },

  async loadDraft(path) {
    return drafts.get(path) ?? null;
  },

  async clearDraft(path) {
    drafts.delete(path);
  },

  async cleanupDrafts() {
    return 0;
  },
};

/** 仅用于开发与 E2E：模拟外部程序修改文件（可携带新内容），触发 fs://change。 */
export function mockExternalChange(path: string, newContent?: string): void {
  const file = files.get(path);
  if (file) {
    if (newContent !== undefined) {
      file.content = newContent;
    }
    file.mtimeMs = now();
  }
  const event: FsChangeEvent = { watchId: 1, paths: [path] };
  for (const listener of fsListeners) {
    listener(event);
  }
}

// 开发与 E2E 钩子：浏览器内模拟外部修改（触发 fs://change 与 mtime 变化）。
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__marklookMock = {
    externalChange: mockExternalChange,
    listenerCount: () => fsListeners.size,
    setPickFile: (target: string) => {
      pickFileTarget = target;
    },
  };
}
