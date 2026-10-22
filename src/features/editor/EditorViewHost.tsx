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
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
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
  onChange: () => void;
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

const lightTheme = [
  layoutTheme(),
  syntaxHighlighting(defaultHighlightStyle),
];
const darkTheme = [oneDark, layoutTheme()];

function themeExtension(theme: Theme): Extension {
  return theme === "dark" ? darkTheme : lightTheme;
}

export const EditorViewHost = forwardRef<EditorHandle, EditorViewHostProps>(
  function EditorViewHost(
    { initialValue, visible, theme, onChange },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const themeCompartment = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const initialValueRef = useRef(initialValue);
    const themeRef = useRef(theme);

    onChangeRef.current = onChange;
    themeRef.current = theme;

    function createState(value: string): EditorState {
      return EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          bracketMatching(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
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

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // EditorView 只创建一次；后续通过 setValue / Compartment 更新。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.current.reconfigure(
          themeExtension(theme),
        ),
      });
    }, [theme]);

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
          const target = Math.min(
            Math.max(1, line),
            view.state.doc.lines,
          );
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
