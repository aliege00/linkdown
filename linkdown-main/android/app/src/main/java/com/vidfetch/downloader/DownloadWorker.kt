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
import io.woong.ytdl.YoutubeDL
import io.woong.ytdl.YoutubeDLRequest
import java.io.File

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
        const val TAG = "vidfetch_download"
        private const val NOTIFICATION_ID = 1001
    }

    override suspend fun doWork(): Result {
        val url = inputData.getString(KEY_URL) ?: return Result.failure()
        var formatId = inputData.getString(KEY_FORMAT_ID) ?: "best"
        if (formatId.isEmpty()) formatId = "best"

        return try {
            // ── Step 1: Promote to Foreground Service ──────────────
            // This tells Android: "This task is important, don't kill it"
            setForeground(createForegroundInfo("Starting download...", 0, false))

            // ── Step 2: Prepare output path ────────────────────────
            val downloadDir = File(applicationContext.filesDir, "downloads")
            if (!downloadDir.exists()) downloadDir.mkdirs()
            val outputTemplate = "${downloadDir.absolutePath}/%(title)s.%(ext)s"

            // ── Step 3: Build yt-dlp request ───────────────────────
            val request = YoutubeDLRequest(url).apply {
                option("-f", formatId)
                option("--no-playlist")
                option("--no-warnings")
                option("--no-cache-dir")
                option("--merge-output-format", "mp4")
                option("-o", outputTemplate)

                // Real-time progress callback from yt-dlp stderr
                progressCallback { data ->
                    val percent = data.percent?.toInt() ?: 0
                    val speed = data.speed ?: "0"
                    val eta = data.eta ?: "--:--"

                    // Update WorkManager progress (observed by UI)
                    setProgress(Data.Builder()
                        .putInt(KEY_PROGRESS, percent)
                        .putString(KEY_SPEED, speed)
                        .putString(KEY_ETA, eta)
                        .build())

                    // Update the persistent notification
                    updateNotification("Downloading... $percent%", percent, false)
                }
            }

            // ── Step 4: Execute download ───────────────────────────
            val response = YoutubeDL.getInstance().execute(request)
            val title = response.title ?: "video"
            val ext = response.ext ?: "mp4"
            val fileName = "${sanitizeFileName(title)}.$ext"

            // ── Step 5: Find the downloaded file ───────────────────
            val downloadedFile = downloadDir.listFiles { _, name ->
                name.contains(sanitizeFileName(title))
            }?.firstOrNull()

            // ── Step 6: Save to public Downloads folder ────────────
            if (downloadedFile != null && downloadedFile.exists()) {
                updateNotification("Saving to Downloads...", 100, false)

                val saved = MediaStoreHelper.saveToDownloads(
                    applicationContext,
                    downloadedFile,
                    fileName,
                    "video/mp4"
                )

                if (saved) {
                    MediaStoreHelper.registerInMediaStore(
                        applicationContext,
                        downloadedFile.absolutePath,
                        "video/mp4"
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
        }
    }

    // ── Foreground Service Helpers ──────────────────────────────────

    private fun createForegroundInfo(text: String, progress: Int, done: Boolean): ForegroundInfo {
        val notification = createNotification(text, progress, done)
        return ForegroundInfo(
            NOTIFICATION_ID,
            notification,
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
            .setProgress(100, progress, progress == 0)
            .build()
    }

    private fun updateNotification(text: String, progress: Int, done: Boolean) {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, createNotification(text, progress, done))
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private fun sanitizeFileName(name: String): String {
        return name.replace(Regex("[^a-zA-Z0-9\\-_. ]"), "_")
            .take(80)
    }
}
