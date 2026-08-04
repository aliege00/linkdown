package com.vidfetch.downloader;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

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
    }
}
