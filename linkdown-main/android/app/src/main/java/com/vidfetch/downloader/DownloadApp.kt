package com.vidfetch.downloader

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import io.woong.ytdl.YoutubeDL

/**
 * Custom Application class that initializes the yt-dlp engine
 * and notification channels on app startup.
 *
 * The youtubedl-android library bundles a Python 3.10 runtime
 * compiled for Android ARM64 along with yt-dlp lazy extractors.
 * init() unpacks these assets into the app's internal storage.
 */
class DownloadApp : Application() {

    companion object {
        const val DOWNLOAD_CHANNEL_ID = "vidfetch_downloads"
        const val DOWNLOAD_CHANNEL_NAME = "Video Downloads"
    }

    override fun onCreate() {
        super.onCreate()

        // ── Initialize youtubedl-android engine ─────────────────────
        // This must be called once before any download operations.
        // It unpacks the embedded Python runtime + yt-dlp to internal storage.
        YoutubeDL.getInstance().init(this)

        // ── Create notification channel (Android 8.0+) ──────────────
        // Required for foreground service notifications.
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
