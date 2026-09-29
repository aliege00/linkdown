package com.vidfetch;

import android.os.Bundle;

/**
 * Legacy MainActivity in the wrong package — the real, used entry point is
 * com.vidfetch.downloader.MainActivity (see AndroidManifest.xml `.MainActivity`
 * resolving against the application namespace com.vidfetch.downloader).
 *
 * This file registers NO plugins and is never referenced. Kept as a stub with
 * no behavior so it can never shadow or break the real activity. If you are
 * looking for the app entry point, see downloader/MainActivity.java.
 */
public class MainActivity extends androidx.activity.ComponentActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        finish(); // Not the real entry point — never shown.
    }
}
