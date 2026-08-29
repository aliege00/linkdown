import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import DownloaderTab from "@/components/tabs/DownloaderTab";
import HistoryTab from "@/components/tabs/HistoryTab";
import SettingsTab from "@/components/tabs/SettingsTab";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("download");

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      {/* ── Top Bar ── */}
      <header className="pointer-events-auto sticky top-0 z-40 mx-3 mt-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-xl backdrop-saturate-[1.8] shadow-[0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.08)] dark:bg-white/[0.04] dark:border-white/[0.06] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-lg shadow-cyan-500/20">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight bg-gradient-to-r from-cyan-500 to-violet-500 bg-clip-text text-transparent">
                VidFetch
              </h1>
              <p className="truncate text-[10px] text-muted-foreground/70">
                v2.0 · {user?.name || "Guest"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={async () => {
                await signOut();
                navigate("/");
              }}
              title="Çıkış"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Active Tab ── */}
      <main className="pointer-events-auto flex-1 px-4 pt-4 pb-32">
        {tab === "download" && <DownloaderTab />}
        {tab === "help" && <HistoryTab />}
        {tab === "about" && <SettingsTab />}
      </main>

      {/* ── Bottom Nav ── */}
      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
