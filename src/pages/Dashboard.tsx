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
  // Two tabs only, as the user asked:
  //   1) İndirme  — paste → analyze → download (+ its own history)
  //   2) Yardım   — help center + about + settings (engines, language…)
  const [tab, setTab] = useState<TabId>("download");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const NAV: { id: TabId; label: string }[] = [
    { id: "download", label: "İndirme" },
    { id: "support", label: "Yardım & Hakkında" },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#e8e8e8]">
      {/* ── Top Bar (sticky, small, never blocks scroll) ── */}
      {/* paddingTop = safe-area inset: the camera notch / status bar must not
          overlap the logo row on notched devices. */}
      <header
        className="sticky top-0 z-40 border-b border-[#262930] bg-[#17191e]/90 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6cb4ee] to-[#4a90d9]">
              <Sparkles className="size-4.5 text-[#0d0f12]" />
              {/* Soft accent halo — one static shadow layer, no animation. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-xl shadow-[0_0_18px_rgba(108,180,238,0.35)]"
              />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight">VidFetch</h1>
              {tab === "download" ? (
                <span className="mt-0.5 inline-flex items-center rounded-full border border-[#6cb4ee]/25 bg-[#6cb4ee]/10 px-1.5 py-px text-[10px] font-semibold text-[#6cb4ee]">
                  v2.6.2
                </span>
              ) : (
                <p className="truncate text-[11px] text-[#8e8e93]">
                  Yardım Merkezi &amp; Hakkında
                </p>
              )}
            </div>
            {/* Desktop-only inline nav (the bottom island is a touch pattern) */}
            <nav className="ml-4 hidden items-center gap-1 sm:flex">
              {NAV.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
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
      {/* pb clears the floating island bar (56px + 14px + safe-area inset). */}
      <main className="pb-28">
        {tab === "download" && (
          <>
            <DownloaderCard
              inputRef={inputRef}
              resultsRef={resultsRef}
              className="mx-auto max-w-2xl px-4 pt-4"
              showInlineHistory={false}
            />
            {/* History belongs to the download section: same place the files
                were saved, same flow (analyze again with one tap). */}
            <HistoryTab />
          </>
        )}
        {tab === "support" && <SettingsTab />}
      </main>

      {/* ── Bottom Nav (floating island, never full width) ── */}
      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}