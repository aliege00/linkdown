package com.vidfetch.downloader;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ⚠️ Register the YtDlp plugin BEFORE super.onCreate().
        // In Capacitor 8, BridgeActivity.onCreate() builds the bridge (and
        // snapshots its plugin list) during super.onCreate(). Registering
        // afterwards silently drops the plugin from the native registry, so
        // the web app sees '"YtDlp" plugin is not implemented on android'.
        registerPlugin(DownloadBridge.class);

        super.onCreate(savedInstanceState);

        // Optional, defensive touch/scroll settings. Capacitor's default
        // CapacitorWebView already handles scrolling correctly; these calls
        // only normalize scrollbar and overscroll behavior. They must never
        // crash the app if the bridge is not ready yet.
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.setVerticalScrollBarEnabled(true);
                webView.setHorizontalScrollBarEnabled(false);
                webView.setOverScrollMode(WebView.OVER_SCROLL_IF_CONTENT_SCROLLS);
                webView.setScrollContainer(true);
            }
        } catch (Exception ignored) {
            // Never let cosmetic WebView tweaks break app startup.
        }
    }
}
