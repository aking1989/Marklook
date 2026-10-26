import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "sepia";
export type ReadingFont = "serif" | "sans";

const THEME_ORDER: Theme[] = ["light", "dark", "sepia"];

const FONT_STACKS: Record<ReadingFont, string> = {
  serif: '"Songti SC", "SimSun", "Source Han Serif SC", Georgia, serif',
  sans: '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
};

export function fontStack(font: ReadingFont): string {
  return FONT_STACKS[font];
}

interface SettingsState {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  readingFont: ReadingFont;
  allowRemoteImages: boolean;
  autoSave: boolean;
  /** 侧栏宽度（px），可拖动调整。 */
  sidebarWidth: number;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  setFontSize: (size: number) => void;
  resetFontSize: () => void;
  setLineHeight: (height: number) => void;
  setContentWidth: (width: number) => void;
  setReadingFont: (font: ReadingFont) => void;
  setAllowRemoteImages: (allowed: boolean) => void;
  setAutoSave: (enabled: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

/** 侧栏宽度范围：太窄放不下文件树，太宽挤掉正文。 */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 248;

export function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "light",
      fontSize: 17,
      lineHeight: 1.8,
      contentWidth: 760,
      readingFont: "serif",
      allowRemoteImages: false,
      autoSave: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,

      setTheme: (theme) => set({ theme }),

      cycleTheme: () => {
        const index = THEME_ORDER.indexOf(get().theme);
        set({ theme: THEME_ORDER[(index + 1) % THEME_ORDER.length] });
      },

      setFontSize: (size) =>
        set({ fontSize: Math.min(28, Math.max(13, Math.round(size))) }),

      resetFontSize: () => set({ fontSize: 17 }),

      setLineHeight: (height) =>
        set({
          lineHeight: Math.min(
            2.4,
            Math.max(1.4, Math.round(height * 10) / 10),
          ),
        }),

      setContentWidth: (width) =>
        set({
          contentWidth: Math.min(
            1100,
            Math.max(560, Math.round(width / 20) * 20),
          ),
        }),

      setReadingFont: (readingFont) => set({ readingFont }),

      setAllowRemoteImages: (allowRemoteImages) => set({ allowRemoteImages }),

      setAutoSave: (autoSave) => set({ autoSave }),

      setSidebarWidth: (width) =>
        set({ sidebarWidth: clampSidebarWidth(width) }),
    }),
    { name: "marklook.settings" },
  ),
);
