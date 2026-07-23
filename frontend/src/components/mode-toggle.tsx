import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "t-components/button";
import { useSettingsStore, type Theme } from "@/state/settings-store";

export type { Theme } from "@/state/settings-store";

const modes: Theme[] = ["system", "light", "dark"];

export function ModeToggle() {
  const { theme, setTheme } = useSettingsStore();
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
      <Icon className="size-3.5" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
