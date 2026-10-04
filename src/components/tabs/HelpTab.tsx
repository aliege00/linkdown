/**
 * The "Yardım" tab: the help center itself plus the app identity card.
 *
 * Split out of SettingsTab when the island grew a third item: help belongs
 * in "Yardım", and everything that CONFIGURED the app (motion switches,
 * AI keys, download engines) belongs in "Ayarlar".
 */

import { Sparkles } from "lucide-react";
import { FlatCard } from "@/components/FlatCard";
import HelpCenter from "@/components/HelpCenter";

export default function HelpTab() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* ── Help center (AI assistant, bot checks, errors, tips) ── */}
      <HelpCenter />

      {/* ── App Info ── */}
      <FlatCard className="space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6cb4ee] to-[#4a90d9] shadow-lg shadow-[#6cb4ee]/25">
          <Sparkles className="size-7 text-[#0d0f12]" />
        </div>
        <h2 className="text-xl font-bold text-foreground">VidFetch</h2>
        <p className="text-xs text-muted-foreground">
          v2.6.5 · On-device video downloader
        </p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { label: "Motor", value: "Cihaz içi" },
            { label: "Platform", value: "1000+" },
            { label: "Ücret", value: "Ücretsiz" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border bg-background p-3"
            >
              <p className="text-lg font-bold text-[#6cb4ee]">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </FlatCard>

      {/* ── Description ── */}
      <FlatCard>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          VidFetch, indirme motorunu doğrudan cihazınızda çalıştırır. Sunucu,
          bulut veya hesap gerekmez. 1000+ site desteklenir.
        </p>
      </FlatCard>
    </div>
  );
}