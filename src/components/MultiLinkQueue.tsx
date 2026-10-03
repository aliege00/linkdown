/**
 * MultiLinkQueue — the multi-link panel shown when the paste box contains
 * more than one link.
 *
 * Everything the user asked for lives here:
 *   • every detected link as its own row with a checkbox
 *   • "Select all" / "Clear"
 *   • quality + format choice built from the FIRST analyzed link's REAL
 *     formats (no fake 1080p on a 360p clip)
 *   • a start button that runs the queue strictly one link at a time, with
 *     per-row progress, the file that was saved, and the error text for the
 *     links that failed — a failing link never stops the rest
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Download, ListChecks, Loader2, Square, Trash2 } from "lucide-react";

import type { QueueItem, QueueSummary } from "@/lib/download-queue";
import type { QualityOption } from "@/lib/quality-options";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pending: "text-muted-foreground",
  downloading: "text-primary",
  completed: "text-emerald-500",
  failed: "text-destructive",
  cancelled: "text-muted-foreground/70",
};

export interface MultiLinkQueueProps {
  items: QueueItem[];
  summary: QueueSummary;
  /** Ids the user ticked. */
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRemoveAll: () => void;
  qualities: QualityOption[];
  selectedQuality: string;
  onQualityChange: (selector: string) => void;
  running: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** True while the engine is still being queried for real qualities. */
  probing: boolean;
  lang?: "tr" | "en";
}

export default function MultiLinkQueue({
  items,
  summary,
  selected,
  onToggle,
  onSelectAll,
  onClearSelection,
  onRemoveAll,
  qualities,
  selectedQuality,
  onQualityChange,
  running,
  onStart,
  onCancel,
  probing,
  lang = "tr",
}: MultiLinkQueueProps) {
  const tr = lang === "tr";
  const selectedCount = useMemo(
    () => items.filter((i) => selected.has(i.id)).length,
    [items, selected],
  );
  const activeIndex = items.findIndex((i) => i.status === "downloading");
  const finished = summary.completed + summary.failed + summary.cancelled;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-3 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">
            {tr
              ? `${items.length} link bulundu · ${selectedCount} seçili`
              : `${items.length} links found · ${selectedCount} selected`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onSelectAll}>
            {tr ? "Hepsini Seç" : "Select all"}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onClearSelection}>
            {tr ? "Temizle" : "Clear"}
          </Button>
          {!running && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={onRemoveAll}
              aria-label={tr ? "Listeyi sil" : "Clear list"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Link rows */}
      <ul className="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
        {items.map((item, index) => {
          const isSelected = selected.has(item.id);
          const isActive = index === activeIndex;
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
                isSelected ? "border-primary/40 bg-primary/5" : "border-border/50 bg-background/40",
                running && !isSelected && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => !running && onToggle(item.id)}
                disabled={running}
                aria-pressed={isSelected}
                aria-label={tr ? "Linki seç" : "Select link"}
                className="shrink-0 text-primary disabled:opacity-40"
              >
                {isSelected ? <CheckCircle2 className="h-5 w-5" /> : <Square className="h-5 w-5 text-muted-foreground/60" />}
              </button>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate" title={item.url}>
                  {item.title || item.url}
                </p>
                {item.title && (
                  <p className="text-[11px] text-muted-foreground truncate">{item.url}</p>
                )}
                {isActive && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${Math.max(4, item.percent)}%` }}
                    />
                  </div>
                )}
                {item.error && (
                  <p className="mt-0.5 flex items-start gap-1 text-[11px] text-destructive">
                    <AlertCircle className="h-3 w-3 mt-px shrink-0" />
                    <span className="line-clamp-2">{item.error}</span>
                  </p>
                )}
                {item.status === "completed" && item.fileName && (
                  <p className="mt-0.5 text-[11px] text-emerald-500 truncate">{item.fileName}</p>
                )}
              </div>

              <span className={cn("shrink-0 text-[11px] tabular-nums", STATUS_STYLES[item.status])}>
                {item.status === "downloading"
                  ? `${Math.round(item.percent)}%`
                  : item.status === "completed"
                    ? "✓"
                    : item.status === "failed"
                      ? "✕"
                      : item.status === "cancelled"
                        ? "—"
                        : ""}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Quality — only real streams of the analyzed video */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="batch-quality">
          {tr ? "Kalite / format" : "Quality / format"}
        </label>
        <select
          id="batch-quality"
          value={selectedQuality}
          onChange={(e) => onQualityChange(e.target.value)}
          disabled={running || probing}
          className="h-11 w-full rounded-xl border border-border/60 bg-background/60 px-3 text-sm disabled:opacity-50"
        >
          {qualities.map((q) => (
            <option key={q.selector} value={q.selector}>
              {q.label}
              {q.height === null && q.label === "Best" ? (tr ? " (en yüksek)" : " (highest)") : ""}
              {q.streamCount > 1 ? ` · ${q.streamCount} kaynak` : ""}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground/80">
          {probing
            ? tr ? "Gerçek kaliteler sorgulanıyor…" : "Checking real qualities…"
            : tr
              ? "Listelenen kaliteler videoda gerçekten var olanlardır."
              : "Only qualities this video really has are listed."}
        </p>
      </div>

      {/* Actions */}
      {running ? (
        <div className="space-y-1.5">
          <Button variant="outline" size="lg" className="w-full h-12 gap-2" onClick={onCancel}>
            <Square className="h-4 w-4" />
            {tr ? "Kuyruğu Durdur" : "Stop queue"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {tr
              ? `${finished + 1}/${items.length} işleniyor — sırayla indiriliyor`
              : `${finished + 1}/${items.length} processing — downloading one at a time`}
          </p>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full h-12 gap-2"
          disabled={selectedCount === 0 || probing}
          onClick={onStart}
        >
          {probing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
          {tr
            ? `${selectedCount} linki sırayla indir`
            : `Download ${selectedCount} sequentially`}
        </Button>
      )}
    </motion.div>
  );
}