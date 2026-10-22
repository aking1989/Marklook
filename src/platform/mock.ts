import {
  PlatformError,
  type Platform,
  type TextDocument,
  type WriteOptions,
  type WriteResult,
} from "./types";

interface MockFile {
  content: string;
  mtimeMs: number;
}

const SAMPLE_DOCUMENT = [
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
  "| 数学公式 | M1 |",
  "| Mermaid | M1 |",
  "| 代码高亮 | M1 |",
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
  "[^1]: 脚注在 M1 完整支持。",
  "",
].join("\n");

const files = new Map<string, MockFile>([
  ["/mock/welcome.md", { content: SAMPLE_DOCUMENT, mtimeMs: Date.now() }],
]);

function readFile(path: string): MockFile {
  const file = files.get(path);
  if (!file) {
    throw new PlatformError("NOT_FOUND", `文件不存在：${path}`);
  }
  return file;
}

export const mockPlatform: Platform = {
  async pickFile() {
    return "/mock/welcome.md";
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

    const mtimeMs = Date.now();
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
};

/** 仅用于开发与 E2E：重置 Mock 文件系统。 */
export function resetMockFileSystem(): void {
  files.clear();
  files.set("/mock/welcome.md", {
    content: SAMPLE_DOCUMENT,
    mtimeMs: Date.now(),
  });
}
