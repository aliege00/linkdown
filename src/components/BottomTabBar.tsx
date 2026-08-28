import { cn } from "@/lib/utils";
import { Download, ListVideo, HelpCircle } from "lucide-react";

export type TabId = "download" | "queue" | "help";

const TABS: { id: TabId; label: string; labelTr: string; icon: typeof Download }[] = [
  { id: "download", label: "Download", labelTr: "İndir", icon: Download },
  { id: "queue", label: "Queue", labelTr: "Kuyruk", icon: ListVideo },
  { id: "help", label: "Help", labelTr: "Yardım", icon: HelpCircle },
];

export default function BottomTabBar({
  active,
  onChange,
  queueCount,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
  queueCount?: number;
}) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 tab-bar-glass safe-area-bottom">
      <div className="mx-auto flex max-w-lg items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-1">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors duration-200",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              <div className="relative">
                <tab.icon
                  className={cn(
                    "size-6 transition-all duration-200",
                    isActive && "scale-110"
                  )}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
                {/* Queue badge */}
                {tab.id === "queue" && queueCount != null && queueCount > 0 && (
                  <span className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                    {queueCount > 99 ? "99+" : queueCount}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium transition-all duration-200",
                  isActive ? "opacity-100" : "opacity-60"
                )}
              >
                {tab.labelTr}
              </span>
              {/* Active indicator dot */}
              {isActive && (
                <span className="absolute -bottom-0 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-primary/60" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
