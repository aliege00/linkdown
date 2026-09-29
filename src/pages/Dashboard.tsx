import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sparkles, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import DownloaderCard from "@/components/DownloaderCard";
import HistoryTab from "@/components/tabs/HistoryTab";
import SettingsTab from "@/components/tabs/SettingsTab";
import { useRef } from "react";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("download");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="min-h-screen bg-[#0d0f12] text-[#e8e8e8]">
      {/* ── Top Bar (sticky, small, never blocks scroll) ── */}
      <header className="sticky top-0 z-40 border-b border-[#262930] bg-[#17191e]">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#6cb4ee]">
              <Sparkles className="size-4 text-[#0d0f12]" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold">VidFetch</h1>
              <p className="truncate text-[11px] text-[#8e8e93]">
                v2.3.3 · {user?.name || "Guest"}
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
