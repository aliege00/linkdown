import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Monitor, QrCode, ShieldCheck, Info } from "lucide-react";
import type { HelpLang } from "@/lib/help-content";

/**
 * WebDownloadCard — the "you can't download here" card for the plain web build.
 *
 * The download engine only exists inside the Android APK and the Windows EXE.
 * When a web visitor presses Analyze/Download, the engine check fails and this
 * card appears: it hands them the real app (stable "latest release" download
 * links, a QR code to move the link from desktop to phone) plus the Android
 * install steps and the SHA-256 verification pointer. It renders nothing on
 * native platforms (APK/EXE), where downloads actually work.
 */

// Stable names uploaded to every GitHub Release by CI (see
// .github/workflows/release.yml → "latest" copies). They always resolve to
// the newest release via GitHub's releases/latest/download redirect — no
// version edits needed on the site.
const APK_URL =
  "https://github.com/aliege00/linkdown/releases/latest/download/VidFetch-latest.apk";
const EXE_URL =
  "https://github.com/aliege00/linkdown/releases/latest/download/VidFetch-Setup-latest.exe";
// ASSUMPTION: canonical site URL is https://vidfetch.app (same assumption as
// LegalPage.tsx). If the real domain differs, update it here and in the
// release workflows.
const SITE_URL = "https://vidfetch.app";
const RELEASES_URL = "https://github.com/aliege00/linkdown/releases";

const T = {
  tr: {
    title: "İndirme, uygulamada çalışır",
    body: "Tarayıcıda indirme motoru yoktur; motor Android ve Windows uygulamalarının içine gömülüdür. Uygulamayı alın, bağlantıyı oraya yapıştırın.",
    apk: "Android APK indir",
    exe: "Windows EXE indir",
    qrTitle: "Telefona taşı",
    qrBody: "Telefon kameranızla okutun — indirme sayfası açılır.",
    stepsTitle: "Android kurulumu (3 adım)",
    steps: [
      "APK'yı indir",
      "Tarayıcına “Bilinmeyen uygulamalar kur” izni ver (Ayarlar → Uygulamalar)",
      "İndirilenler'den APK'yı aç ve onayla",
    ],
    why: "Bu izin gerekiyor çünkü uygulama Play Store dışından dağıtılıyor.",
    shaTitle: "Doğrulama",
    shaBody:
      "APK'nın SHA-256 özeti her sürümün release notlarında yayınlanır — indirdiğiniz dosyayı oradaki değerle karşılaştırın.",
    allReleases: "Tüm sürümler",
  },
  en: {
    title: "Downloading works in the app",
    body: "There is no download engine in the browser; it is embedded in the Android and Windows apps. Get the app, then paste the link there.",
    apk: "Download Android APK",
    exe: "Download Windows EXE",
    qrTitle: "Move to your phone",
    qrBody: "Scan with your phone camera — it opens the download page.",
    stepsTitle: "Android install (3 steps)",
    steps: [
      "Download the APK",
      "Allow “Install unknown apps” for your browser (Settings → Apps)",
      "Open the APK from Downloads and confirm",
    ],
    why: "That permission is needed because the app is distributed outside the Play Store.",
    shaTitle: "Verification",
    shaBody:
      "The APK's SHA-256 digest is published in every release's notes — compare your downloaded file against it.",
    allReleases: "All releases",
  },
} as const;

export default function WebDownloadCard({ lang }: { lang: HelpLang }) {
  // Never show on native platforms — there the engine works and downloads
  // actually run; redirecting users to the app they already have is noise.
  if (typeof window !== "undefined") {
    const cap = (window as unknown as Record<string, unknown>).Capacitor as
      | { isNativePlatform?: () => boolean }
      | undefined;
    if (cap?.isNativePlatform?.() || (window as unknown as Record<string, unknown>).vidfetch) {
      return null;
    }
  }

  const t = T[lang];

  return (
    <Card className="mt-4 border-primary/30 bg-gradient-to-b from-primary/5 to-card shadow-none text-left">
      <CardContent className="p-5 space-y-5">
        {/* Headline */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Info className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold leading-snug">{t.title}</p>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {t.body}
            </p>
          </div>
        </div>

        {/* Download buttons */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild className="h-11 gap-2 cursor-pointer">
            <a href={APK_URL} download>
              <Smartphone className="h-4 w-4" />
              {t.apk}
            </a>
          </Button>
          <Button asChild variant="outline" className="h-11 gap-2 cursor-pointer">
            <a href={EXE_URL} download>
              <Monitor className="h-4 w-4" />
              {t.exe}
            </a>
          </Button>
        </div>

        {/* QR + install steps */}
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] items-start">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border/40 bg-background p-3">
            <QRCodeSVG value={SITE_URL} size={116} marginSize={0} />
            <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <QrCode className="h-3 w-3" />
              {t.qrTitle}
            </p>
            <p className="max-w-[150px] text-center text-[10px] leading-snug text-muted-foreground/70">
              {t.qrBody}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold">{t.stepsTitle}</p>
            <ol className="mt-2 space-y-1.5">
              {t.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground/80 leading-relaxed">{t.why}</p>
          </div>
        </div>

        {/* SHA-256 + releases link */}
        <div className="flex flex-col gap-2 border-t border-border/30 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span>
              <span className="font-medium">{t.shaTitle}:</span> {t.shaBody}
            </span>
          </p>
          <Badge variant="outline" className="shrink-0 self-start sm:self-auto">
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer"
            >
              {t.allReleases}
            </a>
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
