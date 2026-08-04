import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  getVideoInfo,
  startDownload,
  openFile,
  getDownloads,
  pickFolder,
  getDownloadLocation,
  resetDownloadLocation,
  isNativeAvailable,
  formatDuration,
  formatSize,
  type YtDlpFormat,
  type YtDlpInfo,
  type DownloadEntry,
  type CompletedDownload,
  type DownloadLocation,
} from "@/lib/ytdlp-native";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Clock,
  Crown,
  Download,
  ExternalLink,
  Film,
  Globe,
  Image,
  Keyboard,
  Link,
  Loader2,
  Monitor,
  Music,
  Play,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  User,
  Video,
  X,
  Zap,
  AlertCircle,
  Smartphone,
  Youtube,
  FileVideo,
  FolderCog,
  FolderOpen,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback, memo } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";

// ─── Types ────────────────────────────────────────────────────────────

type PageState = "idle" | "loading" | "loaded" | "downloading" | "complete" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────

// Build fingerprint injected by index.html (fix10, etc.) so a screenshot of
// the app or its footer tells us exactly which APK/EXE build is installed.
const BUILD_TAG =
  typeof window !== "undefined"
    ? ((window as any).__VIDFETCH_BUILD__ as string | undefined) ?? null
    : null;

function groupFormats(formats: YtDlpFormat[]) {
  const video: YtDlpFormat[] = [];
  const videoOnly: YtDlpFormat[] = [];
  const audioOnly: YtDlpFormat[] = [];

  for (const f of formats) {
    if (f.vcodec && f.acodec) video.push(f);
    else if (f.vcodec) videoOnly.push(f);
    else audioOnly.push(f);
  }

  return { video, videoOnly, audioOnly };
}

function getQualityLabel(resolution: string): string {
  if (resolution.includes("2160") || resolution.includes("4k")) return "4K";
  if (resolution.includes("1440") || resolution.includes("2k")) return "1440p";
  if (resolution.includes("1080")) return "1080p";
  if (resolution.includes("720")) return "720p";
  if (resolution.includes("480")) return "480p";
  if (resolution.includes("360")) return "360p";
  if (resolution.includes("240")) return "240p";
  if (resolution.includes("144")) return "144p";
  return resolution;
}

