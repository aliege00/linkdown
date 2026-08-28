/**
 * ClipboardNotification — floating notification card that appears
 * when a video URL is detected in the system clipboard.
 *
 * Shows the detected URL with "Download" and "Dismiss" actions.
 * Animated with framer-motion for smooth entrance/exit.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { Clipboard, Download, X } from "lucide-react";
import type { ClipboardUrl } from "@/hooks/use-clipboard-monitor";

interface ClipboardNotificationProps {
  /** The detected URL, or null to hide the notification. */
  url: ClipboardUrl | null;
  /** Callback when the user clicks "Download". */
  onDownload: (url: string) => void;
  /** Callback when the user dismisses the notification. */
  onDismiss: () => void;
  /** Auto-dismiss timeout in ms (default: 8000). 0 = no auto-dismiss. */
  autoDismiss?: number;
}

export function ClipboardNotification({
  url,
  onDownload,
  onDismiss,
  autoDismiss = 8000,
}: ClipboardNotificationProps) {
  // Auto-dismiss timer
  if (url && autoDismiss > 0) {
    setTimeout(() => {
      onDismiss();
    }, autoDismiss);
  }

  return (
    <AnimatePresence>
      {url && (
        <motion.div
          key="clipboard-notification"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="fixed bottom-6 right-6 z-50 max-w-sm"
        >
          <Card className="border-primary/20 bg-card/95 shadow-lg backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Clipboard className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug">
                    Yeni link yakalandı
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {url.displayUrl}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={() => onDownload(url.url)}
                  size="sm"
                  className="flex-1 gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  İndir
                </Button>
                <Button
                  onClick={onDismiss}
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                >
                  Kapat
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
