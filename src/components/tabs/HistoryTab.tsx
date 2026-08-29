import { useState, useCallback } from "react";
import {
  getDownloadHistory,
  clearDownloadHistory,
  type DownloadRecord,
} from "@/lib/history";
import { Clock, FileVideo, ListVideo, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/GlassCard";

export default function HistoryTab() {
  const [history, setHistory] = useState<DownloadRecord[]>(() =>
    getDownloadHistory(),
  );

  const handleClear = () => {
    clearDownloadHistory();
    setHistory([]);
  };

  const copyLink = useCallback(async (record: DownloadRecord) => {
    try {
      await navigator.clipboard.writeText(record.url);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <GlassCard interactive>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground/60" />
            <p className="text-sm font-semibold">Geçmiş</p>
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={handleClear}
            >
              <Trash2 className="size-3" />
              Temizle
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground/50">
            Henüz indirme yok
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/20">
            {history.map((record) => (
              <li key={record.id} className="flex items-center gap-3 py-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {record.kind === "playlist" ? (
                    <ListVideo className="size-3.5" />
                  ) : (
                    <FileVideo className="size-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{record.title}</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    {record.formatLabel || "video"} ·{" "}
                    {new Date(record.time).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => copyLink(record)}
                >
                  <Copy className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
