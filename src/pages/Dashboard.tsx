import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles } from "lucide-react";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import DownloaderCard from "@/components/DownloaderCard";
import HistoryTab from "@/components/tabs/HistoryTab";
import HelpTab from "@/components/tabs/HelpTab";
import SettingsTab from "@/components/tabs/SettingsTab";
import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/hooks/use-app-settings";
import { autoSettingsForDevice } from "@/lib/app-settings";

export default function Dashboard() {
  // Three tabs, matching the three items in the floating island:
  //   1) İndirme — paste → analyze → download (+ its own history)
  //   2) Yardım  — help center (bot checks, errors, tips, AI assistant)
  //   3) Ayarlar — appearance/performance switches, AI keys, engines
const [tab, setTab] = useState<TabId>("download");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { settings, update } = useAppSettings();

  // Device-power tuning on entry: a weak phone starts with low-power + no
  // motion, a strong phone has low-power switched off. Only runs on mount
  // (entering the dashboard), and only patches values that actually differ,
  // so a mid-range device keeps whatever the user chose in Ayarlar.
  useEffect(() => {
    const patch = autoSettingsForDevice(
      navigator.hardwareConcurrency,
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    );
    if (!patch) return;
    const differs = (Object.keys(patch) as (keyof typeof patch)[]).some(
      (k) => settings[k] !== patch[k],
    );
    if (differs) update(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: re-running on every settings change would fight manual toggles
  }, []);

  const NAV: { id: TabId; label: string }[] = [
    { id: "download", label: "İndirme" },
    { id: "support", label: "Yardım" },
    { id: "settings", label: "Ayarlar" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top Bar (sticky, small, never blocks scroll) ── */}
      {/* paddingTop = safe-area inset: the camera notch / status bar must not
          overlap the logo row on notched devices. */}
      {/* Solid, NOT backdrop-blur: on Android WebView a blurred sticky
          header creates a compositing layer that swallows taps on whatever
          sits right beneath it — which is why the AI panel (the first thing
          under the header) could not be pressed. A solid fill costs nothing
          and keeps every control below the header tappable. */}
      <header
        className="sticky top-0 z-40 border-b border-border/70 bg-card"
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
                <span className="mt-0.5 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                  v2.6.8
                </span>
              ) : (
                <p className="truncate text-[11px] text-muted-foreground">
                  {tab === "settings" ? "Ayarlar" : "Yardım Merkezi"}
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
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
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
      {/* ── Active Tab (normal document flow — body scrolls, WebView-safe) ── */}
      {/* pb clears the floating island bar (56px + 14px + safe-area inset).

          Page transition: the island's pill glides between tabs, but the
          CONTENT used to swap instantly — the pill animated over a screen
          that had already changed, which read as a glitch. AnimatePresence
          with mode="wait" cross-fades the outgoing page out before the
          incoming one comes in (a short lift + fade, no layout jump).

          Deliberately transform/opacity only: both properties are
          compositor-driven, so a tab switch costs no layout or paint. The
          whole thing is also disabled by MotionConfig reducedMotion="user"
          in main.tsx, so prefers-reduced-motion users see an instant swap
          with no fade at all.

          ⚠️ The DOWNLOAD tab is deliberately NOT inside AnimatePresence.
          It used to be, and every tab switch tore the card down and built a
          brand new one. The download itself kept running (it is a WorkManager
          job, not a component), but ALL of its UI state — the progress bar,
          the page state machine, the stall watchdog, the cancel handle —
          lived in that component's React state and was destroyed with it.
          Coming back showed an empty form while the file quietly finished in
          the notification shade: "I switch tabs and the download stops".
          It now stays mounted and is hidden with `hidden` (display:none, so
          it costs no layout and no paint) while another tab is in front. */}
      <main className="pb-28">
        <div hidden={tab !== "download"}>
          <DownloaderCard
            inputRef={inputRef}
            resultsRef={resultsRef}
            className="mx-auto max-w-2xl px-4 pt-4"
            showInlineHistory={false}
          />
          {/* History belongs to the download section: same place the
              files were saved, same flow (analyze again with one tap). */}
          <HistoryTab />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {tab !== "download" && (
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {tab === "settings" ? <SettingsTab /> : <HelpTab />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Bottom Nav (floating island, never full width) ── */}
      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}