import { Download, History, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "download" | "help" | "about";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "download", label: "İndir", icon: Download },
  { id: "help", label: "Geçmiş", icon: History },
  { id: "about", label: "Ayarlar", icon: Settings },
];

/**
 * Fixed bottom navigation — plain CSS only.
 *
 * Deliberately NO framer-motion layout animations and NO @capacitor/haptics:
 * both pull heavy JS into every tab switch and the haptics package is not a
 * declared dependency (dynamic import() fails at runtime on the APK).
 * A simple CSS transition gives the same active indicator without the cost.
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
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#262930] bg-[#17191e] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-3 transition-colors duration-200 active:scale-[0.96]",
                isActive ? "text-[#6cb4ee]" : "text-[#8e8e93] hover:text-[#c7c7cc]",
              )}
            >
              <span
                className={cn(
                  "absolute inset-x-3 top-0 h-0.5 rounded-full bg-[#6cb4ee] shadow-[0_0_8px_rgba(108,180,238,0.6)] transition-all duration-200",
                  isActive ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0",
                )}
              />
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl transition-colors duration-200",
                  isActive && "bg-[#6cb4ee]/12",
                )}
              >
                <Icon className="size-6" strokeWidth={isActive ? 2.2 : 1.6} />
              </span>
              <span className="text-[11px] font-semibold">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
