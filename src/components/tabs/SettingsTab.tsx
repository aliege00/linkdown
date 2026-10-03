import { useState } from "react";
import { useNavigate } from "react-router"; // kept: /chat navigation below
import {
  Sparkles,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlatCard } from "@/components/FlatCard";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Cpu } from "lucide-react";
import {
  loadEngineConfig,
  saveEngineConfig,
  normalizeInstance,
  describeRouting,
  isCobaltConfigured,
  type EngineMode,
} from "@/lib/engines";

export default function SettingsTab() {
  const navigate = useNavigate();
  // ── Download engines ──────────────────────────────────────────────
  // Default (auto) keeps everything on the on-device engine. Cobalt is only
  // used for the sites it handles better, and only when the user points the
  // app at their own instance.
  const [engineCfg, setEngineCfg] = useState(() => loadEngineConfig());
  const [instanceDraft, setInstanceDraft] = useState(engineCfg.instance);
  const [tokenDraft, setTokenDraft] = useState(engineCfg.token);

  const persistEngines = (patch: Partial<typeof engineCfg>) => {
    const next = { ...engineCfg, ...patch };
    setEngineCfg(next);
    saveEngineConfig(next);
  };

  const saveInstance = () => {
    const normalized = normalizeInstance(instanceDraft);
    setInstanceDraft(normalized);
    persistEngines({ instance: normalized, token: tokenDraft.trim() });
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* ── App Info ── */}
      <FlatCard interactive className="space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6cb4ee] to-[#4a90d9] shadow-lg shadow-[#6cb4ee]/25">
          <Sparkles className="size-7 text-[#0d0f12]" />
        </div>
        <h2 className="text-xl font-bold text-foreground">VidFetch</h2>
        <p className="text-xs text-muted-foreground">
          v2.6.2 · On-device video downloader
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
      <FlatCard interactive>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          VidFetch, indirme motorunu doğrudan cihazınızda çalıştırır. Sunucu,
          bulut veya hesap gerekmez. 1000+ site desteklenir.
        </p>
      </FlatCard>

      {/* ── Download engines ── */}
      <FlatCard interactive className="space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[#6cb4ee]" />
          <h3 className="text-sm font-semibold text-foreground">
            İndirme motoru
          </h3>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {([
            ["auto", "Otomatik"],
            ["ondevice", "Cihaz içi"],
            ["cobalt", "Cobalt"],
          ] as [EngineMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => persistEngines({ mode })}
              className={cn(
                "rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors cursor-pointer",
                engineCfg.mode === mode
                  ? "border-[#6cb4ee]/50 bg-[#6cb4ee]/10 text-[#6cb4ee]"
                  : "border-border bg-background text-muted-foreground hover:border-[#6cb4ee]/30",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {describeRouting(engineCfg, "tr")}
        </p>

        <div className="space-y-2 pt-1">
          <label className="block text-[11px] text-muted-foreground">
            Cobalt sunucu adresi (opsiyonel)
          </label>
          <div className="flex gap-2">
            <Input
              value={instanceDraft}
              onChange={(e) => setInstanceDraft(e.target.value)}
              placeholder="https://cobalt.ornek-instans.com"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 flex-1 text-xs"
            />
            <Button size="sm" variant="outline" onClick={saveInstance}>
              Kaydet
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-[#6b6b70]">
            Kendi Cobalt v10 instance'ınızı kullanın (github.com/imputnet/cobalt).
            Hazır sunucular bot koruması kullanır ve üçüncü parti uygulamalar
            için uygun değildir.
          </p>

          <label className="block text-[11px] text-muted-foreground">
            API anahtarı (instance isterse)
          </label>
          <div className="flex gap-2">
            <Input
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Api-Key…"
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 flex-1 text-xs"
            />
            <Button size="sm" variant="outline" onClick={saveInstance}>
              Kaydet
            </Button>
          </div>

          {instanceDraft && normalizeInstance(instanceDraft) === "" && (
            <p className="text-[10px] text-red-400">
              Geçerli bir adres girin (http:// veya https:// ile başlamalı).
            </p>
          )}
          <p
            className={cn(
              "text-[10px]",
              isCobaltConfigured(engineCfg) ? "text-[#34c759]" : "text-[#6b6b70]",
            )}
          >
            {isCobaltConfigured(engineCfg)
              ? "Cobalt hazır — Otomatik modda seçili sitelerde önce denenecek."
              : "Cobalt kurulu değil — tüm indirmeler cihaz içi motorla yapılıyor."}
          </p>
        </div>
      </FlatCard>

      {/* ── Help center moved to its own page ── */}
      <FlatCard
        interactive
        className="space-y-3"
        onClick={() => navigate("/help")}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <HelpCircle className="h-4.5 w-4.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Yardım Merkezi</p>
            <p className="text-xs text-muted-foreground">
              Bot kontrolü, sık hatalar, ipuçları ve AI asistan
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </FlatCard>
    </div>
  );
}
