/**
 * EngineSwitcher — UI for selecting the download engine.
 *
 * Two engines are available:
 *   1. Seal Engine (yt-dlp): Full-featured on-device extraction and download.
 *      Requires the Android APK or Windows EXE. Supports 1000+ sites.
 *   2. Cobalt Engine (client-side): Lightweight browser-based extraction
 *      using oEmbed + direct stream URLs. Works in any browser but limited
 *      to direct media URLs.
 *
 * The selected engine is persisted in localStorage and used by DownloaderCard
 * to determine the download strategy.
 */

import { memo, useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Cpu, Globe, CheckCircle2, Info } from "lucide-react";
import { isNativeAvailable } from "@/lib/ytdlp-native";

export type EngineId = "seal" | "cobalt";

export interface EngineConfig {
  id: EngineId;
  label: string;
  description: string;
  badge: string;
  available: boolean;
  icon: typeof Cpu;
}

const STORAGE_KEY = "vidfetch.engine";

/**
 * Get the saved engine preference from localStorage.
 * Falls back to "seal" on native (APK/EXE) and "cobalt" on web.
 */
export function getSavedEngine(): EngineId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "seal" || saved === "cobalt") return saved;
  } catch {
    // Storage unavailable
  }
  // Default: use native engine if available, otherwise client-side
  return isNativeAvailable() ? "seal" : "cobalt";
}

/**
 * Save the engine preference to localStorage.
 */
export function saveEngine(engine: EngineId): void {
  try {
    localStorage.setItem(STORAGE_KEY, engine);
  } catch {
    // Storage unavailable
  }
}

/** Available engines configuration. */
export function getEngines(): EngineConfig[] {
  const native = isNativeAvailable();
  return [
    {
      id: "seal",
      label: "Seal Engine",
      description: native
        ? "Full yt-dlp engine on your device. Supports 1000+ sites, playlist downloads, and format selection."
        : "Requires Android APK or Windows EXE — not available in browser preview.",
      badge: native ? "Active" : "APK/EXE",
      available: native,
      icon: Cpu,
    },
    {
      id: "cobalt",
      label: "Cobalt Engine",
      description: "Client-side extraction via oEmbed + direct stream URLs. Works in any browser for direct media links.",
      badge: "Browser",
      available: true,
      icon: Globe,
    },
  ];
}

const EngineSwitcher = memo(function EngineSwitcher({
  value,
  onChange,
}: {
  value: EngineId;
  onChange: (engine: EngineId) => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const engines = getEngines();

  const handleSelect = useCallback(
    (id: EngineId) => {
      const engine = engines.find((e) => e.id === id);
      if (engine?.available) {
        onChange(id);
      }
    },
    [engines, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
          Download engine
        </p>
        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
        >
          <Info className="h-3 w-3" />
          {showInfo ? "Less info" : "What's this?"}
        </button>
      </div>

      {showInfo && (
        <div className="rounded-lg border border-border/30 bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-1">Engine comparison</p>
          <ul className="space-y-1">
            <li><strong>Seal (yt-dlp):</strong> Full extraction + download. 1000+ sites, playlists, all qualities. Needs APK/EXE.</li>
            <li><strong>Cobalt (client):</strong> Lightweight browser-based. Limited to direct media URLs. Works everywhere.</li>
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {engines.map((engine) => {
          const isSelected = value === engine.id;
          const Icon = engine.icon;

          return (
            <button
              key={engine.id}
              type="button"
              onClick={() => handleSelect(engine.id)}
              disabled={!engine.available}
              className={cn(
                "flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left transition-all duration-200 cursor-pointer select-none",
                isSelected
                  ? "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10 ring-1 ring-primary/20"
                  : engine.available
                    ? "border-border/40 bg-background hover:border-border/70 hover:bg-muted/50 hover:shadow-sm"
                    : "border-border/20 bg-muted/20 opacity-50 cursor-not-allowed",
              )}
            >
              <div className="flex items-center gap-2 w-full">
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isSelected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-semibold",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {engine.label}
                </span>
                {isSelected && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto shrink-0" />
                )}
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] font-medium",
                  isSelected
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {engine.badge}
              </span>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed line-clamp-2">
                {engine.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default EngineSwitcher;
