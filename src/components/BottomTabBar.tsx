import { Download, LifeBuoy, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "download" | "support";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "download", label: "İndirme", icon: Download },
  { id: "support", label: "Yardım", icon: LifeBuoy },
];

/**
 * Floating bottom navigation — an ISLAND, not a full-width bar.
 *
 * Design + performance notes:
 *  • Sized to its content and centered, so it no longer paints an opaque
 *    strip across the bottom of the screen — content stays visible around it.
 *  • Translucent card fill with a SMALL-AREA `backdrop-blur-md`. The blur is
 *    the most expensive effect here, so it is deliberately confined to the
 *    island instead of a full-width bar.
 *  • Own compositor layer (translate3d) so scrolling never forces the blur to
 *    re-read on every frame.
 *  • NO framer-motion and NO @capacitor/haptics: both pull heavy JS into every
 *    tab switch, and the haptics package is not a declared dependency
 *    (dynamic import() fails at runtime on the APK). The motion below is pure
 *    CSS — it animates on the compositor, costs no JS, and runs inside the
 *    same reduced-motion guard as the rest of the app.
 *  • `env(safe-area-inset-bottom)` keeps it above the gesture bar.
 *
 * Motion (CSS only, ~0 JS):
 *  • the island slides up and fades in when it first appears
 *  • the active pill GLIDES between tabs (a transform on one shared element)
 *  • icons and labels cross-fade with a short lift
 *  • a press gives an instant scale-down, then springs back
 */
export default function BottomTabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const activeIndex = Math.max(
    0,
    TABS.findIndex((t) => t.id === active),
  );

  return (
    <nav
      aria-label="Sekmeler"
      className={cn(
        "fixed bottom-0 left-1/2 z-50 rounded-[1.75rem] border border-border/70",
        "bg-card/75 px-1.5 py-1.5 backdrop-blur-md",
        // Entrance: rise + fade. Runs once on mount.
        "motion-safe:animate-[island-rise_420ms_cubic-bezier(0.22,1,0.36,1)_both]",
      )}
      style={{
        marginBottom: "calc(env(safe-area-inset-bottom) + 14px)",
        // translate3d (not translateX) keeps the island on its own layer.
        transform: "translate3d(-50%, 0, 0)",
        willChange: "transform",
        // Soft, theme-aware shadow (dark = deeper, light = softer).
        boxShadow: "var(--island-shadow)",
      }}
    >
      {/* Hairline highlight along the top edge — reads as glass, costs one
          gradient (no extra blur pass, no repaint on scroll). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
      />

      <div className="relative flex items-stretch gap-1">
        {/* Sliding active pill — one element that travels between tabs.
            Positioned with a percentage translate, so it costs one transform
            on one layer instead of animating width/box-shadow on every tab. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-[calc(50%-0.25rem)] rounded-[1.25rem]",
            "bg-primary/14 shadow-[0_0_18px_var(--island-glow)]",
            "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "motion-reduce:transition-none",
          )}
          style={{ transform: `translate3d(${activeIndex * 100}%, 0, 0)` }}
        />

        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2",
                "rounded-[1.25rem] px-5 py-2 select-none",
                // Press feedback: instant down, springy release.
                "transition-[transform,color] duration-200 ease-out active:scale-[0.94]",
                "motion-reduce:transition-none motion-reduce:active:scale-100",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="relative flex size-5 shrink-0 items-center justify-center">
                <Icon
                  className={cn(
                    "size-5 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    isActive
                      ? "scale-100 opacity-100"
                      : "scale-90 opacity-60",
                    "motion-reduce:transition-none",
                  )}
                  strokeWidth={isActive ? 2.2 : 1.7}
                />
              </span>
              <span
                className={cn(
                  "text-[13px] font-semibold whitespace-nowrap transition-all duration-300",
                  isActive
                    ? "translate-y-0 opacity-100"
                    : "translate-y-0.5 opacity-70",
                  "motion-reduce:transition-none motion-reduce:translate-y-0",
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}