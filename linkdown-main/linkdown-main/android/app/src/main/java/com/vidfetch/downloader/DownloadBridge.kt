package com.vidfetch.downloader

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import androidx.work.*
import io.woong.ytdl.YoutubeDL
import io.woong.ytdl.YoutubeDLRequest
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
                    option("--dump-json")
                    option("--no-download")
                    option("--no-playlist")
                    option("--no-warnings")
                }

                val response = YoutubeDL.getInstance().execute(request)
                val jsonOutput = response.out ?: run {
                    call.reject("No output from yt-dlp")
                    return@Thread
                }

                // First line = first video (skip playlist entries)
                val firstLine = jsonOutput.split("\n").first()
                val data = JSONObject(firstLine)

                // Build clean format list matching the old HTTP API structure
                val formats = JSONArray()
                val rawFormats = data.optJSONArray("formats")
                if (rawFormats != null) {
                    for (i in 0 until rawFormats.length()) {
                        val f = rawFormats.getJSONObject(i)
                        val vcodec = f.optString("vcodec", "none")
                        val acodec = f.optString("acodec", "none")

                        // Skip text-only formats (subtitles, etc.)
                        if (vcodec == "none" && acodec == "none") continue

                        val clean = JSONObject().apply {
                            put("format_id", f.optString("format_id", ""))
                            put("ext", f.optString("ext", ""))
                            put("resolution", f.optString("resolution", "unknown"))
                            put("filesize", f.opt("filesize"))
                            put("vcodec", if (vcodec == "none") JSONObject.NULL else vcodec)
                            put("acodec", if (acodec == "none") JSONObject.NULL else acodec)
                            put("fps", f.opt("fps"))
                            put("tbr", f.opt("tbr"))
                        }
                        formats.put(clean)
                    }
                }

                // Determine best combined format
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
                    put("id", data.optString("id", ""))
                    put("title", data.optString("title", "Unknown"))
                    put("duration", data.opt("duration"))
                    put("thumbnail", data.optString("thumbnail", ""))
                    put("uploader", data.optString("uploader",
                        data.optString("channel", "Unknown")))
                    put("uploader_url", data.optString("uploader_url",
                        data.optString("channel_url", "")))
                    put("webpage_url", data.optString("webpage_url", url))
                    put("formats", formats)
                    put("best_format_id", bestFormatId)
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

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val workRequest = OneTimeWorkRequest.Builder(DownloadWorker::class.java)
            .setInputData(inputData)
            .setConstraints(constraints)
            .addTag(DownloadWorker.TAG)
            .build()

        currentWorkId = workRequest.id

        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                "download_${System.currentTimeMillis()}",
                ExistingWorkPolicy.KEEP,
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
        when {
            !workIdStr.isNullOrEmpty() -> {
                try {
                    val workId = UUID.fromString(workIdStr)
                    WorkManager.getInstance(context).cancelWorkById(workId)
                    call.resolve()
                } catch (e: Exception) {
                    call.reject("Invalid workId: $workIdStr")
                }
            }
            currentWorkId != null -> {
                WorkManager.getInstance(context).cancelWorkById(currentWorkId!!)
                call.resolve()
            }
            else -> call.reject("No active download to cancel")
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
