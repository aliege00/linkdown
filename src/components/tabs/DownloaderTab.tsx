import { Download, Link, CheckCircle2, Sparkles, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/GlassCard";
import { cn } from "@/lib/utils";

export default function DownloaderTab() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* ── Hero Input Card ── */}
      <GlassCard interactive className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Download className="size-4 text-cyan-400" />
          <p className="text-sm font-semibold">Video İndir</p>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 backdrop-blur-md">
          <input
            type="url"
            placeholder="YouTube, TikTok, Instagram linkini yapıştırın..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            readOnly
          />
          <button
            type="button"
            className="shrink-0 rounded-xl bg-white/10 p-2 transition-colors hover:bg-white/20"
            onClick={() => navigate("/")}
          >
            <Link className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/* Format chips */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Format:
          </span>
          <div className="flex gap-1.5">
            {["MP4", "MP3"].map((fmt) => (
              <span
                key={fmt}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-semibold transition-all",
                  fmt === "MP4"
                    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-400"
                    : "border-violet-500/30 bg-violet-500/15 text-violet-400",
                )}
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>

        <Button
          className="h-12 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-500 font-semibold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-600 hover:to-violet-600"
          onClick={() => navigate("/")}
        >
          <Download className="mr-2 size-4" />
          İndirmeyi Başlat
        </Button>
      </GlassCard>

      {/* ── Engine Status ── */}
      <GlassCard interactive className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Motor hazır</p>
            <p className="text-xs text-muted-foreground/70">
              Cihazda çalışır — sunucu yok
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
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border/20 bg-white/5 p-3 dark:bg-white/[0.02]"
            >
              <item.icon className="size-4 text-primary/60" />
              <span className="text-[10px] font-medium text-muted-foreground">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* ── Supported Platforms ── */}
      <GlassCard interactive>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
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
              className="rounded-full border border-border/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground/80 dark:bg-white/[0.03]"
            >
              {p}
            </span>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
