/**
 * Settings context — one source of truth for the toggles in the "Ayarlar"
 * tab, shared by main.tsx (framer-motion reducedMotion + page transitions)
 * and SettingsTab (the switches themselves).
 *
 * Kept deliberately tiny: a value object plus a setter that persists to
 * localStorage and re-applies the <html> data attributes.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  applySettings,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "@/lib/app-settings";

interface SettingsContextValue {
  settings: AppSettings;
  /** Merge a patch into the current settings, persist and mirror to <html>. */
  update: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Apply on mount too: a fresh page load must show the saved look before
  // the first paint of an animated screen.
  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      applySettings(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * Read the settings. Outside the provider (unit tests, isolated components)
 * this falls back to the stored value with a no-op setter instead of
 * throwing, so a component can never crash on a missing provider.
 */
export function useAppSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  return { settings: loadSettings(), update: () => {} };
}