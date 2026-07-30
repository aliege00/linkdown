package com.vidfetch.downloader;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Register the YtDlp native plugin for web-to-native bridging
        registerPlugin(DownloadBridge.class);
    }
}
