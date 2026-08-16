package com.vidfetch.downloader

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * WorkManager CoroutineWorker that downloads videos using yt-dlp
 * in a persistent foreground service.
 *
 * Survives app minimization, screen lock, and even process death.
 * Provides real-time progress callbacks (percent, speed, ETA) that
 * are bridged to the web UI via the Capacitor plugin, and surfaces
 * the same progress in the status-bar notification.
 */
class DownloadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val KEY_URL = "url"
        const val KEY_FORMAT_ID = "formatId"
        const val KEY_IS_PLAYLIST = "isPlaylist"
        const val KEY_PROGRESS = "progress"
        const val KEY_SPEED = "speed"
        const val KEY_ETA = "eta"
        const val KEY_ITEM = "item"
        const val KEY_ITEM_COUNT = "itemCount"
        const val KEY_OUTPUT_URI = "outputUri"
        const val KEY_OUTPUT_NAME = "outputName"
        const val KEY_FILE_COUNT = "fileCount"
        const val UNIQUE_WORK_NAME = "vidfetch_download"
        const val TAG = "vidfetch_download"
        private const val NOTIFICATION_ID = 1001
        private const val COMPLETE_NOTIFICATION_ID = 1002

        // Matches a speed token from the yt-dlp progress line, e.g. "12.5MiB/s"
        private val SPEED_PATTERN =
            Regex("([0-9]+(?:\\.[0-9]+)?\\s?[KMGTP]?i?B/s)")

        // Matches playlist item counters, e.g. "[youtube] PLxxx: Downloading item 3 of 10"
        private val ITEM_PATTERN = Regex("Downloading item (\\d+) of (\\d+)")

        // Tracks the live yt-dlp process so cancelDownload() can kill it.
        @Volatile
        var activeProcessId: String? = null
    }

    // Lets the (non-suspend) progress callback push WorkManager progress
    // updates through a coroutine, since setProgress() is suspend.
    private val progressScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // Throttles notification refreshes so rapid yt-dlp progress lines
    // don't spam the status bar (~4 updates/second max).
    private var lastNotificationUpdate = 0L

    override suspend fun doWork(): Result {
        val url = inputData.getString(KEY_URL) ?: return Result.failure()
        val formatId = inputData.getString(KEY_FORMAT_ID)
            ?.takeIf { it.isNotBlank() } ?: "best"
        val isPlaylist = inputData.getBoolean(KEY_IS_PLAYLIST, false)
        val processId = "vidfetch_${System.currentTimeMillis()}"
        activeProcessId = processId

        return try {
            // ── Step 1: Promote to Foreground Service ──────────────
            // Tells Android: "This task is important, don't kill it"
            setForeground(createForegroundInfo("Starting download…", 0, false))

            // ── Step 1.5: Ensure the engine is initialized ─────────
            // The Application class initializes it at startup, but a
            // transient startup failure (low storage mid-extraction) is
            // retried here — init is idempotent, so this is always safe.
            // Inits both yt-dlp AND ffmpeg (needed to merge video+audio).
            DownloadApp.initEngine(applicationContext)?.let { err ->
                throw IllegalStateException("Download engine failed to start: $err")
            }

            // ── Step 2: Prepare output path ────────────────────────
            val downloadDir = File(applicationContext.filesDir, "downloads").apply { mkdirs() }
            // Playlists land in "<playlist title>/NNN - title.ext" so every
            // video from the playlist stays grouped in one folder.
            val outputTemplate = if (isPlaylist) {
                "${downloadDir.absolutePath}/%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s"
            } else {
                "${downloadDir.absolutePath}/%(title)s.%(ext)s"
            }

            // ── Step 3: Build yt-dlp request ───────────────────────
            val request = YoutubeDLRequest(url).apply {
                addOption("-f", formatId)
                if (!isPlaylist) addOption("--no-playlist")
                addOption("--no-warnings")
                addOption("--no-cache-dir")
                addOption("--merge-output-format", "mp4")
                addOption("-o", outputTemplate)

                // Authenticated YouTube requests (cookies.txt imported by the
                // user in the advanced settings) bypass the bot check.
                if (DownloadPrefs.getCookiesFileName(applicationContext) != null) {
                    val cookieFile = File(applicationContext.filesDir, "cookies.txt")
                    if (cookieFile.exists()) {
                        addOption("--cookies", cookieFile.absolutePath)
                    }
                }
            }

            // ── Step 4: Execute download with real-time progress ──
            // Callback args: (percent 0-100 Float, ETA seconds Long,
            // raw progress line String?).
            var currentItem = 0
            var totalItems = 0
            YoutubeDL.execute(request, processId, true) { percent, etaSeconds, line ->
                val pct = if (percent >= 0f) percent.toInt().coerceIn(0, 100) else 0
                val speed = SPEED_PATTERN.find(line ?: "")?.groupValues?.getOrNull(1) ?: "0 B/s"
                val eta = formatEta(etaSeconds)

                // Track the playlist item counter, e.g. "Downloading item 3 of 10"
                val im = ITEM_PATTERN.find(line ?: "")
                if (im != null) {
                    currentItem = im.groupValues[1].toIntOrNull() ?: 0
                    totalItems = im.groupValues[2].toIntOrNull() ?: 0
                }

                // Update WorkManager progress (observed by the UI bridge)
                val builder = Data.Builder()
                    .putInt(KEY_PROGRESS, pct)
                    .putString(KEY_SPEED, speed)
                    .putString(KEY_ETA, eta)
                if (isPlaylist) {
                    builder.putInt(KEY_ITEM, currentItem)
                    builder.putInt(KEY_ITEM_COUNT, totalItems)
                }
                val progressData = builder.build()

                progressScope.launch {
                    setProgress(progressData)
                }

                // Update the persistent notification (percent · speed · ETA),
                // throttled to keep the status bar smooth
                val now = SystemClock.elapsedRealtime()
                if (now - lastNotificationUpdate >= 250 || pct >= 100) {
                    lastNotificationUpdate = now
                    updateNotification("$pct% · $speed · ETA $eta", pct, false)
                }
            }

            // ── Step 5: Find the downloaded output ────────────────
            // Single videos: the newest file. Playlists: the newest folder
            // yt-dlp created (named after the playlist).
            val downloaded = if (isPlaylist) {
                downloadDir.listFiles()
                    ?.filter { it.isDirectory() }
                    ?.maxByOrNull { it.lastModified() }
            } else {
                downloadDir.listFiles()
                    ?.maxByOrNull { it.lastModified() }
            }

            // ── Step 6: Save to public Downloads folder ────────────
            var savedUri: String? = null
            var savedName: String? = null
            var savedCount = 0
            val customTreeUri = DownloadPrefs.getSaveToUri(applicationContext)

            if (isPlaylist && downloaded != null && downloaded.isDirectory) {
                // Save every file of the playlist, one by one.
                updateNotification("Saving ${downloaded.name}…", 100, false)
                val files = (downloaded.listFiles() ?: emptyArray())
                    .filter { it.isFile }
                    .sortedBy { it.name }
                for (file in files) {
                    val mime = MediaStoreHelper.mimeTypeFor(file.name)
                    val uri = if (!customTreeUri.isNullOrEmpty()) {
                        MediaStoreHelper.saveToTree(
                            applicationContext, customTreeUri, file, file.name, mime
                        )
                    } else {
                        MediaStoreHelper.saveToDownloads(
                            applicationContext, file, file.name, mime
                        )
                    }
                    if (uri != null) {
                        if (savedUri == null) savedUri = uri
                        savedCount++
                    }
                    file.delete()
                }
                downloaded.delete()
                savedName = downloaded.name
            } else if (downloaded != null && downloaded.exists() && downloaded.isFile) {
                updateNotification("Saving to Downloads…", 100, false)
                val mime = MediaStoreHelper.mimeTypeFor(downloaded.name)
                // Save into the user's chosen folder when set, otherwise the
                // default Downloads/VidFetch folder.
                savedUri = if (!customTreeUri.isNullOrEmpty()) {
                    MediaStoreHelper.saveToTree(
                        applicationContext, customTreeUri, downloaded, downloaded.name, mime
                    )
                } else {
                    MediaStoreHelper.saveToDownloads(
                        applicationContext, downloaded, downloaded.name, mime
                    )
                }
                savedName = downloaded.name
                if (savedUri != null) savedCount = 1
                downloaded.delete()
            }

            // ── Step 7: Done ───────────────────────────────────────
            val savedMime = savedName?.let { MediaStoreHelper.mimeTypeFor(it) }
            val statusText = when {
                isPlaylist && savedCount > 0 -> "Saved $savedCount videos"
                savedName != null -> "Saved: $savedName"
                else -> "Download complete"
            }
            updateNotification(statusText, 100, true, savedUri, savedMime)
            // Keep a tappable "complete" notification after the foreground
            // service stops (WorkManager auto-removes the FGS notification).
            showCompleteNotification(statusText, savedUri, savedMime)

            val output = Data.Builder()
                .putString(KEY_OUTPUT_URI, savedUri)
                .putString(KEY_OUTPUT_NAME, savedName)
                .putBoolean(KEY_IS_PLAYLIST, isPlaylist)
                .putInt(KEY_FILE_COUNT, savedCount)
                .build()
            Result.success(output)

        } catch (e: Exception) {
            e.printStackTrace()
            val errorMsg = e.message ?: "Download failed"
            updateNotification(errorMsg, 0, true)

            // Retry up to 3 times for transient errors
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        } finally {
            activeProcessId = null
            progressScope.cancel()
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

    private fun createNotification(
        text: String,
        progress: Int,
        done: Boolean,
        openUri: String? = null,
        openMime: String? = null
    ): Notification {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(
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

        // "Open" action on the completion notification
        if (done && !openUri.isNullOrEmpty()) {
            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(openUri), openMime ?: "video/*")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val openPendingIntent = PendingIntent.getActivity(
                applicationContext, 1, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Open", openPendingIntent)
        }

        return builder.build()
    }

    private fun updateNotification(
        text: String,
        progress: Int,
        done: Boolean,
        openUri: String? = null,
        openMime: String? = null
    ) {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager?.notify(
            NOTIFICATION_ID,
            createNotification(text, progress, done, openUri, openMime)
        )
    }

    /** Posts the persistent "Download complete — Open" notification. */
    private fun showCompleteNotification(
        fileName: String?,
        openUri: String?,
        openMime: String?
    ) {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager?.notify(
            COMPLETE_NOTIFICATION_ID,
            createNotification(
                fileName ?: "Saved to Downloads/VidFetch",
                100,
                true,
                openUri,
                openMime
            )
        )
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private fun formatEta(etaSeconds: Long): String {
        if (etaSeconds < 0) return "--:--"
        val minutes = etaSeconds / 60
        val seconds = etaSeconds % 60
        return "%02d:%02d".format(minutes, seconds)
    }
}
