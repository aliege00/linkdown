import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getVideoInfo,
  startDownload,
  downloadOnce,
  openFile,
  getDownloads,
  pickFolder,
  getDownloadLocation,
  resetDownloadLocation,
  getYouTubeSettings,
  setCookiesBrowser,
  pickCookieFile,
  clearCookieFile,
  setPoTokenProvider,
  cancelDownload,
  isNativeAvailable,
  formatDuration,
  formatSize,
  type YtDlpFormat,
  type YtDlpInfo,
  type PlaylistEntry,
  type DownloadEntry,
  type CompletedDownload,
  type DownloadLocation,
  type YouTubeSettings,
} from "@/lib/ytdlp-native";
import { saveToGallery, type GallerySaveResult } from "@/lib/gallery-save";
import { useClipboardMonitor } from "@/hooks/use-clipboard-monitor";
import { ClipboardNotification } from "@/components/ClipboardNotification";
import WebDownloadCard from "./WebDownloadCard";
import { explainError } from "@/lib/error-help";
import { normalizeVideoUrl, extractVideoUrls } from "@/lib/url";
import MultiLinkQueue from "@/components/MultiLinkQueue";
import {
  makeQueueItems,
  runDownloadQueue,
  summarize,
  type QueueItem,
  type QueueSummary,
} from "@/lib/download-queue";
import {
  buildQualityOptions,
  defaultQualityOption,
  type QualityOption,
} from "@/lib/quality-options";
import { postDownloadCleanup } from "@/lib/auto-cleanup";
import { mp4FormatWithHeight, MP4_FORMAT_SELECTOR, MP3_FORMAT_SELECTOR, filterFormats, type FormatLike } from "@/lib/format-enforce";
import {
  DOWNLOAD_MODES,
  approxMbPerMinute,
  approxMbPerMinuteForHeight,
  dataModeSelector,
  type DownloadModeId,
} from "@/lib/download-modes";
import {
  getDownloadHistory,
  addDownloadRecord,
  clearDownloadHistory,
  type DownloadRecord,
} from "@/lib/history";
import {
  loadEngineConfig,
  planEngines,
  lastResortEngine,
  engineLabel,
  type EngineAttempt,
} from "@/lib/engines";
import {
  resolveWithCobalt,
  infoFromCobalt,
  cobaltVideoQuality,
  COBALT_FORMAT_ID,
} from "@/lib/cobalt";
import {
  resolveWithYtdlpServer,
  resolveWithSeal,
  infoFromServer,
  SERVER_FORMAT_ID,
  SEAL_FORMAT_ID,
} from "@/lib/server-engines";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownToLine,
  AlertCircle,
  Check,
  CheckCircle2,
  Cpu,
  ChevronDown,
  ClipboardPaste,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileVideo,
  FolderCog,
  FolderOpen,
  Globe,
  HelpCircle,
  Lightbulb,
  Link,
  ListVideo,
  Loader2,
  Music,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  User,
  Video,
  X,
  Youtube,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
  type KeyboardEvent,
  type RefObject,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────

export type PageState =
  | "idle"
  | "loading"
  | "loaded"
  | "downloading"
  | "complete"
  | "error";

import { HELP_CONTENT, type HelpLang } from "@/lib/help-content";


/**
 * Strict format grouping — only Progressive MP4 and MP3/M4A.
 * ALL DASH/adaptive/webm/m4s/mhtml formats are eliminated.
 */
