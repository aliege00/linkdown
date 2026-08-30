import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.vidfetch.downloader",
  appName: "VidFetch",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    backgroundColor: "#00000000",
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: process.env.NODE_ENV !== "production",
    hardwareAccelerated: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: "#00000000",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
    },
  },
};

export default config;
