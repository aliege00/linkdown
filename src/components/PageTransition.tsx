import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "react-router";
import type { ReactNode } from "react";

/**
 * Page transition between ROUTES (the landing page → the app, app → chat,
 * any legal page). The dashboard tabs already animate inside Dashboard.tsx;
 * this covers navigation where the whole document is swapped.
 *
 * `mode="wait"` means the outgoing page finishes leaving before the incoming
 * one enters, so the two never overlap and cross-fade into mush. Transform +
 * opacity only — both are compositor-driven, so a page change costs no
 * layout or paint work.
 *
 * Respects the OS "reduce motion" setting AND the in-app "Animasyonları kapat"
 * switch (main.tsx maps that switch onto MotionConfig reducedMotion="always"),
 * so with animations off this component renders a plain instant swap.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-dvh"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}