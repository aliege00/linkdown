import { useCallback } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { Download, History, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "download" | "help" | "about";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "download", label: "İndir", icon: Download },
  { id: "help", label: "Geçmiş", icon: History },
  { id: "about", label: "Ayarlar", icon: Settings },
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
  const handleTab = useCallback(
    (id: TabId) => {
      hapticTap();
      onChange(id);
    },
    [onChange],
  );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#262930] bg-[#17191e]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <LayoutGroup id="flatTab">
        <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-1">
          {TABS.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTab(tab.id)}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-1 py-3 transition-colors",
                  isActive ? "text-[#6cb4ee]" : "text-[#8e8e93]",
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-[#6cb4ee]"
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 35,
                    }}
                  />
                )}
                <tab.icon className="size-6" strokeWidth={isActive ? 2.2 : 1.6} />
                <span className="text-[11px] font-semibold">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
    </nav>
  );
}
