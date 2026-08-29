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
  HelpCircle,
  Info,
  CheckCircle2,
  Globe,
  ShieldAlert,
  Lightbulb,
  Link,
} from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import { HELP_CONTENT, type HelpLang } from "@/lib/help-content";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/* ─── Copy Command ────────────────────────────────────────────── */
function CopyCommand({ command, label, copiedLabel }: { command: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };
  return (
    <button type="button" onClick={copy}
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
    try { const s = localStorage.getItem("vidfetch.helpLang"); return s === "en" || s === "tr" ? s : "tr"; } catch { return "tr"; }
  });

  const videoCount = history.filter((h) => h.kind === "video").length;
  const playlistCount = history.length - videoCount;

  const handleClearHistory = () => { clearDownloadHistory(); setHistory([]); };
  const handleSignOut = async () => { await signOut(); navigate("/"); };
  const copyLink = useCallback(async (record: DownloadRecord) => { try { await navigator.clipboard.writeText(record.url); } catch { /* noop */ } }, []);
  const help = HELP_CONTENT[helpLang];

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ contain: "layout style" }}>
      {/* ═══ Floating Glass Top Bar ═══ */}
      <header className="sticky top-0 z-40 liquid-glass-card rounded-b-2xl mx-3 mt-2 px-4 py-3 flex items-center justify-between gap-3" style={{ contain: "layout" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-lg shadow-cyan-500/20">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate bg-gradient-to-r from-cyan-500 to-violet-500 bg-clip-text text-transparent">VidFetch</h1>
            <p className="text-[10px] text-muted-foreground/70 truncate">v1.2 · {user?.name || "Guest"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="size-8 ios-btn" onClick={handleSignOut} title="Çıkış">
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* ═══ Main Content ═══ */}
      <main className="flex-1 px-4 pt-4 pb-28">
        <AnimatePresence mode="wait">
          {/* ── İndir Tab ── */}
          {tab === "download" && (
            <motion.div key="download" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="mx-auto max-w-2xl space-y-4">
              {/* Hero Input Card */}
              <div className="liquid-glass-card p-5 space-y-4" style={{ contain: "layout style" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Download className="size-4 text-cyan-400" />
                  <p className="text-sm font-semibold">Video İndir</p>
                </div>
                <div className="neon-glow-input flex items-center gap-2 rounded-2xl bg-white/5 dark:bg-white/[0.03] border border-white/15 px-4 py-3 transition-all duration-300">
                  <input
                    type="url"
                    placeholder="YouTube, TikTok, Instagram linkini yapıştırın..."
                    className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/50"
                    readOnly
                  />
                  <button type="button" className="shrink-0 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors" onClick={() => navigate("/")}>
                    <Link className="size-4 text-muted-foreground" />
                  </button>
                </div>
                {/* Format Hub */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Format:</span>
                  <div className="flex gap-1.5">
                    {["MP4", "MP3"].map((fmt) => (
                      <span key={fmt} className={cn("px-3 py-1 rounded-full text-[11px] font-semibold border transition-all", fmt === "MP4" ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-400" : "bg-violet-500/15 border-violet-500/30 text-violet-400")}>
                        {fmt}
                      </span>
                    ))}
                  </div>
                </div>
                <Button className="w-full ios-btn rounded-2xl h-12 bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-600 hover:to-violet-600 text-white font-semibold shadow-lg shadow-cyan-500/20" onClick={() => navigate("/")}>
                  <Download className="size-4 mr-2" />
                  İndirmeyi Başlat
                </Button>
              </div>

              {/* Engine Status */}
              <div className="liquid-glass-card p-5" style={{ contain: "layout" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Motor hazır</p>
                    <p className="text-xs text-muted-foreground/70">Cihazda çalışır — sunucu yok</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: Sparkles, label: "Sunucu yok" },
                    { icon: Download, label: "Sınırsız" },
                    { icon: ShieldAlert, label: "Gizli" },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/5 dark:bg-white/[0.02] border border-border/20">
                      <item.icon className="size-4 text-primary/60" />
                      <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Desteklenen Platformlar */}
              <div className="liquid-glass-card p-5" style={{ contain: "layout" }}>
                <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-3">Desteklenen Platformlar</p>
                <div className="flex flex-wrap gap-2">
                  {["YouTube", "TikTok", "Twitter/X", "Instagram", "Vimeo", "Facebook", "Twitch"].map((p) => (
                    <span key={p} className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 dark:bg-white/[0.03] border border-border/20 text-muted-foreground/80">{p}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Yardım Tab ── */}
          {tab === "help" && (
            <motion.div key="help" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="mx-auto max-w-2xl space-y-4">
              <div className="flex justify-center">
                <div className="flex items-center gap-0.5 rounded-full border border-border/30 bg-white/5 dark:bg-white/[0.02] p-0.5">
                  {(["tr", "en"] as const).map((lang) => (
                    <button key={lang} type="button" onClick={() => { setHelpLang(lang); localStorage.setItem("vidfetch.helpLang", lang); }}
                      className={cn("rounded-full px-4 py-1.5 text-xs font-medium transition-colors ios-btn", helpLang === lang ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                    >{lang === "tr" ? "Türkçe" : "English"}</button>
                  ))}
                </div>
              </div>
              <div className="liquid-glass-card p-4" style={{ contain: "layout" }}>
                <Tabs defaultValue="bot">
                  <TabsList className="w-full h-auto grid grid-cols-3 gap-0.5 p-1">
                    <TabsTrigger value="bot" className="gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal text-center"><ShieldAlert className="h-3.5 w-3.5 shrink-0" />{help.tabs.bot}</TabsTrigger>
                    <TabsTrigger value="errors" className="gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal text-center"><HelpCircle className="h-3.5 w-3.5 shrink-0" />{help.tabs.errors}</TabsTrigger>
                    <TabsTrigger value="tips" className="gap-1 px-1 py-2 text-[11px] leading-tight whitespace-normal text-center"><Lightbulb className="h-3.5 w-3.5 shrink-0" />{help.tabs.tips}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="bot" className="mt-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-semibold flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-primary" />{help.bot.introTitle}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1">{help.bot.intro}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold mb-1.5">{help.bot.fixesTitle}</p>
                        <div className="space-y-2">
                          {help.bot.fixes.map((fix, i) => (
                            <div key={i} className="rounded-xl border border-border/30 bg-white/3 dark:bg-white/[0.01] p-3">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{i + 1}</span>
                                <p className="text-sm font-medium">{fix.title}</p>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{fix.body}</p>
                              {"command" in fix && fix.command && (
                                <div className="mt-2 flex items-start gap-2">
                                  <code className="flex-1 min-w-0 break-all rounded-lg border border-border/30 bg-white/3 dark:bg-white/[0.01] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">{fix.command}</code>
                                  <CopyCommand command={fix.command} label={help.copyLabel} copiedLabel={help.copiedLabel} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="errors" className="mt-4">
                    <p className="text-sm font-semibold mb-1">{help.errors.title}</p>
                    <div className="space-y-2">
                      {help.errors.items.map((item, i) => (
                        <div key={i} className="rounded-xl border border-border/30 bg-white/3 dark:bg-white/[0.01] p-3">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.what}</p>
                          <p className="mt-1 flex items-start gap-1.5 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />{item.fix}</p>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="tips" className="mt-4">
                    <p className="text-sm font-semibold mb-1">{help.tips.title}</p>
                    <div className="space-y-2">
                      {help.tips.items.map((item, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-xl border border-border/30 bg-white/3 dark:bg-white/[0.01] p-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500"><Lightbulb className="h-4 w-4" /></div>
                          <div><p className="text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{item.body}</p></div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </motion.div>
          )}

          {/* ── Hakkında Tab ── */}
          {tab === "about" && (
            <motion.div key="about" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="mx-auto max-w-2xl space-y-4">
              <div className="liquid-glass-card p-5 text-center space-y-3" style={{ contain: "layout" }}>
                <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-xl shadow-cyan-500/25">
                  <Sparkles className="size-7" />
                </div>
                <h2 className="text-xl font-bold bg-gradient-to-r from-cyan-500 to-violet-500 bg-clip-text text-transparent">VidFetch</h2>
                <p className="text-xs text-muted-foreground/70">v1.2 · On-device video downloader</p>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  {[
                    { label: "Motor", value: "yt-dlp" },
                    { label: "Platform", value: "1000+" },
                    { label: "Ücret", value: "Ücretsiz" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-white/5 dark:bg-white/[0.02] border border-border/20 p-3">
                      <p className="text-lg font-bold text-primary">{s.value}</p>
                      <p className="text-[10px] text-muted-foreground/60">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="liquid-glass-card p-5" style={{ contain: "layout" }}>
                <p className="text-xs text-muted-foreground/70 leading-relaxed text-center">
                  VidFetch, <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">yt-dlp</a> motorunu doğrudan cihazınızda çalıştırır. Sunucu, bulut veya hesap yoktur. 1000+ site desteklenir — sınırsız, anahtarsız indirme.
                </p>
              </div>
              <div className="liquid-glass-card p-4" style={{ contain: "layout" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-muted-foreground/60" />
                    <p className="text-sm font-semibold">Geçmiş</p>
                  </div>
                  {history.length > 0 && (
                    <Button variant="ghost" size="sm" className="gap-1 text-xs ios-btn" onClick={handleClearHistory}>
                      <Trash2 className="size-3" />Temizle
                    </Button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 text-center py-6">Henüz indirme yok</p>
                ) : (
                  <ul className="divide-y divide-border/20 mt-2">
                    {history.slice(0, 5).map((record) => (
                      <li key={record.id} className="flex items-center gap-3 py-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          {record.kind === "playlist" ? <ListVideo className="size-3.5" /> : <FileVideo className="size-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{record.title}</p>
                          <p className="text-[10px] text-muted-foreground/60">{record.formatLabel || "video"} · {new Date(record.time).toLocaleDateString()}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="size-6 ios-btn" onClick={() => copyLink(record)}><Copy className="size-3" /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ═══ Liquid Glass Tab Bar ═══ */}
      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
