package com.vidfetch.downloader

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.util.regex.Pattern

/**
 * WorkManager CoroutineWorker that downloads videos using yt-dlp
 * in a persistent foreground service.
 *
 * Survives app minimization, screen lock, and even process death.
 * Provides real-time progress callbacks (percent, speed, ETA) that
 * are bridged to the web UI via the Capacitor plugin.
 */
class DownloadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val KEY_URL = "url"
        const val KEY_FORMAT_ID = "formatId"
        const val KEY_PROGRESS = "progress"
        const val KEY_SPEED = "speed"
        const val KEY_ETA = "eta"
        const val UNIQUE_WORK_NAME = "vidfetch_download"
        const val TAG = "vidfetch_download"
        private const val NOTIFICATION_ID = 1001

        // Matches a speed token from the yt-dlp progress line, e.g. "12.5MiB/s"
        private val SPEED_PATTERN =
            Pattern.compile("([0-9]+(?:\\.[0-9]+)?\\s?[KMGTP]?i?B/s)")

        // Tracks the live yt-dlp process so cancelDownload() can kill it.
        @Volatile
        var activeProcessId: String? = null
    }

    override suspend fun doWork(): Result {
        val url = inputData.getString(KEY_URL) ?: return Result.failure()
        val formatId = inputData.getString(KEY_FORMAT_ID)
            ?.takeIf { it.isNotBlank() } ?: "best"
        val processId = "vidfetch_${System.currentTimeMillis()}"
        activeProcessId = processId

        return try {
            // ── Step 1: Promote to Foreground Service ──────────────
            // Tells Android: "This task is important, don't kill it"
            setForeground(createForegroundInfo("Starting download…", 0, false))

            // ── Step 2: Prepare output path ────────────────────────
            val downloadDir = File(applicationContext.filesDir, "downloads").apply { mkdirs() }
            val outputTemplate = "${downloadDir.absolutePath}/%(title)s.%(ext)s"

            // ── Step 3: Build yt-dlp request ───────────────────────
            val request = YoutubeDLRequest(url).apply {
                addOption("-f", formatId)
                addOption("--no-playlist")
                addOption("--no-warnings")
                addOption("--no-cache-dir")
                addOption("--merge-output-format", "mp4")
                addOption("-o", outputTemplate)
            }

            // ── Step 4: Execute download with real-time progress ──
            // redirectErrorStream = true so progress lines reach the
            // stdout parser. Callback args: (percent 0-100 Float,
            // ETA seconds Long, raw progress line String).
            YoutubeDL.execute(request, processId, true) { percent, etaSeconds, line ->
                val pct = if (percent >= 0f) percent.toInt().coerceIn(0, 100) else 0
                val speed = SPEED_PATTERN.find(line)?.groupValues?.get(1) ?: "0 B/s"
                val eta = formatEta(etaSeconds)

                // Update WorkManager progress (observed by the UI bridge)
                setProgress(
                    Data.Builder()
                        .putInt(KEY_PROGRESS, pct)
                        .putString(KEY_SPEED, speed)
                        .putString(KEY_ETA, eta)
                        .build()
                )

                // Update the persistent notification
                updateNotification("Downloading… $pct% · $speed", pct, false)
            }

            // ── Step 5: Find the downloaded file (newest in folder) ─
            val downloadedFile = downloadDir.listFiles()
                ?.maxByOrNull { it.lastModified() }

            // ── Step 6: Save to public Downloads folder ────────────
            if (downloadedFile != null && downloadedFile.exists()) {
                updateNotification("Saving to Downloads…", 100, false)

                val mime = mimeTypeFor(downloadedFile)
                val saved = MediaStoreHelper.saveToDownloads(
                    applicationContext,
                    downloadedFile,
                    downloadedFile.name,
                    mime
                )

                if (saved) {
                    MediaStoreHelper.registerInMediaStore(
                        applicationContext,
                        downloadedFile.absolutePath,
                        mime
                    )
                }

                downloadedFile.delete()
            }

            // ── Step 7: Done ───────────────────────────────────────
            updateNotification("Download complete", 100, true)
            Result.success()

        } catch (e: Exception) {
            e.printStackTrace()
            val errorMsg = e.message ?: "Download failed"
            updateNotification(errorMsg, 0, true)

            // Retry up to 3 times for transient errors
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        } finally {
            activeProcessId = null
        }
    }

    // ── Foreground Service Helpers ──────────────────────────────────

    private fun createForegroundInfo(text: String, progress: Int, done: Boolean): ForegroundInfo {
        return ForegroundInfo(
            NOTIFICATION_ID,
            createNotification(text, progress, done),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
    }

    private fun createNotification(text: String, progress: Int, done: Boolean): Notification {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(
            applicationContext,
            DownloadApp.DOWNLOAD_CHANNEL_ID
        )
            .setContentTitle(if (done) "Download complete" else "Downloading video")
            .setContentText(text)
            .setSmallIcon(
                if (done) android.R.drawable.stat_sys_download_done
                else android.R.drawable.stat_sys_download
            )
            .setOngoing(!done)
            .setAutoCancel(done)
            .setContentIntent(pendingIntent)
            .setProgress(100, progress, progress <= 0)
            .build()
    }

    private fun updateNotification(text: String, progress: Int, done: Boolean) {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, createNotification(text, progress, done))
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private fun formatEta(etaSeconds: Long): String {
        if (etaSeconds < 0) return "--:--"
        val minutes = etaSeconds / 60
        val seconds = etaSeconds % 60
        return "%02d:%02d".format(minutes, seconds)
    }

    private fun mimeTypeFor(file: File): String {
        return when (file.extension.lowercase()) {
            "webm" -> "video/webm"
            "mkv" -> "video/x-matroska"
            "mov" -> "video/quicktime"
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            else -> "video/mp4"
        }
    }
}
