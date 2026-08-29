import { Download, Link, CheckCircle2, Sparkles, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { FlatCard } from "@/components/FlatCard";

export default function DownloaderTab() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* ── URL Input ── */}
      <FlatCard interactive className="space-y-4">
        <div className="flex items-center gap-2">
          <Download className="size-5 text-[#6cb4ee]" />
          <p className="text-base font-semibold">Video İndir</p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#262930] bg-[#0d0f12] px-4 py-3">
          <input
            type="url"
            placeholder="YouTube, TikTok, Instagram linkini yapıştırın..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#8e8e93]"
            readOnly
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-[#1e2026] p-2.5 transition-colors hover:bg-[#262930]"
            onClick={() => navigate("/")}
          >
            <Link className="size-4 text-[#8e8e93]" />
          </button>
        </div>

        {/* Format */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-[#8e8e93]">
            Format:
          </span>
          <div className="flex gap-2">
            {["MP4", "MP3"].map((fmt) => (
              <span
                key={fmt}
                className={`rounded-lg border px-4 py-1.5 text-xs font-bold ${
                  fmt === "MP4"
                    ? "border-[#6cb4ee]/30 bg-[#6cb4ee]/10 text-[#6cb4ee]"
                    : "border-[#bf5af2]/30 bg-[#bf5af2]/10 text-[#bf5af2]"
                }`}
              >
                {fmt}
              </span>
            ))}
          </div>
        </div>

        <Button
          className="h-[52px] w-full rounded-xl bg-[#6cb4ee] text-base font-bold text-[#0d0f12] hover:bg-[#5aa0d6] active:scale-[0.98] transition-transform"
          onClick={() => navigate("/")}
        >
          <Download className="mr-2 size-5" />
          İndirmeyi Başlat
        </Button>
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
