import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * FlatCard — Solid dark card for Capacitor WebView.
 * No backdrop-filter, no blur, no opacity tricks.
 */
export function FlatCard({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#262930] bg-[#17191e] p-5",
        // Interactive cards get a hairline accent on hover instead of a
        // shadow: same affordance, no repaint cost on low-end WebViews.
        interactive
          ? "cursor-pointer transition-[border-color,transform] duration-150 hover:border-[#6cb4ee]/30 active:scale-[0.98]"
          : "transition-[border-color] duration-150",
        className,
      )}
    >
      {children}
    </div>
  );
}
