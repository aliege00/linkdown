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
import { explainError } from "@/lib/error-help";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownToLine,
  AlertCircle,
  Check,
  CheckCircle2,
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

// ─── Bilingual YouTube bot-check help guide ───────────────────────────
// Shown prominently below the download card. The same content is written
// in plain language for end users (TR + EN), with a toggle in the card.
type HelpLang = "tr" | "en";

const HELP_CONTENT = {
  tr: {
    kicker: "Yardım merkezi",
    title: "VidFetch yardım merkezi",
    copyLabel: "Kopyala",
    copiedLabel: "Kopyalandı",
    tabs: {
      bot: "YouTube bot kontrolü",
      errors: "Sık hatalar",
      tips: "İpuçları",
    },
    bot: {
      introTitle: "Neden 'bot kontrolü' hatası alıyorum?",
      intro:
        "Bazen YouTube, bir videoyu indirmeye çalışırken \"Sign in to confirm you're not a bot\" (Devam etmek için giriş yapın) uyarısını gösterir ve erişimi engeller. Bu, uygulamanın hatası değildir. YouTube; VPN, veri merkezi veya ortak ağlardan gelen istekleri otomatik olarak şüpheli görür ve geçici olarak kısıtlar. Diğer siteler (Vimeo, TikTok, Instagram vb.) bu kontrolden etkilenmez — sorun yalnızca YouTube'a özeldir.",
      causesTitle: "En sık nedenler",
      causes: [
        "VPN, kurumsal veya veri merkezi ağına bağlı olman",
        "Tarayıcıda YouTube'a giriş yapılmamış olması",
        "Kısa sürede çok fazla indirme yapılması",
        "YouTube'un yeni bir altyapı değişikliği yayınlaması (birkaç gün sürebilir)",
      ],
      fixesTitle: "Nasıl çözülür?",
      fixes: [
        {
          badge: "Windows",
          title: "Tarayıcı cookies — en kolay yol",
          body: "Chrome, Edge veya Firefox'ta YouTube'a giriş yap. Uygulamada Gelişmiş → YouTube sorun giderme → Tarayıcı cookies bölümünden tarayıcını seç. İndirme sırasında tarayıcının kapalı veya kilidi açık olması gerekir.",
        },
        {
          badge: "Android + Windows",
          title: "cookies.txt dosyası",
          body: "Tarayıcına \"Get cookies.txt LOCALLY\" eklentisini kur, YouTube'a giriş yap ve cookies dosyasını dışa aktar. Ardından uygulamada Gelişmiş → YouTube sorun giderme bölümünden bu dosyayı seç.",
        },
        {
          badge: "Windows • İleri düzey",
          title: "PO token sağlayıcı",
          body: "Bilgisayarında token sunucusunu çalıştır, ardından uygulamaya http://127.0.0.1:4416 yaz ve Kaydet'e bas:",
          command: "docker run -d --init -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider",
        },
      ],
      note: "Bu ayarlar yalnızca YouTube isteklerini etkiler ve Gelişmiş → YouTube sorun giderme bölümündedir. En güvenilir çözüm, giriş yaptığın bir tarayıcıdan cookies almaktır. VPN'i kapatmak da çoğu zaman yeterlidir.",
    },
    errors: {
      title: "Sık karşılaşılan hatalar",
      intro:
        "Aşağıdaki hatalardan birini görürsen panik yapma — çoğu birkaç saniyede çözülür. Her hata için ne anlama geldiği ve ne yapman gerektiği aşağıda.",
      items: [
        {
          title: "Geçersiz veya tanınmayan bağlantı",
          what: "Bağlantı bir video sayfasına ait değil ya da site desteklenmiyor.",
          fix: "Bağlantıyı tarayıcının adres çubuğundan kopyala; YouTube, TikTok, Twitter/X gibi desteklenen bir siteden video kullan.",
        },
        {
          title: "Video gizli veya kaldırılmış",
          what: "Video özel (private), kaldırılmış ya da artık kullanılamıyor.",
          fix: "Videonun tarayıcıda açılıp açılmadığını kontrol et; başka bir video dene.",
        },
        {
          title: "Yaş sınırı olan video",
          what: "YouTube, yaş sınırı olan videolara doğrulama istemeden erişimi engelleyebiliyor.",
          fix: "YouTube hesabınla tarayıcıda oturum aç ve tarayıcı cookies'ini içe aktar.",
        },
        {
          title: "Bölge kısıtlaması",
          what: "Video, bulunduğun ülkede/bölgede yayınlanmadığı için erişilemiyor.",
          fix: "Bölgende yayınlanan bir video dene; VPN kullanıyorsan kapat veya sunucu değiştir.",
        },
        {
          title: "İnternet bağlantısı",
          what: "Uygulama video sunucusuna ulaşamadı; bağlantı kesik, yavaş veya engellenmiş olabilir.",
          fix: "İnterneti kontrol et, VPN'i kapat, birkaç saniye bekleyip tekrar dene.",
        },
        {
          title: "Giriş gerekiyor",
          what: "Site, içeriği indirmek için hesaba giriş yapılmasını istiyor.",
          fix: "Sitede hesabına giriş yap; tarayıcı cookies'ini içe aktar ve tekrar dene.",
        },
        {
          title: "Ses birleştirme hatası (ffmpeg)",
          what: "Video ve ses ayrı indirildi ama birleştirilemedi.",
          fix: "Daha düşük bir kalite seç (ör. 1080p) veya uygulamayı güncelle.",
        },
        {
          title: "Diğer hatalar",
          what: "Yukarıdakilere benzemeyen bir sorun oluştu.",
          fix: "Birkaç dakika sonra tekrar dene; uygulamayı kapatıp yeniden aç. Sorun sürerse hatanın altındaki teknik ayrıntıyı not al.",
        },
      ],
    },
    tips: {
      title: "Genel ipuçları",
      items: [
        {
          title: "Tarayıcı cookies en güvenilir çözümdür",
          body: "YouTube'a giriş yaptığın tarayıcıdan cookies içe aktarmak bot kontrolünü aşmanın en etkili yoludur. Gelişmiş → YouTube sorun giderme bölümünden yapabilirsin.",
        },
        {
          title: "VPN'ini kapat",
          body: "VPN, kurumsal veya veri merkezi ağları YouTube tarafından şüpheli görülür. Kapatmak çoğu YouTube sorununu çözer.",
        },
        {
          title: "Bağlantıyı adres çubuğundan kopyala",
          body: "Kısa veya paylaşım bağlantıları yerine tarayıcının adres çubuğundaki tam URL'yi kullan; bu, analiz hatalarını azaltır.",
        },
        {
          title: "İnternetini kontrol et",
          body: "Yavaş veya kesintili bağlantı hem analiz hem indirme hatalarına yol açar. Wi-Fi yerine mobil veriyi de deneyebilirsin.",
        },
        {
          title: "Uygulamayı güncel tut",
          body: "Her güncelleme yeni site desteği ve hata düzeltmeleri getirir. Güncel sürüm kullandığından emin ol.",
        },
        {
          title: "Depolama alanını kontrol et",
          body: "Yetersiz depolama alanı indirmenin sessizce başarısız olmasına neden olabilir. Cihazında yeterli boş alan olduğundan emin ol.",
        },
      ],
    },
    stuck: {
      title: "Hâlâ çözülmedi mi?",
      body: "Yukarıdaki adımları denediysen ve hâlâ indiremiyorsan: uygulamanın güncel olduğundan emin ol, cihazı yeniden başlat ve başka bir video ile test et. Sorun yalnızca YouTube'da görünüyorsa birkaç saat sonra tekrar dene — YouTube zaman zaman geçici kısıtlamalar uygular.",
    },
  },
  en: {
    kicker: "Help center",
    title: "VidFetch help center",
    copyLabel: "Copy",
    copiedLabel: "Copied",
    tabs: {
      bot: "YouTube bot check",
      errors: "Common errors",
      tips: "Tips",
    },
    bot: {
      introTitle: "Why am I getting a 'bot check' error?",
      intro:
        "Sometimes YouTube shows \"Sign in to confirm you're not a bot\" and blocks access while you try to download a video. This is not a bug in the app. YouTube automatically treats requests coming from VPNs, datacenter or shared networks as suspicious and temporarily restricts them. Other sites (Vimeo, TikTok, Instagram, etc.) are not affected by this check — it only applies to YouTube.",
      causesTitle: "Most common causes",
      causes: [
        "You are on a VPN, corporate or datacenter network",
        "You are not logged into YouTube in your browser",
        "Too many downloads in a short period of time",
        "YouTube just rolled out an infrastructure change (may last a few days)",
      ],
      fixesTitle: "How to fix it",
      fixes: [
        {
          badge: "Windows",
          title: "Browser cookies — easiest way",
          body: "Log into YouTube in Chrome, Edge or Firefox. In the app open Advanced → YouTube troubleshooting → Browser cookies and pick your browser. The browser must be closed or unlocked while downloading.",
        },
        {
          badge: "Android + Windows",
          title: "cookies.txt file",
          body: "Install the \"Get cookies.txt LOCALLY\" browser extension, log into YouTube and export the cookies file. Then choose that file under Advanced → YouTube troubleshooting in the app.",
        },
        {
          badge: "Windows • Advanced",
          title: "PO token provider",
          body: "Run a token server on this PC, then enter http://127.0.0.1:4416 in the app and press Save:",
          command: "docker run -d --init -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider",
        },
      ],
      note: "These settings only affect YouTube requests and live under Advanced → YouTube troubleshooting. The most reliable fix is importing cookies from a browser where you are logged in. Turning your VPN off also fixes most cases.",
    },
    errors: {
      title: "Common errors",
      intro:
        "If you see one of these errors, don't panic — most are fixed in seconds. Here's what each one means and what to do.",
      items: [
        {
          title: "Invalid or unrecognized link",
          what: "The link isn't a video page, or the site isn't supported.",
          fix: "Copy the link from your browser's address bar; use a video from a supported site like YouTube or TikTok.",
        },
        {
          title: "Video is private or removed",
          what: "The video is private, has been removed, or is no longer available.",
          fix: "Check whether the video opens in your browser; try a different video.",
        },
        {
          title: "Age-restricted video",
          what: "YouTube can block age-restricted videos without a verification step.",
          fix: "Log into YouTube in your browser and import browser cookies.",
        },
        {
          title: "Region restriction",
          what: "The video isn't published in your country or region.",
          fix: "Try a video published in your region; if you use a VPN, turn it off or switch servers.",
        },
        {
          title: "Internet connection",
          what: "The app couldn't reach the video server; the connection may be down, slow or blocked.",
          fix: "Check your internet, turn your VPN off, wait a few seconds and try again.",
        },
        {
          title: "Login required",
          what: "The site requires you to be logged into an account before downloading.",
          fix: "Log into your account on the site; import browser cookies and try again.",
        },
        {
          title: "Audio merge error (ffmpeg)",
          what: "Video and audio downloaded separately but couldn't be merged.",
          fix: "Pick a lower quality (e.g. 1080p) or update the app.",
        },
        {
          title: "Other errors",
          what: "Something that doesn't match the cases above happened.",
          fix: "Wait a few minutes and retry; restart the app. If it persists, note the technical detail shown under the error.",
        },
      ],
    },
    tips: {
      title: "General tips",
      items: [
        {
          title: "Browser cookies are the most reliable fix",
          body: "Importing cookies from a browser where you're logged into YouTube is the most effective way to get past the bot check. It lives under Advanced → YouTube troubleshooting.",
        },
        {
          title: "Turn your VPN off",
          body: "VPNs, corporate and datacenter networks look suspicious to YouTube. Turning it off fixes most YouTube issues.",
        },
        {
          title: "Copy the link from the address bar",
          body: "Use the full URL from your browser's address bar instead of short or share links; this avoids analysis errors.",
        },
        {
          title: "Check your internet",
          body: "Slow or flaky connections cause both analysis and download errors. You can also try mobile data instead of Wi-Fi.",
        },
        {
          title: "Keep the app updated",
          body: "Every update brings new site support and bug fixes. Make sure you're on the latest version.",
        },
        {
          title: "Check your storage",
          body: "Not enough free storage can make downloads fail silently. Make sure your device has free space.",
        },
      ],
    },
    stuck: {
      title: "Still stuck?",
      body: "If you tried the steps above and still can't download: make sure the app is up to date, restart the device, and test with another video. If the issue only shows on YouTube, try again in a few hours — YouTube occasionally applies temporary restrictions.",
    },
  },
} as const;

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

