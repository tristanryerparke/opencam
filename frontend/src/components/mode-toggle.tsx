import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light" | "system";

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const applyTheme = (theme: Theme) => {
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "system") {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    root.classList.add(systemTheme);
  } else {
    root.classList.add(theme);
  }
};

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "vite-ui-theme",
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

useTheme.subscribe((state) => applyTheme(state.theme));

const modes: Theme[] = ["system", "light", "dark"];

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const currentIndex = modes.indexOf(theme);
  const nextMode = modes[(currentIndex + 1) % modes.length];

  let Icon = Monitor;
  if (theme === "light") Icon = Sun;
  if (theme === "dark") Icon = Moon;

  return (
    <Button
      size="icon"
      onClick={() => setTheme(nextMode)}
      aria-label="Toggle theme"
    >
      <Icon className="h-[1.2rem] w-[1.2rem]" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
