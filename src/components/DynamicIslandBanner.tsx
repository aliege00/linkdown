import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertCircle, Download, Loader2, X } from "lucide-react";
import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";

export type BannerType = "success" | "error" | "downloading" | "info";

export interface BannerRef {
  show: (type: BannerType, message: string, duration?: number) => void;
  hide: () => void;
}

interface BannerState {
  visible: boolean;
  type: BannerType;
  message: string;
}

const ICONS: Record<BannerType, typeof Check> = {
  success: Check,
  error: AlertCircle,
  downloading: Download,
  info: Loader2,
};

const COLORS: Record<BannerType, string> = {
  success: "bg-emerald-500/90 text-white",
  error: "bg-red-500/90 text-white",
  downloading: "bg-primary/90 text-primary-foreground",
  info: "bg-muted text-muted-foreground",
};

/**
 * iOS Dynamic Island-style banner notification.
 * Expands from a pill at the top-center with spring animation,
 * shows status, then auto-collapses.
 */
const DynamicIslandBanner = forwardRef<BannerRef>(function DynamicIslandBanner(
  _props,
  ref,
) {
  const [state, setState] = useState<BannerState>({
    visible: false,
    type: "info",
    message: "",
  });
  const timerRef = useState<ReturnType<typeof setTimeout> | null>(null)[0];

  const hide = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const show = useCallback(
    (type: BannerType, message: string, duration = 3000) => {
      // Clear any existing timer
      if (timerRef) clearTimeout(timerRef);

      setState({ visible: true, type, message });

      // Auto-collapse after duration
      if (duration > 0) {
        setTimeout(() => {
          setState((s) => ({ ...s, visible: false }));
        }, duration);
      }
    },
    [timerRef],
  );

  useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef) clearTimeout(timerRef);
    };
  }, [timerRef]);

  const Icon = ICONS[state.type];
  const colorClass = COLORS[state.type];

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex justify-center pointer-events-none pt-[env(safe-area-inset-top)]">
      <AnimatePresence>
        {state.visible && (
          <motion.div
            key="banner"
            initial={{ width: 48, opacity: 0, y: -20, scaleY: 0.6 }}
            animate={{ width: "auto", opacity: 1, y: 8, scaleY: 1 }}
            exit={{ width: 48, opacity: 0, y: -20, scaleY: 0.6 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 28,
              mass: 0.9,
            }}
            className="pointer-events-auto overflow-hidden"
            style={{
              willChange: "transform, width, opacity",
              transformOrigin: "top center",
            }}
          >
            <div
              className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-xl backdrop-blur-xl border border-white/20 dark:border-white/10 ${colorClass}`}
              style={{
                background: state.type === "success"
                  ? "rgba(16, 185, 129, 0.92)"
                  : state.type === "error"
                    ? "rgba(239, 68, 68, 0.92)"
                    : state.type === "downloading"
                      ? "rgba(99, 102, 241, 0.92)"
                      : "rgba(28, 28, 30, 0.88)",
              }}
            >
              <motion.div
                animate={
                  state.type === "downloading"
                    ? { rotate: 360 }
                    : { rotate: 0 }
                }
                transition={
                  state.type === "downloading"
                    ? { repeat: Infinity, duration: 1, ease: "linear" }
                    : {}
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
              </motion.div>

              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.25 }}
                className="text-[13px] font-semibold whitespace-nowrap max-w-[240px] truncate"
              >
                {state.message}
              </motion.span>

              {/* Close button */}
              <button
                type="button"
                onClick={hide}
                className="ml-1 p-0.5 rounded-full hover:bg-white/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default DynamicIslandBanner;
