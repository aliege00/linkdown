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
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Custom Application class that prepares the yt-dlp engine and the
 * notification channel on app startup.
 *
 * youtubedl-android bundles a Python runtime + yt-dlp for Android. init()
 * unpacks these assets into the app's internal storage (idempotent).
 *
 * ⚠️ TWO HARDENING RULES LEARNED THE HARD WAY (both from a shipped crash):
 *
 *  1. **Catch Throwable, never Exception.** The failure users reported was
 *     `java.lang.ExceptionInInitializerError` raised inside Chaquopy's static
 *     initialiser. That is an `Error`, so the old `catch (e: Exception)`
 *     did not catch it: it escaped `initEngine`, propagated out of
 *     `Application.onCreate`, and the process died — the app appeared for an
 *     instant and closed. Catching `Throwable` is what makes a broken engine
 *     a readable error instead of a dead app.
 *
 *  2. **Never let the engine block startup.** Unpacking ~60 MB of Python +
 *     yt-dlp + ffmpeg assets on the main thread is slow enough to trip the
 *     ANR watchdog on cold storage. Startup kicks it off in the background;
 *     `DownloadBridge` retries lazily before every analyze/download anyway
 *     (see `retryEngineInit`), so nothing is lost by not waiting.
 */
class DownloadApp : Application() {

    companion object {
        const val DOWNLOAD_CHANNEL_ID = "vidfetch_downloads"
        const val DOWNLOAD_CHANNEL_NAME = "Video Downloads"

        private const val TAG = "DownloadApp"

        /**
         * Why the embedded yt-dlp engine failed to initialize, or null when it
         * is ready. Written whenever init is attempted, cleared once a lazy
         * retry succeeds.
         */
        @Volatile
        var engineError: String? = null

        /** Guards against starting the background init twice. */
        private val startupInitStarted = AtomicBoolean(false)

        /**
         * Builds an actionable, human-readable reason for an engine init
         * failure — includes the device ABI and free space so the user (or the
         * developer looking at a screenshot) knows what to do.
         */
        fun describeEngineError(filesDirPath: String, t: Throwable): String {
            val cause = t.cause?.message ?: t.message ?: t.javaClass.simpleName
            val abi = Build.SUPPORTED_ABIS.joinToString(", ")
            val freeMb = try {
                StatFs(filesDirPath).availableBytes / 1024 / 1024
            } catch (_: Throwable) {
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
         * Catches `Throwable` on purpose: Chaquopy raises
         * `ExceptionInInitializerError` (an `Error`) when its runtime cannot
         * start, and letting that escape kills the whole app at launch.
         *
         * @return null when the engine is ready, or an actionable error
         */
        fun initEngine(context: Context): String? {
            return try {
                YoutubeDL.init(context)
                try {
                    FFmpeg.getInstance().init(context)
                } catch (t: Throwable) {
                    // ffmpeg failure should not brick the whole engine — the
                    // error surfaces later if a download actually needs to merge.
                    Log.w(TAG, "FFmpeg init failed (non-fatal)", t)
                }
                null
            } catch (t: Throwable) {
                // Includes OutOfMemoryError and, crucially, the
                // ExceptionInInitializerError Chaquopy throws when its static
                // initialiser fails (e.g. under R8 without the right rules).
                val described = describeEngineError(context.filesDir.absolutePath, t)
                Log.e(TAG, "yt-dlp engine init failed", t)
                described
            }
        }

        /**
         * Kick off engine initialization off the main thread. Never throws:
         * a broken engine must not stop the app from starting.
         */
        private fun initEngineAsync(context: Context) {
            Thread({
                engineError = initEngine(context)
                if (engineError == null) {
                    Log.i(TAG, "yt-dlp engine + ffmpeg initialized")
                }
            }, "vidfetch-engine-init").apply {
                priority = Thread.NORM_PRIORITY - 1
                isDaemon = true
                start()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()

        // ── Initialize yt-dlp engine (+ ffmpeg) in the BACKGROUND ────
        // ~60 MB of assets are unpacked here; doing that on the main thread
        // risks an ANR, and doing it *fatally* would close the app on launch.
        // The bridge retries lazily before every analyze/download, so the UI
        // never depends on this finishing first.
        if (startupInitStarted.compareAndSet(false, true)) {
            initEngineAsync(this)
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