import { useEffect, useState } from "react";
import {
  Sparkles,
  Cpu,
  Eye,
  Bot,
  Link2,
  Server,
  Anchor,
  Gauge,
  Smartphone,
  ShieldAlert,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlatCard } from "@/components/FlatCard";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/hooks/use-app-settings";
import { FRAGMENT_CHOICES } from "@/lib/app-settings";
import {
  getInstalledEngines,
  getEngineInfo,
  updateEngine,
  isNativeAvailable,
  type EngineInfo,
} from "@/lib/ytdlp-native";
import { DOWNLOAD_MODES } from "@/lib/download-modes";
import {
  loadEngineConfig,
  saveEngineConfig,
  normalizeInstance,
  describeRouting,
  isCobaltConfigured,
  isServerConfigured,
  isSealConfigured,
  DEFAULT_SEAL_URL,
  HANDOFF_APPS,
  type EngineMode,
} from "@/lib/engines";

/**
 * The "Ayarlar" tab: everything that CONFIGURES the app.
 *
 * Three groups, in the order people look for them:
 *   1. Görünüm & Performans — turn all animation off, or switch to the flat
 *      low-power look (solid colors, no blur).
 *   2. Yapay Zeka — where the Gemini / Claude API key goes. Previously the
 *      only way to set it was a build-time env var, so the AI tab just said
 *      "not configured" with nowhere to fix it.
 *   3. İndirme motoru — the on-device engine plus the HTTP engines
 *      (Cobalt, your own yt-dlp server, Seal).
 *
 * The help center moved to the "Yardım" tab (HelpTab.tsx) when this tab
 * became real settings.
 */

/** A labeled on/off row. Deliberately a plain button, not the Switch
 *  primitive: this is the one control people open this tab to find, and it
 *  must work identically on a 5" Android WebView. */
