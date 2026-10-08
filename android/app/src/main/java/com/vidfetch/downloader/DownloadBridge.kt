package com.vidfetch.downloader

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
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
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Capacitor plugin that bridges yt-dlp video download functionality
 * from native Kotlin to the web-based UI.
 *
 * Exposed JS methods:
 *   - extractInfo({ url })            → Get video metadata & formats
 *   - startDownload({ url, formatId })→ Start foreground download
 *   - cancelDownload({ workId })      → Cancel a download
 *   - openFile({ uri })               → Open a saved file with the system viewer
 *   - getDownloads()                  → List saved files (Download/VidFetch)
 *   - getActiveDownload()             → State of the running download chain
 *   - ensureDownloadFolder()          → Create Download/VidFetch if missing
 *
 * Events emitted to JS:
 *   - downloadProgress { percent, speed, eta }
 *   - downloadComplete { uri, fileName }
 *   - downloadError { error }
 */
@CapacitorPlugin(
    name = "YtDlp",
    permissions = [
        Permission(
            alias = "storage",
            strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE]
        )
    ]
)
/*
 * Error handling note: every catch on the JS boundary is `Throwable`, not
 * `Exception`. The engine (Chaquopy/yt-dlp) raises `Error` subclasses —
 * ExceptionInInitializerError among them — and a single uncaught one kills the
 * process while the user is tapping, which reads to them as "the app just
 * closed". Turning those into a rejected promise keeps the UI alive.
 */
class DownloadBridge : Plugin() {

    companion object {
        private const val TAG = "DownloadBridge"
        private const val EVENT_PROGRESS = "downloadProgress"
        private const val EVENT_COMPLETE = "downloadComplete"
        private const val EVENT_ERROR = "downloadError"
        private const val REQ_NOTIFICATION_PERMISSION = 2001
        private const val COOKIES_FILE = "cookies.txt"
    }

    private var currentWorkId: UUID? = null

    /**
     * Main-thread Handler used to hop off Capacitor's plugin HandlerThread.
     *
     * Capacitor dispatches `@PluginMethod` calls on a background
     * HandlerThread (see Bridge.callPluginMethod). Android APIs that assert
     * the main thread — LiveData.observeForever, ActivityCompat
     * .requestPermissions, anything touching a View — throw
     * IllegalStateException there, which the JS bridge wraps into a
     * RuntimeException and the app dies with. Every such call must be
     * wrapped in runOnMain { … }.
     */
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    /**
     * WorkManager LiveData sources currently observed via observeForever,
     * kept so handleOnDestroy() can detach them. Without this the observers
     * (and through them this plugin instance) leak for the app's lifetime.
     */
    private val activeObservers =
        mutableListOf<Pair<androidx.lifecycle.LiveData<WorkInfo?>, androidx.lifecycle.Observer<WorkInfo?>>>()

    /**
     * Work IDs already observed, so a re-attach never double-observes (which
     * would deliver every progress event twice).
     */
    private val observedWorkIds = mutableSetOf<UUID>()

    /**
     * Attaches observers for downloads that are still running.
     *
     * This is the other half of the "switching tabs kills the download"
     * report. The observer lived only on the `startDownload()` call, so any
     * time the Activity was recreated — Android drops a backgrounded Activity
     * to save memory, and the user returns by tapping the download
     * notification — the whole plugin instance, and with it every observer,
     * was gone. WorkManager happily kept downloading, but no progress and no
     * completion event ever reached the web UI again: the bar froze where it
     * was and the file finished unseen. Re-attaching on `load()` restores the
     * event stream for whatever is still in flight.
     */
    override fun load() {
        super.load()
        reattachRunningWork()
    }

