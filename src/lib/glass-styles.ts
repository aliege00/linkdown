/**
 * Inline glassmorphism style objects.
 *
 * These are applied as React `style={{ ... }}` props alongside the CSS
 * classes, so even if Tailwind or any CSS processor strips the classes,
 * the glass effect still renders.
 */

export const glassCard: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.08)",
  WebkitBackdropFilter: "blur(12px) saturate(180%)",
  backdropFilter: "blur(12px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  borderRadius: "24px",
  boxShadow:
    "0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.15)",
  WebkitTransform: "translateZ(0)",
  transform: "translateZ(0)",
  willChange: "transform",
  touchAction: "pan-y" as const,
};

export const glassCardDark: React.CSSProperties = {
  background: "rgba(18, 18, 24, 0.65)",
  WebkitBackdropFilter: "blur(12px) saturate(180%)",
  backdropFilter: "blur(12px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "24px",
  boxShadow:
    "0 8px 32px 0 rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.05)",
  WebkitTransform: "translateZ(0)",
  transform: "translateZ(0)",
  willChange: "transform",
  touchAction: "pan-y" as const,
};

export const glassBar: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.72)",
  WebkitBackdropFilter: "blur(16px) saturate(200%)",
  backdropFilter: "blur(16px) saturate(200%)",
  border: "1px solid rgba(255, 255, 255, 0.45)",
  borderRadius: "35px",
  boxShadow:
    "0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.03)",
  WebkitTransform: "translateZ(0)",
  transform: "translateZ(0)",
  willChange: "transform",
};

export const glassBarDark: React.CSSProperties = {
  background: "rgba(30, 30, 35, 0.78)",
  WebkitBackdropFilter: "blur(16px) saturate(200%)",
  backdropFilter: "blur(16px) saturate(200%)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "35px",
  boxShadow:
    "0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.06), inset 0 -1px 1px rgba(0, 0, 0, 0.1)",
  WebkitTransform: "translateZ(0)",
  transform: "translateZ(0)",
  willChange: "transform",
};

export const neonInput: React.CSSProperties = {
  WebkitBackdropFilter: "blur(8px)",
  backdropFilter: "blur(8px)",
  background: "rgba(255, 255, 255, 0.05)",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  borderRadius: "16px",
  WebkitBoxShadow:
    "inset 0 2px 4px rgba(0, 0, 0, 0.06), inset 0 1px 2px rgba(0, 0, 0, 0.04)",
  boxShadow:
    "inset 0 2px 4px rgba(0, 0, 0, 0.06), inset 0 1px 2px rgba(0, 0, 0, 0.04)",
};

/**
 * Helper: returns dark or light glass style based on document class.
 * Safe to call in render — reads .dark from <html>.
 */
export function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** Returns the appropriate glass card style for the current theme. */
export function currentGlassCard(): React.CSSProperties {
  return isDark() ? glassCardDark : glassCard;
}

/** Returns the appropriate glass bar style for the current theme. */
export function currentGlassBar(): React.CSSProperties {
  return isDark() ? glassBarDark : glassBar;
}
