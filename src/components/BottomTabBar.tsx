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
 *  • It is sized to its content (`w-fit` via the inline flex child) and
 *    centered, so it no longer paints an opaque strip across the whole
 *    bottom of the screen — content stays visible on both sides.
 *  • Translucent (`/70`) with a small-area `backdrop-blur-md`. The blur is
 *    the single most expensive effect here, so it is deliberately confined
 *    to the island instead of a full-width bar.
 *  • Own compositor layer (translate3d + will-change) so scrolling does not
 *    force the blur to re-read on every frame.
 *  • NO framer-motion and NO @capacitor/haptics: both pull heavy JS into
 *    every tab switch, and the haptics package is not a declared dependency
 *    (dynamic import() fails at runtime on the APK). A plain CSS transition
 *    gives the same active state at no JS cost.
 *  • `env(safe-area-inset-bottom)` keeps it above the gesture bar.
 */
export default function BottomTabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav
      aria-label="Sekmeler"
      className="fixed bottom-0 left-1/2 z-50 rounded-2xl border border-[#2b2f36]/80 bg-[#17191e]/70 px-1.5 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
      style={{
        marginBottom: "calc(env(safe-area-inset-bottom) + 14px)",
        // translate3d (not translateX) keeps the island on its own layer.
        transform: "translate3d(-50%, 0, 0)",
        willChange: "transform",
      }}
    >
      <div className="flex items-stretch gap-1">
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
                "flex items-center gap-2 rounded-xl px-4 py-2 transition-colors duration-150 active:scale-[0.97] cursor-pointer",
                isActive
                  ? "bg-[#6cb4ee]/14 text-[#6cb4ee]"
                  : "text-[#8e8e93] hover:text-[#c7c7cc]",
              )}
            >
              <Icon
                className="size-4.5 shrink-0"
                strokeWidth={isActive ? 2.2 : 1.7}
              />
              <span className="text-[12px] font-semibold whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}