import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * GlassCard — Clean liquid glass container for Capacitor WebView.
 *
 * Uses pointer-events: none on the container (so backdrop-filter
 * doesn't trap touch events) and pointer-events: auto on interactive
 * children.  The `interactive` prop flips the card itself to catch
 * taps (useful for tappable list rows).
 */
export function GlassCard({
  children,
  className,
  interactive = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 p-5",
        "bg-white/[0.06] backdrop-blur-xl backdrop-saturate-[1.8]",
        "shadow-[0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.08)]",
        "dark:bg-white/[0.04] dark:border-white/[0.06]",
        "dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.04)]",
        interactive
          ? "pointer-events-auto cursor-pointer"
          : "pointer-events-none",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
