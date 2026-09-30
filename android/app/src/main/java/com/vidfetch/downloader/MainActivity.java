package com.vidfetch.downloader;

import android.view.MotionEvent;
import android.view.View;
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

                // ── Kill the long-press "Paste" floating menu ──────────
                // Users reported the WebView text-selection Paste bubble
                // appearing when long-pressing anywhere on the screen. The
                // app has no editable text surfaces that need it (the URL
                // field uses the clipboard BUTTON, not long-press menus),
                // so the cleanest fix is to stop the WebView from ever
                // starting text-selection ActionModes: consume the long
                // press before the WebView reacts, and back the broader
                // suppression with setLongClickable(false) on the WebView.
                webView.setOnLongClickListener(new View.OnLongClickListener() {
                    @Override
                    public boolean onLongClick(View v) {
                        return true; // consume — no Paste/selection menu
                    }
                });
                webView.setLongClickable(false);
                webView.setHapticFeedbackEnabled(false);
                webView.setOnTouchListener(new View.OnTouchListener() {
                    @Override
                    public boolean onTouch(View v, MotionEvent event) {
                        // Swallow long-press-generated ACTION_UP events so
                        // the selection handle menu never materializes.
                        if (event.getAction() == MotionEvent.ACTION_UP) {
                            v.performClick();
                        }
                        return false; // never block normal scrolling/taps
                    }
                });
            }
        } catch (Exception ignored) {
            // Never let cosmetic WebView tweaks break app startup.
        }
    }
}
