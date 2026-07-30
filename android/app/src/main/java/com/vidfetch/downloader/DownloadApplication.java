package com.vidfetch.downloader;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import io.woong.ytdl.YoutubeDL;

/**
 * Custom Application class that initializes the yt-dlp engine
 * and notification channels on app startup.
 */
public class DownloadApplication extends Application {

    public static final String DOWNLOAD_CHANNEL_ID = "vidfetch_downloads";
    public static final String DOWNLOAD_CHANNEL_NAME = "Video Downloads";

    @Override
    public void onCreate() {
        super.onCreate();

        // ── Initialize youtubedl-android engine ─────────────────────
        // This bundles Python 3.10 + yt-dlp lazy extractors for Android ARM64.
        // Must be called once before any download operations.
        YoutubeDL.getInstance().init(this);

        // ── Create notification channel ─────────────────────────────
        // Required for Android 8.0+ (API 26+) foreground service notifications.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    DOWNLOAD_CHANNEL_ID,
                    DOWNLOAD_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_LOW // Low = no sound, shows in shade
            );
            channel.setDescription("Notification for ongoing video downloads");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
