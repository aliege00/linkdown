import { useState, useCallback } from "react";
import {
  getDownloadHistory,
  clearDownloadHistory,
  type DownloadRecord,
} from "@/lib/history";
import { Clock, FileVideo, ListVideo, Trash2, Copy } from "lucide-react";
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
            <Clock className="size-5 text-[#8e8e93]" />
            <p className="text-base font-semibold">Geçmiş</p>
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-[#8e8e93]"
              onClick={handleClear}
            >
              <Trash2 className="size-3.5" />
              Temizle
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#8e8e93]">
            Henüz indirme yok
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[#262930]">
            {history.map((record) => (
              <li key={record.id} className="flex items-center gap-3 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#6cb4ee]/10">
                  {record.kind === "playlist" ? (
                    <ListVideo className="size-4 text-[#6cb4ee]" />
                  ) : (
                    <FileVideo className="size-4 text-[#6cb4ee]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{record.title}</p>
                  <p className="text-xs text-[#8e8e93]">
                    {record.formatLabel || "video"} ·{" "}
                    {new Date(record.time).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-[#8e8e93]"
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
