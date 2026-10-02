import { useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles } from "lucide-react";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import DownloaderCard from "@/components/DownloaderCard";
import HistoryTab from "@/components/tabs/HistoryTab";
import SettingsTab from "@/components/tabs/SettingsTab";
import { useRef } from "react";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const [tab, setTab] = useState<TabId>("download");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const NAV: { id: TabId; label: string }[] = [
    { id: "download", label: "İndir" },
    { id: "help", label: "Geçmiş" },
    { id: "about", label: "Ayarlar" },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#e8e8e8]">
      {/* ── Top Bar (sticky, small, never blocks scroll) ── */}
      <header className="sticky top-0 z-40 border-b border-[#262930] bg-[#17191e]">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6cb4ee] to-[#4a90d9] shadow-md shadow-[#6cb4ee]/20">
              <Sparkles className="size-4.5 text-[#0d0f12]" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight">VidFetch</h1>
              <p className="truncate text-[11px] text-[#8e8e93]">
                v2.6.2
              </p>
            </div>
            {/* Desktop-only inline nav (the bottom bar is a touch pattern) */}
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              {NAV.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    tab === t.id
                      ? "bg-[#6cb4ee]/15 text-[#6cb4ee]"
                      : "text-[#8e8e93] hover:text-[#e8e8e8]",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Active Tab (normal document flow — body scrolls, WebView-safe) ── */}
      <main className="pb-24">
        {tab === "download" && (
          <DownloaderCard
            inputRef={inputRef}
            resultsRef={resultsRef}
            className="mx-auto max-w-2xl px-4 pt-4"
          />
        )}
        {tab === "help" && <HistoryTab />}
        {tab === "about" && <SettingsTab />}
      </main>

      {/* ── Bottom Nav (fixed, always visible) ── */}
      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