function groupFormats(formats: YtDlpFormat[]) {
  // Cast to FormatLike for the strict filter
  const filtered = filterFormats(formats as unknown as FormatLike[]);
  return {
    video: filtered.progressiveMp4 as unknown as YtDlpFormat[],
    videoOnly: [], // REMOVED — DASH segments are never shown
    audioOnly: filtered.audioFormats as unknown as YtDlpFormat[],
  };
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

/**
 * Cheap URL-based playlist hint. Engines double-check this against
 * yt-dlp's own response, so a false positive just means the analyze
 * runs in playlist mode and reports back a single video.
 */
function looksLikePlaylist(raw: string): boolean {
  return /[?&]list=[^&\s]+/.test(raw) || /\/playlist([/?]|$)/.test(raw);
}

/**
 * How long the progress bar may sit frozen before the stall watchdog assumes
 * the completion event was lost. Generous: a real download can pause for a
 * while on a slow or congested connection, and stepping in early is what made
 * the card announce "done" mid-transfer.
 */
const STALLED_DOWNLOAD_MS = 45_000;

/** Quality presets for playlist downloads — enforced MP4 output. */
const PLAYLIST_PRESETS = [
  { id: "best", label: "Best", desc: "Best MP4 available", spec: MP4_FORMAT_SELECTOR },
  {
    id: "1080p",
    label: "1080p",
    desc: "Full HD MP4",
    spec: mp4FormatWithHeight(1080),
  },
  {
    id: "720p",
    label: "720p",
    desc: "HD MP4",
    spec: mp4FormatWithHeight(720),
  },
  {
    id: "480p",
    label: "480p",
    desc: "SD MP4",
    // Explicit height pick: stays the plain 480p cap. The bitrate-stepping
    // Data Saver selector is only for the "Veri Dostu" mode chip, where
    // "smaller file" is the whole point.
    spec: mp4FormatWithHeight(480),
  },
  { id: "audio", label: "Audio", desc: "MP3", spec: MP3_FORMAT_SELECTOR },
] as const;

// ─── Copy Command (small copy-to-clipboard button) ────────────────────

const CopyCommand = memo(function CopyCommand({
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
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-background px-2 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground cursor-pointer"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
});

// ─── Help Guide Card (bilingual help center) ──────────────────────────
// Memoized so typing in the URL input and progress updates never
// re-render this large text-heavy card.

const HelpGuideCard = memo(function HelpGuideCard({
  lang,
  onLangChange,
  showSettings,
}: {
  lang: HelpLang;
  onLangChange: (lang: HelpLang) => void;
  /** True when the native YouTube troubleshooting panel exists (APK/EXE). */
  showSettings?: boolean;
}) {
  const help = HELP_CONTENT[lang];
  const [tab, setTab] = useState("bot");
  // The native troubleshooting panel only exists inside the APK/EXE builds.
  // (showSettings is optional — fall back to the environment check.)
  const canOpenSettings = showSettings ?? isNativeAvailable();

  return (
    <div className="mt-6 mx-auto max-w-2xl" id="youtube-help-guide">
      <Card className="border-amber-500/25 bg-gradient-to-b from-amber-50/70 to-card dark:from-amber-500/5 dark:to-card shadow-sm">
        <CardContent className="p-4 sm:p-5 text-left">
          {/* Header + language toggle */}
          <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border/30">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                {help.kicker}
              </p>
              <p className="text-sm font-semibold leading-snug">
                {help.title}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border/50 bg-background p-0.5">
              <button
                type="button"
                onClick={() => onLangChange("tr")}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                  lang === "tr"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Türkçe
              </button>
              <button
                type="button"
                onClick={() => onLangChange("en")}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                  lang === "en"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                English
              </button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full h-auto grid grid-cols-3 gap-0.5 p-1">
              <TabsTrigger
                value="bot"
                className="gap-1 px-1 py-1.5 text-[11px] sm:text-xs leading-tight whitespace-normal text-center"
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                {help.tabs.bot}
              </TabsTrigger>
              <TabsTrigger
                value="errors"
                className="gap-1 px-1 py-1.5 text-[11px] sm:text-xs leading-tight whitespace-normal text-center"
              >
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                {help.tabs.errors}
              </TabsTrigger>
              <TabsTrigger
                value="tips"
                className="gap-1 px-1 py-1.5 text-[11px] sm:text-xs leading-tight whitespace-normal text-center"
              >
                <Lightbulb className="h-3.5 w-3.5 shrink-0" />
                {help.tabs.tips}
              </TabsTrigger>
            </TabsList>

            {/* ── Bot check tab ── */}
            <TabsContent value="bot" className="mt-4">
              <div className="mb-4">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  {help.bot.introTitle}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
                  {help.bot.intro}
                </p>
              </div>

              <div className="mb-4">
                <p className="text-sm font-semibold">{help.bot.causesTitle}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {help.bot.causes.map((cause, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500/70" />
                      {cause}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mb-4">
                <p className="text-sm font-semibold mb-2">{help.bot.fixesTitle}</p>
                <div className="space-y-2.5">
                  {help.bot.fixes.map((fix, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border/40 bg-background/60 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                          {i + 1}
                        </span>
                        <p className="text-sm font-medium">{fix.title}</p>
                        <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {fix.badge}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {fix.body}
                      </p>
                      {"command" in fix && fix.command && (
                        <div className="mt-2 flex items-start gap-2">
                          <code className="flex-1 min-w-0 break-all rounded-md border border-border/40 bg-background px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                            {fix.command}
                          </code>
                          <CopyCommand
                            command={fix.command}
                            label={help.copyLabel}
                            copiedLabel={help.copiedLabel}
                          />
                        </div>
                      )}
                      {"settingsKey" in fix && canOpenSettings && (
                        <button
                          type="button"
                          onClick={scrollToTroubleshooting}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 cursor-pointer"
                        >
                          <Settings2 className="h-3 w-3" />
                          {help.goToSettings}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground/70 leading-relaxed border-t border-border/30 pt-3">
                {help.bot.note}
              </p>
            </TabsContent>

            {/* ── Common errors tab ── */}
            <TabsContent value="errors" className="mt-4">
              <p className="text-sm font-semibold">{help.errors.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                {help.errors.intro}
              </p>
              <div className="mt-3 space-y-2.5">
                {help.errors.items.map((item, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border/40 bg-background/60 p-3"
                  >
                    <p className="text-sm font-medium flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-[11px] font-bold text-amber-500">
                        {i + 1}
                      </span>
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {item.what}
                    </p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-foreground/80">
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                      <span>{item.fix}</span>
                    </p>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── Tips tab ── */}
            <TabsContent value="tips" className="mt-4">
              <p className="text-sm font-semibold">{help.tips.title}</p>
              <div className="mt-3 space-y-2.5">
                {help.tips.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-border/40 bg-background/60 p-3"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                      <Lightbulb className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
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

          {/* Still stuck */}
          <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
              {help.stuck.title}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              {help.stuck.body}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

// ─── Error Box (plain-language error explanations) ────────────────────
// Converts raw engine errors into a friendly, localized explanation with
// actionable steps. Memoized so it only re-renders when the error changes.

/** Scroll to the native YouTube troubleshooting panel (APK/EXE only). */
function scrollToTroubleshooting() {
  document.getElementById("youtube-troubleshooting")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

const ErrorBox = memo(function ErrorBox({
  message,
  phase,
  lang,
  showSettings,
}: {
  message: string;
  phase: "analyze" | "download";
  lang: HelpLang;
  /** True when the native YouTube troubleshooting panel exists (APK/EXE). */
  showSettings?: boolean;
}) {
  const info = explainError(message, lang);
  // The native troubleshooting panel only exists inside the APK/EXE builds.
  // (showSettings is optional — fall back to the environment check.)
  const canOpenSettings = showSettings ?? isNativeAvailable();

  const scrollToHelpGuide = () => {
    document.getElementById("youtube-help-guide")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30">
      <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
      <div className="text-left text-sm flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-red-500/70 font-medium">
          {phase=== "download"
            ? lang === "tr"
              ? "İndirme hatası"
              : "Download error"
            : lang === "tr"
              ? "Analiz hatası"
              : "Analysis error"}
        </p>
        <p className="font-medium text-red-800 dark:text-red-300 mt-0.5">
          {info.title}
        </p>
        <p className="text-red-600 dark:text-red-400/80 mt-1 text-xs leading-relaxed">
          {info.message}
        </p>
        {info.steps.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {info.steps.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300/90 leading-relaxed"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-400" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        )}
        {info.category === "bot-check" && (
          <div className="mt-2.5 flex flex-col sm:flex-row items-stretch gap-1.5">
            <button
              type="button"
              onClick={scrollToHelpGuide}
              className="flex-1 flex items-start gap-2 rounded-md border border-amber-300/50 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-left text-[11px] leading-relaxed text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/50 cursor-pointer"
            >
              <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {lang === "tr"
                  ? "Bu bir YouTube bot kontrolü hatası — rehbere git"
                  : "This looks like a YouTube bot check — open the guide"}
              </span>
            </button>
            {canOpenSettings && (
              <button
                type="button"
                onClick={scrollToTroubleshooting}
                className="flex items-center justify-center gap-1.5 rounded-md border border-amber-300/50 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/50 cursor-pointer"
              >
                <Settings2 className="h-3.5 w-3.5 shrink-0" />
                {lang === "tr" ? "Ayarları aç" : "Open settings"}
              </button>
            )}
          </div>
        )}
        {info.technical && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] font-medium text-red-500/60 hover:text-red-500 transition-colors select-none">
              {lang === "tr" ? "Teknik detay" : "Technical detail"}
            </summary>
            <p className="mt-1 rounded-md border border-red-200/40 bg-red-50/60 dark:bg-red-950/20 px-2 py-1.5 font-mono text-[10px] leading-relaxed break-words text-red-500/60">
              {info.technical}
            </p>
          </details>
        )}
      </div>
    </div>
  );
});

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

/**
 * Resolve a URL through one of the HTTP engines (Cobalt, a self-hosted
 * yt-dlp API, or a Seal server).
 *
 * All three answer the same question — "what is the direct media file?" — so
 * they share one code path and produce the same YtDlpInfo shape with a
 * `direct_url` the on-device engine can download. A failure is returned as a
 * message instead of thrown so the caller can fall through to the next engine.
 */
async function resolveWithHttpEngine(
  engine: Exclude<EngineAttempt, "ondevice">,
  pageUrl: string,
  cfg: ReturnType<typeof loadEngineConfig>,
  opts: { audioOnly: boolean; mode: string; precise: number | "auto" },
): Promise<{ ok: true; info: YtDlpInfo } | { ok: false; message: string }> {
  const quality = cobaltVideoQuality(opts.mode, opts.precise);
  // "max" has no height of its own; every engine here tops out at 1080p.
  const requestedQuality = quality === "max" ? "1080" : quality;

  if (engine === "cobalt") {
    const res = await resolveWithCobalt({
      instance: cfg.instance,
      token: cfg.token || undefined,
      url: pageUrl,
      audioOnly: opts.audioOnly,
      mode: opts.mode,
      precise: opts.precise,
    });
    return res.ok
      ? { ok: true, info: infoFromCobalt(pageUrl, res, { audioOnly: opts.audioOnly, requestedQuality }) }
      : { ok: false, message: res.message };
  }

  const serverOpts = { audioOnly: opts.audioOnly, requestedQuality };
  const res =
    engine === "server"
      ? await resolveWithYtdlpServer(pageUrl, cfg.serverUrl, {
          ...serverOpts,
          token: cfg.serverToken || undefined,
        })
      : await resolveWithSeal(pageUrl, cfg.sealUrl, serverOpts);

  return res.ok
    ? { ok: true, info: infoFromServer(pageUrl, res.resolution, serverOpts) }
    : { ok: false, message: res.message };
}

// ─── Playlist Panel ──────────────────────────────────────────────────

const PlaylistPanel = memo(function PlaylistPanel({
  count,
  entries,
  quality,
  onQuality,
  onDownloadAll,
  onDownloadOne,
  lang,
}: {
  count: number;
  entries: PlaylistEntry[];
  quality: string;
  onQuality: (id: string) => void;
  onDownloadAll: () => void;
  /** Download ONE entry — the per-video button in the list. */
  onDownloadOne: (entry: PlaylistEntry) => void;
  lang: HelpLang;
}) {
  const tr = lang === "tr";
  return (
    <div className="space-y-4">
      {/* Quality presets — one choice applies to every video */}
      <div className="text-left">
        <p className="text-sm font-medium text-foreground mb-3">
          {tr ? "Kalite" : "Quality"}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PLAYLIST_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onQuality(p.id)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-3 rounded-lg border text-center transition-all duration-200 cursor-pointer select-none",
                quality === p.id
                  ? "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10 ring-1 ring-primary/20 scale-[1.02]"
                  : "border-border/40 bg-background hover:border-border/70 hover:bg-muted/50 hover:-translate-y-0.5 active:translate-y-0",
              )}
            >
              <span className="font-semibold text-xs">{p.label}</span>
              <span className="text-[10px] text-muted-foreground/60">
                {p.desc}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Playlist entries */}
      <div className="text-left">
        <p className="text-sm font-medium text-foreground mb-2">
          {tr ? `Videolar (${count})` : `Videos (${count})`}
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border border-border/30 rounded-lg bg-background/50">
            {tr
              ? "Liste okunuyor… Videolar burada listelenir; istediğini tek tek ya da 'Tümünü indir' ile indirebilirsin."
              : "Reading playlist… videos are listed here — grab one by one or press Download all."}
          </p>
        ) : (
          <>
            <ul className="max-h-64 overflow-y-auto divide-y divide-border/40 rounded-lg border border-border/30 bg-background/50">
              {entries.slice(0, 100).map((entry, i) => (
                <li
                  key={entry.id || i}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span className="w-6 shrink-0 text-right text-[11px] font-mono text-muted-foreground/50">
                    {i + 1}
                  </span>
                  {entry.thumbnail && (
                    <img
                      src={entry.thumbnail}
                      alt=""
                      loading="lazy"
                      className="h-9 w-14 shrink-0 rounded object-cover bg-muted"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">
                      {entry.title || `Video ${i + 1}`}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      {entry.duration ? formatDuration(entry.duration) : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDownloadOne(entry)}
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-[#6cb4ee] transition-colors hover:border-[#6cb4ee]/50 hover:bg-[#6cb4ee]/10 active:scale-95"
                    aria-label={
                      tr ? `Videoyu indir: ${entry.title}` : `Download video: ${entry.title}`
                    }
                    title={tr ? "Bu videoyu indir" : "Download this video"}
                  >
                    <Play className="size-3.5 fill-current" />
                  </button>
                </li>
              ))}
            </ul>
            {count > 100 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {tr
                  ? `İlk 100 video gösteriliyor (${count} video). "Tümünü indir" listenin tamamını indirir.`
                  : `Showing the first 100 of ${count} videos — Download all still grabs the whole playlist.`}
              </p>
            )}
          </>
        )}
      </div>

      <Button
        onClick={onDownloadAll}
        size="lg"
        className="w-full h-12 gap-2 text-base font-medium transition-shadow shadow-md shadow-primary/20"
      >
        <Download className="h-5 w-5" />
        {tr ? `Tümünü indir (${count})` : `Download all (${count})`}
      </Button>
      <p className="text-xs text-center text-muted-foreground/70 -mt-2">
        {tr
          ? "Her video tek bir liste klasörüne kaydedilir (Downloads/VidFetch)"
          : "Saves every video into one playlist folder in Downloads/VidFetch"}
      </p>
    </div>
  );
});

// ─── Native tools (APK/EXE only): download location + recent downloads + ─
// ─── YouTube troubleshooting. Memoized so progress ticks and typing in   ─
// ─── the URL input never re-render this section.                         ─

const NativeToolsPanel = memo(function NativeToolsPanel({
  isDesktop,
  downloadLocation,
  savedDownloads,
  ytSettings,
  poProviderInput,
  pickingFolder,
  pickingCookies,
  onPickFolder,
  onResetLocation,
  onOpenFile,
  onPoProviderChange,
  onSavePoProvider,
  onSetCookiesBrowser,
  onPickCookieFile,
  onClearCookieFile,
  lang,
}: {
  isDesktop: boolean;
  downloadLocation: DownloadLocation | null;
  savedDownloads: DownloadEntry[];
  ytSettings: YouTubeSettings | null;
  poProviderInput: string;
  pickingFolder: boolean;
  pickingCookies: boolean;
  onPickFolder: () => void;
  onResetLocation: () => void;
  onOpenFile: (uri: string) => void;
  onPoProviderChange: (value: string) => void;
  onSavePoProvider: () => void;
  onSetCookiesBrowser: (browser: string) => void;
  onPickCookieFile: () => void;
  onClearCookieFile: () => void;
  lang: HelpLang;
}) {
  const tr = lang === "tr";
  return (
    <div className="mt-6 mx-auto max-w-2xl">
      {/* Download location — changeable via the system folder picker */}
      <Card className="border-border/50 shadow-sm bg-card">
        <CardContent className="p-4 sm:p-5 text-left">
          <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border/30">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FolderCog className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                {tr ? "İndirme konumu" : "Download location"}
              </p>
              <p className="text-sm font-semibold truncate">
                {downloadLocation?.uri ? downloadLocation.name : "Downloads/VidFetch"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 shrink-0"
              onClick={onPickFolder}
              disabled={pickingFolder}
            >
              {pickingFolder ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderCog className="h-3.5 w-3.5" />
              )}
              {tr ? "Değiştir" : "Change"}
            </Button>
            {downloadLocation?.uri && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 shrink-0"
                onClick={onResetLocation}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {tr ? "Sıfırla" : "Reset"}
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between mb-2">              <p className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              {tr ? "Son indirmeler" : "Recent downloads"}
              {savedDownloads.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({savedDownloads.length})
                </span>
              )}
            </p>
          </div>
          {savedDownloads.length === 0 ? (              <p className="text-sm text-muted-foreground/80 text-center py-4">
              {lang === "tr"
                ? "İndirdiğin videolar burada görünecek."
                : "Videos you download will appear here."}
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
                    onClick={() => onOpenFile(dl.uri)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {tr ? "Aç" : "Open"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* YouTube anti-bot troubleshooting (optional, advanced) */}
      <Card
        id="youtube-troubleshooting"
        className="mt-4 scroll-mt-24 border-border/50 shadow-sm bg-card"
      >
        <CardContent className="p-4 sm:p-5 text-left">
          <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border/30">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Settings2 className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                Advanced
              </p>
              <p className="text-sm font-semibold">
                YouTube troubleshooting
              </p>
            </div>
          </div>

          {/* Browser cookies — desktop only */}
          {isDesktop && (
            <div className="mb-4">
              <label className="text-sm font-medium text-foreground">
                Browser cookies
              </label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Read your logged-in YouTube session from a browser to
                bypass the bot check. The browser must be closed or
                unlocked while downloading.
              </p>
              <select
                value={ytSettings?.cookiesBrowser ?? ""}
                onChange={(e) => onSetCookiesBrowser(e.target.value)}
                className="w-full h-9 rounded-md border border-border/50 bg-background px-3 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
              >
                <option value="">Off — no browser cookies</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
                <option value="opera">Opera</option>
                <option value="vivaldi">Vivaldi</option>
              </select>
            </div>
          )}

          {/* cookies.txt file — both platforms */}
          <div className="mb-4">
            <label className="text-sm font-medium text-foreground">
              cookies.txt file
            </label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Export cookies from a logged-in YouTube tab (e.g. with the
              "Get cookies.txt LOCALLY" extension) and import the file
              here.
            </p>
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate rounded-md border border-border/40 bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {ytSettings?.cookiesFileName
                  ? ytSettings.cookiesFileName
                  : "No cookies file imported"}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                onClick={onPickCookieFile}
                disabled={pickingCookies}
              >
                {pickingCookies ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5" />
                )}
                Choose file
              </Button>
              {ytSettings?.cookiesFileName && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 shrink-0"
                  onClick={onClearCookieFile}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* PO token provider — desktop only */}
          {isDesktop && (
            <div className="mb-4">
              <label className="text-sm font-medium text-foreground">
                PO token provider URL
              </label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Run the token server on this PC with:{" "}
                <code className="text-[11px]">
                  docker run -d --init -p 4416:4416
                  brainicism/bgutil-ytdlp-pot-provider
                </code>{" "}
                and enter{" "}
                <code className="text-[11px]">http://127.0.0.1:4416</code>. Leave
                empty to disable.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={poProviderInput}
                  onChange={(e) => onPoProviderChange(e.target.value)}
                  placeholder="http://127.0.0.1:4416"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={onSavePoProvider}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            These settings only affect YouTube requests. If a video
            still fails with "Sign in to confirm you're not a bot",
            import cookies from a browser where you are logged in —
            that is the most reliable fix.
          </p>
        </CardContent>
      </Card>
    </div>
  );
});

// ─── Download History (on-device, every build) ───────────────────────
// Records what the user downloaded (title, URL, kind) in localStorage so
// the list survives reloads and works even in the plain browser preview
// where there is no native downloads list.

const DownloadHistoryCard = memo(function DownloadHistoryCard({
  history,
  onUse,
  onClear,
  lang,
}: {
  history: DownloadRecord[];
  onUse: (record: DownloadRecord) => void;
  onClear: () => void;
  lang: HelpLang;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = async (record: DownloadRecord) => {
    try {
      await navigator.clipboard.writeText(record.url);
      setCopiedId(record.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  return (
    <div className="mt-6 mx-auto max-w-2xl">
      <Card className="border-border/50 shadow-sm bg-card">
        <CardContent className="p-4 sm:p-5 text-left">
          <div className="flex items-center gap-3 pb-3 mb-3 border-b border-border/30">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Clock className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                {lang === "tr" ? "Geçmiş" : "History"}
              </p>
              <p className="text-sm font-semibold">
                {lang === "tr" ? "Son indirmeler" : "Recent downloads"}
              </p>
            </div>
            {history.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 shrink-0 cursor-pointer"
                onClick={onClear}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {lang === "tr" ? "Temizle" : "Clear"}
              </Button>
            )}
          </div>

          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground/80 text-center py-4">
              {lang === "tr"
                ? "İndirdiğin videolar burada görünecek."
                : "Videos you download will appear here."}
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {history.slice(0, 8).map((record) => (
                <li
                  key={record.id}
                  className="flex items-center gap-3 py-2.5 group"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {record.kind === "playlist" ? (
                      <ListVideo className="h-4 w-4" />
                    ) : (
                      <FileVideo className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {record.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {record.kind === "playlist"
                        ? lang === "tr"
                          ? `${record.count ?? ""} video · liste`
                          : `${record.count ?? ""} videos · playlist`
                        : record.formatLabel || "video"}
                      {" · "}
                      {new Date(record.time).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyLink(record)}
                      title={
                        lang === "tr" ? "Bağlantıyı kopyala" : "Copy link"
                      }
                    >
                      {copiedId === record.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={() => onUse(record)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {lang === "tr" ? "İndir" : "Again"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

// ─── Component ────────────────────────────────────────────────────────

export default function DownloaderCard({
  inputRef,
  resultsRef,
  onStateChange,
  initialUrl,
  className,
  showInlineHistory = true,
}: {
  /** Focus target for the URL input (driven from the page nav / CTA). */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Scroll target for the video results ("scroll to results"). */
  resultsRef: RefObject<HTMLDivElement | null>;
  /** Lets the page hide the hero scroll hint while the card is busy. */
  onStateChange?: (state: PageState) => void;
  /** Prefill the URL input (e.g. re-download from the dashboard via ?url=). */
  initialUrl?: string;
  /** Optional wrapper classes so hosts (Dashboard tab) can control layout. */
  className?: string;
  /**
   * Show the compact history card inside this component. Hosts that render
   * the full HistoryTab next to the card turn this off so the same list is
   * not shown twice on one screen.
   */
  showInlineHistory?: boolean;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<PageState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [videoInfo, setVideoInfo] = useState<YtDlpInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  // Download mode (Best / Data Saver / Audio). "data" is the default —
  // the user explicitly asked for low-data downloads with small files.
  const [videoQuality, setVideoQuality] = useState<DownloadModeId>("data");
  // Precise video quality (Gelişmiş seçenekler): "auto" follows the mode
  // chip; otherwise an explicit height cap (1080/720/480).
  const [preciseQuality, setPreciseQuality] = useState<"auto" | 1080 | 720 | 480>("auto");
  // Gelişmiş seçenekler disclosure state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [playlistQuality, setPlaylistQuality] = useState<string>("best");
  const [playlistSummary, setPlaylistSummary] = useState<{
    saved: number;
    total: number | null;
    folder: string | null;
  } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    percent: number;
    speed: string;
    eta: string;
    item?: number;
    itemCount?: number;
    fileName?: string;
  }>({ percent: 0, speed: "0", eta: "--:--" });
  const [savedDownloads, setSavedDownloads] = useState<DownloadEntry[]>([]);
  const [lastCompleted, setLastCompleted] = useState<CompletedDownload | null>(null);
  const [gallerySaveState, setGallerySaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [gallerySaveResult, setGallerySaveResult] = useState<GallerySaveResult | null>(null);

  // ── Clipboard Monitor ──
  const { lastUrl: clipboardUrl, clearLastUrl } = useClipboardMonitor({
    enabled: true,
    interval: 2000,
    cooldown: 30_000,
    onUrlDetected: (url) => {
      // Auto-fill the URL input when a video URL is detected
      setUrl(url.url);
    },
  });

  const [downloadLocation, setDownloadLocation] = useState<DownloadLocation | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [ytSettings, setYtSettings] = useState<YouTubeSettings | null>(null);
  const [poProviderInput, setPoProviderInput] = useState("");
  const [pickingCookies, setPickingCookies] = useState(false);
  // Help-guide language is remembered across sessions (defaults to Turkish).
  const [helpLang, setHelpLang] = useState<HelpLang>(() => {
    try {
      const saved = localStorage.getItem("vidfetch.helpLang");
      return saved === "en" || saved === "tr" ? saved : "tr";
    } catch {
      return "tr";
    }
  });
  // Whether the visible error came from analyzing the URL or starting the
  // download — used to pick the error box's kicker label.
  const [errorPhase, setErrorPhase] = useState<"analyze" | "download">("analyze");
  const nativeAvailable = isNativeAvailable();
  // Show the right paste shortcut on the button badge (⌘V on Mac, Ctrl+V
  // everywhere else).
  const pasteShortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘V"
      : "Ctrl+V";
  // Desktop (EXE) only: browser-cookies and PO-token-provider settings are
  // not available on Android, so the UI shows them just on Windows.
  const desktopBridge = window.vidfetch;
  const isDesktop =
    !!desktopBridge &&
    typeof desktopBridge.isDesktop === "boolean" &&
    desktopBridge.isDesktop;

  // Download history (localStorage) — works in every build, including the
  // plain browser preview where there is no native downloads list.
  const [history, setHistory] = useState<DownloadRecord[]>(
    () => getDownloadHistory(),
  );
  const refreshHistory = useCallback(() => setHistory(getDownloadHistory()), []);

  // ── Multi-link queue ──────────────────────────────────────────────
  // Links parsed out of the paste box (adjacent links included). The queue
  // runs them strictly one after another — firing them all at once is what
  // made the engine crash the app.
  //
  // Selection is tracked by URL, not by generated id: ids are regenerated on
  // every keystroke, so an id-keyed selection would reset (or duplicate)
  // itself while the user is still typing.
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueSelected, setQueueSelected] = useState<Set<string>>(new Set());
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueSummary, setQueueSummary] = useState<QueueSummary>(() => summarize([]));
  const [batchQualities, setBatchQualities] = useState<QualityOption[]>([]);
  const [batchSelector, setBatchSelector] = useState("");
  const [batchProbing, setBatchProbing] = useState(false);
  const queueAbortRef = useRef({ aborted: false });

  /** Re-parse the paste box into queue rows (never blocks typing). */
  const syncLinksFromInput = useCallback((raw: string) => {
    const found = extractVideoUrls(raw);
    setQueueItems((prev) => makeQueueItems(found, prev));
    // Newly detected links start ticked; links the user unticked stay unticked.
    setQueueSelected((prev) => {
      const next = new Set(prev);
      let changed = next.size > 0 && found.length === 0;
      for (const url of found) {
        if (!next.has(url)) {
          next.add(url);
          changed = true;
        }
      }
      if (found.length === 0 && prev.size > 0) next.clear();
      return changed ? next : prev;
    });
  }, []);

  const hasBatch = queueItems.length > 1;

  const toggleQueueItem = useCallback((itemUrl: string) => {
    setQueueSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemUrl)) next.delete(itemUrl);
      else next.add(itemUrl);
      return next;
    });
  }, []);

  const selectAllQueueItems = useCallback(() => {
    setQueueSelected(new Set(queueItems.map((i) => i.url)));
  }, [queueItems]);

  const clearQueueSelection = useCallback(() => setQueueSelected(new Set()), []);

  const clearQueueList = useCallback(() => {
    setQueueItems([]);
    setQueueSelected(new Set());
    setQueueSummary(summarize([]));
    setBatchQualities([]);
    setBatchSelector("");
  }, []);

  const startBatchQueue = useCallback(async () => {
    const chosen = new Set(queueSelected);
    if (chosen.size === 0 || queueRunning) return;

    queueAbortRef.current = { aborted: false };
    setQueueRunning(true);
    setBatchProbing(true);

    // Quality list comes from the FIRST selected link's real formats — a 360p
    // clip never shows a fake 1080p chip.
    let selector = batchSelector;
    const firstUrl = normalizeVideoUrl(
      queueItems.find((i) => chosen.has(i.url))?.url ?? "",
    );
    try {
      if (firstUrl) {
        const info = await getVideoInfo(firstUrl, false);
        if (info.success) {
          const options = buildQualityOptions(info.formats as YtDlpFormat[]);
          setBatchQualities(options);
          const pick = options.find((o) => o.selector === selector) ?? defaultQualityOption(options);
          selector = pick.selector;
          setBatchSelector(selector);
          const probedUrl = firstUrl;
          setQueueItems((prev) =>
            prev.map((item) =>
              item.url === probedUrl ? { ...item, title: info.title || item.url } : item,
            ),
          );
        }
      }
    } catch (error) {
      // A failed probe must never block the queue: fall back to the chain the
      // single-link path already uses, which has last-resort terms.
      console.warn("[DownloaderCard] quality probe failed:", error);
    } finally {
      setBatchProbing(false);
    }

    if (!selector) selector = MP4_FORMAT_SELECTOR;

    const result = await runDownloadQueue(
      queueItems,
      async (item) => {
        // Only ticked links take part in this run; the rest stay pending.
        if (!chosen.has(item.url)) return { ok: false, error: "Atlandı" };
        const clean = normalizeVideoUrl(item.url);
        if (!clean) return { ok: false, error: "Geçersiz link" };
        return downloadOnce({
          url: clean,
          formatId: selector,
          isPlaylist: false,
        });
      },
      {
        signal: queueAbortRef.current,
        onChange: (items, summary) => {
          setQueueItems(items);
          setQueueSummary(summary);
        },
        onItemSettled: (item) => {
          if (item.status === "completed") {
            addDownloadRecord({
              title: item.title || item.url,
              url: item.url,
              kind: "video",
              time: Date.now(),
            });
          }
        },
      },
    );

    setQueueRunning(false);
    // Leave untouched rows as "pending" instead of marking them failed.
    setQueueItems((prev) =>
      prev.map((item) => {
        const settled = result.items.find((i) => i.id === item.id);
        if (settled && chosen.has(item.url) && settled.status === "failed") return settled;
        if (settled && chosen.has(item.url) && settled.status === "completed") return settled;
        if (settled && chosen.has(item.url) && settled.status === "cancelled") return settled;
        return item;
      }),
    );

    const list = await getDownloads().catch(() => []);
    if (list.length > 0) setSavedDownloads(list);
    refreshHistory();
  }, [batchSelector, queueItems, queueRunning, queueSelected, refreshHistory]);

  const cancelBatchQueue = useCallback(() => {
    queueAbortRef.current.aborted = true;
    void cancelDownload();
    // Show the stop immediately instead of waiting for the engine to notice.
    setQueueItems((prev) =>
      prev.map((item) =>
        item.status === "pending" || item.status === "downloading"
          ? { ...item, status: "cancelled" as const }
          : item,
      ),
    );
    setQueueRunning(false);
  }, []);

  // Tracks the active native download so "Cancel" really stops it instead of
  // only resetting the UI.
  const workIdRef = useRef<string | null>(null);

  // Safety-net timeout refs — cleaned up on unmount and before each new
  // download to prevent stale state updates and timer leaks.
  const safetyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Timestamp of the last progress tick; drives the stall watchdog. */
  const lastProgressAtRef = useRef(0);

  // Clear any lingering safety-net timers when the component unmounts.
  useEffect(() => {
    return () => {
      if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
      if (completeResetTimerRef.current !== null) clearTimeout(completeResetTimerRef.current);
    };
  }, []);

  // Persist the help-guide language choice.
  useEffect(() => {
    try {
      localStorage.setItem("vidfetch.helpLang", helpLang);
    } catch {
      // Storage unavailable — best-effort only.
    }
  }, [helpLang]);

  // Current page state, mirrored in a ref so the long safety-net timers can
  // decide whether to advance the UI without stale closures.
  const stateRef = useRef<PageState>("idle");
  const updateState = useCallback(
    (s: PageState) => {
      stateRef.current = s;
      setState(s);
      onStateChange?.(s);
    },
    [onStateChange],
  );

  // Load the list of files already saved (APK only) + the chosen location
  useEffect(() => {
    if (!isNativeAvailable()) return;
    getDownloads().then((list) => {
      if (list.length > 0) setSavedDownloads(list);
    });
    getDownloadLocation().then((loc) => {
      if (loc?.uri) setDownloadLocation(loc);
    });
    getYouTubeSettings().then((s) => {
      setYtSettings(s);
      setPoProviderInput(s.poTokenProvider);
    });
  }, []);

  // ── YouTube anti-bot settings handlers ────────────────────────────
  const refreshYtSettings = useCallback(async () => {
    const s = await getYouTubeSettings();
    setYtSettings(s);
    setPoProviderInput((prev) => prev || s.poTokenProvider);
    return s;
  }, []);

  const handleSetCookiesBrowser = useCallback(
    async (browser: string) => {
      await setCookiesBrowser(browser);
      await refreshYtSettings();
    },
    [refreshYtSettings],
  );

  const handlePickCookieFile = useCallback(async () => {
    if (pickingCookies) return;
    setPickingCookies(true);
    try {
      const s = await pickCookieFile();
      if (s) setYtSettings(s);
    } finally {
      setPickingCookies(false);
    }
  }, [pickingCookies]);

  const handleClearCookieFile = useCallback(async () => {
    await clearCookieFile();
    await refreshYtSettings();
  }, [refreshYtSettings]);

  const handleSavePoProvider = useCallback(async () => {
    await setPoTokenProvider(poProviderInput.trim());
    await refreshYtSettings();
  }, [poProviderInput, refreshYtSettings]);

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

  // Auto-scroll DISABLED — prevents jarring page jumps during download.
  // Users can manually scroll if needed.
  const scrollToResults = () => {
    // Intentionally no-op to prevent unwanted page scrolling
  };

  // ─── Fetch video info ──────────────────────────────────────────────
  // Core analyze routine, split out so both the input's button and the
  // recent-downloads list ("download again") can trigger it with their
  // own URL.
  const runAnalyze = useCallback(
    async (targetUrl: string) => {
      try {
        // Clean the pasted text first — links often arrive with extra
        // whitespace, quotes or surrounding words from chat apps / notes.
        const cleanUrl = normalizeVideoUrl(targetUrl);
        if (!cleanUrl) {
          setErrorMsg(targetUrl.trim());
          setErrorPhase("analyze");
          updateState("error");
          return;
        }

        setUrl(cleanUrl);
        updateState("loading");
        setErrorMsg("");
        setVideoInfo(null);
        setSelectedFormat("");
        setPlaylistSummary(null);
        // Sync the playlist preset with the selected mode chip so the
        // auto-download below and PlaylistPanel's quality row agree.
        setPlaylistQuality(
          videoQuality === "audio" ? "audio" : videoQuality === "data" ? "480p" : "best",
        );

        // Playlist links SKIP the format-picker screen entirely and go
        // straight to downloading every video — the user asked for
        // "playlist link → download all, no extra step".
        const isPlaylist = looksLikePlaylist(cleanUrl);

        // ── Engine routing ──────────────────────────────────────────
        // Try the engines in order (Cobalt first only for the sites it
        // handles better, when the user configured an instance). Any
        // failure falls through to the on-device engine, so enabling
        // Cobalt can never break a link that used to download.
        const engineCfg = loadEngineConfig();
        const plan = planEngines(cleanUrl, {
          isPlaylist,
          mode: engineCfg.mode,
          native: nativeAvailable,
        });
        const tried: EngineAttempt[] = [];
        let result: YtDlpInfo | null = null;
        let lastError = "";

        for (const engine of plan) {
          tried.push(engine);
          if (engine === "ondevice") {
            const nativeResult = await getVideoInfo(cleanUrl, isPlaylist);
            if (nativeResult.success) {
              result = nativeResult;
              break;
            }
            lastError = nativeResult.error;
            continue;
          }
          const res = await resolveWithHttpEngine(engine, cleanUrl, engineCfg, {
            audioOnly: videoQuality === "audio",
            mode: videoQuality,
            precise: preciseQuality,
          });
          if (res.ok) {
            result = res.info;
            break;
          }
          lastError = res.message;
        }

        // Last resort: the on-device engine was blocked (e.g. a bot check)
        // and Cobalt is configured but was not tried for this site yet.
        if (!result) {
          const rescue = lastResortEngine(cleanUrl, tried, engineCfg.mode);
          if (rescue) {
            tried.push(rescue);
            const res = await resolveWithHttpEngine(
              rescue as Exclude<EngineAttempt, "ondevice">,
              cleanUrl,
              engineCfg,
              {
                audioOnly: videoQuality === "audio",
                mode: videoQuality,
                precise: preciseQuality,
              },
            );
            if (res.ok) {
              result = res.info;
            } else {
              lastError = res.message;
            }
          }
        }

        if (!result) {
          setErrorMsg(lastError);
          setErrorPhase("analyze");
          updateState("error");
          return;
        }

        setVideoInfo(result);

        // A playlist STOPS here and shows the video list. It used to start
        // downloading all N videos the moment the link was analyzed, which
        // left no way to pick a quality first, to skip videos, or to grab a
        // single item — the user has to be able to see the list and choose.
        // PlaylistPanel then offers "Tümünü indir" plus a per-video button.

        // Audio mode downloads the best audio track directly; Best/Data
        // map onto the closest real format for the mode's height cap —
        // unless the user pinned an exact quality (1080p/720p/480p) in
        // Gelişmiş seçenekler, which overrides the mode's cap.
        // A Cobalt result already carries ONE resolved stream, so its own
        // format id is preselected instead of a selector.
        setSelectedFormat(
          result.engine === "cobalt"
            ? COBALT_FORMAT_ID
            : result.engine === "seal"
              ? SEAL_FORMAT_ID
              : result.engine === "server"
                ? SERVER_FORMAT_ID
                : videoQuality === "audio"
              ? "bestaudio"
              : preciseQuality !== "auto"
                ? mp4FormatWithHeight(preciseQuality)
                : videoQuality === "data"
                  ? dataModeSelector(480)
                  : MP4_FORMAT_SELECTOR,
        );
        updateState("loaded");
        scrollToResults();
      } catch (err) {
        // Catch any Script error / bridge crash so the UI never goes blank
        console.error("[DownloaderCard] runAnalyze error:", err);
        setErrorMsg(
          err instanceof Error
            ? err.message
            : helpLang === "tr"
              ? "Video bilgisi alınırken beklenmeyen bir hata oluştu"
              : "An unexpected error occurred while fetching video info"
        );
        setErrorPhase("analyze");
        updateState("error");
      }
    },
    [updateState, videoQuality, preciseQuality, helpLang, nativeAvailable],
  );

  const handleAnalyze = useCallback(() => runAnalyze(url), [url, runAnalyze]);

  // Ref filled AFTER handleDownloadPlaylist is declared below, so the
  // auto-playlist flow inside runAnalyze can invoke the exact same handler
  // (identical progress/complete wiring) without a circular dependency.
  const downloadPlaylistRef = useRef<() => void>(() => {});

  // ─── Download ──────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    try {
    const cleanUrl = normalizeVideoUrl(url);
    if (!cleanUrl || !selectedFormat) return;

    // NOTE: deliberately NO formatExists pre-validation here. selectedFormat
    // is either a selector ("bestaudio", mp4FormatWithHeight(480), …) set by
    // the mode chips or a real format ID picked from the filtered cards, and
    // startDownload only ever receives the strict MP4/MP3 selectors below.
    // The old pre-validation compared against raw format IDs, so it aborted
    // EVERY mode-chip download (default Data Saver and Audio included) with
    // a bogus "auto-corrected" error before the engine ever started.

    updateState("downloading");
    lastProgressAtRef.current = Date.now();
    setErrorMsg("");
    setDownloadProgress({ percent: 0, speed: "0", eta: "--:--" });
    // Throttle window for progress re-renders (see onProgress below).
    let lastTick = 0;

    // CRITICAL: Always use strict MP4 format selector to prevent crashes.
    // Never pass raw format IDs to yt-dlp — they may refer to DASH segments
    // that cause the native plugin to crash or produce unplayable files.
    const picked = videoInfo?.formats.find(
      (f) => f.format_id === selectedFormat,
    );
    // Determine if user selected audio-only
    const isAudioSelection = selectedFormat === "bestaudio" ||
      (picked && !picked.vcodec && !!picked.acodec);
    // A mode chip puts a strict yt-dlp SELECTOR into selectedFormat
    // ("bestaudio", mp4FormatWithHeight(480), MP4_FORMAT_SELECTOR, …).
    // Selectors always contain '[' or '/'; raw format IDs never do. Pass
    // them through VERBATIM — mapping every selection onto
    // MP4_FORMAT_SELECTOR here threw away the user's quality pick: Data
    // Saver downloaded full HD instead of 480p and a quality picked from
    // the format cards was ignored (the card's format_id maps to the same
    // full-quality chain anyway).
    const isSelector = /[[/]/.test(selectedFormat);
    // An HTTP resolver (Cobalt) hands us an already-resolved media URL:
    // download THAT file instead of re-running the page extractor. "best"
    // matches the single format a direct URL exposes; the native side maps
    // an empty format to "best" as well.
    const directUrl = videoInfo?.direct_url;
    const formatSpec = directUrl
      ? "best"
      : isSelector
        ? selectedFormat
        : isAudioSelection
          ? MP3_FORMAT_SELECTOR
          : MP4_FORMAT_SELECTOR;

    const workId = await startDownload({
      url: directUrl || cleanUrl,
      formatId: formatSpec,
      onProgress: (progress) => {
        // Liveness marker for the stall watchdog below — every tick counts,
        // even the ones the visual throttle drops.
        lastProgressAtRef.current = Date.now();
        // Auto-complete when we hit 100%
        if (progress.percent >= 100) {
          updateState("complete");
        }
        // Throttled progress: skip ticks that don't move the visible
        // percentage and cap updates to ~5/sec. Each progress event
        // otherwise re-renders this entire card.
        setDownloadProgress((prev) => {
          const now = Date.now();
          if (now - lastTick < 100) return prev;  // 100ms throttle for smooth UI
          if (Math.round(progress.percent) === Math.round(prev.percent)) {
            return prev;
          }
          lastTick = now;
          return {
            percent: progress.percent,
            speed: progress.speed,
            eta: progress.eta,
          };
        });
      },
      onComplete: async (completed) => {
        // Foreground service finished — remember the file & refresh the list
        workIdRef.current = null;
        setLastCompleted(completed);
        updateState("complete");
        const list = await getDownloads();
        if (list.length > 0) setSavedDownloads(list);
        // Record in on-device history (title, url, format) — works in every
        // build, including the browser preview.
        addDownloadRecord({
          title: videoInfo?.title || cleanUrl,
          url: cleanUrl,
          kind: "video",
          formatLabel: picked ? getQualityLabel(picked.resolution) : undefined,
          time: Date.now(),
        });
        refreshHistory();
        // Clean up any orphan temp files from this download
        postDownloadCleanup(completed.fileName).catch(() => {});
      },
      onError: (error) => {
        workIdRef.current = null;
        setErrorMsg(error);
        setErrorPhase("download");
        updateState("error");
      },
    });
    if (!workId) {
      // The on-device engine only exists inside the APK / EXE build.
      // In a plain browser there is nothing to do the download — be honest.
      setErrorMsg(
        helpLang === "tr"
          ? "Bu önizleme tarayıcıda çalışıyor — indirme motoru yalnızca Android APK ve Windows EXE uygulamalarında mevcut. Sunucu gerekmez, API anahtarı gerekmez, sınırsızdır."
          : "This preview runs in a browser with no download engine. Install the Android APK or Windows EXE — fully offline, no server needed."
      );
      setErrorPhase("download");
      updateState("error");
      return;
    }
    // Only set workIdRef AFTER the null check — the server path calls
    // onComplete synchronously (which sets workIdRef to null), so setting
    // it before the check would overwrite the null with a stale value.
    workIdRef.current = workId;

    // Safety net ONLY. The native foreground service reliably emits
    // downloadComplete/downloadError, and progress events keep the
    // progress screen alive until 100%. This fallback exists purely
    // so the UI can never get stuck on "downloading" if an event is lost
    // (e.g. an old build without the complete event).
    //
    // It watches for STALLED progress, not elapsed time. The old version
    // was a flat 120 s timer, which is well inside a normal download: a
    // 200 MB video on a phone connection runs for many minutes, so the
    // card flipped to "complete" and then back to "loaded" while the file
    // was still arriving — exactly the "everything reset but it is still
    // downloading" report. Only step in when the bar has been frozen for
    // a long time AND no completion event arrived.
    if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
    if (completeResetTimerRef.current !== null) clearTimeout(completeResetTimerRef.current);
    safetyTimerRef.current = setInterval(() => {
      if (stateRef.current !== "downloading") {
        if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
        return;
      }
      if (Date.now() - lastProgressAtRef.current > STALLED_DOWNLOAD_MS) {
        if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
        updateState("complete");
      }
    }, 5000);

    // Reset "complete" state after a short delay so the success animation
    // is visible but the user can quickly start a new download.
    completeResetTimerRef.current = setTimeout(() => {
      if (stateRef.current === "complete") updateState("loaded");
    }, 5000);
    } catch (err) {
      // Catch Script errors / bridge crashes
      console.error("[DownloaderCard] handleDownload error:", err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : helpLang === "tr"
            ? "İndirme başlatılırken beklenmeyen bir hata oluştu"
            : "An unexpected error occurred while starting the download"
      );
      setErrorPhase("download");
      updateState("error");
    }
  }, [url, selectedFormat, videoInfo, updateState, refreshHistory, helpLang]);

  // ─── Playlist download (all videos at once) ───────────────────────
  const handleDownloadPlaylist = useCallback(async () => {
    try {
    const cleanUrl = normalizeVideoUrl(url);
    if (!cleanUrl || !videoInfo?.is_playlist) return;

    const total = videoInfo.count ?? videoInfo.entries?.length ?? 0;
    // Honor the quality row shown in PlaylistPanel (Best/1080p/720p/480p/
    // Audio). runAnalyze keeps playlistQuality in sync with the mode chips,
    // and when the panel is visible the user's explicit pick wins.
    const preset =
      PLAYLIST_PRESETS.find((p) => p.id === playlistQuality) ?? PLAYLIST_PRESETS[0];
    const modeSpec = preset.spec;

    updateState("downloading");
    lastProgressAtRef.current = Date.now();
    setErrorMsg("");
    setPlaylistSummary(null);
    setDownloadProgress({
      percent: 0,
      speed: "0",
      eta: "--:--",
      item: 0,
      itemCount: total || undefined,
    });
    // Throttle window for progress re-renders (see onProgress below).
    let lastTick = 0;

    const workId = await startDownload({
      url: cleanUrl,
      formatId: modeSpec,
      isPlaylist: true,
      onProgress: (progress) => {
        // Liveness marker for the stall watchdog below.
        lastProgressAtRef.current = Date.now();
        // The last item reaching 100% means the whole playlist finished.
        if (
          progress.item &&
          progress.itemCount &&
          progress.item >= progress.itemCount &&
          progress.percent >= 100
        ) {
          updateState("complete");
        }
        // Throttled progress — same reasoning as handleDownload.
        setDownloadProgress((prev) => {
          const now = Date.now();
          if (now - lastTick < 100) return prev;  // 100ms throttle for smooth UI
          if (
            Math.round(progress.percent) === Math.round(prev.percent) &&
            progress.item === prev.item &&
            progress.itemCount === prev.itemCount &&
            progress.fileName === prev.fileName
          ) {
            return prev;
          }
          lastTick = now;
          return {
            percent: progress.percent,
            speed: progress.speed,
            eta: progress.eta,
            item: progress.item ?? prev.item,
            itemCount: progress.itemCount ?? prev.itemCount,
            fileName: progress.fileName ?? prev.fileName,
          };
        });
      },
      onComplete: async (completed) => {
        workIdRef.current = null;
        setLastCompleted(completed);
        setPlaylistSummary({
          saved: completed.fileCount ?? total,
          total: total || null,
          folder: completed.fileName ?? null,
        });
        updateState("complete");
        const list = await getDownloads();
        if (list.length > 0) setSavedDownloads(list);
        // Record the playlist in on-device history.
        addDownloadRecord({
          title: videoInfo?.title || cleanUrl,
          url: cleanUrl,
          kind: "playlist",
          count: completed.fileCount ?? total,
          time: Date.now(),
        });
        refreshHistory();
      },
      onError: (error) => {
        workIdRef.current = null;
        setErrorMsg(error);
        setErrorPhase("download");
        updateState("error");
      },
    });
    if (!workId) {
      setErrorMsg(
        helpLang === "tr"
          ? "Bu önizleme tarayıcıda çalışıyor — indirme motoru yalnızca Android APK ve Windows EXE uygulamalarında mevcut. Sunucu gerekmez, API anahtarı gerekmez, sınırsızdır."
          : "This preview runs in a browser with no download engine. Install the Android APK or Windows EXE — fully offline, no server needed."
      );
      setErrorPhase("download");
      updateState("error");
      return;
    }
    workIdRef.current = workId;

    // Safety net ONLY — same stall-watchdog reasoning as single-video
    // downloads. A flat 10-minute timer was wrong here too: a long playlist
    // is still progressing long after that, and announcing "complete"
    // mid-transfer is the bug this whole change is about.
    if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
    if (completeResetTimerRef.current !== null) clearTimeout(completeResetTimerRef.current);
    safetyTimerRef.current = setInterval(() => {
      if (stateRef.current !== "downloading") {
        if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
        return;
      }
      if (Date.now() - lastProgressAtRef.current > STALLED_DOWNLOAD_MS) {
        if (safetyTimerRef.current !== null) clearInterval(safetyTimerRef.current);
        updateState("complete");
      }
    }, 5000);
    completeResetTimerRef.current = setTimeout(() => {
      if (stateRef.current === "complete") updateState("loaded");
    }, 10000);
    } catch (err) {
      console.error("[DownloaderCard] handleDownloadPlaylist error:", err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : helpLang === "tr"
            ? "Liste indirme başlatılırken beklenmeyen bir hata oluştu"
            : "An unexpected error occurred while starting playlist download"
      );
      setErrorPhase("download");
      updateState("error");
    }
  }, [url, videoInfo, playlistQuality, updateState, refreshHistory, helpLang]);

  // Keep the auto-playlist ref pointing at the latest handler.
  // ─── Single video out of a playlist ───────────────────────────────────
  // The list is the feature: picking one video out of a playlist is a normal
  // single download of that entry's own URL, at the quality chosen in the
  // panel above. Kept as a separate handler (instead of re-analyzing the
  // entry) so it reuses the running progress/queue machinery and lands in
  // history exactly like any other download.
  const handleDownloadPlaylistEntry = useCallback(
    async (entry: PlaylistEntry) => {
      const targetUrl = (entry.url || "").trim();
      if (!targetUrl || !videoInfo?.is_playlist) return;

      const preset =
        PLAYLIST_PRESETS.find((p) => p.id === playlistQuality) ?? PLAYLIST_PRESETS[0];

      updateState("downloading");
      setErrorMsg("");
      setDownloadProgress({ percent: 0, speed: "0", eta: "--:--", item: 1 });

      try {
        const workId = await startDownload({
          url: targetUrl,
          formatId: preset.spec,
          onProgress: (progress) => {
            if (progress.percent >= 100) updateState("complete");
            setDownloadProgress((prev) => {
              const next = {
                percent: progress.percent,
                speed: progress.speed || "0",
                eta: progress.eta || "--:--",
                item: 1,
              };
              // Skip ticks that would not change what is on screen.
              if (
                Math.round(next.percent) === Math.round(prev.percent) &&
                next.speed === prev.speed &&
                next.eta === prev.eta
              ) {
                return prev;
              }
              return next;
            });
          },
          onComplete: (completed) => {
            workIdRef.current = null;
            updateState("complete");
            void getDownloads().then((list) => {
              if (list.length > 0) setSavedDownloads(list);
            });
            addDownloadRecord({
              title: entry.title || videoInfo.title,
              url: targetUrl,
              kind: "video",
              time: Date.now(),
            });
            refreshHistory();
            postDownloadCleanup(completed.fileName).catch(() => {});
          },
          onError: (error) => {
            workIdRef.current = null;
            setErrorMsg(error);
            setErrorPhase("download");
            updateState("error");
          },
        });

        if (!workId) {
          setErrorMsg(
            helpLang === "tr"
              ? "Bu önizleme tarayıcıda çalışıyor — indirme motoru yalnızca Android APK ve Windows EXE uygulamalarında mevcut."
              : "This preview runs in a browser with no download engine. Install the Android APK or Windows EXE.",
          );
          setErrorPhase("download");
          updateState("error");
          return;
        }
        workIdRef.current = workId;
      } catch (err) {
        workIdRef.current = null;
        console.error("[DownloaderCard] handleDownloadPlaylistEntry error:", err);
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setErrorPhase("download");
        updateState("error");
      }
    },
    [
      videoInfo,
      playlistQuality,
      updateState,
      setErrorMsg,
      setErrorPhase,
      setDownloadProgress,
      setSavedDownloads,
      addDownloadRecord,
      refreshHistory,
      helpLang,
    ],
  );

  downloadPlaylistRef.current = handleDownloadPlaylist;

  // ─── Paste ─────────────────────────────────────────────────────────
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      // A pasted block is usually a LIST — parse it right away.
      syncLinksFromInput(text);
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // With several links in the box, Enter must not analyze just the first
    // one — the queue panel is the action for this input.
    if (e.key === "Enter" && hasBatch) return;
    if (e.key === "Enter" && url.trim() && state !== "loading") {
      handleAnalyze();
    }
  };

  const resetAll = () => {
    updateState("idle");
    setErrorMsg("");
    setVideoInfo(null);
    setSelectedFormat("");
    setPlaylistSummary(null);
    setUrl("");
    clearQueueList();
    inputRef.current?.focus();
  };

  const handleNewDownload = () => {
    try {
      // If a native download is still running, actually stop it instead of
      // only hiding the progress screen.
      if (workIdRef.current) {
        cancelDownload(workIdRef.current).catch(() => {});
        workIdRef.current = null;
      }
    } catch {
      // Non-critical — cancel might fail if the plugin is unavailable
    }
    resetAll();
  };

  // ─── On-device download history ───────────────────────────────────
  const handleUseHistory = useCallback(
    (record: DownloadRecord) => {
      runAnalyze(record.url);
    },
    [runAnalyze],
  );

  const handleClearHistory = useCallback(() => {
    clearDownloadHistory();
    refreshHistory();
  }, [refreshHistory]);

  // ─── Video info ────────────────────────────────────────────────────
  const grouped = useMemo(
    () => (videoInfo ? groupFormats(videoInfo.formats) : null),
    [videoInfo],
  );

  // Overall progress across a whole playlist: ((item-1) + item%) / total.
  const overallPercent =
    downloadProgress.item && downloadProgress.itemCount
      ? Math.min(
          100,
          Math.round(
            ((downloadProgress.item - 1) * 100 + downloadProgress.percent) /
              downloadProgress.itemCount
          ),
        )
      : downloadProgress.percent;
  const isPlaylistDownload = !!downloadProgress.itemCount;

  // ─── Size for the CURRENT selection ────────────────────────────────
  // The old estimate only read the download-mode chip, so picking a quality
  // (a format card or the pinned 1080p/720p/480p) left the MB number frozen.
  // Priority now:
  //   1. the exact size the engine reported for the selected format
  //   2. audio mode  → 1 MB/min
  //   3. pinned exact height → height-based estimate
  //   4. the mode chip (best / data)
  const selectedFormatMeta = useMemo(() => {
    if (!videoInfo || !selectedFormat) return null;
    return (
      videoInfo.formats.find((f) => f.format_id === selectedFormat) ?? null
    );
  }, [videoInfo, selectedFormat]);

  // Total download size in bytes, plus whether it is an exact engine value
  // (no "~" prefix) or a bitrate-based estimate.
  const { totalBytes, sizeExact } = useMemo(() => {
    if (selectedFormatMeta?.filesize) {
      return { totalBytes: selectedFormatMeta.filesize, sizeExact: true };
    }
    const duration = videoInfo?.duration;
    if (!duration || duration <= 0) {
      return { totalBytes: null, sizeExact: false };
    }
    const mbPerMinute =
      videoQuality === "audio"
        ? approxMbPerMinute("audio")
        : preciseQuality !== "auto"
          ? approxMbPerMinuteForHeight(preciseQuality)
          : approxMbPerMinute(videoQuality);
    return {
      totalBytes: Math.round((duration / 60) * mbPerMinute) * 1024 * 1024,
      sizeExact: false,
    };
  }, [selectedFormatMeta, videoInfo, videoQuality, preciseQuality]);

  // Live "downloaded / total" during the download itself. The native bridge
  // reports percent/speed/eta but not byte counts, so the downloaded amount is
  // derived from the percentage — hence the "≈" in the UI.
  const downloadedBytes =
    totalBytes != null
      ? Math.round((overallPercent / 100) * totalBytes)
      : null;

  // ─── Page render ───────────────────────────────────────────────────
  return (
    <div className={className}>
      {/* On-device download history — works in every build */}
      {showInlineHistory && history.length > 0 && (
        <DownloadHistoryCard
          history={history}
          lang={helpLang}
          onUse={handleUseHistory}
          onClear={handleClearHistory}
        />
      )}

      <Card className="border-border/50 shadow-lg shadow-primary/5 bg-card">
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
                onChange={(e) => {
                  setUrl(e.target.value);
                  syncLinksFromInput(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                className="pl-10 pr-10 h-12 text-base border-border/60 bg-background/50 focus-visible:ring-primary/20"
              />
              {url && (
                <button
                  onClick={() => {
                    setUrl("");
                    clearQueueList();
                    updateState("idle");
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
              <ClipboardPaste className="h-5 w-5" />
              <kbd className="absolute -top-1.5 -right-1.5 hidden sm:inline-flex items-center justify-center h-4 min-w-[1.25rem] px-1 rounded-[3px] text-[9px] font-mono font-semibold bg-muted text-muted-foreground/60 border border-border/40 shadow-sm">
                {pasteShortcut}
              </kbd>
            </Button>
          </div>

          <AnimatePresence mode="wait">
            {/* ── Multi-link queue (2+ links pasted, adjacent links included) ── */}
            {hasBatch && (
              <MultiLinkQueue
                items={queueItems}
                summary={queueSummary}
                selected={queueSelected}
                onToggle={toggleQueueItem}
                onSelectAll={selectAllQueueItems}
                onClearSelection={clearQueueSelection}
                onRemoveAll={clearQueueList}
                qualities={batchQualities.length ? batchQualities : [{ height: null, label: "Best", selector: MP4_FORMAT_SELECTOR, streamCount: 0 }]}
                selectedQuality={batchSelector || MP4_FORMAT_SELECTOR}
                onQualityChange={setBatchSelector}
                running={queueRunning}
                onStart={startBatchQueue}
                onCancel={cancelBatchQueue}
                probing={batchProbing}
                lang={helpLang}
              />
            )}

            {/* ── Idle / URL entered ── */}
            {!hasBatch && state === "idle" && (
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
                    "w-full h-12 gap-2 text-base font-medium transition-shadow active:scale-[0.98]",
                    url.trim() && "shadow-md shadow-primary/20",
                  )}
                >
                  <Search className="h-5 w-5" />
                  {helpLang === "tr" ? "Analiz Et ve İndir" : "Analyze & Download"}
                </Button>

                {/* Download mode selector — how much data does this use?
                    Replaces the old per-pixel quality list; playlist links
                    start downloading with this mode automatically. */}
                <div className="mt-4 pt-3 border-t border-border/20">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-center mb-2.5">
                    {helpLang === "tr"
                      ? "İndirme modu — ne kadar internet yer?"
                      : "Download mode — how much data?"}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {DOWNLOAD_MODES.map((m) => {
                      const active = videoQuality === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            setVideoQuality(m.id);
                            // A new mode pick means the user is re-deciding
                            // quality — clear a previously pinned 1080p/720p/
                            // 480p so it can't silently override the chip.
                            setPreciseQuality("auto");
                          }}
                          title={helpLang === "tr" ? m.descTr : m.descEn}
                          className={cn(
                            "flex flex-col items-center gap-1 px-2 py-3 rounded-xl border text-center transition-all duration-150 cursor-pointer active:scale-[0.97]",
                            active
                              ? "bg-primary/10 border-primary/40 ring-1 ring-primary/20 shadow-[0_0_16px_rgba(108,180,238,0.18)]"
                              : "border-border/30 bg-background hover:border-border/60 hover:bg-muted/60",
                          )}
                        >
                          <span className="text-lg leading-none">{m.emoji}</span>
                          <span
                            className={cn(
                              "text-xs font-bold",
                              active ? "text-primary" : "text-foreground",
                            )}
                          >
                            {helpLang === "tr" ? m.label : m.labelEn}
                          </span>
                          {m.recommended && (
                            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {helpLang === "tr" ? "Önerilen" : "Recommended"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground/80">
                    {(() => {
                      const mode =
                        DOWNLOAD_MODES.find((m) => m.id === videoQuality) ??
                        DOWNLOAD_MODES[0];
                      return helpLang === "tr" ? mode.descTr : mode.descEn;
                    })()}
                  </p>
                  {videoQuality === "audio" && (
                    <p className="mt-1 text-center text-[10px] text-muted-foreground/60">
                      {helpLang === "tr"
                        ? "🎧 Ses modu: dosya .m4a olarak iner — her oynatıcıda açılır"
                        : "🎧 Audio mode: saved as .m4a — plays everywhere"}
                    </p>
                  )}
                </div>
                <p className="text-xs text-center text-muted-foreground/70 mt-3">
                  {helpLang === "tr" ? "YouTube, TikTok, Twitter/X, Instagram, Vimeo ve 1000+ site destekler" : "Supports YouTube, TikTok, Twitter/X, Instagram, Vimeo, and 1000+ more"}
                </p>

                {/* ── Gelişmiş seçenekler (engine + exact quality) ── */}
                <div className="mt-4 pt-3 border-t border-border/20">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    {helpLang === "tr" ? "Gelişmiş seçenekler" : "Advanced options"}
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200",
                        showAdvanced && "rotate-180",
                      )}
                    />
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 space-y-4 rounded-xl border border-border/30 bg-muted/20 p-3">
                      {/* ── Engine picker ── */}
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
                          {helpLang === "tr" ? "Motor" : "Engine"}
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {(
                            [
                              {
                                id: "device" as const,
                                icon: Cpu,
                                label: helpLang === "tr"
                                  ? "Cihaz içi motor"
                                  : "On-device engine",
                                desc: helpLang === "tr"
                                  ? "Hızlı, sınırsız, tamamen cihazında çalışır — 1000+ site"
                                  : "Fast, unlimited, fully on-device — 1000+ sites",
                                recommended: true,
                              },
                            ]
                          ).map((e) => {
                            const Icon = e.icon;
                            return (
                              <div
                                key={e.id}
                                className="flex items-center gap-3 p-3 rounded-lg border border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                              >
                                <Icon className="h-4 w-4 shrink-0 text-primary" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-primary">
                                      {e.label}
                                    </span>
                                    {e.recommended && (
                                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                                        {helpLang === "tr" ? "Önerilen" : "Recommended"}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                                    {e.desc}
                                  </p>
                                </div>
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── Exact video quality ── */}
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
                          {helpLang === "tr"
                            ? "Video kalitesi (tam seçim)"
                            : "Video quality (exact)"}
                        </p>
                        <div className="grid grid-cols-4 gap-2">
                          {(
                            [
                              { id: "auto" as const, label: helpLang === "tr" ? "Otomatik" : "Auto" },
                              { id: 1080 as const, label: "1080p" },
                              { id: 720 as const, label: "720p" },
                              { id: 480 as const, label: "480p" },
                            ]
                          ).map((q) => {
                            const active = preciseQuality === q.id;
                            return (
                              <button
                                key={String(q.id)}
                                type="button"
                                onClick={() => setPreciseQuality(q.id)}
                                className={cn(
                                  "flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-lg border text-center transition-all duration-150 cursor-pointer active:scale-[0.97]",
                                  active
                                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                                    : "border-border/40 bg-background hover:border-border/70 hover:bg-muted/50",
                                )}
                              >
                                <span
                                  className={cn(
                                    "text-xs font-bold",
                                    active ? "text-primary" : "text-foreground",
                                  )}
                                >
                                  {q.label}
                                </span>
                                {q.id === "auto" && (
                                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    {helpLang === "tr" ? "Önerilen" : "Recommended"}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/60">
                          {helpLang === "tr"
                            ? "Otomatik: yukarıdaki indirme moduna uyar. Belirli bir kalite seçersen modun üstüne geçer."
                            : "Auto: follows the download mode above. Picking an exact quality overrides it."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Format note — always MP4/MP3 enforced */}
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/50">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                    MP4 / MP3 only
                  </span>
                  <span>{" — " + (helpLang === "tr" ? "evrensel olarak oynatılabilir format" : "universally playable format")}</span>
                </div>

                {/* Example URLs — shown when input is empty */}
                {!url.trim() && (
                  <div className="mt-4 pt-3 border-t border-border/20">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-center mb-2.5">
                      Try an example
                    </p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {[
                        { label: "YouTube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
                        { label: "Playlist", url: "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf" },
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
                          {ex.label === "Playlist" && <ListVideo className="h-3 w-3 text-emerald-400" />}
                          <span>{ex.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Loading ── */}
            {!hasBatch && state === "loading" && (
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
                </div>
                <div className="text-center">
                  <p className="font-medium text-foreground">
                    {helpLang === "tr" ? "Video bilgisi alınıyor" : "Extracting video info"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {helpLang === "tr" ? "Analiz ediliyor…" : "Analyzing video…"}
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
            {!hasBatch && state === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="space-y-3"
              >
                {errorMsg && (
                  <ErrorBox message={errorMsg} phase={errorPhase} lang={helpLang} />
                )}
                {/* Web builds have no download engine — point the user to
                    the real app (APK/EXE) with stable latest-release links. */}
                {!nativeAvailable && <WebDownloadCard lang={helpLang} />}
                <div className="flex gap-2">
                  <Button onClick={handleAnalyze} variant="default" className="flex-1 gap-2 active:scale-[0.97]">
                    <RefreshCw className="h-4 w-4" />
                    {helpLang === "tr" ? "Tekrar dene" : "Retry"}
                  </Button>
                  <Button onClick={resetAll} variant="outline" className="gap-2 active:scale-[0.97]">
                    <X className="h-4 w-4" />
                    {helpLang === "tr" ? "Temizle" : "Clear"}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Loaded (video info shown) ── */}
            {!hasBatch && state === "loaded" && videoInfo && (
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
                          {videoInfo.is_playlist ? (
                            <>
                              <ListVideo className="h-2.5 w-2.5 mr-0.5" />
                              {videoInfo.count ?? videoInfo.entries?.length ?? 0}{" "}
                              videos
                            </>
                          ) : (
                            <>
                              <Clock className="h-2.5 w-2.5 mr-0.5" />
                              {formatDuration(videoInfo.duration)}
                            </>
                          )}
                        </Badge>
                      </div>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <h3 className="font-semibold text-foreground line-clamp-2 leading-snug">
                      {videoInfo.title}
                    </h3>
                    {/* Which resolver actually produced this result */}
                    {videoInfo.engine && (
                      <Badge
                        variant="outline"
                        className="mt-1.5 gap-1 border-border/40 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                      >
                        <Cpu className="h-2.5 w-2.5" />
                        {engineLabel(videoInfo.engine as EngineAttempt, helpLang)}
                      </Badge>
                    )}
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

                {/* ── Playlist mode ── */}
                {videoInfo.is_playlist && (
                  <PlaylistPanel
                    count={
                      videoInfo.count ?? videoInfo.entries?.length ?? 0
                    }
                    entries={videoInfo.entries ?? []}
                    quality={playlistQuality}
                    onQuality={setPlaylistQuality}
                    onDownloadAll={handleDownloadPlaylist}
                    onDownloadOne={handleDownloadPlaylistEntry}
                    lang={helpLang}
                  />
                )}

                {/* ── Single video mode ── */}
                {!videoInfo.is_playlist && (
                  <>
                    {/* Format selector */}
                    <div className="text-left">
                      <p className="text-sm font-medium text-foreground mb-3">
                        {helpLang === "tr" ? "Kalite seç" : "Choose quality"}
                      </p>

                      {grouped && (
                        <div className="space-y-3">
                          {/* Video + Audio formats */}
                          {grouped.video.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">
                                {helpLang === "tr"
                                  ? "Video + Ses"
                                  : "Video + Audio"}
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

                          {/* Video-only DASH segments are intentionally REMOVED.
                              Only Progressive MP4 (combined video+audio) is shown.
                              This prevents crashes from selecting unplayable .m4s segments. */}

                          {/* Audio only */}
                          {grouped.audioOnly.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">
                                {helpLang === "tr" ? "Sadece Ses" : "Audio Only"}
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

                          {                            grouped.video.length === 0 &&
                            grouped.audioOnly.length === 0 &&
                            grouped.videoOnly.length === 0 && (
                              <p className="text-sm text-muted-foreground">
                                {helpLang === "tr"
                                  ? "Bu video için indirilebilir format bulunamadı."
                                  : "No downloadable formats found for this video."}
                              </p>
                            )}
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={handleDownload}
                      disabled={!selectedFormat}
                      size="lg"
                      className="w-full h-12 gap-2 text-base font-medium bg-gradient-to-r from-[#6cb4ee] to-[#4a90d9] text-[#0d0f12] hover:from-[#7dbdf0] hover:to-[#5a9ee2] shadow-lg shadow-[#6cb4ee]/25 transition-all active:scale-[0.99]"
                    >
                      <Download className="h-5 w-5" />
                      {helpLang === "tr" ? "İndir" : "Download"}
                      {totalBytes != null && (
                        <span className="font-mono text-sm font-normal opacity-90">
                          {sizeExact
                            ? ` (${formatSize(totalBytes)})`
                            : ` (~${Math.round(
                                totalBytes / (1024 * 1024),
                              )} MB)`}
                        </span>
                      )}
                    </Button>
                  </>
                )}
              </motion.div>
            )}

            {/* ── Downloading (with real-time progress) ── */}
            {!hasBatch && state === "downloading" && (
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
                        animate={{ pathLength: overallPercent / 100 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                      />
                    </svg>
                    {/* Percentage in the center */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      {/* Plain span: re-mounting a motion element with a new key
                          on every throttled tick caused extra layout/anim work. */}
                      <span className="text-2xl font-bold tabular-nums">
                        {overallPercent}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Playlist item tracker */}
                {isPlaylistDownload && (
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground flex items-center justify-center gap-1.5">
                      <ListVideo className="h-4 w-4 text-primary" />
                      Video {downloadProgress.item ?? 1} of{" "}
                      {downloadProgress.itemCount}
                    </p>
                    {downloadProgress.fileName && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md mx-auto">
                        {downloadProgress.fileName}
                      </p>
                    )}
                  </div>
                )}

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

                {/* Downloaded / total — the byte count follows the quality the
                    user actually picked, so it moves with the selection. */}
                {downloadedBytes != null && totalBytes != null && (
                  <p className="-mt-3 text-center text-xs tabular-nums text-muted-foreground">
                    {sizeExact ? "" : "≈"}
                    {formatSize(downloadedBytes)}
                    {" / "}
                    {sizeExact ? "" : "~"}
                    {formatSize(totalBytes)}
                  </p>
                )}

                {/* Linear progress bar */}
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${overallPercent}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>

                <p className="text-xs text-center text-muted-foreground">
                  {isPlaylistDownload
                    ? "Downloading the playlist in background — you can leave this page"
                    : "Downloading in background &mdash; you can leave this page"}
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
            {!hasBatch && state === "complete" && (
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
                    {playlistSummary ? "Playlist saved!" : "Ready!"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {playlistSummary ? (
                      <>
                        {playlistSummary.saved} videos saved to{" "}
                        <strong>
                          Downloads/VidFetch
                          {playlistSummary.folder
                            ? `/${playlistSummary.folder}`
                            : ""}
                        </strong>
                      </>
                    ) : (
                      <>
                        Video saved to <strong>Downloads/VidFetch</strong>
                      </>
                    )}
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
                  {lastCompleted?.uri && (
                    <Button
                      onClick={async () => {
                        if (!lastCompleted?.uri) return;
                        setGallerySaveState("saving");
                        try {
                          const res = await saveToGallery({
                            filePath: lastCompleted.uri,
                            displayName: lastCompleted.fileName || undefined,
                          });
                          setGallerySaveResult(res);
                          if (res.success) setGallerySaveState("saved");
                          else setGallerySaveState("error");
                        } catch {
                          setGallerySaveState("error");
                        }
                      }}
                      disabled={gallerySaveState === "saving" || gallerySaveState === "saved"}
                      variant="outline"
                      className="flex-1 gap-2 active:scale-[0.97]"
                    >
                      {gallerySaveState === "saving" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                      ) : gallerySaveState === "saved" ? (
                        <><Check className="h-4 w-4" /> Saved</>
                      ) : gallerySaveState === "error" ? (
                        <><AlertCircle className="h-4 w-4" /> Error</>
                      ) : (
                        <><Video className="h-4 w-4" /> Save to gallery</>
                      )}
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
                  <Button onClick={videoInfo?.is_playlist ? handleDownloadPlaylist : handleDownload} variant="outline" className="flex-1 gap-2 active:scale-[0.97]">
                    <RefreshCw className="h-4 w-4" />
                    Try again
                  </Button>
                </div>
                {gallerySaveState === "error" && gallerySaveResult && (
                  <p className="text-xs text-destructive mt-2 text-center">
                    {gallerySaveResult.errorTr || gallerySaveResult.error || "Galeriye kaydetme başarısız"}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      <HelpGuideCard lang={helpLang} onLangChange={setHelpLang} />

      {/* Recent downloads + YouTube troubleshooting (APK / EXE only) */}
      {nativeAvailable && (
        <NativeToolsPanel
          isDesktop={isDesktop}
          downloadLocation={downloadLocation}
          savedDownloads={savedDownloads}
          ytSettings={ytSettings}
          poProviderInput={poProviderInput}
          pickingFolder={pickingFolder}
          pickingCookies={pickingCookies}
          onPickFolder={handlePickFolder}
          onResetLocation={handleResetLocation}
          onOpenFile={openFile}
          onPoProviderChange={setPoProviderInput}
          onSavePoProvider={handleSavePoProvider}
          onSetCookiesBrowser={handleSetCookiesBrowser}
          onPickCookieFile={handlePickCookieFile}
          onClearCookieFile={handleClearCookieFile}
          lang={helpLang}
        />
      )}
      {/* Clipboard Monitor Notification */}
      <ClipboardNotification
        url={clipboardUrl}
        onDownload={(url) => {
          setUrl(url);
          clearLastUrl();
        }}
        onDismiss={clearLastUrl}
      />
    </div>
  );
}
