package com.vidfetch;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Custom MainActivity that forces WebView scroll and touch settings
 * to prevent the Capacitor WebView from locking touch/scroll on Android.
 *
 * BridgeActivity sets up the Capacitor bridge and WebView. After super.onCreate,
 * we access the WebView via getBridge().getWebView() and force:
 *   - Vertical scrollbar visible (Android renders a scroll indicator)
 *   - Overscroll mode ALWAYS (shows overscroll glow, confirms touch works)
 *   - JavaScript enabled (required, but make sure it's not disabled)
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Force WebView scroll settings after bridge is initialized
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();

            // Enable JavaScript (Capacitor requires it)
            settings.setJavaScriptEnabled(true);

            // Allow file access
            settings.setAllowFileAccess(true);

            // Force vertical scrollbar
            webView.setVerticalScrollBarEnabled(true);
            webView.setHorizontalScrollBarEnabled(false);

            // Force overscroll mode — confirms touch events reach WebView
            webView.setOverScrollMode(WebView.OVER_SCROLL_ALWAYS);

            // Ensure the WebView itself can scroll
            webView.setScrollContainer(true);
        }
    }
}
