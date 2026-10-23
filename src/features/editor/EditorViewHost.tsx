import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Theme } from "../../stores/settingsStore";

export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  getCursorLine(): number;
  getTopVisibleLine(): number;
  scrollToLine(line: number, focus?: boolean): void;
  focus(): void;
}

interface EditorViewHostProps {
  initialValue: string;
  visible: boolean;
  theme: Theme;
  /** 大文件模式：关闭行号/当前行高亮等装饰，保留搜索与撤销。 */
  largeFile?: boolean;
  onChange: () => void;
  /**
   * 粘贴/拖入图片时由宿主保存到 assets/，返回可插入的相对路径；
   * 返回 null 表示放弃（未保存文档等场景，宿主负责提示）。
   */
  onPasteImage?: (
    suggestedName: string,
    bytes: Uint8Array,
  ) => Promise<string | null>;
}

function layoutTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--bg)",
      color: "var(--fg)",
      fontSize: "var(--editor-font-size)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
    },
    ".cm-content": {
      maxWidth: "var(--content-width)",
      margin: "0 auto",
      padding: "40px 0 160px",
      caretColor: "var(--accent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg)",
      color: "var(--fg-muted)",
      border: "none",
      paddingLeft: "12px",
    },
    ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection)",
    },
  });
}

const lightTheme = [layoutTheme(), syntaxHighlighting(defaultHighlightStyle)];
const darkTheme = [oneDark, layoutTheme()];

function themeExtension(theme: Theme): Extension {
  return theme === "dark" ? darkTheme : lightTheme;
}

export const EditorViewHost = forwardRef<EditorHandle, EditorViewHostProps>(
  function EditorViewHost(
    { initialValue, visible, theme, largeFile = false, onChange, onPasteImage },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartment = useRef(new Compartment());
    const featuresCompartment = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const onPasteImageRef = useRef(onPasteImage);
    const initialValueRef = useRef(initialValue);
    const themeRef = useRef(theme);

    onChangeRef.current = onChange;
    onPasteImageRef.current = onPasteImage;
    themeRef.current = theme;

    /** 提取事件中的图片文件；无图片返回空数组。 */
    function collectImages(items: DataTransferItemList | null): File[] {
      if (!items) return [];
      const images: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) images.push(file);
        }
      }
      return images;
    }

    /** 保存图片到 assets 并在光标处逐张插入 Markdown 语法。 */
    async function insertImages(files: File[]): Promise<boolean> {
      const handler = onPasteImageRef.current;
      if (!handler || files.length === 0) return false;

      let inserted = false;
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        try {
          const relativePath = await handler(file.name || "image", bytes);
          if (!relativePath) continue;
          const view = viewRef.current;
          if (!view) break;
          const selection = view.state.selection.main;
          view.dispatch({
            changes: {
              from: selection.to,
              insert: `${inserted ? "\n" : ""}![${file.name || "image"}](${relativePath})\n`,
            },
            selection: { anchor: selection.to },
          });
          onChangeRef.current();
          inserted = true;
        } catch {
          // 单张失败继续下一张。
        }
      }
      return inserted;
    }

    function handlePaste(event: ClipboardEvent): void {
      const images = collectImages(event.clipboardData?.items ?? null);
      if (images.length === 0) return; // 普通文本交给 CodeMirror
      event.preventDefault();
      void insertImages(images);
    }

    function handleDrop(event: DragEvent): void {
      const images = collectImages(event.dataTransfer?.items ?? null);
      if (images.length === 0) return;
      event.preventDefault();
      void insertImages(images);
    }

    function createState(value: string): EditorState {
      return EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          highlightSpecialChars(),
          rectangularSelection(),
          crosshairCursor(),
          bracketMatching(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          // 大文件模式关闭行号/当前行/选区匹配高亮（>2MB 或 >25k 行）。
          featuresCompartment.current.of(
            largeFile
              ? []
              : [
                  lineNumbers(),
                  highlightActiveLineGutter(),
                  highlightActiveLine(),
                  highlightSelectionMatches(),
                ],
          ),
          themeCompartment.current.of(themeExtension(themeRef.current)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current();
          }),
        ],
      });
    }

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const view = new EditorView({
        state: createState(initialValueRef.current),
        parent: host,
      });
      viewRef.current = view;

      host.addEventListener("paste", handlePaste);
      host.addEventListener("drop", handleDrop);

      return () => {
        host.removeEventListener("paste", handlePaste);
        host.removeEventListener("drop", handleDrop);
        view.destroy();
        viewRef.current = null;
      };
      // EditorView 只创建一次；后续通过 setValue / Compartment 更新。
      // handlePaste/handleDrop 经 ref 读取最新实现。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.current.reconfigure(themeExtension(theme)),
      });
    }, [theme]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: featuresCompartment.current.reconfigure(
          largeFile
            ? []
            : [
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightActiveLine(),
                highlightSelectionMatches(),
              ],
        ),
      });
    }, [largeFile]);

    useEffect(() => {
      if (!visible) return;
      const view = viewRef.current;
      if (!view) return;
      view.requestMeasure();
      view.focus();
    }, [visible]);

    useImperativeHandle(
      ref,
      () => ({
        getValue() {
          return viewRef.current?.state.doc.toString() ?? "";
        },

        setValue(value: string) {
          viewRef.current?.setState(createState(value));
        },

        getCursorLine() {
          const view = viewRef.current;
          if (!view) return 1;
          return view.state.doc.lineAt(view.state.selection.main.head).number;
        },

        getTopVisibleLine() {
          const view = viewRef.current;
          if (!view) return 1;
          const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 8);
          return view.state.doc.lineAt(block.from).number;
        },

        scrollToLine(line: number, focus = true) {
          const view = viewRef.current;
          if (!view) return;
          const target = Math.min(Math.max(1, line), view.state.doc.lines);
          const position = view.state.doc.line(target).from;
          view.dispatch({
            selection: { anchor: position },
            effects: EditorView.scrollIntoView(position, {
              y: "start",
              yMargin: 24,
            }),
          });
          if (focus) view.focus();
        },

        focus() {
          viewRef.current?.focus();
        },
      }),
      // handle 与 createState 仅引用 ref（viewRef 等），不随渲染失效。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    return (
      <div
        ref={hostRef}
        className="editor-host"
        hidden={!visible}
        aria-hidden={!visible}
      />
    );
  },
);