/**
 * Cheap URL-based playlist hint. Engines double-check this against
 * yt-dlp's own response, so a false positive just means the analyze
 * runs in playlist mode and reports back a single video.
 */
function looksLikePlaylist(raw: string): boolean {
  return /[?&]list=[^&\s]+/.test(raw) || /\/playlist([/?]|$)/.test(raw);
}

/** Quality presets for playlist downloads (yt-dlp format selectors). */
const PLAYLIST_PRESETS = [
  { id: "best", label: "Best", desc: "Best available", spec: "best" },
  {
    id: "1080p",
    label: "1080p",
    desc: "Full HD + audio",
    spec: "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  },
  {
    id: "720p",
    label: "720p",
    desc: "HD + audio",
    spec: "bestvideo[height<=720]+bestaudio/best[height<=720]",
  },
  {
    id: "480p",
    label: "480p",
    desc: "SD + audio",
    spec: "bestvideo[height<=480]+bestaudio/best[height<=480]",
  },
  { id: "audio", label: "Audio", desc: "MP3 / M4A", spec: "bestaudio" },
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
}: {
  lang: HelpLang;
  onLangChange: (lang: HelpLang) => void;
}) {
  const help = HELP_CONTENT[lang];
  const [tab, setTab] = useState("bot");

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

const ErrorBox = memo(function ErrorBox({
  message,
  phase,
  lang,
}: {
  message: string;
  phase: "analyze" | "download";
  lang: HelpLang;
}) {
  const info = explainError(message, lang);

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
          {phase === "download"
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
          <button
            type="button"
            onClick={scrollToHelpGuide}
            className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-300/50 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-left text-[11px] leading-relaxed text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-950/50 cursor-pointer"
          >
            <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {lang === "tr"
                ? "Bu bir YouTube bot kontrolü hatası. Aşağıdaki yardım rehberinde çözüm adım adım anlatılıyor — dokun ve rehbere git."
                : "This looks like a YouTube bot check. The help guide below walks you through the fix — tap to jump to it."}
            </span>
          </button>
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

// ─── Playlist Panel ──────────────────────────────────────────────────

const PlaylistPanel = memo(function PlaylistPanel({
  count,
  entries,
  quality,
  onQuality,
  onDownloadAll,
}: {
  count: number;
  entries: PlaylistEntry[];
  quality: string;
  onQuality: (id: string) => void;
  onDownloadAll: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Quality presets — one choice applies to every video */}
      <div className="text-left">
        <p className="text-sm font-medium text-foreground mb-3">Quality</p>
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
          Videos ({count})
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border border-border/30 rounded-lg bg-background/50">
            Reading playlist… press Download all to grab every video.
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
                  <Play className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                </li>
              ))}
            </ul>
            {count > 100 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Showing the first 100 of {count} videos — the whole playlist
                downloads.
              </p>
            )}
          </>
        )}
      </div>

      <Button
        onClick={onDownloadAll}
        size="lg"
        className="w-full h-12 gap-2 text-base font-medium shadow-md shadow-primary/20"
      >
        <Download className="h-5 w-5" />
        Download all ({count})
      </Button>
      <p className="text-xs text-center text-muted-foreground/70 -mt-2">
        Saves every video into one playlist folder in Downloads/VidFetch
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
}) {
  return (
    <div className="mt-6 mx-auto max-w-2xl">
      {/* Download location — changeable via the system folder picker */}
      <Card className="border-border/50 shadow-sm bg-card/95 backdrop-blur-sm">
        <CardContent className="p-4 sm:p-5 text-left">
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
              onClick={onPickFolder}
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
                onClick={onResetLocation}
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
                    onClick={() => onOpenFile(dl.uri)}
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

      {/* YouTube anti-bot troubleshooting (optional, advanced) */}
      <Card className="mt-4 border-border/50 shadow-sm bg-card/95 backdrop-blur-sm">
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

// ─── Component ────────────────────────────────────────────────────────

export default function DownloaderCard({
  inputRef,
  resultsRef,
  onStateChange,
}: {
  /** Focus target for the URL input (driven from the page nav / CTA). */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Scroll target for the video results ("scroll to results"). */
  resultsRef: RefObject<HTMLDivElement | null>;
  /** Lets the page hide the hero scroll hint while the card is busy. */
  onStateChange?: (state: PageState) => void;
}) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<PageState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [videoInfo, setVideoInfo] = useState<YtDlpInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("");
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
  const [downloadLocation, setDownloadLocation] = useState<DownloadLocation | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [ytSettings, setYtSettings] = useState<YouTubeSettings | null>(null);
  const [poProviderInput, setPoProviderInput] = useState("");
  const [pickingCookies, setPickingCookies] = useState(false);
  const [helpLang, setHelpLang] = useState<HelpLang>("tr");
  // Whether the visible error came from analyzing the URL or starting the
  // download — used to pick the error box's kicker label.
  const [errorPhase, setErrorPhase] = useState<"analyze" | "download">("analyze");
  const nativeAvailable = isNativeAvailable();
  // Desktop (EXE) only: browser-cookies and PO-token-provider settings are
  // not available on Android, so the UI shows them just on Windows.
  const desktopBridge = window.vidfetch;
  const isDesktop =
    !!desktopBridge &&
    typeof desktopBridge.isDesktop === "boolean" &&
    desktopBridge.isDesktop;

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

  // Scroll to results
  const scrollToResults = () => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  };

  // ─── Fetch video info ──────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!url.trim()) return;

    updateState("loading");
    setErrorMsg("");
    setVideoInfo(null);
    setSelectedFormat("");
    setPlaylistSummary(null);
    setPlaylistQuality("best");

    const result = await getVideoInfo(url.trim(), looksLikePlaylist(url.trim()));

    if (!result.success) {
      setErrorMsg(result.error);
      setErrorPhase("analyze");
      updateState("error");
      return;
    }

    setVideoInfo(result);
    setSelectedFormat(result.best_format_id);
    updateState("loaded");
    scrollToResults();
  }, [url, updateState]);

  // ─── Download ──────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    if (!url.trim() || !selectedFormat) return;

    updateState("downloading");
    setErrorMsg("");
    setDownloadProgress({ percent: 0, speed: "0", eta: "--:--" });
    // Throttle window for progress re-renders (see onProgress below).
    let lastTick = 0;

    // Video-only formats (common above 1080p on YouTube) carry no audio
    // track. When ffmpeg is available (bundled in both the APK and the EXE),
    // append bestaudio so the engine merges video + audio into one playable
    // file instead of saving a silent video.
    const picked = videoInfo?.formats.find(
      (f) => f.format_id === selectedFormat,
    );
    const formatSpec =
      picked && picked.vcodec && !picked.acodec && videoInfo?.ffmpeg_available
        ? `${selectedFormat}+bestaudio/bestaudio`
        : selectedFormat;

    const workId = await startDownload({
      url: url.trim(),
      formatId: formatSpec,
      onProgress: (progress) => {
        // Auto-complete when we hit 100%
        if (progress.percent >= 100) {
          updateState("complete");
        }
        // Throttled progress: skip ticks that don't move the visible
        // percentage and cap updates to ~5/sec. Each progress event
        // otherwise re-renders this entire card.
        setDownloadProgress((prev) => {
          const now = Date.now();
          if (now - lastTick < 200) return prev;
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
        setLastCompleted(completed);
        updateState("complete");
        const list = await getDownloads();
        if (list.length > 0) setSavedDownloads(list);
      },
      onError: (error) => {
        setErrorMsg(error);
        setErrorPhase("download");
        updateState("error");
      },
    });

    if (!workId) {
      // The on-device engine only exists inside the APK / EXE build.
      // In a plain browser there is nothing to do the download — be honest.
      setErrorMsg(
        "This preview runs in a browser, where there is no download engine. Install the Android APK or the Windows EXE — the engine runs right on your device. No server, no API key, unlimited."
      );
      setErrorPhase("download");
      updateState("error");
      return;
    }

    // Safety net ONLY: the native foreground service reliably emits
    // downloadComplete/downloadError, and progress events keep the
    // progress screen alive until 100%. This long fallback exists purely
    // so the UI can never get stuck on "downloading" if an event is lost
    // (e.g. an old build without the complete event). It must NOT fire
    // while the download is still running — a real video download takes
    // far longer than a few seconds.
    setTimeout(() => {
      if (stateRef.current === "downloading") updateState("complete");
    }, 120000);

    // Reset "complete" state after a delay
    setTimeout(() => {
      if (stateRef.current === "complete") updateState("loaded");
    }, 5000);
  }, [url, selectedFormat, videoInfo, updateState]);

  // ─── Playlist download (all videos at once) ───────────────────────
  const handleDownloadPlaylist = useCallback(async () => {
    if (!url.trim() || !videoInfo?.is_playlist) return;

    const total = videoInfo.count ?? videoInfo.entries?.length ?? 0;
    const preset =
      PLAYLIST_PRESETS.find((p) => p.id === playlistQuality) ??
      PLAYLIST_PRESETS[0];

    updateState("downloading");
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
      url: url.trim(),
      formatId: preset.spec,
      isPlaylist: true,
      onProgress: (progress) => {
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
          if (now - lastTick < 200) return prev;
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
        setLastCompleted(completed);
        setPlaylistSummary({
          saved: completed.fileCount ?? total,
          total: total || null,
          folder: completed.fileName ?? null,
        });
        updateState("complete");
        const list = await getDownloads();
        if (list.length > 0) setSavedDownloads(list);
      },
      onError: (error) => {
        setErrorMsg(error);
        setErrorPhase("download");
        updateState("error");
      },
    });

    if (!workId) {
      setErrorMsg(
        "This preview runs in a browser, where there is no download engine. Install the Android APK or the Windows EXE — the engine runs right on your device. No server, no API key, unlimited."
      );
      setErrorPhase("download");
      updateState("error");
      return;
    }

    // Safety net ONLY — same reasoning as single-video downloads. The
    // real completion is driven by progress events (last item at 100%)
    // and the downloadComplete event; this long fallback just prevents a
    // permanently stuck "downloading" screen if an event is ever lost.
    setTimeout(() => {
      if (stateRef.current === "downloading") updateState("complete");
    }, 10 * 60 * 1000);
    setTimeout(() => {
      if (stateRef.current === "complete") updateState("loaded");
    }, 10000);
  }, [url, videoInfo, playlistQuality, updateState]);

  // ─── Paste ─────────────────────────────────────────────────────────
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && url.trim() && state !== "loading") {
      handleAnalyze();
    }
  };

  const resetAll = () => {
    updateState("idle");
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

  // ─── Page render ───────────────────────────────────────────────────
  return (
    <>
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
                {errorMsg && (
                  <ErrorBox message={errorMsg} phase={errorPhase} lang={helpLang} />
                )}
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
                  />
                )}

                {/* ── Single video mode ── */}
                {!videoInfo.is_playlist && (
                  <>
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
                                      onSelect={handleSelectFormat}
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
                  </>
                )}
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
        />
      )}
    </>
  );
}
