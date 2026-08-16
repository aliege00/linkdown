import type { DesktopBridge } from "@/lib/ytdlp-native";

declare global {
  interface Window {
    /**
     * Navigate to the auth page with a custom redirect URL
     * @param redirectUrl - URL to redirect to after successful authentication
     */
    navigateToAuth: (redirectUrl: string) => void;

    /**
     * Desktop (Electron EXE) bridge, exposed by electron/preload.cjs.
     * Undefined when running in a browser or the Android APK.
     */
    vidfetch?: DesktopBridge;

    /**
     * Build fingerprint injected by index.html so a screenshot of the app
     * tells us exactly which APK/EXE build is installed.
     */
    __VIDFETCH_BUILD__?: string;
  }
}

export {};