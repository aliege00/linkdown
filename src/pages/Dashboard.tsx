import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  getDownloadHistory,
  clearDownloadHistory,
  type DownloadRecord,
} from "@/lib/history";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  FileVideo,
  ListVideo,
  LogOut,
  Sparkles,
  Trash2,
  Clock,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
  HelpCircle,
  Lightbulb,
  ChevronDown,
  Settings2,
  CheckCircle2,
  Globe,
  Link,
} from "lucide-react";
import { useMemo, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import { HELP_CONTENT, type HelpLang } from "@/lib/help-content";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.05 } },
};

/* ─── Copy Command ────────────────────────────────────────────── */
function CopyCommand({
  command,
  label,
  copiedLabel,
}: {
  command: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* noop */ }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-background/50 px-2 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground cursor-pointer"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("download");
  const [history, setHistory] = useState<DownloadRecord[]>(() => getDownloadHistory());
  const [helpLang, setHelpLang] = useState<HelpLang>(() => {
    try {
      const s = localStorage.getItem("vidfetch.helpLang");
      return s === "en" || s === "tr" ? s : "tr";
    } catch { return "tr"; }
  });

  const videoCount = history.filter((h) => h.kind === "video").length;
  const playlistCount = history.length - videoCount;

  const handleClearHistory = () => {
    clearDownloadHistory();
    setHistory([]);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const copyLink = useCallback(async (record: DownloadRecord) => {
    try { await navigator.clipboard.writeText(record.url); } catch { /* noop */ }
  }, []);

  const help = HELP_CONTENT[helpLang];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ═══ Header ═══ */}
      <header className="sticky top-0 z-40 glass-card rounded-none border-x-0 border-t-0 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">
              VidFetch
            </h1>
            <p className="text-[10px] text-muted-foreground/70 truncate">
              {user?.name ? `${user.name}` : "Guest"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 ios-btn"
            onClick={handleSignOut}
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* ═══ Main Content ═══ */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 pt-4 pb-28">
        <AnimatePresence mode="wait">
          {/* ── Download Tab ── */}
          {tab === "download" && (
            <motion.div
              key="download"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="mx-auto max-w-2xl space-y-4"
            >
              {/* Quick Actions */}
              <Card
                className="glass-card cursor-pointer hover:shadow-lg transition-shadow duration-300"
                onClick={() => navigate("/")}
              >
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Download className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">Yeni indirme başlat</p>
                    <p className="text-sm text-muted-foreground/70 mt-0.5">
                      YouTube, TikTok ve 1000+ siteden indir
                    </p>
                  </div>
                  <Link className="size-4 text-muted-foreground/40 shrink-0" />
                </CardContent>
              </Card>

              {/* Engine Status */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                      <CheckCircle2 className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">İndirme motoru hazır</p>
                      <p className="text-xs text-muted-foreground/70">
                        Her şey bu cihazda çalışır — sunucu yok, API anahtarı yok
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { icon: Sparkles, label: "Sunucu yok" },
                      { icon: Download, label: "Sınırsız" },
                      { icon: ShieldAlert, label: "Gizli" },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/5 dark:bg-white/[0.02] border border-border/20"
                      >
                        <item.icon className="size-4 text-primary/60" />
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Supported Platforms */}
              <Card className="glass-card">
                <CardContent className="p-5">
                  <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">
                    Desteklenen Platformlar
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["YouTube", "TikTok", "Twitter/X", "Instagram", "Vimeo", "Facebook", "Twitch"].map((p) => (
                      <span
                        key={p}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 dark:bg-white/[0.03] border border-border/20 text-muted-foreground/80"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Queue / History Tab ── */}
          {tab === "queue" && (
            <motion.div
              key="queue"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="mx-auto max-w-2xl space-y-4"
            >
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Toplam", value: history.length, color: "text-primary" },
                  { label: "Video", value: videoCount, color: "text-blue-400" },
                  { label: "Liste", value: playlistCount, color: "text-emerald-400" },
                ].map((stat) => (
                  <Card key={stat.label} className="glass-card">
                    <CardContent className="p-3 text-center">
                      <p className={cn("text-xl font-bold", stat.color)}>
                        {stat.value}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {stat.label}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* History List */}
              <Card className="glass-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground/60" />
                      <p className="text-sm font-semibold">Son indirmeler</p>
                    </div>
                    {history.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs ios-btn"
                        onClick={handleClearHistory}
                      >
                        <Trash2 className="size-3" />
                        Temizle
                      </Button>
                    )}
                  </div>

                  {history.length === 0 ? (
                    <div className="text-center py-10">
                      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-white/5 dark:bg-white/[0.02]">
                        <Download className="size-5 text-muted-foreground/40" />
                      </div>
                      <p className="text-sm text-muted-foreground/60">
                        Henüz indirme yok
                      </p>
                      <p className="text-xs text-muted-foreground/40 mt-1">
                        İndirilen videolar burada görünecek
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/20">
                      {history.slice(0, 10).map((record) => (
                        <li key={record.id} className="flex items-center gap-3 py-3 group">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            {record.kind === "playlist" ? (
                              <ListVideo className="size-4" />
                            ) : (
                              <FileVideo className="size-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {record.title}
                            </p>
                            <p className="text-xs text-muted-foreground/60">
                              {record.formatLabel || "video"} ·{" "}
                              {new Date(record.time).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 ios-btn sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              onClick={() => copyLink(record)}
                            >
                              <Copy className="size-3" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-[10px] ios-btn sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                              onClick={() => navigate(`/?url=${encodeURIComponent(record.url)}`)}
                            >
                              <RefreshCw className="size-3" />
                              İndir
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── Help Tab ── */}
          {tab === "help" && (
            <motion.div
              key="help"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="mx-auto max-w-2xl space-y-4"
            >
              {/* Language Toggle */}
              <div className="flex justify-center">
                <div className="flex items-center gap-0.5 rounded-full border border-border/30 bg-white/5 dark:bg-white/[0.02] p-0.5">
                  <button
                    type="button"
                    onClick={() => { setHelpLang("tr"); localStorage.setItem("vidfetch.helpLang", "tr"); }}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-xs font-medium transition-colors ios-btn",
                      helpLang === "tr"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Türkçe
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHelpLang("en"); localStorage.setItem("vidfetch.helpLang", "en"); }}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-xs font-medium transition-colors ios-btn",
                      helpLang === "en"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    English
                  </button>
                </div>
              </div>

              {/* Help Content Tabs */}
              <Card className="glass-card">
                <CardContent className="p-4">
                  <Tabs defaultValue="bot">
                    <TabsList className="w-full h-auto grid grid-cols-3 gap-0.5 p-1">
                      <TabsTrigger
                        value="bot"
                        className="gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal text-center"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                        {help.tabs.bot}
                      </TabsTrigger>
                      <TabsTrigger
                        value="errors"
                        className="gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal text-center"
                      >
                        <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                        {help.tabs.errors}
                      </TabsTrigger>
                      <TabsTrigger
                        value="tips"
                        className="gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal text-center"
                      >
                        <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                        {help.tabs.tips}
                      </TabsTrigger>
                    </TabsList>

                    {/* Bot check tab */}
                    <TabsContent value="bot" className="mt-4">
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-semibold flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-primary" />
                            {help.bot.introTitle}
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                            {help.bot.intro}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold mb-1.5">{help.bot.fixesTitle}</p>
                          <div className="space-y-2">
                            {help.bot.fixes.map((fix, i) => (
                              <div
                                key={i}
                                className="rounded-xl border border-border/30 bg-white/3 dark:bg-white/[0.01] p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                    {i + 1}
                                  </span>
                                  <p className="text-sm font-medium">{fix.title}</p>
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  {fix.body}
                                </p>
                                {"command" in fix && fix.command && (
                                  <div className="mt-2 flex items-start gap-2">
                                    <code className="flex-1 min-w-0 break-all rounded-lg border border-border/30 bg-white/3 dark:bg-white/[0.01] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                                      {fix.command}
                                    </code>
                                    <CopyCommand
                                      command={fix.command}
                                      label={help.copyLabel}
                                      copiedLabel={help.copiedLabel}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    {/* Errors tab */}
                    <TabsContent value="errors" className="mt-4">
                      <p className="text-sm font-semibold mb-1">{help.errors.title}</p>
                      <div className="space-y-2">
                        {help.errors.items.map((item, i) => (
                          <div
                            key={i}
                            className="rounded-xl border border-border/30 bg-white/3 dark:bg-white/[0.01] p-3"
                          >
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{item.what}</p>
                            <p className="mt-1 flex items-start gap-1.5 text-xs text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              {item.fix}
                            </p>
                          </div>
                        ))}
                      </div>
                    </TabsContent>

                    {/* Tips tab */}
                    <TabsContent value="tips" className="mt-4">
                      <p className="text-sm font-semibold mb-1">{help.tips.title}</p>
                      <div className="space-y-2">
                        {help.tips.items.map((item, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 rounded-xl border border-border/30 bg-white/3 dark:bg-white/[0.01] p-3"
                          >
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                              <Lightbulb className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{item.title}</p>
                              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                                {item.body}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              {/* About VidFetch */}
              <Card className="glass-card">
                <CardContent className="p-4">
                  <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">
                    Hakkında
                  </p>
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">
                    VidFetch,{" "}
                    <a
                      href="https://github.com/yt-dlp/yt-dlp"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-medium"
                    >
                      yt-dlp
                    </a>{" "}
                    motorunu doğrudan cihazınızda çalıştırır. Sunucu, bulut veya hesap yoktur.
                    1000+ site desteklenir — sınırsız, anahtarsız indirme.
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ═══ iOS Bottom Tab Bar ═══ */}
      <BottomTabBar
        active={tab}
        onChange={setTab}
        queueCount={history.length}
      />
    </div>
  );
}
