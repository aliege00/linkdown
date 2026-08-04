package com.vidfetch.downloader

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
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
 *   - extractInfo({ url })            → Get video metadata & formats
 *   - startDownload({ url, formatId })→ Start foreground download
 *   - cancelDownload({ workId })      → Cancel a download
 *   - openFile({ uri })               → Open a saved file with the system viewer
 *   - getDownloads()                  → List saved files (Downloads/VidFetch)
 *
 * Events emitted to JS:
 *   - downloadProgress { percent, speed, eta }
 *   - downloadComplete { uri, fileName }
 *   - downloadError { error }
 */
@CapacitorPlugin(name = "YtDlp")
class DownloadBridge : Plugin() {

    companion object {
        private const val TAG = "DownloadBridge"
        private const val EVENT_PROGRESS = "downloadProgress"
        private const val EVENT_COMPLETE = "downloadComplete"
        private const val EVENT_ERROR = "downloadError"
        private const val REQ_NOTIFICATION_PERMISSION = 2001
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

        // On Android 13+ the notification permission must be granted at
        // runtime for the download progress notification to be visible.
        requestNotificationPermissionIfNeeded()

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

    // ── Open saved file ─────────────────────────────────────────────

    @PluginMethod
    fun openFile(call: PluginCall) {
        val uri = call.getString("uri")
        if (uri.isNullOrEmpty()) {
            call.reject("uri is required")
            return
        }

        val opened = MediaStoreHelper.openFile(context, uri)
        if (opened) {
            call.resolve()
        } else {
            call.reject("Could not open the file")
        }
    }

    // ── List saved downloads ────────────────────────────────────────

    @PluginMethod
    fun getDownloads(call: PluginCall) {
        Thread {
            try {
                // Merges the default Downloads/VidFetch folder with the
                // user's custom folder (if one is chosen).
                val downloads = MediaStoreHelper.queryDownloads(
                    context,
                    DownloadPrefs.getSaveToUri(context)
                )
                call.resolve(JSObject().put("downloads", downloads))
            } catch (e: Exception) {
                Log.e(TAG, "getDownloads failed", e)
                call.reject(e.message ?: "Failed to list downloads")
            }
        }.start()
    }

    // ── Choose download folder (SAF) ───────────────────────────────

    /** Opens the system folder picker and persists the user's choice. */
    @PluginMethod
    fun pickFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }

        // The result arrives in the @ActivityCallback method below
        startActivityForResult(call, intent, "folderPicked")
    }

    /** Receives the picked folder URI from the system picker. */
    @ActivityCallback
    private fun folderPicked(call: PluginCall, result: ActivityResult) {
        val treeUri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (treeUri == null) {
            call.reject("Folder selection cancelled")
            return
        }

        try {
            // Keep access after the app is killed and reopened
            context.contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (e: Exception) {
            Log.w(TAG, "takePersistableUriPermission failed", e)
        }

        val doc = DocumentFile.fromTreeUri(context, treeUri)
        val name = doc?.name?.takeIf { it.isNotBlank() } ?: "Custom folder"
        DownloadPrefs.saveLocation(context, treeUri.toString(), name)

        call.resolve(JSObject().apply {
            put("uri", treeUri.toString())
            put("name", name)
            put("isDefault", false)
        })
    }

    /** Returns the current download folder (or default when unset). */
    @PluginMethod
    fun getDownloadLocation(call: PluginCall) {
        val uri = DownloadPrefs.getSaveToUri(context)
        call.resolve(JSObject().apply {
            put("uri", uri ?: "")
            put("name", DownloadPrefs.getSaveToName(context) ?: "")
            put("isDefault", uri.isNullOrEmpty())
        })
    }

    /** Resets downloads to the default Downloads/VidFetch folder. */
    @PluginMethod
    fun resetDownloadLocation(call: PluginCall) {
        DownloadPrefs.clearLocation(context)
        call.resolve()
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
                        val out = workInfo.outputData
                        notifyListeners(EVENT_COMPLETE, JSObject().apply {
                            put("uri", out.getString(DownloadWorker.KEY_OUTPUT_URI) ?: "")
                            put("fileName", out.getString(DownloadWorker.KEY_OUTPUT_NAME) ?: "")
                        })
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

    // ── Helpers ────────────────────────────────────────────────────

    /** Requests POST_NOTIFICATIONS on Android 13+ so the progress
     *  notification is visible in the status bar. */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val act = activity ?: return
        if (ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        ActivityCompat.requestPermissions(
            act,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            REQ_NOTIFICATION_PERMISSION
        )
    }
}
