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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0d0f12] text-[#e8e8e8]">
      {/* ── Top Bar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-[#262930] bg-[#17191e] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#6cb4ee]">
            <Sparkles className="size-4 text-[#0d0f12]" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold">VidFetch</h1>
            <p className="truncate text-[11px] text-[#8e8e93]">
              v2.1.1 · {user?.name || "Guest"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-[#8e8e93]"
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
            title="Çıkış"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* ── Active Tab (fills remaining space, independent scroll) ── */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "download" && <DownloaderTab />}
        {tab === "help" && <HistoryTab />}
        {tab === "about" && <SettingsTab />}
      </main>

      {/* ── Bottom Nav ── */}
      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