// ─── Component ────────────────────────────────────────────────────────

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, signIn } = useAuth();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<PageState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [videoInfo, setVideoInfo] = useState<YtDlpInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState({
    percent: 0,
    speed: "0",
    eta: "--:--",
  });
  const [footerOpen, setFooterOpen] = useState<number | null>(null);
  const [savedDownloads, setSavedDownloads] = useState<DownloadEntry[]>([]);
  const [lastCompleted, setLastCompleted] = useState<CompletedDownload | null>(null);
  const [downloadLocation, setDownloadLocation] = useState<DownloadLocation | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const nativeAvailable = isNativeAvailable();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0.85]);

  // Load the list of files already saved (APK only) + the chosen location
  useEffect(() => {
    if (!isNativeAvailable()) return;
    getDownloads().then((list) => {
      if (list.length > 0) setSavedDownloads(list);
    });
    getDownloadLocation().then((loc) => {
      if (loc?.uri) setDownloadLocation(loc);
    });
  }, []);

  // Stable callback so memoized FormatCards don't re-render on progress ticks
  const handleSelectFormat = useCallback((id: string) => setSelectedFormat(id), []);

  const handlePickFolder = useCallback(async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    try {
      const loc = await pickFolder();
      if (loc?.uri) {
        setDownloadLocation(loc);
        const list = await getDownloads();
        setSavedDownloads(list);
      }
    } finally {
      setPickingFolder(false);
    }
  }, [pickingFolder]);

  const handleResetLocation = useCallback(async () => {
    await resetDownloadLocation();
    setDownloadLocation(null);
    const list = await getDownloads();
    setSavedDownloads(list);
  }, []);

  // Scroll to results
  const scrollToResults = () => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  };

  // ─── Fetch video info ──────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!url.trim()) return;

    setState("loading");
    setErrorMsg("");
    setVideoInfo(null);
    setSelectedFormat("");

    const result = await getVideoInfo(url.trim());

    if (!result.success) {
      setErrorMsg(result.error);
      setState("error");
      return;
    }

    setVideoInfo(result);
    setSelectedFormat(result.best_format_id);
    setState("loaded");
    scrollToResults();
  }, [url]);

  // ─── Download ──────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    if (!url.trim() || !selectedFormat) return;

    setState("downloading");
    setErrorMsg("");
    setDownloadProgress({ percent: 0, speed: "0", eta: "--:--" });

    const workId = await startDownload(
      url.trim(),
      selectedFormat,
      (progress) => {
        // Real-time progress updates from the native foreground service
        setDownloadProgress({
          percent: progress.percent,
          speed: progress.speed,
          eta: progress.eta,
        });

        // Auto-complete when we hit 100%
        if (progress.percent >= 100) {
          setState("complete");
        }
      },
      async (completed) => {
        // Foreground service finished — remember the file & refresh the list
        setLastCompleted(completed);
        setState("complete");
        const list = await getDownloads();
        if (list.length > 0) setSavedDownloads(list);
      },
      (error) => {
        setErrorMsg(error);
        setState("error");
      }
    );

    if (!workId) {
      // The on-device engine only exists inside the APK / EXE build.
      // In a plain browser there is nothing to do the download — be honest.
      setErrorMsg(
        "This preview runs in a browser, where there is no download engine. Install the Android APK or the Windows EXE — the engine runs right on your device. No server, no API key, unlimited."
      );
      setState("error");
      return;
    } else {
      // If we got a workId but never hit 100% from the callback,
      // poll for a short while then show complete
      setTimeout(() => {
        setState((s) => (s === "downloading" ? "complete" : s));
      }, 2000);
    }

    // Reset "complete" state after a delay
    setTimeout(() => {
      setState((s) => (s === "complete" ? "loaded" : s));
    }, 5000);
  }, [url, selectedFormat]);

  // ─── Paste ─────────────────────────────────────────────────────────
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && url.trim() && state !== "loading") {
      handleAnalyze();
    }
  };

  const resetAll = () => {
    setState("idle");
    setErrorMsg("");
    setVideoInfo(null);
    setSelectedFormat("");
    setUrl("");
    inputRef.current?.focus();
  };

  const handleNewDownload = () => {
    resetAll();
  };

  // ─── Video info ────────────────────────────────────────────────────
  const grouped = videoInfo ? groupFormats(videoInfo.formats) : null;

  // ─── FAQ data ──────────────────────────────────────────────────────
  const faqs = [
    {
      q: "How does VidFetch work?",
      a: "Paste any video URL from YouTube, TikTok, Twitter/X, Instagram, Vimeo, and thousands of other sites. The built-in yt-dlp engine extracts the video and saves it straight to your device. No sign-ups required.",
    },
    {
      q: "What sites are supported?",
      a: "Over 1,000 sites including YouTube, TikTok, Twitter/X, Instagram, Vimeo, Facebook, Reddit, Twitch, Dailymotion, and many more. If you can watch it online, we can probably download it.",
    },
    {
      q: "Do I need a server or an API key?",
      a: "No. There is no server — the phone or the desktop app IS the engine. Everything runs on your device, completely free and unlimited, with no API keys and no setup.",
    },
    {
      q: "Is this service free?",
      a: "Yes — 100% free and unlimited. No accounts, no API keys, no rate limits, no monthly caps. Your device does all the work.",
    },
    {
      q: "Are there any file size limits?",
      a: "None at all. Since downloads run on your device, the only limit is your own storage space.",
    },
    {
      q: "Is my privacy protected?",
      a: "Yes. Everything happens on your device — videos are downloaded directly to your phone or PC. Nothing is ever uploaded to a server, and we don't log or track anything.",
    },
  ];

  // ─── Page render ───────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col overflow-x-hidden"
    >
      {/* ═══ Navigation ═══ */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Download className="h-4.5 w-4.5" />
            </div>
            <span className="text-base font-semibold tracking-tight">VidFetch</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
            <button
              onClick={() => inputRef.current?.focus()}
              className="hover:text-foreground transition-colors cursor-pointer"
            >
              Download
            </button>
            <button
              onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="hover:text-foreground transition-colors cursor-pointer"
            >
              How it works
            </button>
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate("/dashboard")}>
                Dashboard
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => navigate("/auth")}>
                Sign in
              </Button>
            )}
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              className="sm:hidden"
              onClick={() => navigate(isAuthenticated ? "/dashboard" : "/auth")}
            >
              {isAuthenticated ? "Dashboard" : "Sign in"}
            </Button>
          </div>
        </div>
      </header>

      {/* ═══ Hero ═══ */}
      <motion.section
        style={{ opacity: heroOpacity }}
        className="relative min-h-[90vh] flex flex-col items-center justify-center px-6 pt-24 pb-16"
      >
        {/* Subtle background grid */}
        <div className="absolute inset-0 bg-subtle-grid pointer-events-none" />

        {/* Decorative glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />

        <div className="relative z-10 mx-auto max-w-4xl text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6 flex justify-center"
          >
            <Badge
              variant="outline"
              className="gap-1.5 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              <Sparkles className="h-3 w-3" />
              Powered by yt-dlp
            </Badge>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]"
          >
            Download from{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
              1000+ sites
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            YouTube, TikTok, Twitter/X, Instagram &mdash; paste any video link,
            pick your quality, and download. The engine runs right on your device.
          </motion.p>

          {/* Downloader Card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-10 mx-auto max-w-2xl"
          >
            <Card className="border-border/50 shadow-lg shadow-primary/5 bg-card/95 backdrop-blur-sm">
              <CardContent className="p-4 sm:p-6 space-y-4">
                {/* On-device engine note */}
                <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                  <div className="text-left text-sm">
                    <p className="font-medium text-emerald-800 dark:text-emerald-300">
                      No server. No API key. Unlimited.
                    </p>
                    <p className="text-emerald-600 dark:text-emerald-400/80 mt-0.5">
                      The download engine runs entirely on your device — the Android app
                      and the Windows app both have it built in.
                    </p>
                  </div>
                </div>

                {/* URL Input */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={inputRef}
                      type="url"
                      placeholder="Paste video URL from YouTube, TikTok, Twitter..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="pl-10 pr-10 h-12 text-base border-border/60 bg-background/50 focus-visible:ring-primary/20"
                    />
                    {url && (
                      <button
                        onClick={() => {
                          setUrl("");
                          setState("idle");
                          setVideoInfo(null);
                          setErrorMsg("");
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    onClick={handlePaste}
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 shrink-0 border-border/60 relative group/paste"
                    title="Paste from clipboard"
                    aria-label="Paste from clipboard"
                  >
                    <ClipboardPaste className="h-4.5 w-4.5" />
                    <kbd className="absolute -top-1.5 -right-1.5 hidden sm:inline-flex items-center justify-center h-4 min-w-[1.25rem] px-1 rounded-[3px] text-[9px] font-mono font-semibold bg-muted text-muted-foreground/60 border border-border/40 shadow-sm">
                      ⌘V
                    </kbd>
                  </Button>
                </div>

                <AnimatePresence mode="wait">
                  {/* ── Idle / URL entered ── */}
                  {state === "idle" && (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Button
                        onClick={handleAnalyze}
                        disabled={!url.trim()}
                        size="lg"
                        className={cn(
                          "w-full h-12 gap-2 text-base font-medium transition-all active:scale-[0.98]",
                          url.trim() && "shadow-md shadow-primary/20",
                        )}
                      >
                        <Search className="h-5 w-5" />
                        Analyze & Download
                      </Button>
                      <p className="text-xs text-center text-muted-foreground/70 mt-3">
                        Supports YouTube, TikTok, Twitter/X, Instagram, Vimeo, and 1000+ more
                      </p>

                      {/* Example URLs — shown when input is empty */}
                      {!url.trim() && (
                        <div className="mt-4 pt-3 border-t border-border/20">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-center mb-2.5">
                            Try an example
                          </p>
                          <div className="flex flex-wrap justify-center gap-1.5">
                            {[
                              { label: "YouTube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
                              { label: "TikTok", url: "https://www.tiktok.com/@nba/video/7441322573611494702" },
                              { label: "Twitter/X", url: "https://x.com/NASA/status/1868180428428595520" },
                            ].map((ex) => (
                              <button
                                key={ex.label}
                                onClick={() => {
                                  setUrl(ex.url);
                                  setTimeout(() => inputRef.current?.focus(), 50);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 border border-border/20 hover:border-border/50 transition-all duration-150"
                              >
                                {ex.label === "YouTube" && <Youtube className="h-3 w-3 text-red-400" />}
                                <span>{ex.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* ── Loading ── */}
                  {state === "loading" && (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="flex flex-col items-center gap-4 py-8"
                    >
                      <div className="relative">
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                        <div className="absolute inset-0 animate-ping opacity-20 rounded-full bg-primary" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-foreground">
                          Extracting video info
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Analyzing video&hellip;
                        </p>
                      </div>
                      <div className="w-full max-w-xs bg-muted rounded-full h-1.5 overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full"
                          initial={{ width: "0%" }}
                          animate={{ width: "100%" }}
                          transition={{
                            duration: 6,
                            ease: "easeInOut",
                            repeat: Infinity,
                          }}
                        />
                      </div>
                    </motion.div>
                  )}

                  {/* ── Error ── */}
                  {state === "error" && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      className="space-y-3"
                    >
                      <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30">
                        <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                        <div className="text-left text-sm">
                          <p className="font-medium text-red-800 dark:text-red-300">
                            Failed to analyze video
                          </p>
                          <p className="text-red-600 dark:text-red-400/80 mt-1 text-xs leading-relaxed">
                            {errorMsg}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={handleAnalyze} variant="default" className="flex-1 gap-2 active:scale-[0.97]">
                          <RefreshCw className="h-4 w-4" />
                          Retry
                        </Button>
                        <Button onClick={resetAll} variant="outline" className="gap-2 active:scale-[0.97]">
                          <X className="h-4 w-4" />
                          Clear
                        </Button>
                      </div>
                    </motion.div>
                  )}

                  {/* ── Loaded (video info shown) ── */}
                  {state === "loaded" && videoInfo && (
                    <motion.div
                      key="loaded"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4"
                    >
                      {/* Video info header */}
                      <div className="flex flex-col sm:flex-row gap-4">
                        {videoInfo.thumbnail && (
                          <div className="relative shrink-0 w-full sm:w-48 aspect-video sm:aspect-[16/9] rounded-lg overflow-hidden border border-border/40 bg-muted">
                            <img
                              src={videoInfo.thumbnail}
                              alt={videoInfo.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                            <div className="absolute bottom-1.5 right-1.5">
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0.5 bg-black/70 text-white border-none"
                              >
                                <Clock className="h-2.5 w-2.5 mr-0.5" />
                                {formatDuration(videoInfo.duration)}
                              </Badge>
                            </div>
                          </div>
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <h3 className="font-semibold text-foreground line-clamp-2 leading-snug">
                            {videoInfo.title}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              {videoInfo.uploader}
                            </span>
                            {videoInfo.duration && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {formatDuration(videoInfo.duration)}
                              </span>
                            )}
                          </div>
                          {videoInfo.webpage_url && (
                            <a
                              href={videoInfo.webpage_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open original
                            </a>
                          )}
                        </div>
                      </div>

                      <Separator />

                      {/* Format selector */}
                      <div className="text-left">
                        <p className="text-sm font-medium text-foreground mb-3">
                          Choose quality
                        </p>

                        {grouped && (
                          <div className="space-y-3">
                            {/* Video + Audio formats */}
                            {grouped.video.length > 0 && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">
                                  Video + Audio
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {grouped.video.slice(0, 9).map((f) => (
                                    <FormatCard
                                      key={f.format_id}
                                      format={f}
                                      selected={selectedFormat === f.format_id}
                                      onSelect={handleSelectFormat}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Video only formats (high quality, needs separate audio) */}
                            {grouped.videoOnly.length > 0 &&
                              videoInfo.ffmpeg_available && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">
                                    Video Only (requires ffmpeg)
                                  </p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {grouped.videoOnly.slice(0, 6).map((f) => (
                                      <FormatCard
                                        key={f.format_id}
                                        format={f}
                                        selected={selectedFormat === f.format_id}
                                        onSelect={() =>
                                          setSelectedFormat(f.format_id)
                                        }
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}

                            {/* Audio only */}
                            {grouped.audioOnly.length > 0 && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">
                                  Audio Only
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {grouped.audioOnly.slice(0, 6).map((f) => (
                                    <FormatCard
                                      key={f.format_id}
                                      format={f}
                                      selected={selectedFormat === f.format_id}
                                      onSelect={handleSelectFormat}
                                      audio
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {grouped.video.length === 0 &&
                              grouped.audioOnly.length === 0 &&
                              grouped.videoOnly.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                  No downloadable formats found for this video.
                                </p>
                              )}
                          </div>
                        )}
                      </div>

                      <Button
                        onClick={handleDownload}
                        disabled={!selectedFormat}
                        size="lg"
                        className="w-full h-12 gap-2 text-base font-medium shadow-md shadow-primary/20"
                      >
                        <Download className="h-5 w-5" />
                        Download{" "}
                        {videoInfo.best_format_id === selectedFormat
                          ? "(Best Quality)"
                          : ""}
                      </Button>
                    </motion.div>
                  )}

                  {/* ── Downloading (with real-time progress) ── */}
                  {state === "downloading" && (
                    <motion.div
                      key="downloading"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="space-y-5 py-2"
                    >
                      {/* Animated progress ring */}
                      <div className="flex justify-center">
                        <div className="relative w-24 h-24">
                          {/* Background circle */}
                          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                            <circle
                              cx="50" cy="50" r="42"
                              fill="none"
                              strokeWidth="6"
                              className="stroke-muted/50"
                            />
                            <motion.circle
                              cx="50" cy="50" r="42"
                              fill="none"
                              strokeWidth="6"
                              strokeLinecap="round"
                              className="stroke-primary"
                              initial={{ pathLength: 0 }}
                              animate={{ pathLength: downloadProgress.percent / 100 }}
                              transition={{ duration: 0.4, ease: "easeOut" }}
                            />
                          </svg>
                          {/* Percentage in the center */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <motion.span
                              key={downloadProgress.percent}
                              initial={{ opacity: 0.5, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="text-2xl font-bold tabular-nums"
                            >
                              {downloadProgress.percent}%
                            </motion.span>
                          </div>
                        </div>
                      </div>

                      {/* Speed + ETA row */}
                      <div className="flex items-center justify-center gap-6 text-sm">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          <span className="font-mono text-xs tabular-nums">
                            {downloadProgress.speed}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="font-mono text-xs tabular-nums">
                            ETA {downloadProgress.eta}
                          </span>
                        </div>
                      </div>

                      {/* Linear progress bar */}
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-full"
                          initial={{ width: "0%" }}
                          animate={{ width: `${downloadProgress.percent}%` }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                        />
                      </div>

                      <p className="text-xs text-center text-muted-foreground">
                        Downloading in background &mdash; you can leave this page
                      </p>

                      <Button
                        onClick={() => handleNewDownload()}
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                      >
                        <X className="h-4 w-4" />
                        Cancel &amp; start new
                      </Button>
                    </motion.div>
                  )}

                  {/* ── Download Complete ── */}
                  {state === "complete" && (
                    <motion.div
                      key="complete"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 300, damping: 22 }}
                      className="text-center py-4"
                    >
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                        className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/30"
                      >
                        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      </motion.div>
                      <div className="text-center mb-4">
                        <p className="font-semibold text-foreground text-lg">
                          Ready!
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Video saved to <strong>Downloads/VidFetch</strong>
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        {lastCompleted?.uri && (
                          <Button
                            onClick={() => {
                              if (lastCompleted?.uri) openFile(lastCompleted.uri);
                            }}
                            variant="default"
                            className="flex-1 gap-2 active:scale-[0.97]"
                          >
                            <FolderOpen className="h-4 w-4" />
                            Open video
                          </Button>
                        )}
                        <Button
                          onClick={handleNewDownload}
                          variant={lastCompleted?.uri ? "outline" : "default"}
                          className="flex-1 gap-2 active:scale-[0.97]"
                        >
                          <Download className="h-4 w-4" />
                          Download another
                        </Button>
                        <Button onClick={handleDownload} variant="outline" className="flex-1 gap-2 active:scale-[0.97]">
                          <RefreshCw className="h-4 w-4" />
                          Try again
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>

          {/* Recent downloads (APK only) */}
          {nativeAvailable && (
            <div className="mt-6 mx-auto max-w-2xl">
              <Card className="border-border/50 shadow-sm bg-card/95 backdrop-blur-sm">
                <CardContent className="p-4 sm:p-5 text-left">
                  {/* Download location — changeable via the system folder picker */}
                  <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border/30">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <FolderCog className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                        Download location
                      </p>
                      <p className="text-sm font-semibold truncate">
                        {downloadLocation?.uri ? downloadLocation.name : "Downloads/VidFetch"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 shrink-0"
                      onClick={handlePickFolder}
                      disabled={pickingFolder}
                    >
                      {pickingFolder ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FolderCog className="h-3.5 w-3.5" />
                      )}
                      Change
                    </Button>
                    {downloadLocation?.uri && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 shrink-0"
                        onClick={handleResetLocation}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reset
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-primary" />
                      Recent downloads
                      {savedDownloads.length > 0 && (
                        <span className="text-xs font-normal text-muted-foreground">
                          ({savedDownloads.length})
                        </span>
                      )}
                    </p>
                  </div>
                  {savedDownloads.length === 0 ? (
                    <p className="text-sm text-muted-foreground/80 text-center py-4">
                      Videos you download will appear here.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {savedDownloads.map((dl) => (
                        <li key={dl.uri} className="flex items-center gap-3 py-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FileVideo className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{dl.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {dl.size ? formatSize(dl.size) : "—"}
                              {dl.date
                                ? ` · ${new Date(dl.date * 1000).toLocaleDateString()}`
                                : ""}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 shrink-0"
                            onClick={() => openFile(dl.uri)}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            Open
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Scroll indicator */}
        {state === "idle" && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, 6, 0] }}
            transition={{ delay: 1, y: { repeat: Infinity, duration: 2 } }}
            onClick={() =>
              featuresRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="h-6 w-6" />
          </motion.button>
        )}
      </motion.section>

      {/* ═══ Results / Video Info (scroll target) ═══ */}
      <div ref={resultsRef} />

      {/* ═══ How it Works ═══ */}
      <section ref={featuresRef} className="scroll-mt-20 relative px-6 py-24 border-t border-border/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              How it works
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Your device is the engine
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              No servers to deploy. No API keys to manage. It just works.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Smartphone,
                title: "Engine on your device",
                description:
                  "The yt-dlp engine is built into the Android and Windows apps. No server, no API key, no setup.",
                step: "01",
              },
              {
                icon: Youtube,
                title: "Paste & analyze",
                description:
                  "Paste any video URL. VidFetch's on-device engine extracts the metadata and available formats instantly.",
                step: "02",
              },
              {
                icon: Download,
                title: "Choose & download",
                description:
                  "Pick your preferred quality from 4K to audio-only. The video saves directly to your device.",
                step: "03",
              },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="border-border/40 shadow-sm hover:shadow-md hover:border-border/70 transition-all duration-300 h-full group">
                  <CardContent className="p-8 flex flex-col items-start gap-4">
                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground/40 uppercase">
                      Step {item.step}
                    </span>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                      <item.icon className="h-5.5 w-5.5" />
                    </div>
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Supported Sites ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30 bg-muted/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              Supported sites
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Over 1,000 platforms
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Powered by yt-dlp &mdash; the most comprehensive video extraction engine.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Youtube, label: "YouTube", desc: "Videos, Shorts, playlists", color: "text-red-500" },
              { icon: Video, label: "TikTok", desc: "Videos, livestreams", color: "text-pink-400" },
              { icon: Monitor, label: "Twitter/X", desc: "Tweets with media", color: "text-sky-400" },
              { icon: Film, label: "Instagram", desc: "Reels, posts, stories", color: "text-purple-400" },
              { icon: Globe, label: "Vimeo", desc: "HD videos", color: "text-blue-400" },
              { icon: Play, label: "Facebook", desc: "Public videos", color: "text-blue-600" },
              { icon: FileVideo, label: "Twitch", desc: "Clips, VODs", color: "text-violet-500" },
              { icon: Music, label: "SoundCloud", desc: "Tracks, playlists", color: "text-orange-400" },
              { icon: Image, label: "Reddit", desc: "Videos in posts", color: "text-orange-500" },
              { icon: Globe, label: "Dailymotion", desc: "User uploads", color: "text-blue-500" },
              { icon: Video, label: "VK", desc: "Social videos", color: "text-blue-400" },
              { icon: Zap, label: "1000+ more", desc: "Any site yt-dlp supports", color: "text-primary" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className="border-border/30 shadow-none hover:shadow-sm hover:border-border/60 transition-all duration-300 h-full group">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background border border-border/40 transition-colors group-hover:bg-primary/5",
                        item.color,
                      )}
                    >
                      <item.icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              Features
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Why you'll love it
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: "Your data stays on your device",
                desc: "Downloads run locally on your phone or PC. Zero third-party requests, zero logs, zero tracking.",
              },
              {
                icon: Zap,
                title: "Unlimited downloads",
                desc: "No rate limits, no API keys, no monthly caps. Download as many videos as you want.",
              },
              {
                icon: Crown,
                title: "Best quality possible",
                desc: "yt-dlp extracts the highest quality available — up to 4K, 60fps, with proper audio.",
              },
              {
                icon: Globe,
                title: "1000+ sites supported",
                desc: "YouTube, TikTok, Twitter, Instagram, Vimeo, Facebook, Twitch, and thousands more.",
              },
              {
                icon: Sparkles,
                title: "Format selection UI",
                desc: "Pick exactly the resolution and format you want from a beautiful, intuitive interface.",
              },
              {
                icon: Monitor,
                title: "Runs on your device",
                desc: "The engine ships inside the app itself — phone or desktop. Nothing to host, nothing to deploy.",
              },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="border-border/30 shadow-none hover:shadow-sm hover:border-border/60 transition-all duration-300 h-full group">
                  <CardContent className="p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4 group-hover:bg-primary/15 transition-colors">
                      <feature.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold mb-1.5">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.desc}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30 bg-muted/30">
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-12"
          >
            <Badge
              variant="outline"
              className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary"
            >
              FAQ
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Frequently asked questions
            </h2>
          </motion.div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.05 }}
              >
                <Card
                  className={cn(
                    "border-border/30 shadow-none cursor-pointer transition-all duration-200",
                    footerOpen === i
                      ? "border-primary/30 shadow-sm"
                      : "hover:border-border/60",
                  )}
                  onClick={() =>
                    setFooterOpen(footerOpen === i ? null : i)
                  }
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="font-medium text-sm sm:text-base">
                        {faq.q}
                      </h3>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                          footerOpen === i && "rotate-180",
                        )}
                      />
                    </div>
                    <AnimatePresence>
                      {footerOpen === i && (
                        <motion.p
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="mt-3 text-sm text-muted-foreground leading-relaxed overflow-hidden"
                        >
                          {faq.a}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="scroll-mt-20 relative px-6 py-24 border-t border-border/30">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mx-auto max-w-2xl text-center relative z-10"
        >
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Ready to download?
          </h2>
          <p className="mt-4 text-muted-foreground">
            No server. No API key. No limits. Paste a link and download from
            1000+ sites, right on your device.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              onClick={() => inputRef.current?.focus()}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Start downloading
            </Button>
            {!isAuthenticated && (
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/auth")}
                className="gap-2"
              >
                <ArrowRight className="h-4 w-4" />
                Create account
              </Button>
            )}
          </div>
        </motion.div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-border/30 bg-background">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Download className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">VidFetch</span>
            </div>
            <p className="text-xs text-muted-foreground">
              On-device video downloader. Powered by yt-dlp.
              {BUILD_TAG && (
                <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">
                  build {BUILD_TAG}
                </span>
              )}
            </p>
          </div>
        </div>
      </footer>
    </motion.div>
  );
}

// ─── Format Card ──────────────────────────────────────────────────────

const FormatCard = memo(function FormatCard({
  format,
  selected,
  onSelect,
  audio,
}: {
  format: YtDlpFormat;
  selected: boolean;
  onSelect: (id: string) => void;
  audio?: boolean;
}) {
  const quality = audio
    ? `${format.tbr ? `${format.tbr}kbps` : "Audio"}`
    : getQualityLabel(format.resolution);

  const ext = format.ext.toUpperCase();

  return (
    <button
      onClick={() => onSelect(format.format_id)}
      className={cn(
        "flex flex-col items-center gap-1 p-3 rounded-lg border text-center transition-all duration-200 cursor-pointer select-none",
        selected
          ? "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10 ring-1 ring-primary/20 scale-[1.02]"
          : "border-border/40 bg-background hover:border-border/70 hover:bg-muted/50 hover:shadow-sm hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
      )}
    >
      {audio ? (
        <Music className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:scale-110" />
      ) : (
        <Video className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:scale-110" />
      )}
      <span className="font-semibold text-xs">{quality}</span>
      <span className="text-[10px] text-muted-foreground/60 font-mono">
        {ext}
      </span>
      {format.filesize && (
        <span className="text-[9px] text-muted-foreground/50">
          {formatSize(format.filesize)}
        </span>
      )}
      {selected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="mt-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary"
        >
          <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
        </motion.div>
      )}
    </button>
  );
});


