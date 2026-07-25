import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Download,
  ExternalLink,
  Film,
  Globe,
  Link,
  Loader2,
  Monitor,
  Shield,
  Sparkles,
  Video,
  Youtube,
  X,
  FileVideo,
  Music,
  Image,
  Globe2,
  Zap,
  Crown,
  ArrowRight,
  Check,
  Copy,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";

// ─── types ────────────────────────────────────────────────────────────
interface DownloadState {
  status: "idle" | "checking" | "ready" | "downloading" | "complete" | "error";
  message: string;
  progress: number;
  videoUrl: string | null;
  fileName: string | null;
  fileSize: string | null;
  contentType: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────
const SUPPORTED_VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v", "3gp"];
const SUPPORTED_AUDIO_EXTS = ["mp3", "wav", "aac", "ogg", "flac", "m4a"];
const SUPPORTED_IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg"];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isDirectMediaUrl(urlStr: string): { isMedia: boolean; type: "video" | "audio" | "image" | "unknown"; ext: string | null } {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    const ext = pathname.split(".").pop() || null;
    if (ext && SUPPORTED_VIDEO_EXTS.includes(ext)) return { isMedia: true, type: "video", ext };
    if (ext && SUPPORTED_AUDIO_EXTS.includes(ext)) return { isMedia: true, type: "audio", ext };
    if (ext && SUPPORTED_IMAGE_EXTS.includes(ext)) return { isMedia: true, type: "image", ext };
    return { isMedia: false, type: "unknown", ext };
  } catch {
    return { isMedia: false, type: "unknown", ext: null };
  }
}

function getConvexUrl(): string {
  return (import.meta as any).env.VITE_CONVUX_URL || "";
}

