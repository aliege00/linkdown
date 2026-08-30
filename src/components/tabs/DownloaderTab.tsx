import { useState, useCallback, useEffect } from "react";
import {
  Download,
  Link,
  CheckCircle2,
  Sparkles,
  ShieldAlert,
  ClipboardPaste,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { FlatCard } from "@/components/FlatCard";

const FORMATS = ["MP4", "MP3"] as const;
const QUALITIES = ["1080p", "720p", "480p"] as const;

/** Skeleton loader — pulsing blocks that mimic the download card layout */
function SkeletonLoader() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-4 rounded-lg bg-[#262930]"
          style={{ width: `${80 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

/** Error toast that slides in from top */
function ErrorToast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed top-4 left-4 right-4 z-[60] flex items-center gap-3 rounded-xl border border-[#ff453a]/30 bg-[#ff453a]/15 px-4 py-3 animate-in slide-in-from-top-4 fade-in duration-300">
      <AlertCircle className="size-5 shrink-0 text-[#ff453a]" />
      <p className="flex-1 text-sm font-medium text-[#ff453a]">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-lg p-1.5 text-[#ff453a]/60 hover:text-[#ff453a]"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export default function DownloaderTab() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("MP4");
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>("720p");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setError(null);
      }
    } catch {
      setError("Panoya erişim izni reddedildi");
    }
  }, []);

  const handleClear = useCallback(() => {
    setUrl("");
  }, []);

  const handleAnalyze = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Lütfen bir URL yapıştırın");
      return;
    }

    try {
      new URL(trimmed);
    } catch {
      setError("Geçersiz URL — lütfen geçerli bir link girin");
      return;
    }

    // Basic domain check
    const supported = [
      "youtube.com",
      "youtu.be",
      "tiktok.com",
      "instagram.com",
      "twitter.com",
      "x.com",
      "vimeo.com",
      "facebook.com",
      "twitch.tv",
    ];
    try {
      const host = new URL(trimmed).hostname.replace("www.", "");
      if (!supported.some((s) => host.includes(s))) {
        setError(
          "Bu site henüz desteklenmiyor — YouTube, TikTok, Instagram, Twitter, Vimeo, Facebook veya Twitch linkleri kullanın",
        );
        return;
      }
    } catch {
      // Shouldn't happen since URL was valid above
    }

    setError(null);
    setAnalyzing(true);
    // Simulate analysis — in real app this would call native bridge
    setTimeout(() => {
      setAnalyzing(false);
      navigate("/");
    }, 1500);
  }, [url, navigate]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {error && <ErrorToast message={error} onClose={() => setError(null)} />}

      {/* ── URL Input ── */}
      <FlatCard interactive className="space-y-4">
        <div className="flex items-center gap-2">
          <Download className="size-5 text-[#6cb4ee]" />
          <p className="text-base font-semibold">Video İndir</p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#262930] bg-[#0d0f12] px-4 py-3">
          <Link className="size-4 shrink-0 text-[#8e8e93]" />
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="YouTube, TikTok, Instagram linkini yapıştırın..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8e8e93]"
          />
          {url && (
            <button
              type="button"
              onClick={handleClear}
              className="shrink-0 rounded-lg bg-[#1e2026] p-2.5 text-[#8e8e93] transition-colors hover:bg-[#262930] hover:text-[#e8e8e8]"
              title="Temizle"
            >
              <X className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handlePaste}
            className="shrink-0 rounded-lg bg-[#1e2026] p-2.5 text-[#8e8e93] transition-colors hover:bg-[#262930] hover:text-[#6cb4ee]"
            title="Yapıştır"
          >
            <ClipboardPaste className="size-4" />
          </button>
        </div>

        {/* Format pills */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-[#8e8e93]">
            Format
          </span>
          <div className="flex gap-2">
            {FORMATS.map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setFormat(fmt)}
                className={`rounded-full px-5 py-2 text-xs font-bold transition-all ${
                  format === fmt
                    ? "bg-[#6cb4ee] text-[#0d0f12] shadow-lg shadow-[#6cb4ee]/20"
                    : "border border-[#262930] bg-[#0d0f12] text-[#8e8e93] hover:border-[#6cb4ee]/30 hover:text-[#e8e8e8]"
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Quality pills (only for video) */}
        {format === "MP4" && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-[#8e8e93]">
              Kalite
            </span>
            <div className="flex gap-2">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  className={`rounded-full px-5 py-2 text-xs font-bold transition-all ${
                    quality === q
                      ? "bg-[#6cb4ee] text-[#0d0f12] shadow-lg shadow-[#6cb4ee]/20"
                      : "border border-[#262930] bg-[#0d0f12] text-[#8e8e93] hover:border-[#6cb4ee]/30 hover:text-[#e8e8e8]"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {analyzing ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-[#6cb4ee]">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm font-medium">Analiz ediliyor...</span>
            </div>
            <SkeletonLoader />
          </div>
        ) : (
          <Button
            className="h-[52px] w-full rounded-xl bg-[#6cb4ee] text-base font-bold text-[#0d0f12] hover:bg-[#5aa0d6] active:scale-[0.98] transition-transform"
            onClick={handleAnalyze}
          >
            <Download className="mr-2 size-5" />
            İndirmeyi Başlat
          </Button>
        )}
      </FlatCard>

      {/* ── Engine Status ── */}
      <FlatCard interactive className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#34c759]/10">
            <CheckCircle2 className="size-5 text-[#34c759]" />
          </div>
          <div>
            <p className="text-sm font-semibold">Motor hazır</p>
            <p className="text-xs text-[#8e8e93]">Cihazda çalışır — sunucu yok</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Sparkles, label: "Sunucu yok" },
            { icon: Download, label: "Sınırsız" },
            { icon: ShieldAlert, label: "Gizli" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-center gap-2 rounded-xl border border-[#262930] bg-[#0d0f12] p-4"
            >
              <item.icon className="size-5 text-[#6cb4ee]" />
              <span className="text-xs font-medium text-[#8e8e93]">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </FlatCard>

      {/* ── Supported Platforms ── */}
      <FlatCard interactive>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8e8e93]">
          Desteklenen Platformlar
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            "YouTube",
            "TikTok",
            "Twitter/X",
            "Instagram",
            "Vimeo",
            "Facebook",
            "Twitch",
          ].map((p) => (
            <span
              key={p}
              className="rounded-lg border border-[#262930] bg-[#0d0f12] px-3 py-1.5 text-xs font-medium text-[#8e8e93]"
            >
              {p}
            </span>
          ))}
        </div>
      </FlatCard>
    </div>
  );
}
