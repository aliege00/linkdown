import { cn } from "@/lib/utils";
import { motion, LayoutGroup } from "framer-motion";
import { Download, ListVideo, HelpCircle, type LucideIcon } from "lucide-react";
import { useCallback, useRef } from "react";

export type TabId = "download" | "queue" | "help";

const TABS: { id: TabId; label: string; labelTr: string; icon: LucideIcon }[] = [
  { id: "download", label: "Download", labelTr: "İndir", icon: Download },
  { id: "queue", label: "Queue", labelTr: "Kuyruk", icon: ListVideo },
  { id: "help", label: "Help", labelTr: "Yardım", icon: HelpCircle },
];

/**
 * Trigger a subtle haptic tap via the Capacitor Haptics plugin.
 * Uses dynamic import so the app never crashes if the plugin is absent.
 * Falls back gracefully in a plain browser (no bridge).
 */
async function hapticTap() {
  try {
    // Dynamic import with type assertion — the package may not be installed
    // in the browser/dev environment, so we catch resolution failures.
    const mod: any = await (Function("return import('@capacitor/haptics')")() as Promise<any>).catch(() => null);
    if (mod?.Haptics) {
      await mod.Haptics.impact({ style: mod.ImpactStyle?.Light ?? 0 });
    }
  } catch {
    // Browser fallback — no-op
  }
}

export default function BottomTabBar({
  active,
  onChange,
  queueCount,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
  queueCount?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTab = useCallback(
    (id: TabId) => {
      hapticTap();
      onChange(id);
    },
    [onChange],
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      {/* ── Floating Liquid Glass Pill ── */}
      <div
        ref={containerRef}
        className="liquid-glass-bar mx-4 mb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <LayoutGroup id="tabBar">
          <div className="relative flex items-center justify-around px-1 py-1">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTab(tab.id)}
                  className={cn(
                    "relative z-10 flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors duration-200",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground/50 active:text-muted-foreground/70",
                  )}
                >
                  {/* ── Animated Active Pill Background ── */}
                  {isActive && (
                    <motion.div
                      layoutId="liquidPill"
                      className="absolute inset-x-1 inset-y-0.5 rounded-full bg-white/20 dark:bg-white/15 shadow-lg shadow-black/5 border border-white/30 dark:border-white/10"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                        mass: 0.8,
                      }}
                      style={{
                        // GPU-accelerate the pill for smooth 60fps
                        willChange: "transform",
                        transform: "translateZ(0)",
                      }}
                    />
                  )}

                  {/* ── Icon with scale animation ── */}
                  <div className="relative z-10">
                    <motion.div
                      animate={
                        isActive
                          ? { scale: 1.12, y: -1 }
                          : { scale: 1, y: 0 }
                      }
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 25,
                      }}
                    >
                      <tab.icon
                        className="size-[22px]"
                        strokeWidth={isActive ? 2.2 : 1.6}
                      />
                    </motion.div>

                    {/* Queue badge */}
                    {tab.id === "queue" && queueCount != null && queueCount > 0 && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white shadow-sm"
                      >
                        {queueCount > 99 ? "99+" : queueCount}
                      </motion.span>
                    )}
                  </div>

                  {/* ── Label ── */}
                  <motion.span
                    className="relative z-10 text-[10px] font-semibold"
                    animate={isActive ? { opacity: 1 } : { opacity: 0.5 }}
                    transition={{ duration: 0.2 }}
                  >
                    {tab.labelTr}
                  </motion.span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>
    </nav>
  );
}
