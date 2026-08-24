import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [pulsing, setPulsing] = useState(false);

  // Prevent hydration mismatch — set to true only after first render.
  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const handleToggle = () => {
    setPulsing(true);
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
    setTimeout(() => setPulsing(false), 600);
  };

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        disabled
        aria-label="Toggle theme"
      >
        <div className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      className={`h-9 w-9 shrink-0 relative overflow-visible transition-colors ${
        pulsing ? "animate-pulse" : ""
      }`}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      {/* Pulsing ring on click */}
      <span
        className={`absolute inset-0 rounded-md ring-2 ring-primary/30 transition-all duration-500 ${
          pulsing ? "scale-150 opacity-0" : "scale-100 opacity-0"
        }`}
      />

      {/* Sun icon */}
      <Sun
        className={`h-4 w-4 absolute transition-all duration-500 ${
          isDark
            ? "opacity-0 rotate-180 scale-50"
            : "opacity-100 rotate-0 scale-100"
        }`}
      />

      {/* Moon icon */}
      <Moon
        className={`h-4 w-4 absolute transition-all duration-500 ${
          isDark
            ? "opacity-100 rotate-0 scale-100"
            : "opacity-0 -rotate-180 scale-50"
        }`}
      />

      {/* Sparkle dots that appear during transition */}
      {pulsing && (
        <>
          <span className="absolute -top-0.5 -right-0.5 h-1 w-1 rounded-full bg-yellow-400 animate-ping" />
          <span className="absolute -bottom-0.5 -left-0.5 h-1 w-1 rounded-full bg-blue-400 animate-ping delay-75" />
        </>
      )}

      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
