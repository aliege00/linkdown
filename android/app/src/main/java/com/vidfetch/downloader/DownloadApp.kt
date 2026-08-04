package com.vidfetch.downloader

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import com.yausername.youtubedl_android.YoutubeDL

/**
 * Custom Application class that initializes the yt-dlp engine
 * and notification channels on app startup.
 *
 * youtubedl-android bundles a Python runtime + yt-dlp for Android ARM64.
 * init() unpacks these assets into the app's internal storage (idempotent).
 */
class DownloadApp : Application() {

    companion object {
        const val DOWNLOAD_CHANNEL_ID = "vidfetch_downloads"
        const val DOWNLOAD_CHANNEL_NAME = "Video Downloads"
    }

    override fun onCreate() {
        super.onCreate()

        try {
            // Unpacks the embedded Python runtime + yt-dlp to internal storage.
            // Safe to call repeatedly — it no-ops once initialized.
            YoutubeDL.init(this)
        } catch (e: Exception) {
            Log.e("DownloadApp", "Failed to initialize yt-dlp engine", e)
        }

        // ── Create notification channel (Android 8.0+) ──────────────
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                DOWNLOAD_CHANNEL_ID,
                DOWNLOAD_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW // Low = no sound, shows in shade
            ).apply {
                description = "Notifications for ongoing video downloads"
                setShowBadge(false)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }
}
