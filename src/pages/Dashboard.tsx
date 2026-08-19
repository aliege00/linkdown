import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  getDownloadHistory,
  clearDownloadHistory,
  type DownloadRecord,
} from "@/lib/history";
import {
  motion,
  AnimatePresence,
} from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FileVideo,
  Globe,
  Infinity as InfinityIcon,
  ListVideo,
  LogOut,
  Monitor,
  Shield,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.06 } },
};

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [history, setHistory] = useState<DownloadRecord[]>(
    () => getDownloadHistory(),
  );

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

  // Most recent download time
  const lastDownload = useMemo(() => {
    if (history.length === 0) return null;
    return new Date(history[0].time);
  }, [history]);

  return (
    <main className="min-h-screen bg-background px-4 sm:px-6 py-6 sm:py-10 text-foreground">
      <motion.div
        className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:gap-8"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* ═══ Header ═══ */}
        <motion.header
          variants={fadeUp}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-xs sm:text-sm font-medium text-muted-foreground">
              Workspace
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight">
              Welcome{user?.name ? `, ${user.name}` : ""}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your on-device video downloader — private, unlimited, no server.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer gap-2 self-start active:scale-[0.97] min-h-[40px]"
              onClick={() => navigate("/")}
            >
              <Download className="size-4" />
              New download
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer gap-2 self-start active:scale-[0.97] min-h-[40px]"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </motion.header>

        {/* ═══ Stats Grid ═══ */}
        <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {[
            {
              label: "Total downloads",
              value: history.length,
              icon: Download,
              color: "text-primary",
              bg: "bg-primary/10",
            },
            {
              label: "Videos",
              value: videoCount,
              icon: FileVideo,
              color: "text-blue-500",
              bg: "bg-blue-500/10",
            },
            {
              label: "Playlists",
              value: playlistCount,
              icon: ListVideo,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
            {
              label: "Last download",
              value: lastDownload
                ? lastDownload.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : "—",
              icon: Clock,
              color: "text-amber-500",
              bg: "bg-amber-500/10",
              isText: true,
            },
          ].map((stat) => (
            <Card
              key={stat.label}
              className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200"
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${stat.bg}`}>
                  <stat.icon className={`size-5 ${stat.color}`} />
                </div>
                <div className="min-w-0">
                  <p className={`font-bold text-xl leading-none ${stat.isText ? "text-sm font-semibold mt-0.5" : ""}`}>
                    {stat.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.label}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        {/* ═══ Quick Actions ═══ */}
        <motion.div variants={fadeUp} className="grid sm:grid-cols-2 gap-4">
          <Card
            className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer border-primary/20 bg-gradient-to-br from-primary/5 to-transparent"
            onClick={() => navigate("/")}
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                <Sparkles className="size-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Start a new download</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Paste a URL and download from YouTube, TikTok, and 1000+ sites
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1 shrink-0" />
            </CardContent>
          </Card>

          <Card
            className="border-border/40 shadow-sm hover:shadow-md transition-all duration-200 group cursor-pointer"
            onClick={() => window.open("https://github.com/yt-dlp/yt-dlp", "_blank")}
          >
            <CardContent className="p-6 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-muted/80 transition-colors">
                <BookOpen className="size-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">yt-dlp documentation</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Explore the engine powering your downloads — 1000+ sites
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1 shrink-0" />
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══ Engine Status ═══ */}
        <motion.div variants={fadeUp}>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Download engine — always ready</p>
                  <p className="text-sm text-muted-foreground">
                    Everything runs right on this device — no servers, no API keys, no limits.
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                {[
                  {
                    icon: Zap,
                    title: "No server needed",
                    desc: "The phone or desktop app is the engine. Nothing to deploy.",
                  },
                  {
                    icon: InfinityIcon,
                    title: "Unlimited downloads",
                    desc: "No rate limits, no API keys, no monthly caps. Ever.",
                  },
                  {
                    icon: Shield,
                    title: "Private by design",
                    desc: "Videos are processed and saved on your device — nothing leaves it.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="p-4 rounded-xl border border-border/30 bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3">
                      <item.icon className="size-4" />
                    </div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══ Recent Downloads ═══ */}
        <motion.div variants={fadeUp}>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <TrendingUp className="size-5" />
                  </div>
                  <div>
                    <p className="font-semibold">Recent downloads</p>
                    <p className="text-sm text-muted-foreground">
                      Your latest downloads, stored privately on this device
                    </p>
                  </div>
                </div>
                {history.length > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="font-semibold text-foreground">{history.length}</span> total
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="font-semibold text-foreground">{videoCount}</span> videos
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="font-semibold text-foreground">{playlistCount}</span> playlists
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 cursor-pointer"
                      onClick={handleClearHistory}
                    >
                      <Trash2 className="size-3.5" />
                      Clear
                    </Button>
                  </div>
                )}
              </div>

              <AnimatePresence mode="wait">
                {history.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center py-10"
                  >
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted/50">
                      <Download className="size-6 text-muted-foreground/60" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      No downloads yet
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Paste a link on the downloader page and your finished downloads will appear here.
                    </p>
                  </motion.div>
                ) : (
                  <motion.ul
                    key="list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="divide-y divide-border/40"
                  >
                    {history.slice(0, 8).map((record, i) => (
                      <motion.li
                        key={record.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-center gap-3 py-3 group"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
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
                          <p className="text-xs text-muted-foreground">
                            {record.kind === "playlist"
                              ? `${record.count ?? ""} videos · playlist`
                              : record.formatLabel || "video"}
                            {" · "}
                            {new Date(record.time).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 shrink-0 cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          onClick={() => navigate(`/?url=${encodeURIComponent(record.url)}`)}
                        >
                          <Download className="size-3.5" />
                          Again
                        </Button>
                      </motion.li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══ Platform Cards ═══ */}
        <motion.div variants={fadeUp}>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Globe className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Take the engine anywhere</p>
                  <p className="text-sm text-muted-foreground">
                    One app, fully self-contained on every device you use
                  </p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  {
                    name: "Android (APK)",
                    desc: "The full yt-dlp engine runs on your phone. Downloads continue in the background with progress notifications, and videos land in your chosen folder.",
                    icon: Smartphone,
                    color: "text-emerald-500",
                    bg: "bg-emerald-500/10",
                  },
                  {
                    name: "Windows (EXE)",
                    desc: "A portable desktop app with the engine built in. No install, no setup — just paste and download.",
                    icon: Monitor,
                    color: "text-blue-500",
                    bg: "bg-blue-500/10",
                  },
                ].map((option) => (
                  <div
                    key={option.name}
                    className="p-5 rounded-xl border border-border/30 hover:border-border/60 hover:bg-muted/30 transition-all duration-200 group"
                  >
                    <div className={`flex size-10 items-center justify-center rounded-xl ${option.bg} mb-3`}>
                      <option.icon className={`size-5 ${option.color}`} />
                    </div>
                    <p className="font-semibold">{option.name}</p>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      {option.desc}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══ About ═══ */}
        <motion.div variants={fadeUp}>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">About VidFetch</p>
                  <p className="text-sm text-muted-foreground">
                    A video downloader that lives entirely on your device
                  </p>
                </div>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  VidFetch wraps{" "}
                  <a
                    href="https://github.com/yt-dlp/yt-dlp"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium"
                  >
                    yt-dlp
                  </a>
                  , the most powerful video extraction engine available, directly into your
                  phone and desktop apps.
                </p>
                <p>
                  There is no server, no cloud, and no account to manage &mdash; the device
                  you're holding is the engine. Your downloads never pass through
                  third-party services.
                </p>
                <p>
                  Supports over 1,000 sites including YouTube, TikTok, Twitter/X,
                  Instagram, Vimeo, Facebook, Twitch, and more &mdash; with unlimited,
                  key-free downloads.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </main>
  );
}
