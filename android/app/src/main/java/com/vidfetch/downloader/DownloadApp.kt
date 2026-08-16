package com.vidfetch.downloader

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.StatFs
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL

/**
 * Custom Application class that initializes the yt-dlp engine
 * and notification channels on app startup.
 *
 * youtubedl-android bundles a Python runtime + yt-dlp for Android ARM64.
 * init() unpacks these assets into the app's internal storage (idempotent).
 *
 * NOTE: init() can fail on first run (low storage during the ~60 MB
 * extraction, slow flash, etc.). If it does, we record WHY instead of
 * swallowing it — otherwise the user only ever sees the library's cryptic
 * "instance not initialized" later. The plugin retries init lazily before
 * every analyze/download, which usually recovers from a transient startup
 * failure by the time the user actually pastes a URL.
 */
class DownloadApp : Application() {

    companion object {
        const val DOWNLOAD_CHANNEL_ID = "vidfetch_downloads"
        const val DOWNLOAD_CHANNEL_NAME = "Video Downloads"

        /**
         * Why the embedded yt-dlp engine failed to initialize, or null when
         * it is ready. Written at app startup, cleared once a lazy retry in
         * the plugin succeeds.
         */
        @Volatile
        var engineError: String? = null

        /**
         * Builds an actionable, human-readable reason for an engine init
         * failure — includes the device ABI and free space so the user (or
         * the developer looking at a screenshot) knows what to do.
         */
        fun describeEngineError(filesDirPath: String, e: Exception): String {
            val cause = e.cause?.message ?: e.message ?: e.javaClass.simpleName
            val abi = Build.SUPPORTED_ABIS.joinToString(", ")
            val freeMb = try {
                StatFs(filesDirPath).availableBytes / 1024 / 1024
            } catch (_: Exception) {
                -1L
            }
            return "The download engine could not start on this device " +
                "(ABI: $abi, free space: $freeMb MB). Reason: $cause. " +
                "Free up some storage and restart the app, or reinstall it."
        }

        /**
         * Initializes BOTH parts of the download engine:
         *   - YoutubeDL:  unpacks the embedded Python runtime + yt-dlp
         *   - FFmpeg:     unpacks the ffmpeg binary used to merge
         *                 video+audio streams (required for most YouTube
         *                 qualities above 720p and for --merge-output-format)
         *
         * Idempotent and synchronized inside the library, so calling this
         * repeatedly (startup, lazy retry in the plugin, worker) is safe.
         *
         * @return null when the engine is ready, or an actionable error
         */
        fun initEngine(context: Context): String? {
            return try {
                YoutubeDL.init(context)
                try {
                    FFmpeg.getInstance().init(context)
                } catch (e: Exception) {
                    // ffmpeg failure should not brick the whole engine — the
                    // error surfaces later if a download actually needs to merge.
                    Log.w("DownloadApp", "FFmpeg init failed (non-fatal)", e)
                }
                null
            } catch (e: Exception) {
                describeEngineError(context.filesDir.absolutePath, e)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()

        // ── Initialize yt-dlp engine (+ ffmpeg) ────────────────────
        // Unpacks the embedded Python runtime + yt-dlp + ffmpeg to internal
        // storage. Safe to call repeatedly — it no-ops once initialized.
        engineError = initEngine(this)
        if (engineError == null) {
            Log.i("DownloadApp", "yt-dlp engine + ffmpeg initialized")
        } else {
            Log.e("DownloadApp", "Failed to initialize yt-dlp engine: $engineError")
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
