import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "sepia";

const THEME_ORDER: Theme[] = ["light", "dark", "sepia"];

interface SettingsState {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  setFontSize: (size: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "light",
      fontSize: 17,
      lineHeight: 1.8,
      contentWidth: 760,

      setTheme: (theme) => set({ theme }),

      cycleTheme: () => {
        const index = THEME_ORDER.indexOf(get().theme);
        set({ theme: THEME_ORDER[(index + 1) % THEME_ORDER.length] });
      },

      setFontSize: (size) =>
        set({ fontSize: Math.min(28, Math.max(13, Math.round(size))) }),
    }),
    { name: "marklook.settings" },
  ),
);
