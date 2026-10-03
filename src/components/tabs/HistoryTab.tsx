import { useState, useCallback } from "react";
import {
  getDownloadHistory,
  clearDownloadHistory,
  type DownloadRecord,
} from "@/lib/history";
import {
  Clock,
  FileVideo,
  ListVideo,
  Trash2,
  Copy,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlatCard } from "@/components/FlatCard";

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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <FlatCard interactive>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" />
            <p className="text-base font-semibold">Geçmiş</p>
            {history.length > 0 && (
              <span className="rounded-full bg-[#6cb4ee]/10 px-2 py-0.5 text-[11px] font-bold text-[#6cb4ee]">
                {history.length}
              </span>
            )}
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-[#ff453a]"
              onClick={handleClear}
            >
              <Trash2 className="size-3.5" />
              Tümünü Temizle
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-secondary">
              <Download className="size-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">
                Henüz indirme yok
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                İndirdiğiniz videolar burada görünecek
              </p>
            </div>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {history.map((record) => (
              <li
                key={record.id}
                className="group flex items-center gap-3 rounded-xl px-1 py-3 transition-colors hover:bg-secondary/60"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#6cb4ee]/10 transition-colors group-hover:bg-[#6cb4ee]/20">
                  {record.kind === "playlist" ? (
                    <ListVideo className="size-4 text-[#6cb4ee]" />
                  ) : (
                    <FileVideo className="size-4 text-[#6cb4ee]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{record.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {record.formatLabel || "video"} ·{" "}
                    {new Date(record.time).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground transition-colors hover:text-[#6cb4ee]"
                  onClick={() => copyLink(record)}
                >
                  <Copy className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </FlatCard>
    </div>
  );
}