    /**
     * Runs [block] on the Android main (UI) thread, immediately when the
     * caller is already there.
     */
    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else mainHandler.post(block)
    }

    /** Detaches every forever-observer before the plugin goes away. */
    override fun handleOnDestroy() {
        runOnMain {
            for ((liveData, observer) in activeObservers) {
                liveData.removeObserver(observer)
            }
            activeObservers.clear()
            observedWorkIds.clear()
        }
        super.handleOnDestroy()
    }

    /**
     * Finds any unfinished job in the download chain and re-observes it.
     * Runs the WorkManager query off the plugin thread and only touches
     * LiveData back on the main thread.
     */
    private fun reattachRunningWork() {
        Thread {
            runCatching {
                WorkManager.getInstance(context)
                    .getWorkInfosForUniqueWork(DownloadWorker.UNIQUE_WORK_NAME)
                    .get()
            }.getOrNull()
                ?.filter { !it.state.isFinished }
                ?.forEach { info ->
                    runOnMain {
                        if (observedWorkIds.add(info.id)) attachWorkObserver(info.id)
                    }
                }
        }.start()
    }

    /**
     * The current state of the download chain, so a freshly mounted UI can
     * show a download it did not start itself.
     *
     * The web layer kept every piece of download state in React component
     * state, so the progress bar belonged to whichever screen happened to be
     * mounted. This endpoint makes the running job the single source of truth
     * instead of the component.
     */
    @PluginMethod
    fun getActiveDownload(call: PluginCall) {
        Thread {
            try {
                val infos = runCatching {
                    WorkManager.getInstance(context)
                        .getWorkInfosForUniqueWork(DownloadWorker.UNIQUE_WORK_NAME)
                        .get()
                }.getOrNull().orEmpty()

                val running = infos.firstOrNull { !it.state.isFinished }
                val latest = running ?: infos.lastOrNull()

                val progress = latest?.progress
                val output = latest?.outputData
                call.resolve(JSObject().apply {
                    put("active", running != null)
                    put("state", latest?.state?.name ?: "NONE")
                    // Handed back so a remounted UI can still cancel the job.
                    put("workId", latest?.id?.toString() ?: "")
                    put("percent", progress?.getInt(DownloadWorker.KEY_PROGRESS, 0) ?: 0)
                    put("speed", progress?.getString(DownloadWorker.KEY_SPEED) ?: "0")
                    put("eta", progress?.getString(DownloadWorker.KEY_ETA) ?: "--:--")
                    put("item", progress?.getInt(DownloadWorker.KEY_ITEM, 0) ?: 0)
                    put("itemCount", progress?.getInt(DownloadWorker.KEY_ITEM_COUNT, 0) ?: 0)
                    put("isPlaylist", output?.getBoolean(DownloadWorker.KEY_IS_PLAYLIST, false) ?: false)
                    put("uri", output?.getString(DownloadWorker.KEY_OUTPUT_URI) ?: "")
                    put("fileName", output?.getString(DownloadWorker.KEY_OUTPUT_NAME) ?: "")
                    put("error", output?.getString(DownloadWorker.KEY_OUTPUT_ERROR) ?: "")
                })
            } catch (e: Throwable) {
                Log.e(TAG, "getActiveDownload failed", e)
                call.reject(e.message ?: "Failed to read download state")
            }
        }.start()
    }

    // ── Download folder bootstrap ────────────────────────────────────

    /**
     * Makes sure `Download/VidFetch` is ready before the first download, and
     * asks for storage access only when the platform actually requires it.
     *
     * Never asks twice: the folder check runs first, and the permission
     * request is only reached when the folder is missing AND the Android
     * version gates the public directory behind a runtime grant (API < 29).
     * Android 10+ needs no permission at all, so modern devices are never
     * interrupted by a dialog.
     */
    @PluginMethod
    fun ensureDownloadFolder(call: PluginCall) {
        val needsGrant = MediaStoreHelper.needsStoragePermission() &&
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) != PackageManager.PERMISSION_GRANTED

        if (!needsGrant) {
            resolveFolderState(call, requested = false)
            return
        }

        val act = activity
        if (act == null) {
            // No Activity to prompt from (headless start): report the need and
            // let the UI offer the button instead of failing the whole call.
            call.resolve(JSObject().apply {
                put("ready", MediaStoreHelper.folderExists(context))
                put("needsPermission", true)
                put("path", MediaStoreHelper.VIDFETCH_PATH)
            })
            return
        }

        runOnMain {
            // The alias is declared on @CapacitorPlugin above; Capacitor maps
            // it to the permission string and remembers the call until the
            // user answers the system dialog.
            requestPermissionForAlias("storage", call, "storagePermissionCallback")
        }
    }

    /**
     * Runs after the system permission dialog, granted or denied.
     *
     * Capacitor invokes the callback with the saved [PluginCall] only, so the
     * outcome is re-read from the platform rather than passed in. A denial is
     * not an error: the download still works on any device where the folder
     // is reachable, and the UI reports `ready: false` instead of throwing.
     */
    @PermissionCallback
    private fun storagePermissionCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.WRITE_EXTERNAL_STORAGE
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            MediaStoreHelper.ensureVidFetchFolder(context)
        } else {
            Log.i(TAG, "storage permission denied — Download/VidFetch will be created on the next grant")
        }
        resolveFolderState(call, requested = true)
    }

    /** Answers `ensureDownloadFolder` with the folder's final state. */
    private fun resolveFolderState(call: PluginCall, requested: Boolean) {
        val ready = runCatching { MediaStoreHelper.ensureVidFetchFolder(context) }
            .getOrDefault(false)
        call.resolve(JSObject().apply {
            put("ready", ready)
            put("permissionRequested", requested)
            put("needsPermission", MediaStoreHelper.needsStoragePermission())
            put("path", MediaStoreHelper.VIDFETCH_PATH)
        })
    }

    // ── Extract Video Info ─────────────────────────────────────────

    @PluginMethod
    fun extractInfo(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrEmpty()) {
            call.reject("URL is required")
            return
        }
        val isPlaylist = call.getBoolean("isPlaylist", false) ?: false

        // The engine must be initialized before any yt-dlp call. Retry
        // lazily here — a failed startup init often succeeds on retry.
        val engineErr = ensureEngine()
        if (engineErr != null) {
            call.reject(engineErr)
            return
        }

        Thread {
            try {
                if (isPlaylist && extractPlaylistInfo(url, call)) return@Thread
                extractSingleVideoInfo(url, call)
            } catch (e: Throwable) {
                Log.e(TAG, "extractInfo failed", e)
                call.reject(e.message ?: "Extraction failed")
            }
        }.start()
    }

    /**
     * Playlist analysis. The library's VideoInfo model has no `entries`
     * field, so we run yt-dlp ourselves with --flat-playlist and parse the
     * raw JSON from stdout. Returns true when the URL really was a playlist
     * (the call has been resolved); false means it wasn't — the caller then
     * falls back to single-video extraction.
     */
    private fun extractPlaylistInfo(url: String, call: PluginCall): Boolean {
        try {
            val request = YoutubeDLRequest(url).apply {
                addOption("--dump-json")
                addOption("--flat-playlist")
                addOption("--no-warnings")
                cookiesArgs().forEach { addOption(it) }
            }
            val response = YoutubeDL.execute(
                request, "vidfetch_info_${System.currentTimeMillis()}"
            )
            if (response.exitCode != 0) {
                // Automatic bot-check fallback: rotate player clients before
                // surfacing any error to the user.
                if (response.err.lowercase().contains("not a bot") ||
                    response.err.lowercase().contains("sign in to confirm")
                ) {
                    var lastErr = response.err
                    for (retry in botCheckRetryArgs()) {
                        val retryReq = YoutubeDLRequest(url).apply {
                            addOption("--dump-json")
                            addOption("--flat-playlist")
                            addOption("--no-warnings")
                            retry.forEach { addOption(it) }
                        }
                        val r = YoutubeDL.execute(
                            retryReq, "vidfetch_info_${System.currentTimeMillis()}"
                        )
                        if (r.exitCode == 0) {
                            return handlePlaylistJson(r.out, url, call)
                        }
                        lastErr = r.err
                    }
                    call.reject(lastErr.ifBlank { "yt-dlp failed" })
                    return true
                }
                call.reject(response.err.ifBlank { "yt-dlp exited with code ${response.exitCode}" })
                return true
            }
            return handlePlaylistJson(response.out, url, call)
        } catch (e: Throwable) {
            Log.e(TAG, "extractPlaylistInfo failed", e)
            call.reject(e.message ?: "Playlist extraction failed")
            return true
        }
    }

    /** Parses a flat-playlist JSON payload and resolves the plugin call. */
    private fun handlePlaylistJson(out: String, url: String, call: PluginCall): Boolean {
        val root = JSONObject(out)
        val rawEntries = root.optJSONArray("entries")
        if (rawEntries == null) return false // not actually a playlist

            val entries = JSONArray()
            for (i in 0 until rawEntries.length()) {
                val e = rawEntries.getJSONObject(i)
                entries.put(JSONObject().apply {
                    put("id", e.optString("id", ""))
                    put("title", e.optString("title", e.optString("fulltitle", "")))
                    put("url", e.optString("url", e.optString("webpage_url", "")))
                    put(
                        "duration",
                        if (e.has("duration") && !e.isNull("duration"))
                            e.optLong("duration")
                        else
                            JSONObject.NULL
                    )
                    put("thumbnail", e.optString("thumbnail", ""))
                })
            }

            val result = JSObject().apply {
                put("success", true)
                put("is_playlist", true)
                put("id", root.optString("id", ""))
                put("title", root.optString("title", "Playlist"))
                put("duration", JSONObject.NULL)
                put("thumbnail", root.optString("thumbnail", ""))
                put(
                    "uploader",
                    root.optString("uploader", root.optString("channel", "Unknown"))
                )
                put(
                    "uploader_url",
                    root.optString("uploader_url", root.optString("channel_url", url))
                )
                put("webpage_url", root.optString("webpage_url", url))
                put("formats", JSONArray())
                put("best_format_id", "best")
                put("best_audio_format_id", JSONObject.NULL)
                put("ffmpeg_available", true)
                put("count", entries.length())
                put("entries", entries)
            }
            call.resolve(result)
            return true
    }

    /**
     * Builds the retry ladder for YouTube bot-check failures. YouTube's
     * "Sign in to confirm you're not a bot" wall depends on which player
     * client yt-dlp uses; rotating the client almost always gets through
     * WITHOUT any cookies. The default client stays first; only when the
     * user has explicitly imported a cookies.txt does it come into play.
     */
    private fun hasCookies(): Boolean =
        DownloadPrefs.getCookiesFileName(context) != null &&
            File(context.filesDir, COOKIES_FILE).exists()

    private fun botCheckRetryArgs(): List<List<String>> {
        val ladder = mutableListOf<List<String>>()
        ladder.add(listOf("--extractor-args", "youtube:player_client=default"))
        ladder.add(listOf("--extractor-args", "youtube:player_client=android"))
        ladder.add(listOf("--extractor-args", "youtube:player_client=ios"))
        ladder.add(listOf("--extractor-args", "youtube:player_client=tv_embedded"))
        // Cookies are the LAST resort — only when the user imported them.
        if (hasCookies()) {
            ladder.add(cookiesArgs())
        }
        return ladder
    }

    /** True when the error looks like YouTube's bot-check wall. */
    private fun isBotCheckError(e: Throwable): Boolean {
        val msg = (e.message ?: "").lowercase()
        return msg.contains("sign in to confirm") ||
            msg.contains("confirm you're not a bot") ||
            msg.contains("not a bot")
    }

    /** Single-video analysis — full format list, with automatic retry ladder. */
    private fun extractSingleVideoInfo(url: String, call: PluginCall) {
        try {
            val base = YoutubeDLRequest(url).apply {
                addOption("--no-playlist")
                addOption("--no-warnings")
                cookiesArgs().forEach { addOption(it) }
            }

            // getInfo() adds --dump-json and parses the JSON for us.
            // On a bot-check failure, rotate the player client automatically —
            // the user never sees the error unless EVERY fallback fails.
            val info = try {
                YoutubeDL.getInfo(base)
            } catch (e: Throwable) {
                if (!isBotCheckError(e)) throw e
                Log.w(TAG, "bot check on analyze — trying fallback clients")
                var last: Throwable = e
                var success = false
                for (retry in botCheckRetryArgs()) {
                    try {
                        val retryReq = YoutubeDLRequest(url).apply {
                            addOption("--no-playlist")
                            addOption("--no-warnings")
                            retry.forEach { addOption(it) }
                        }
                        resolveSingleVideoInfo(url, YoutubeDL.getInfo(retryReq), call)
                        success = true
                        break
                    } catch (e2: Throwable) {
                        last = e2
                    }
                }
                if (!success) throw last
                return
            }

            resolveSingleVideoInfo(url, info, call)
        } catch (e: Throwable) {
            Log.e(TAG, "extractSingleVideoInfo failed", e)
            call.reject(e.message ?: "Extraction failed")
        }
    }

    /** Maps a yt-dlp VideoInfo object onto the plugin response and resolves the call. */
    private fun resolveSingleVideoInfo(
        url: String,
        info: com.yausername.youtubedl_android.mapper.VideoInfo,
        call: PluginCall,
    ) {
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
            put("is_playlist", false)
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
    }

    // ── Start Download ─────────────────────────────────────────────

    @PluginMethod
    fun startDownload(call: PluginCall) {
        val url = call.getString("url")
        var formatId = call.getString("formatId") ?: "best"
        if (formatId.isEmpty()) formatId = "best"
        val isPlaylist = call.getBoolean("isPlaylist", false) ?: false
        // Parallel-fragment count from the app's speed setting. Out-of-range
        // values are clamped here too, so a hand-edited preference can never
        // produce a request yt-dlp would choke on. getInt() is @Nullable even
        // with a default, so the elvis re-states the default explicitly.
        val fragments = (call.getInt(
            "fragments", DownloadWorker.DEFAULT_CONCURRENT_FRAGMENTS
        ) ?: DownloadWorker.DEFAULT_CONCURRENT_FRAGMENTS).coerceIn(
            DownloadWorker.MIN_CONCURRENT_FRAGMENTS,
            DownloadWorker.MAX_CONCURRENT_FRAGMENTS,
        )

        if (url.isNullOrEmpty()) {
            call.reject("URL is required")
            return
        }

        // The engine must be initialized before any yt-dlp call.
        val engineErr = ensureEngine()
        if (engineErr != null) {
            call.reject(engineErr)
            return
        }

        // On Android 13+ the notification permission must be granted at
        // runtime for the download progress notification to be visible.
        requestNotificationPermissionIfNeeded()

        val inputData = Data.Builder()
            .putString(DownloadWorker.KEY_URL, url)
            .putString(DownloadWorker.KEY_FORMAT_ID, formatId)
            .putBoolean(DownloadWorker.KEY_IS_PLAYLIST, isPlaylist)
            .putInt(DownloadWorker.KEY_CONCURRENT_FRAGMENTS, fragments)
            .build()

        val workRequest = OneTimeWorkRequest.Builder(DownloadWorker::class.java)
            .setInputData(inputData)
            .addTag(DownloadWorker.TAG)
            // Linear, 10 s: the worker retries a stalled download immediately
            // after it detects the stall. WorkManager's default is EXPONENTIAL
            // from 30 s, so a dropped connection used to cost the user a
            // half-minute of "nothing happening" before the retry even started.
            .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
            .build()

        currentWorkId = workRequest.id

        // ⚠️ ExistingWorkPolicy decision (the crash fix).
        //
        // This used to be REPLACE: every startDownload() call CANCELLED the
        // download that was already running and started a new yt-dlp process
        // in its place. Two yt-dlp processes then raced for the same output
        // template, the same MediaStore rows and the same foreground-service
        // notification — on a mid-range phone that is an ANR and a process
        // death ("engine crashes the app"), not a slow download.
        //
        // APPEND_OR_REPLACE chains the job onto the running one: the engine
        // executes downloads strictly one at a time (WorkManager runs one
        // worker per unique chain), and if the previous job ended in FAILED /
        // CANCELLED state it is replaced instead of blocking the queue
        // forever. This is what makes the JS-side multi-link queue safe even
        // if two calls arrive before the UI updates.
        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                DownloadWorker.UNIQUE_WORK_NAME,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                workRequest
            )

        // Observe progress and emit events to web UI. Must happen on the
        // main thread — startDownload() itself runs on Capacitor's plugin
        // background HandlerThread, and LiveData.observeForever asserts the
        // main thread (IllegalStateException → app crash).
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
        } catch (e: Throwable) {
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
            } catch (e: Throwable) {
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
        } catch (e: Throwable) {
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

    // ── YouTube anti-bot settings ───────────────────────────────────
    // Cookies: the user picks a cookies.txt (Netscape format) via SAF; it is
    // copied into internal storage and passed to yt-dlp with --cookies.
    // Browser-cookies and PO-token-provider modes are desktop-only features
    // (the bundled yt-dlp on Android cannot load OS browser cookies and does
    // not support the bgutil provider plugin), so those setters are no-ops
    // here and the UI hides them on Android.

    @PluginMethod
    fun getYouTubeSettings(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("cookiesBrowser", "")
            put("cookiesFileName", DownloadPrefs.getCookiesFileName(context) ?: "")
            put("poTokenProvider", "")
        })
    }

    @PluginMethod
    fun setCookiesBrowser(call: PluginCall) {
        // Desktop-only — resolve silently on Android.
        call.resolve()
    }

    @PluginMethod
    fun setPoTokenProvider(call: PluginCall) {
        // Desktop-only — resolve silently on Android.
        call.resolve()
    }

    /** Opens the system file picker for a cookies.txt (Netscape format). */
    @PluginMethod
    fun pickCookieFile(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "text/plain"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "cookiePicked")
    }

    /** Receives the picked cookies.txt and copies it into internal storage. */
    @ActivityCallback
    private fun cookiePicked(call: PluginCall, result: ActivityResult) {
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        if (uri == null) {
            call.reject("File selection cancelled")
            return
        }
        try {
            val name = context.contentResolver
                .query(uri, null, null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) {
                        c.getString(c.getColumnIndexOrThrow(
                            android.provider.OpenableColumns.DISPLAY_NAME
                        ))
                    } else null
                } ?: "cookies.txt"

            val dest = File(context.filesDir, COOKIES_FILE)
            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(dest).use { output ->
                    input.copyTo(output)
                }
            } ?: run {
                call.reject("Could not read the selected file")
                return
            }

            DownloadPrefs.saveCookiesFileName(context, name)
            call.resolve(JSObject().put("cookiesFileName", name))
        } catch (e: Throwable) {
            Log.e(TAG, "pickCookieFile failed", e)
            call.reject(e.message ?: "Could not import cookies")
        }
    }

    /** Removes the imported cookies.txt. */
    @PluginMethod
    fun clearCookieFile(call: PluginCall) {
        try {
            File(context.filesDir, COOKIES_FILE).delete()
            DownloadPrefs.clearCookies(context)
            call.resolve()
        } catch (e: Throwable) {
            call.reject("Clear failed: ${e.message}")
        }
    }

    /**
     * The --cookies argument for yt-dlp when the user imported a cookies.txt,
     * otherwise empty (leaves default behavior unchanged).
     */
    private fun cookiesArgs(): List<String> {
        val file = File(context.filesDir, COOKIES_FILE)
        return if (DownloadPrefs.getCookiesFileName(context) != null && file.exists()) {
            listOf("--cookies", file.absolutePath)
        } else {
            emptyList()
        }
    }

    // ── Observe WorkManager Progress ───────────────────────────────

    private fun observeWork(workId: UUID) {
        // observeForever() must be called on the main thread: Capacitor runs
        // startDownload() on a background HandlerThread and LiveData throws
        // "Cannot invoke observeForever on a background thread" there.
        runOnMain {
            attachWorkObserver(workId)
        }
    }

    /** Attaches the progress observer. MUST be called on the main thread. */
    private fun attachWorkObserver(workId: UUID) {
        if (!observedWorkIds.add(workId)) return
        // Observe via a standalone LiveData + observer and REMOVE the observer
        // once the work reaches a terminal state. Without this, every download
        // registers a new observerForever that is never cleaned up — observers
        // accumulate across downloads and leak the plugin/activity references.
        val liveData = WorkManager.getInstance(context).getWorkInfoByIdLiveData(workId)
        // `lateinit var` so the observer can remove itself from the LiveData
        // on terminal states — a plain `val` cannot reference itself inside
        // its own initializer ("Unresolved reference").
        lateinit var observer: androidx.lifecycle.Observer<WorkInfo?>
        observer = androidx.lifecycle.Observer<WorkInfo?> { workInfo ->
            if (workInfo == null) return@Observer

            when (workInfo.state) {
                WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED -> {
                    // ENQUEUED is included on purpose: it is the state the job
                    // sits in while WorkManager waits out the backoff before
                    // restarting a download the watchdog killed. Forwarding the
                    // last known progress keeps the UI (and its own stall
                    // watchdog) alive instead of letting the screen look frozen
                    // during a retry that is already under way.
                    val progress = workInfo.progress
                    val percent = progress.getInt(DownloadWorker.KEY_PROGRESS, 0)
                    val speed = progress.getString(DownloadWorker.KEY_SPEED) ?: "0"
                    val eta = progress.getString(DownloadWorker.KEY_ETA) ?: "--:--"

                    notifyListeners(EVENT_PROGRESS, JSObject().apply {
                        put("percent", percent)
                        put("speed", speed)
                        put("eta", eta)
                        put("item", progress.getInt(DownloadWorker.KEY_ITEM, 0))
                        put("itemCount", progress.getInt(DownloadWorker.KEY_ITEM_COUNT, 0))
                    })
                }
                WorkInfo.State.SUCCEEDED -> {
                    val out = workInfo.outputData
                    notifyListeners(EVENT_COMPLETE, JSObject().apply {
                        put("uri", out.getString(DownloadWorker.KEY_OUTPUT_URI) ?: "")
                        put("fileName", out.getString(DownloadWorker.KEY_OUTPUT_NAME) ?: "")
                        put("isPlaylist", out.getBoolean(DownloadWorker.KEY_IS_PLAYLIST, false))
                        put("fileCount", out.getInt(DownloadWorker.KEY_FILE_COUNT, 0))
                    })
                    liveData.removeObserver(observer)
                    activeObservers.remove(liveData to observer)
                    observedWorkIds.remove(workId)
                }
                WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> {
                    // Surface the actual error message from the worker
                    // (e.g. ffmpeg merge failure, corrupt file, blocked)
                    // instead of a generic "Download failed" string.
                    val workerError = workInfo.outputData
                        .getString(DownloadWorker.KEY_OUTPUT_ERROR)
                    val errorMsg = if (!workerError.isNullOrEmpty()) {
                        workerError
                    } else if (workInfo.state == WorkInfo.State.CANCELLED) {
                        "Download cancelled"
                    } else {
                        "Download failed — check your connection and try again"
                    }
                    notifyListeners(EVENT_ERROR, JSObject().apply {
                        put("error", errorMsg)
                    })
                    liveData.removeObserver(observer)
                    activeObservers.remove(liveData to observer)
                    observedWorkIds.remove(workId)
                }
                else -> { /* ignore */ }
            }
        }
        liveData.observeForever(observer)
        activeObservers.add(liveData to observer)
    }

    // ── On-device download apps (handoff) ──────────────────────────
    // Separate Android apps that take the URL and download it themselves.
    // The link is handed over with ACTION_SEND; this app does no download
    // of its own in that mode.

    /** Known on-device downloaders: UI id → Android package name. */
    private val HANDOFF_PACKAGES = linkedMapOf(
        "seal" to "com.junkfood.seal",
        "ytdlnis" to "com.deniscerri.ytdl",
        "newpipe" to "org.schabi.newpipe",
    )

    /**
     * Which of the known download apps are installed, so the settings
     * screen shows real status instead of guessing. Needs the <queries>
     * package entries in AndroidManifest — without them Android 11+
     * hides every other package from us.
     */
    @PluginMethod
    fun getInstalledEngines(call: PluginCall) {
        val pm = context.packageManager
        val result = JSObject()
        for ((id, pkg) in HANDOFF_PACKAGES) {
            result.put(id, try {
                pm.getPackageInfo(pkg, 0)
                true
            } catch (_: Throwable) {
                false
            })
        }
        call.resolve(result)
    }

    /**
     * Hands a URL to an on-device download app via ACTION_SEND — that app
     * performs the download itself.
     *
     * Rejects (instead of silently doing nothing) when the app is missing
     * or has no activity accepting shared text, so the UI can tell the
     * user exactly what to install.
     */
    @PluginMethod
    fun openInEngine(call: PluginCall) {
        val id = call.getString("engine") ?: ""
        val url = call.getString("url")
        val pkg = HANDOFF_PACKAGES[id]
        if (pkg == null) {
            call.reject("Unknown engine: $id")
            return
        }
        if (url.isNullOrEmpty()) {
            call.reject("URL is required")
            return
        }

        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
            setPackage(pkg)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val resolvable = context.packageManager.queryIntentActivities(
            send, PackageManager.MATCH_DEFAULT_ONLY
        )
        if (resolvable.isEmpty()) {
            call.reject("The $id app is not installed or cannot receive links")
            return
        }
        try {
            (activity ?: context).startActivity(send)
            call.resolve(JSObject().apply {
                put("engine", id)
                put("url", url)
            })
        } catch (e: Throwable) {
            Log.e(TAG, "openInEngine failed for $id", e)
            call.reject("Could not open $id: ${e.message}")
        }
    }

    // ── Helpers ────────────────────────────────────────────────────

    /**
     * Ensures the yt-dlp engine is initialized before an analyze/download.
     *
     * Returns null when the engine is ready. If the startup init (in
     * DownloadApp.onCreate) failed, retries it once — init is idempotent
     * and synchronized inside the library, and a transient first-run
     * failure (e.g. storage pressure during the ~60 MB extraction) is
     * usually resolved by the time the user actually tries to download.
     *
     * @return an actionable error message when the engine still cannot start
     */
    private fun ensureEngine(): String? {
        if (DownloadApp.engineError == null) return null
        // Retry inits BOTH YoutubeDL and FFmpeg (idempotent inside the
        // library). Clears the startup failure when the retry succeeds.
        val err = DownloadApp.initEngine(context)
        if (err == null) DownloadApp.engineError = null
        return err
    }

    /** Requests POST_NOTIFICATIONS on Android 13+ so the progress
     *  notification is visible in the status bar. */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val act = activity ?: return
        // Permission dialogs are Activity/UI work: startDownload() runs on a
        // background thread, and requestPermissions off the main thread is
        // both unsafe and rejected on newer Android versions.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            runOnMain { requestNotificationPermissionIfNeeded() }
            return
        }
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
