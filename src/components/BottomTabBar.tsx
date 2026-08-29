import { useCallback, useEffect, useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { Download, HelpCircle, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "download" | "help" | "about";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "download", label: "İndir", icon: Download },
  { id: "help", label: "Yardım", icon: HelpCircle },
  { id: "about", label: "Ayarlar", icon: Info },
];

async function hapticTap() {
  try {
    const mod: any = await (
      Function("return import('@capacitor/haptics')")() as Promise<any>
    ).catch(() => null);
    if (mod?.Haptics)
      await mod.Haptics.impact({ style: mod.ImpactStyle?.Light ?? 0 });
  } catch {
    /* noop */
  }
}

export default function BottomTabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  const handleTab = useCallback(
    (id: TabId) => {
      hapticTap();
      onChange(id);
    },
    [onChange],
  );

  return (
    <nav
      className="pointer-events-auto fixed bottom-4 left-4 right-4 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="mx-auto max-w-lg rounded-full border p-1 backdrop-blur-2xl backdrop-saturate-[1.8]"
        style={{
          background: isDark
            ? "rgba(30, 30, 35, 0.78)"
            : "rgba(255, 255, 255, 0.72)",
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.08)"
            : "rgba(255, 255, 255, 0.45)",
          boxShadow: isDark
            ? "0 20px 40px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.06)"
            : "0 20px 40px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.6)",
        }}
      >
        <LayoutGroup id="liquidTab">
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
                    isActive ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="liquidPill"
                      className="absolute inset-x-1 inset-y-0.5 rounded-full border shadow-lg"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(255,255,255,0.4)",
                        borderColor: isDark
                          ? "rgba(255,255,255,0.12)"
                          : "rgba(255,255,255,0.5)",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 32,
                        mass: 0.8,
                      }}
                    />
                  )}
                  <div className="relative z-10">
                    <motion.div
                      animate={
                        isActive ? { scale: 1.12, y: -1 } : { scale: 1, y: 0 }
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
                  </div>
                  <motion.span
                    className="relative z-10 text-[10px] font-semibold"
                    animate={isActive ? { opacity: 1 } : { opacity: 0.5 }}
                    transition={{ duration: 0.2 }}
                  >
                    {tab.label}
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