// ─── Component ───────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, signIn } = useAuth();
  const [url, setUrl] = useState("");
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
    message: "",
    progress: 0,
    videoUrl: null,
    fileName: null,
    fileSize: null,
    contentType: null,
  });
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const downloaderRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0.85]);

  // Scroll to downloader
  const scrollToDownloader = () => {
    downloaderRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => inputRef.current?.focus(), 600);
  };

  // ─── Download logic ────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    if (!url.trim()) return;

    const trimmedUrl = url.trim();
    const mediaInfo = isDirectMediaUrl(trimmedUrl);

    setDownloadState({
      status: "checking",
      message: "Analyzing link...",
      progress: 0,
      videoUrl: null,
      fileName: null,
      fileSize: null,
      contentType: null,
    });

    try {
      if (mediaInfo.isMedia && mediaInfo.type === "video") {
        // Direct video URL — try direct download first
        setDownloadState(prev => ({
          ...prev,
          status: "downloading",
          message: "Fetching video...",
          progress: 25,
        }));

        const response = await fetch(trimmedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) throw new Error(`Server responded with ${response.status}`);

        const contentType = response.headers.get("content-type") || "video/mp4";
        const contentLength = response.headers.get("content-length");
        const size = contentLength ? parseInt(contentLength) : 0;

        setDownloadState(prev => ({
          ...prev,
          status: "downloading",
          message: "Downloading...",
          progress: 50,
          contentType,
          fileSize: size ? formatFileSize(size) : "Unknown",
          fileName: `video.${mediaInfo.ext || "mp4"}`,
        }));

        const reader = response.body?.getReader();
        if (!reader) {
          // Fallback: just get the blob
          const blob = await response.blob();
          triggerDownload(blob, `video.${mediaInfo.ext || "mp4"}`, contentType);
          setDownloadState(prev => ({
            ...prev,
            status: "complete",
            message: "Download complete!",
            progress: 100,
            videoUrl: URL.createObjectURL(blob),
            fileName: `video.${mediaInfo.ext || "mp4"}`,
            fileSize: formatFileSize(blob.size),
            contentType,
          }));
          return;
        }

        const chunks: Uint8Array[] = [];
        let downloadedBytes = 0;
        const totalBytes = contentLength ? parseInt(contentLength) : 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          downloadedBytes += value.length;
          if (totalBytes > 0) {
            setDownloadState(prev => ({
              ...prev,
              progress: Math.round((downloadedBytes / totalBytes) * 100),
            }));
          }
        }

        const blob = new Blob(chunks as BlobPart[], { type: contentType });
        triggerDownload(blob, `video.${mediaInfo.ext || "mp4"}`, contentType);

        setDownloadState({
          status: "complete",
          message: "Download complete!",
          progress: 100,
          videoUrl: URL.createObjectURL(blob),
          fileName: `video.${mediaInfo.ext || "mp4"}`,
          fileSize: formatFileSize(blob.size),
          contentType,
        });
      } else {
        // Non-direct URL — try the Convex proxy download
        setDownloadState(prev => ({
          ...prev,
          status: "downloading",
          message: "Preparing proxy download...",
          progress: 30,
        }));

        // Use the Convex HTTP proxy
        const convexUrl = getConvexUrl();
        const proxyUrl = `${convexUrl}/proxy-download?url=${encodeURIComponent(trimmedUrl)}`;

        // Open in a new tab / trigger download via link
        const a = document.createElement("a");
        a.href = proxyUrl;
        a.download = "video";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setDownloadState({
          status: "complete",
          message: "Download started via proxy!",
          progress: 100,
          videoUrl: null,
          fileName: "video",
          fileSize: null,
          contentType: null,
        });
      }
    } catch (error) {
      // Fallback: try the Convex proxy
      try {
        const convexUrl = getConvexUrl();
        const proxyUrl = `${convexUrl}/proxy-download?url=${encodeURIComponent(trimmedUrl)}`;
        const a = document.createElement("a");
        a.href = proxyUrl;
        a.download = "video";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setDownloadState({
          status: "complete",
          message: "Download started via proxy!",
          progress: 100,
          videoUrl: null,
          fileName: "video",
          fileSize: null,
          contentType: null,
        });
      } catch (proxyError) {
        setDownloadState({
          status: "error",
          message: error instanceof Error ? error.message : "Download failed. Try a direct video URL.",
          progress: 0,
          videoUrl: null,
          fileName: null,
          fileSize: null,
          contentType: null,
        });
      }
    }
  }, [url]);

  function triggerDownload(blob: Blob, filename: string, contentType: string) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      // Fallback: focus and let user paste manually
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && url.trim()) {
      handleDownload();
    }
  };

  const resetState = () => {
    setDownloadState({
      status: "idle",
      message: "",
      progress: 0,
      videoUrl: null,
      fileName: null,
      fileSize: null,
      contentType: null,
    });
  };

  const handleNewDownload = () => {
    resetState();
    setUrl("");
    inputRef.current?.focus();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── FAQ data ──────────────────────────────────────────────────────
  const faqs = [
    {
      q: "How does this video downloader work?",
      a: "Paste any direct video URL (ending in .mp4, .webm, .mov, etc.) and hit download. We fetch the video through our proxy server and stream it directly to you. No registration required.",
    },
    {
      q: "What types of URLs are supported?",
      a: "We support direct video file URLs (.mp4, .webm, .mov, .avi, .mkv, .flv, .wmv), audio files (.mp3, .wav, .aac), and images (.jpg, .png, .gif). For platform URLs (YouTube, Vimeo, etc.), we route through our download proxy.",
    },
    {
      q: "Is this service free?",
      a: "Yes! This is completely free to use. No hidden charges, no registration needed. Just paste and download.",
    },
    {
      q: "Are there any file size limits?",
      a: "Direct downloads have no file size limit. Proxy downloads may have a limit based on available bandwidth. Large files (>500MB) may take longer to process.",
    },
    {
      q: "Is my privacy protected?",
      a: "We do not log, store, or track any videos you download. All processing happens in-memory and nothing is persisted on our servers. Your downloads are private.",
    },
  ];

  // ─── Render ────────────────────────────────────────────────────────
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
            <button onClick={scrollToDownloader} className="hover:text-foreground transition-colors cursor-pointer">
              Download
            </button>
            <button onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })} className="hover:text-foreground transition-colors cursor-pointer">
              Features
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
          <Button size="sm" variant="ghost" className="sm:hidden" onClick={() => navigate(isAuthenticated ? "/dashboard" : "/auth")}>
            {isAuthenticated ? "Dashboard" : "Sign in"}
          </Button>
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
            <Badge variant="outline" className="gap-1.5 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary">
              <Sparkles className="h-3 w-3" />
              Free &amp; open downloader
            </Badge>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]"
          >
            Download any{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
              video
            </span>
            {" "}instantly
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Paste a link, tap download. No sign-ups, no limits, no fuss.
            Just fast, free video downloading.
          </motion.p>

          {/* Downloader Card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            ref={downloaderRef}
            className="mt-10 mx-auto max-w-2xl"
          >
            <Card className="border-border/50 shadow-lg shadow-primary/5 bg-card/95 backdrop-blur-sm">
              <CardContent className="p-4 sm:p-6">
                <AnimatePresence mode="wait">
                  {downloadState.status === "complete" || downloadState.status === "error" ? (
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="space-y-4"
                    >
                      {downloadState.status === "complete" ? (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/30">
                              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                            </div>
                            <div className="text-left">
                              <p className="font-semibold text-foreground">Download ready!</p>
                              <p className="text-sm text-muted-foreground">
                                {downloadState.fileName}
                                {downloadState.fileSize ? ` \u00B7 ${downloadState.fileSize}` : ""}
                              </p>
                            </div>
                          </div>
                          {downloadState.videoUrl && (
                            <video
                              src={downloadState.videoUrl}
                              controls
                              className="w-full rounded-lg border border-border/40 bg-black/5 max-h-64"
                            />
                          )}
                          <Button onClick={handleNewDownload} variant="outline" className="w-full gap-2">
                            <Download className="h-4 w-4" />
                            Download another
                          </Button>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/30">
                              <X className="h-6 w-6 text-red-500" />
                            </div>
                            <div className="text-left">
                              <p className="font-semibold text-foreground">Download failed</p>
                              <p className="text-sm text-muted-foreground">{downloadState.message}</p>
                            </div>
                          </div>
                          <Button onClick={handleNewDownload} variant="outline" className="w-full gap-2">
                            Try again
                          </Button>
                        </>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="input"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            ref={inputRef}
                            type="url"
                            placeholder="Paste video URL here..."
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="pl-10 h-12 text-base border-border/60 bg-background/50 focus-visible:ring-primary/20"
                          />
                          {url && (
                            <button
                              onClick={() => setUrl("")}
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
                          className="h-12 w-12 shrink-0 border-border/60"
                          title="Paste from clipboard"
                        >
                          <ClipboardPaste className="h-4.5 w-4.5" />
                        </Button>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={handleDownload}
                          disabled={!url.trim() || downloadState.status === "checking" || downloadState.status === "downloading"}
                          size="lg"
                          className={cn(
                            "flex-1 h-12 gap-2 text-base font-medium transition-all",
                            url.trim() ? "shadow-md shadow-primary/20" : ""
                          )}
                        >
                          {downloadState.status === "checking" || downloadState.status === "downloading" ? (
                            <>
                              <Loader2 className="h-5 w-5 animate-spin" />
                              {downloadState.status === "checking" ? "Checking..." : `${downloadState.progress}%`}
                            </>
                          ) : (
                            <>
                              <Download className="h-5 w-5" />
                              Download
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Progress bar */}
                      {(downloadState.status === "downloading" || downloadState.status === "checking") && (
                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                          <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${downloadState.progress}%` }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                          />
                        </div>
                      )}

                      <p className="text-xs text-center text-muted-foreground/70">
                        Supports direct video URLs (.mp4, .webm, .mov, .avi, .mkv)
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 6, 0] }}
          transition={{ delay: 1, y: { repeat: Infinity, duration: 2 } }}
          onClick={() => featuresRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className="h-6 w-6" />
        </motion.button>
      </motion.section>

      {/* ═══ How it Works ═══ */}
      <section className="relative px-6 py-24 border-t border-border/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge variant="outline" className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary">
              How it works
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Three simple steps
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              No account needed. No complicated settings. Just paste and go.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: ClipboardPaste,
                title: "Paste the link",
                description: "Copy any video URL from the web and paste it into the input field above.",
                step: "01",
              },
              {
                icon: Download,
                title: "Click download",
                description: "Hit the download button and watch as we fetch and prepare your video.",
                step: "02",
              },
              {
                icon: CheckCircle2,
                title: "Save & enjoy",
                description: "The video saves directly to your device. Watch it offline, anywhere.",
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

      {/* ═══ Supported Formats ═══ */}
      <section ref={featuresRef} className="relative px-6 py-24 border-t border-border/30 bg-muted/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge variant="outline" className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary">
              Formats
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Everything you need
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              Wide format support means your videos always work.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Video, label: "MP4", desc: "Most compatible", formats: [".mp4", ".m4v"] },
              { icon: Film, label: "WebM", desc: "Modern & efficient", formats: [".webm"] },
              { icon: Monitor, label: "MOV / AVI", desc: "Professional formats", formats: [".mov", ".avi"] },
              { icon: FileVideo, label: "MKV / FLV", desc: "Advanced containers", formats: [".mkv", ".flv", ".wmv"] },
              { icon: Music, label: "Audio", desc: "MP3, WAV, AAC", formats: [".mp3", ".wav", ".aac", ".ogg"] },
              { icon: Image, label: "Images", desc: "JPG, PNG, GIF", formats: [".jpg", ".png", ".gif", ".webp"] },
              { icon: Globe, label: "Web links", desc: "Proxy download", formats: ["YouTube", "Vimeo", "More"] },
              { icon: Shield, label: "Secure", desc: "No tracking", formats: ["Private", "Safe", "Free"] },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="border-border/30 shadow-none hover:shadow-sm hover:border-border/60 transition-all duration-300 h-full group">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background border border-border/40 text-primary group-hover:bg-primary/5 transition-colors">
                      <item.icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {item.formats.map((f) => (
                          <span key={f} className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground/70 font-mono">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section className="relative px-6 py-24 border-t border-border/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-16"
          >
            <Badge variant="outline" className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary">
              Features
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Why choose VidFetch
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                title: "Lightning fast",
                desc: "Powered by edge-optimized proxies for the fastest possible download speeds.",
              },
              {
                icon: Crown,
                title: "Completely free",
                desc: "No premium tiers, no hidden limits. Every feature is free for everyone.",
              },
              {
                icon: Shield,
                title: "Privacy first",
                desc: "We never store your downloads. No logs, no tracking, no data collection.",
              },
              {
                icon: Globe2,
                title: "Universal links",
                desc: "Works with direct video URLs from any website or platform worldwide.",
              },
              {
                icon: Monitor,
                title: "Preview before download",
                desc: "See what you're downloading with our built-in video preview player.",
              },
              {
                icon: Sparkles,
                title: "Beautiful interface",
                desc: "Clean, modern design that makes downloading videos effortless and enjoyable.",
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
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ═══ */}
      <section className="relative px-6 py-24 border-t border-border/30 bg-muted/30">
        <div className="mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-center mb-12"
          >
            <Badge variant="outline" className="mb-4 px-4 py-1.5 text-xs font-normal border-primary/20 bg-primary/5 text-primary">
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
                    faqOpen === i ? "border-primary/30 shadow-sm" : "hover:border-border/60"
                  )}
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="font-medium text-sm sm:text-base">{faq.q}</h3>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                          faqOpen === i && "rotate-180"
                        )}
                      />
                    </div>
                    <AnimatePresence>
                      {faqOpen === i && (
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
      <section className="relative px-6 py-24 border-t border-border/30">
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
            Paste your link above or create an account to save your download history.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" onClick={scrollToDownloader} className="gap-2">
              <Download className="h-4 w-4" />
              Start downloading
            </Button>
            {!isAuthenticated && (
              <Button size="lg" variant="outline" onClick={() => navigate("/auth")} className="gap-2">
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
              Free video downloader. No limits, no tracking, no fuss.
            </p>
          </div>
        </div>
      </footer>
    </motion.div>
  );
}
