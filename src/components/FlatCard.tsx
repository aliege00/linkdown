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
        interactive
          ? "cursor-pointer active:scale-[0.98] transition-transform"
          : "",
        className,
      )}
    >
      {children}
    </div>
  );
}
