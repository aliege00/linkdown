package com.vidfetch.downloader

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Capacitor plugin that bridges yt-dlp video download functionality
 * from native Kotlin to the web-based UI.
 *
 * Exposed JS methods:
 *   - extractInfo({ url })        → Get video metadata & formats
 *   - startDownload({ url, formatId }) → Start foreground download
 *   - cancelDownload({ workId })  → Cancel a download
 *
 * Events emitted to JS:
 *   - downloadProgress { percent, speed, eta }
 *   - downloadComplete {}
 *   - downloadError { error }
 */
@CapacitorPlugin(name = "YtDlp")
class DownloadBridge : Plugin() {

    companion object {
        private const val TAG = "DownloadBridge"
        private const val EVENT_PROGRESS = "downloadProgress"
        private const val EVENT_COMPLETE = "downloadComplete"
        private const val EVENT_ERROR = "downloadError"
    }

    private var currentWorkId: UUID? = null

    // ── Extract Video Info ─────────────────────────────────────────

    @PluginMethod
    fun extractInfo(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrEmpty()) {
            call.reject("URL is required")
            return
        }

        Thread {
            try {
                val request = YoutubeDLRequest(url).apply {
                    addOption("--no-playlist")
                    addOption("--no-warnings")
                }

                // getInfo() adds --dump-json and parses the JSON for us
                val info = YoutubeDL.getInfo(request)

                // Build the format list matching the existing VidFetch API contract
                val formats = JSONArray()
                info.formats?.forEach { f ->
                    // Skip text-only formats (subtitles, etc.)
                    if (f.vcodec == null && f.acodec == null) return@forEach

                    val resolution = when {
                        f.width > 0 && f.height > 0 -> "${f.width}x${f.height}"
                        !f.formatNote.isNullOrEmpty() -> f.formatNote!!
                        else -> "unknown"
                    }

                    val clean = JSONObject().apply {
                        put("format_id", f.formatId ?: "")
                        put("ext", f.ext ?: "")
                        put("resolution", resolution)
                        put("filesize", if (f.fileSize > 0) f.fileSize else JSONObject.NULL)
                        put("vcodec", if (f.vcodec == null) JSONObject.NULL else f.vcodec)
                        put("acodec", if (f.acodec == null) JSONObject.NULL else f.acodec)
                        put("fps", f.fps)
                        put("tbr", f.tbr)
                    }
                    formats.put(clean)
                }

                // Determine best combined (video+audio) format
                var bestFormatId = "best"
                for (i in 0 until formats.length()) {
                    val f = formats.getJSONObject(i)
                    if (f.has("vcodec") && !f.isNull("vcodec") &&
                        f.has("acodec") && !f.isNull("acodec")
                    ) {
                        bestFormatId = f.optString("format_id", "best")
                        break
                    }
                }

                // Build response matching the existing VidFetch API contract
                val result = JSObject().apply {
                    put("success", true)
                    put("id", info.id ?: "")
                    put("title", info.title ?: info.fulltitle ?: "Unknown")
                    put("duration", info.duration)
                    put("thumbnail", info.thumbnail ?: "")
                    put("uploader", info.uploader ?: "Unknown")
                    put("uploader_url", info.webpageUrl ?: url)
                    put("webpage_url", info.webpageUrl ?: url)
                    put("formats", formats)
                    put("best_format_id", bestFormatId)
                    put("best_audio_format_id", JSONObject.NULL)
                    put("ffmpeg_available", true)
                }

                call.resolve(result)

            } catch (e: Exception) {
                Log.e(TAG, "extractInfo failed", e)
                call.reject(e.message ?: "Extraction failed")
            }
        }.start()
    }

    // ── Start Download ─────────────────────────────────────────────

    @PluginMethod
    fun startDownload(call: PluginCall) {
        val url = call.getString("url")
        var formatId = call.getString("formatId") ?: "best"
        if (formatId.isEmpty()) formatId = "best"

        if (url.isNullOrEmpty()) {
            call.reject("URL is required")
            return
        }

        val inputData = Data.Builder()
            .putString(DownloadWorker.KEY_URL, url)
            .putString(DownloadWorker.KEY_FORMAT_ID, formatId)
            .build()

        val workRequest = OneTimeWorkRequest.Builder(DownloadWorker::class.java)
            .setInputData(inputData)
            .addTag(DownloadWorker.TAG)
            .build()

        currentWorkId = workRequest.id

        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                DownloadWorker.UNIQUE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                workRequest
            )

        // Observe progress and emit events to web UI
        observeWork(workRequest.id)

        val result = JSObject().apply {
            put("workId", workRequest.id.toString())
        }
        call.resolve(result)
    }

    // ── Cancel Download ────────────────────────────────────────────

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        val workIdStr = call.getString("workId")
        try {
            if (!workIdStr.isNullOrEmpty()) {
                WorkManager.getInstance(context).cancelWorkById(UUID.fromString(workIdStr))
            } else {
                WorkManager.getInstance(context)
                    .cancelUniqueWork(DownloadWorker.UNIQUE_WORK_NAME)
            }

            // Kill the underlying yt-dlp process so the download actually stops
            DownloadWorker.activeProcessId?.let { YoutubeDL.destroyProcessById(it) }

            call.resolve()
        } catch (e: Exception) {
            call.reject("Cancel failed: ${e.message}")
        }
    }

    // ── Observe WorkManager Progress ───────────────────────────────

    private fun observeWork(workId: UUID) {
        WorkManager.getInstance(context)
            .getWorkInfoByIdLiveData(workId)
            .observeForever { workInfo ->
                if (workInfo == null) return@observeForever

                when (workInfo.state) {
                    WorkInfo.State.RUNNING -> {
                        val progress = workInfo.progress
                        val percent = progress.getInt(DownloadWorker.KEY_PROGRESS, 0)
                        val speed = progress.getString(DownloadWorker.KEY_SPEED) ?: "0"
                        val eta = progress.getString(DownloadWorker.KEY_ETA) ?: "--:--"

                        notifyListeners(EVENT_PROGRESS, JSObject().apply {
                            put("percent", percent)
                            put("speed", speed)
                            put("eta", eta)
                        })
                    }
                    WorkInfo.State.SUCCEEDED -> {
                        notifyListeners(EVENT_COMPLETE, JSObject())
                    }
                    WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> {
                        notifyListeners(EVENT_ERROR, JSObject().apply {
                            put("error", "Download ${workInfo.state.name.lowercase()}")
                        })
                    }
                    else -> { /* ignore */ }
                }
            }
    }
}
