import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * FlatCard — solid surface card (light/dark via tokens).
 * No backdrop-filter, no blur, no opacity tricks: those are the effects that
 * stall low-end Android WebViews.
 */
export function FlatCard({
  children,
  className,
  interactive = false,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  /** Makes the card a real button-like target (used by the → /help card). */
  onClick?: () => void;
}) {
  const Element = onClick ? "button" : "div";

  return (
    <Element
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "w-full rounded-2xl border border-border bg-card p-5 text-left",
        // Interactive cards get a hairline accent on hover instead of a
        // shadow: same affordance, no repaint cost on low-end WebViews.
        interactive
          ? "cursor-pointer transition-[border-color,transform] duration-150 hover:border-primary/30 active:scale-[0.98]"
          : "transition-[border-color] duration-150",
        className,
      )}
    >
      {children}
    </Element>
  );
}