function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: typeof Eye;
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors",
        checked
          ? "border-[#6cb4ee]/50 bg-[#6cb4ee]/10"
          : "border-border bg-background hover:border-[#6cb4ee]/30",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          checked ? "text-[#6cb4ee]" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-[#6cb4ee]" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-[1.125rem]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

export default function SettingsTab() {
  // ── Appearance / performance ───────────────────────────────────────
  const { settings, update } = useAppSettings();

  // ── AI keys ────────────────────────────────────────────────────────
  const [geminiDraft, setGeminiDraft] = useState(settings.geminiKey);
  const [claudeDraft, setClaudeDraft] = useState(settings.anthropicKey);

  // ── Download engines ───────────────────────────────────────────────
  // Default (auto) keeps everything on the on-device engine; the HTTP
  // engines are only used when the user points the app at one.
  const [engineCfg, setEngineCfg] = useState(() => loadEngineConfig());
  const [instanceDraft, setInstanceDraft] = useState(engineCfg.instance);
  const [tokenDraft, setTokenDraft] = useState(engineCfg.token);
  const [serverDraft, setServerDraft] = useState(engineCfg.serverUrl);
  const [serverTokenDraft, setServerTokenDraft] = useState(engineCfg.serverToken);
  const [sealDraft, setSealDraft] = useState(engineCfg.sealUrl);

  // Which handoff apps are actually installed. Android only: in a browser
  // the call returns an empty record, so every entry truthfully shows
  // "kurulu değil" and stays unselectable.
  const [installedEngines, setInstalledEngines] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    getInstalledEngines()
      .then((list) => {
        if (!cancelled) setInstalledEngines(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Engine version + in-app yt-dlp update ───────────────────────
  // undefined = probing (the Android probe runs yt-dlp --version, which
  // takes a moment), null = no engine here (plain browser). The browser
  // case is decided up front in the initializer so the effect never has to
  // set state synchronously.
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null | undefined>(
    () => (isNativeAvailable() ? undefined : null),
  );
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [engineMsg, setEngineMsg] = useState("");
  const [engineMsgError, setEngineMsgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isNativeAvailable()) return;
    getEngineInfo()
      .then((info) => {
        if (!cancelled) setEngineInfo(info);
      })
      .catch(() => {
        if (!cancelled) setEngineInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdateEngine = async () => {
    setEngineUpdating(true);
    setEngineMsg("");
    try {
      const res = await updateEngine();
      if (res.success) {
        setEngineMsgError(false);
        setEngineMsg(
          res.status === "ALREADY_UP_TO_DATE"
            ? `Motor zaten güncel${res.version ? ` (${res.version})` : ""}.`
            : `Motor güncellendi → ${res.version || "son sürüm"}.`,
        );
        setEngineInfo(await getEngineInfo());
      } else {
        setEngineMsgError(true);
        setEngineMsg(`Güncelleme başarısız: ${res.error || "bilinmeyen hata"}`);
      }
    } finally {
      setEngineUpdating(false);
    }
  };

  const persistEngines = (patch: Partial<typeof engineCfg>) => {
    const next = { ...engineCfg, ...patch };
    setEngineCfg(next);
    saveEngineConfig(next);
  };

  const saveCobalt = () => {
    const normalized = normalizeInstance(instanceDraft);
    setInstanceDraft(normalized);
    persistEngines({ instance: normalized, token: tokenDraft.trim() });
  };
  const saveServer = () => {
    const normalized = normalizeInstance(serverDraft);
    setServerDraft(normalized);
    persistEngines({ serverUrl: normalized, serverToken: serverTokenDraft.trim() });
  };
  const saveSeal = () => {
    const normalized = normalizeInstance(sealDraft);
    setSealDraft(normalized);
    persistEngines({ sealUrl: normalized });
  };

  const MODES: [EngineMode, string][] = [
    ["auto", "Otomatik"],
    ["ondevice", "Cihaz içi"],
    ["cobalt", "Cobalt"],
    ["server", "yt-dlp sunucusu"],
    ["seal", "Seal"],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {/* ── Görünüm & Performans ── */}
      <FlatCard className="space-y-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#6cb4ee]" />
          <h3 className="text-sm font-semibold text-foreground">
            Görünüm &amp; Performans
          </h3>
        </div>

        <div className="space-y-2">
          <ToggleRow
            icon={Sparkles}
            title="Animasyonları aç"
            description="Kapalıyken sekme geçişleri, sayfa geçişleri ve tüm hareket efektleri anında olur — pil ömrü uzar."
            checked={settings.animations}
            onChange={(next) => update({ animations: next })}
          />
          <ToggleRow
            icon={Cpu}
            title="Düşük donanım modu"
            description="Arayüz düz renkli ve sade olur: bulanıklık (blur), geçiş (gradient) ve gölge efektleri kapanır. Eski telefonlarda daha akıcı çalışır."
            checked={settings.lowPower}
            onChange={(next) => update({ lowPower: next })}
          />
        </div>
      </FlatCard>

      {/* ── İndirme ayarları ── */}
      <FlatCard className="space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[#6cb4ee]" />
          <h3 className="text-sm font-semibold text-foreground">
            İndirme ayarları
          </h3>
        </div>

        {/* ── Speed (parallel fragments) ── */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
            <Gauge className="h-3.5 w-3.5 text-[#6cb4ee]" />
            İndirme hızı
          </div>
          <div className="grid grid-cols-3 gap-2">
            {FRAGMENT_CHOICES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ fragments: value })}
                className={cn(
                  "cursor-pointer rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                  settings.fragments === value
                    ? "border-[#6cb4ee]/50 bg-[#6cb4ee]/10 text-[#6cb4ee]"
                    : "border-border bg-background text-muted-foreground hover:border-[#6cb4ee]/30",
                )}
              >
                {value === 4
                  ? "Ekonomik · 4"
                  : value === 16
                    ? "Hızlı · 16"
                    : "Dengeli · 8"}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-[#6b6b70]">
            Aynı anda indirilen parça sayısı — indirme hızını belirleyen tek
            ayar. Hızlı (16) en yüksek verimi verir; zayıf bir ağda bağlantı
            koparsa indirme kendiliğinden kaldığı yerden devam eder.
          </p>
        </div>

        {/* ── Default download mode ── */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-foreground">
            Varsayılan indirme modu
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DOWNLOAD_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => update({ defaultMode: mode.id })}
                className={cn(
                  "cursor-pointer rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                  settings.defaultMode === mode.id
                    ? "border-[#6cb4ee]/50 bg-[#6cb4ee]/10 text-[#6cb4ee]"
                    : "border-border bg-background text-muted-foreground hover:border-[#6cb4ee]/30",
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-[#6b6b70]">
            Yeni bağlantılarda hangi mod seçili gelsin. İndirme ekranındaki
            mod çipleri her seferinde değiştirilebilir.
          </p>
        </div>

        {/* ── Toggles ── */}
        <div className="space-y-2">
          <ToggleRow
            icon={Link2}
            title="Panodaki linki yakala"
            description="Kopyalanan video linki algılanınca giriş alanına otomatik doldurulur — yalnızca bu cihazda, hiçbir yere gönderilmez."
            checked={settings.clipboardMonitor}
            onChange={(next) => update({ clipboardMonitor: next })}
          />
          <ToggleRow
            icon={Cpu}
            title="Otomatik temizlik"
            description="İndirme bitince artık geçici dosyalar (.part, .tmp, .state) silinir; disk boş kalır."
            checked={settings.autoCleanup}
            onChange={(next) => update({ autoCleanup: next })}
          />
        </div>
      </FlatCard>

      {/* ── Yapay zeka ── */}
      <FlatCard className="space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#6cb4ee]" />
          <h3 className="text-sm font-semibold text-foreground">Yapay Zeka</h3>
        </div>

        {/* ── Explicit key-security disclosure ──────────────────────
            The key lives client-side — there is no proxy in this app, so
            anyone with the device (or DevTools) can read it. Stating that
            plainly, next to the input, is the whole point. */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 dark:border-amber-700/40 dark:bg-amber-950/25">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200/90">
            <p className="font-semibold">
              Anahtar güvensiz tarafında tutuluyor — lütfen oku
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-700 dark:text-amber-300/80">
              <li>
                Anahtar bu cihazın tarayıcı deposunda (localStorage) düz metin
                olarak saklanır; cihazı açan herkes ve Tarayıcı Araçları
                (F12) görebilir.
              </li>
              <li>
                Bu uygulamada proxy yok: istekler <strong>doğrudan bu
                cihazdan</strong> Google / Anthropic sunucularına gider.
                Anahtar hiçbir VidFetch sunucusuna gönderilmez — böyle bir
                sunucu zaten yok.
              </li>
              <li>
                Ortak bir cihazda anahtar koyma. Koymak zorundaysan işin
                bitince "Kaldır" ile silebilirsin.
              </li>
            </ul>
          </div>
        </div>

        <p className="text-[10px] leading-relaxed text-[#6b6b70]">
          Hesap gerekmez. İkisinden birini yazman yeterli; ikisi de doluysa
          Gemini kullanılır.
        </p>

        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">
            Google AI Studio anahtarı (Gemini)
          </label>
          <div className="flex gap-2">
            <Input
              value={geminiDraft}
              onChange={(e) => setGeminiDraft(e.target.value)}
              placeholder="AIza…"
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => update({ geminiKey: geminiDraft.trim() })}
            >
              Kaydet
            </Button>
            {settings.geminiKey && (
              <Button
                size="sm"
                variant="outline"
                className="text-[#ff453a] hover:text-[#ff453a]"
                aria-label="Gemini anahtarını cihazdan sil"
                onClick={() => {
                  setGeminiDraft("");
                  update({ geminiKey: "" });
                }}
              >
                Kaldır
              </Button>
            )}
          </div>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[#6cb4ee] hover:underline"
          >
            <Link2 className="h-3 w-3" />
            Anahtar al: aistudio.google.com/apikey
          </a>
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground">
            Anthropic anahtarı (Claude)
          </label>
          <div className="flex gap-2">
            <Input
              value={claudeDraft}
              onChange={(e) => setClaudeDraft(e.target.value)}
              placeholder="sk-ant-…"
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => update({ anthropicKey: claudeDraft.trim() })}
            >
              Kaydet
            </Button>
            {settings.anthropicKey && (
              <Button
                size="sm"
                variant="outline"
                className="text-[#ff453a] hover:text-[#ff453a]"
                aria-label="Claude anahtarını cihazdan sil"
                onClick={() => {
                  setClaudeDraft("");
                  update({ anthropicKey: "" });
                }}
              >
                Kaldır
              </Button>
            )}
          </div>
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[#6cb4ee] hover:underline"
          >
            <Link2 className="h-3 w-3" />
            Anahtar al: console.anthropic.com/settings/keys
          </a>
        </div>

        <p
          className={cn(
            "text-[10px]",
            settings.geminiKey || settings.anthropicKey
              ? "text-[#34c759]"
              : "text-[#6b6b70]",
          )}
        >
          {settings.geminiKey || settings.anthropicKey
            ? settings.geminiKey
              ? "Gemini hazır — AI Asistan ve Tam Ekran Sohbet çalışıyor."
              : "Claude hazır — AI Asistan ve Tam Ekran Sohbet çalışıyor."
            : "Anahtar girilmedi — AI Asistan devre dışı."}
        </p>
      </FlatCard>

      {/* ── İndirme motoru ── */}
      <FlatCard className="space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[#6cb4ee]" />
          <h3 className="text-sm font-semibold text-foreground">
            İndirme motoru
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => persistEngines({ mode })}
              className={cn(
                "cursor-pointer rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
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

        {/* ── Engine version + in-app update ──
            YouTube's extractors change weekly; a stale embedded yt-dlp is
            the #1 cause of "downloads broke". Surfacing the running version
            and a one-tap update here is the fix. */}
        <div className="space-y-2 rounded-xl border border-border/60 bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">
                yt-dlp motoru
              </p>
              <p className="truncate text-[10px] text-[#6b6b70]">
                {engineInfo === undefined
                  ? "Sürüm okunuyor…"
                  : engineInfo === null
                    ? "Tarayıcıda motor yok — sürüm APK/EXE içinde tutulur."
                    : !engineInfo.available
                      ? `Motor kullanılamıyor: ${engineInfo.detail || "bilinmiyor"}`
                      : engineInfo.version
                        ? `Sürüm: ${engineInfo.version}`
                        : "Sürüm bilinmiyor (motor yeni kurulmuş)"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={engineUpdating || !engineInfo?.available}
              onClick={handleUpdateEngine}
              className="shrink-0 gap-1.5"
              aria-label="yt-dlp motorunu güncelle"
            >
              {engineUpdating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {engineUpdating ? "Güncelleniyor…" : "Güncelle"}
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-[#6b6b70]">
            YouTube düzenli olarak değişir; motor güncellenmezse indirmeler
            bozulur. Güncelleme yt-dlp'yi uygulamayı yeniden kurmadan son
            sürüme taşır — indirmeleri etkilemez, bir-iki saniye sürebilir.
          </p>
          {engineMsg && (
            <p
              role="status"
              className={cn(
                "text-[10px]",
                engineMsgError ? "text-red-500" : "text-[#34c759]",
              )}
            >
              {engineMsg}
            </p>
          )}
        </div>

        <div className="space-y-3 pt-1">
          {/* Cobalt */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Server className="h-3.5 w-3.5 text-[#6cb4ee]" />
              Cobalt (kendi sunucun)
            </div>
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
              <Button size="sm" variant="outline" onClick={saveCobalt}>
                Kaydet
              </Button>
            </div>
            <Input
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="API anahtarı (instance isterse)"
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 text-xs"
            />
            <p className="text-[10px] leading-relaxed text-[#6b6b70]">
              Kendi Cobalt v10 instance'ınızı kullanın.{" "}
              {isCobaltConfigured(engineCfg)
                ? "Hazır — seçili sitelerde önce denenecek."
                : "Kurulu değil."}
            </p>
          </div>

          {/* yt-dlp server */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Server className="h-3.5 w-3.5 text-[#6cb4ee]" />
              yt-dlp sunucusu (kendi sunucun)
            </div>
            <div className="flex gap-2">
              <Input
                value={serverDraft}
                onChange={(e) => setServerDraft(e.target.value)}
                placeholder="https://yt-dlp.ornek-sunucu.com"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-9 flex-1 text-xs"
              />
              <Button size="sm" variant="outline" onClick={saveServer}>
                Kaydet
              </Button>
            </div>
            <Input
              value={serverTokenDraft}
              onChange={(e) => setServerTokenDraft(e.target.value)}
              placeholder="Erişim anahtarı (varsa)"
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 text-xs"
            />
            <p className="text-[10px] leading-relaxed text-[#6b6b70]">
              yt-dlp-web gibi kendi HTTP sunucunuz. Format listesini sunucudan
              alır, dosyayı yine cihazdaki motor indirir.{" "}
              {isServerConfigured(engineCfg) ? "Hazır." : "Kurulu değil."}
            </p>
          </div>

          {/* Seal */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Anchor className="h-3.5 w-3.5 text-[#6cb4ee]" />
              Seal motoru
            </div>
            <div className="flex gap-2">
              <Input
                value={sealDraft}
                onChange={(e) => setSealDraft(e.target.value)}
                placeholder={DEFAULT_SEAL_URL}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-9 flex-1 text-xs"
              />
              <Button size="sm" variant="outline" onClick={saveSeal}>
                Kaydet
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-[#6b6b70]">
              Seal (yt-dlp tabanlı Android uygulaması) ile uyumlu sunucu.{" "}
              {isSealConfigured(engineCfg) ? "Hazır." : "Kurulu değil."}
            </p>
          </div>

          {/* ── On-device apps (handoff) ── */}
          <div className="space-y-1.5 border-t border-border/40 pt-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Smartphone className="h-3.5 w-3.5 text-[#6cb4ee]" />
              Cihaz içi uygulamayla indir
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => persistEngines({ handoff: "" })}
                className={cn(
                  "cursor-pointer rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                  !engineCfg.handoff
                    ? "border-[#6cb4ee]/50 bg-[#6cb4ee]/10 text-[#6cb4ee]"
                    : "border-border bg-background text-muted-foreground hover:border-[#6cb4ee]/30",
                )}
              >
                Kapalı
                <span className="block text-[9px] font-normal opacity-70">
                  uygulama içinde indir
                </span>
              </button>
              {HANDOFF_APPS.map((app) => {
                const installed = installedEngines[app.id] === true;
                return (
                  <button
                    key={app.id}
                    type="button"
                    disabled={!installed}
                    title={installed ? app.desc : `${app.label} kurulu değil`}
                    onClick={() => persistEngines({ handoff: app.id })}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors",
                      engineCfg.handoff === app.id
                        ? "border-[#6cb4ee]/50 bg-[#6cb4ee]/10 text-[#6cb4ee]"
                        : "border-border bg-background text-muted-foreground",
                      installed
                        ? "cursor-pointer hover:border-[#6cb4ee]/30"
                        : "cursor-not-allowed opacity-40",
                    )}
                  >
                    {app.label}
                    <span className="block text-[9px] font-normal opacity-70">
                      {installed ? "kurulu" : "kurulu değil"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-relaxed text-[#6b6b70]">
              Seçili uygulama linki alır ve indirmeyi kendisi yapar; video
              bilgisi yine cihazda analiz edilir. Yalnızca Android'de kurulu
              olan uygulamalar seçilebilir.
            </p>
          </div>

          {instanceDraft && normalizeInstance(instanceDraft) === "" && (
            <p className="text-[10px] text-red-400">
              Geçerli bir adres girin (http:// veya https:// ile başlamalı).
            </p>
          )}
        </div>
      </FlatCard>
    </div>
  );
}