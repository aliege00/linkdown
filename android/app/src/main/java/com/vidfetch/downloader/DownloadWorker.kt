package com.vidfetch.downloader

import android.app.Notification
import android.app.NotificationManager
import android.util.Log
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
import android.media.MediaMetadataRetriever
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Collapses yt-dlp's per-FILE progress into a single number that only ever
 * moves forward.
 *
 * Why this class exists — the shipped bug was "the bar resets to zero in the
 * middle of the download but the download keeps going". Two independent
 * causes, both in the old one-liner
 * `if (percent >= 0f) percent.toInt().coerceIn(0, 100) else 0`:
 *
 *  1. **Split downloads.** Every quality above ~360p resolves to a merged
 *     format, `bestvideo+bestaudio`, so yt-dlp writes the VIDEO file, then
 *     the AUDIO file, then muxes them with ffmpeg. Each file reports its own
 *     0→100 %, so the UI watched the bar sprint to 100 % and snap back to 0 %
 *     when the second file started.
 *  2. **Unknown totals.** yt-dlp reports `percent = -1` whenever it cannot
 *     compute one — during the ffmpeg merge, for "has already been
 *     downloaded", and while resolving formats. The old code mapped -1 to 0,
 *     so the bar was actively yanked back to the start mid-download.
 *
 * Rules enforced here:
 *  1. A negative percentage means "no news", never "0 %".
 *  2. The emitted number never decreases.
 *  3. Each stream file gets an equal slice of the bar, so a two-file
 *     download fills 0→50 then 50→100.
 *  4. The bar stops at 99 until yt-dlp actually returns, so the trailing
 *     ffmpeg merge never looks like the download finished early.
 */
internal class ProgressAggregator(private val planned: Int) {

    private var totalFiles = planned.coerceAtLeast(1)
    private var fileIndex = 0
    private var lastPath: String? = null
    private var emitted = 0

    /** The percentage currently shown for the whole job. */
    val percent: Int get() = emitted

    /**
     * Registers a `[download] Destination:` path. yt-dlp prints one per
     * stream file, so a path we have not seen before means the previous file
     * finished and the next slice of the bar starts.
     */
    fun onFile(path: String) {
        if (path == lastPath) return
        val isFirstFile = lastPath == null
        lastPath = path
        if (isFirstFile) return
        fileIndex += 1
        // More files than we predicted: widen the denominator so the bar can
        // still reach the end instead of stopping short.
        if (fileIndex + 1 > totalFiles) totalFiles = fileIndex + 1
    }

    /**
     * Folds one yt-dlp tick into the job percentage.
     *
     * @param percent yt-dlp's per-file percentage; negative when unknown.
     * @return the new job percentage — never lower than the previous one.
     */
    fun onProgress(percent: Float): Int {
        if (percent < 0f) return emitted
        val within = percent.toDouble().coerceIn(0.0, 100.0) / 100.0
        val slice = ((fileIndex + within) / totalFiles * 100.0).toInt()
        emitted = maxOf(emitted, slice.coerceIn(0, MAX_RUNNING))
        return emitted
    }

    /**
     * Starts a fresh 0→100 bar. Used per playlist entry: the UI offsets the
     * per-item percentage by the item number, so each item must report its
     * own local progress.
     */
    fun reset() {
        fileIndex = 0
        lastPath = null
        totalFiles = planned
        emitted = 0
    }

    /** yt-dlp returned successfully: the job (merge included) is really done. */
    fun complete(): Int {
        emitted = 100
        return emitted
    }

    companion object {
        /** Hold here while running so the merge never reads as "finished". */
        const val MAX_RUNNING = 99

        /**
         * How many files yt-dlp will write for a `-f` value.
         *
         * Only the FIRST alternative matters — yt-dlp tries alternatives left
         * to right and uses the first that resolves. `137+bestaudio` means two
         * files plus a merge; `18`, `best`, or a concrete id means one. The
         * value is only a head start: [onFile] corrects it the moment yt-dlp
         * reveals a file we did not expect.
         */
        fun streamCountFor(formatId: String): Int {
            val first = formatId.substringBefore('/')
            return maxOf(1, first.split('+').size)
        }
    }
}

/**
 * Decides when yt-dlp has gone quiet for so long that the download is dead
 * rather than merely slow, so the worker can restart it instead of leaving the
 * bar frozen forever.
 *
 * The shipped bug was "some videos stay at 0% and never continue". yt-dlp is a
 * separate process driven over pipes: when that process wedges — a socket that
 * opens but never delivers, a fragment range the CDN never answers, a DNS or
 * TLS black hole on a phone that just lost signal — it simply stops printing
 * progress lines. Nothing in the worker noticed, `YoutubeDL.execute` never
 * returned and never threw, so the job sat at whatever percentage it last
 * reached (usually 0 %, because the wedge almost always happens during format
 * resolution or on the first fragment) until the user gave up.
 *
 * Two rules keep this from firing on healthy downloads:
 *
 *  1. **Any output counts as life.** yt-dlp prints plenty of non-progress
 *     lines; every one of them proves the process is awake, so each callback
 *     re-arms the timer. Only total silence trips the watchdog.
 *  2. **Post-processing gets a longer leash.** After the last fragment yt-dlp
 *     merges the streams with ffmpeg, which prints nothing while it works and
 *     can take minutes on a large file. A download that is 100% of the way
 *     through must never be killed for being quiet, so the mute window widens
 *     once a post-processor marker appears.
 */
internal class StallWatchdog(
    private val timeoutMs: Long,
    private val postProcessTimeoutMs: Long
) {

    private var lastActivityAt = 0L
    private var postProcessing = false

    /** Starts (or restarts) the window from [nowMs]. */
    fun arm(nowMs: Long) {
        lastActivityAt = nowMs
        postProcessing = false
    }

    /**
     * Records one yt-dlp output line.
     *
     * @param line the raw line from the process, or null when none is available
     * @param nowMs a monotonic clock reading, in milliseconds
     */
    fun onLine(line: String?, nowMs: Long) {
        lastActivityAt = nowMs
        if (line != null && POST_PROCESS_MARKERS.any { line.contains(it) }) {
            postProcessing = true
        }
    }

    /** Milliseconds since yt-dlp last said anything. */
    fun idleMs(nowMs: Long): Long = nowMs - lastActivityAt

    /** The mute window currently in force. */
    fun limitMs(): Long = if (postProcessing) postProcessTimeoutMs else timeoutMs

    /** True when yt-dlp has been silent for longer than the window allows. */
    fun isStalled(nowMs: Long): Boolean = idleMs(nowMs) > limitMs()

    companion object {
        /** Lines that prove yt-dlp reached the ffmpeg merge / fixup stage. */
        val POST_PROCESS_MARKERS = listOf(
            "[Merger]",
            "[ExtractAudio]",
            "[VideoConvertor]",
            "[Fixup",
            "Merging formats",
        )
    }
}

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
        const val KEY_OUTPUT_ERROR = "outputError"
        const val KEY_FILE_COUNT = "fileCount"
        const val UNIQUE_WORK_NAME = "vidfetch_download"
        const val TAG = "vidfetch_download"
        private const val NOTIFICATION_ID = 1001
        private const val COMPLETE_NOTIFICATION_ID = 1002

        /**
         * How long yt-dlp may print nothing before the worker assumes the
         * process is wedged and restarts it. Comfortably longer than a normal
         * pause between fragments, short enough that a real hang is not a
         * multi-minute wait for the user.
         */
        const val STALL_TIMEOUT_MS = 45_000L

        /**
         * The same window while ffmpeg merges the streams. Merging a large
         * 1080p file is silent and slow, so killing it would destroy a
         * download that is already finished transferring.
         */
        const val POST_PROCESS_STALL_TIMEOUT_MS = 180_000L

        /**
         * Network + parallelism flags shared by the first attempt AND every
         * player-client retry, so a retry can never be slower than the original.
         *
         * Why exactly these, per yt-dlp's own documentation:
         *
         *  - `--concurrent-fragments 8` is the only real throughput lever.
         *    YouTube serves DASH/HLS, which are lists of fragments that yt-dlp
         *    otherwise fetches strictly one at a time; raising the count lets
         *    it keep several in flight at once.
         *  - `--http-chunk-size` is deliberately NOT here. yt-dlp documents it
         *    as an *experimental* throttle bypass for chunk-based HTTP
         *    downloads, and yt-dlp's FAQ notes YouTube throttles chunked
         *    requests. It raises no ceiling (the per-request rate limit is the
         *    real limit) and when a CDN answers the chunk request slowly or
         *    mishandles the Range header, the downloader waits on data that
         *    never arrives — precisely the "stuck at 0%" report. Dropping it is
         *    the stall fix; the fragments flag is what speeds us up.
         *  - The timeout and retry flags turn a dead connection into a resume
         *    instead of an indefinite wait: the socket read timeout aborts the
         *    hung request, `--retry-sleep linear=1::2` restarts it after a short
         *    and growing pause, and the retry counts give a phone that briefly
         *    loses signal enough chances to finish.
         */
        val NETWORK_OPTIONS: List<Pair<String, String?>> = listOf(
            "--concurrent-fragments" to "8",
            "--socket-timeout" to "30",
            "--retries" to "10",
            "--fragment-retries" to "10",
            "--file-access-retries" to "3",
            "--retry-sleep" to "linear=1::2",
        )

        // Matches a speed token from the yt-dlp progress line, e.g. "12.5MiB/s"
        private val SPEED_PATTERN =
            Regex("([0-9]+(?:\\.[0-9]+)?\\s?[KMGTP]?i?B/s)")

        // Matches playlist item counters, e.g. "[youtube] PLxxx: Downloading item 3 of 10"
        private val ITEM_PATTERN = Regex("Downloading item (\\d+) of (\\d+)")

        // Matches the destination path from yt-dlp's progress output:
        //   [download] Destination: /path/to/file.mp4
        //   [download] /path/to/file.mp4 has already been downloaded
        // Used to know exactly which file yt-dlp produced.
        private val OUTPUT_FILENAME_PATTERN =
            Regex("\\[download\\]\\s+Destination:\\s+(.+?)\\s*$")
        private val ALREADY_DOWNLOADED_PATTERN =
            Regex("\\[download\\]\\s+(.+?)\\s+has already been downloaded")

        /**
         * Thrown when yt-dlp stops talking for longer than
         * [STALL_TIMEOUT_MS]. It is not a failure the user caused, so the
         * catch block turns it into a `Result.retry()` — WorkManager restarts
         * the worker, yt-dlp resumes the `.part` file it already has, and the
         * download continues from where it froze instead of dying.
         */
        class DownloadStalledException : Exception(
            "The download stopped making progress and was restarted automatically."
        )

        /**
         * Player-client rotation for YouTube's "Sign in to confirm you're
         * not a bot" wall. Different player clients use different extraction
         * paths and almost always get through WITHOUT any cookies — so the
         * user never has to import cookies.txt. Tried in order after the
         * default request fails with a bot-check error.
         */
        private val BOT_CHECK_ARGS = listOf(
            listOf("--extractor-args", "youtube:player_client=android"),
            listOf("--extractor-args", "youtube:player_client=ios"),
            listOf("--extractor-args", "youtube:player_client=tv_embedded"),
        )

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
            setForeground(createForegroundInfo("Starting download…", 0))

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
            // Every request in this worker (the first attempt and each
            // player-client retry) is built by newRequest(), so a retry can
            // never be missing a flag the original had.
            val request = newRequest(url, formatId, isPlaylist, outputTemplate)

            // ── Step 4: Execute download with real-time progress ──
            // On a bot-check failure, automatically retry with alternate
            // player clients — the user never sees the wall unless every
            // fallback fails. The retry reuses the SAME progress callback
            // captured in `runDownloadWithClients`.
            var currentItem = 0
            var totalItems = 0
            var outputFilePath: String? = null
            // Head start for the slice math: a `-f` value with "+" means the
            // job writes more than one file (video, then audio) and merges
            // them afterwards. See ProgressAggregator for the full rationale.
            val progress = ProgressAggregator(ProgressAggregator.streamCountFor(formatId))
            // Turns "yt-dlp went silent forever" into "restart and resume".
            val stallWatchdog = StallWatchdog(
                STALL_TIMEOUT_MS, POST_PROCESS_STALL_TIMEOUT_MS
            )
            stallWatchdog.arm(SystemClock.elapsedRealtime())

            val progressCb: (Float, Long, String?) -> Unit = { percent, etaSeconds, line ->
                // Any output at all proves the process is alive — re-arm
                // before doing anything else with the line.
                stallWatchdog.onLine(line, SystemClock.elapsedRealtime())
                val speed = SPEED_PATTERN.find(line ?: "")?.groupValues?.getOrNull(1) ?: "0 B/s"
                val eta = formatEta(etaSeconds)

                // Capture the exact output filename yt-dlp reports, and tell
                // the aggregator that a new stream file has started so the
                // bar moves on to the next slice instead of restarting.
                if (line != null) {
                    val dest = OUTPUT_FILENAME_PATTERN.find(line)
                        ?.groupValues?.getOrNull(1)?.trim()
                    val already = ALREADY_DOWNLOADED_PATTERN.find(line)
                        ?.groupValues?.getOrNull(1)?.trim()
                    val path = dest ?: already
                    if (!path.isNullOrEmpty()) {
                        outputFilePath = path
                        progress.onFile(path)
                    }
                }

                // Track the playlist item counter, e.g. "Downloading item 3 of 10"
                val im = ITEM_PATTERN.find(line ?: "")
                if (im != null) {
                    val item = im.groupValues[1].toIntOrNull() ?: 0
                    totalItems = im.groupValues[2].toIntOrNull() ?: 0
                    // Every playlist entry gets its own 0→100 bar; the UI
                    // offsets it with the item number, so item 2 must start
                    // at 0 again rather than inheriting item 1's total.
                    if (item != currentItem) progress.reset()
                    currentItem = item
                }

                val pct = progress.onProgress(percent)

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

                // Update the SAME WorkManager-owned FGS notification by
                // re-calling setForeground() — throttled to once a second.
                // Manual notify() on the FGS id races WorkManager's own
                // cancel of that id (flicker); and rebuilding the
                // notification many times per second makes some OEM
                // launchers re-rank it, which reads as "disappearing and
                // reappearing". 1 Hz keeps the indicator stable.
                val now = SystemClock.elapsedRealtime()
                if (now - lastNotificationUpdate >= 1000 || pct >= 100) {
                    lastNotificationUpdate = now
                    // setForeground() is suspend — hop into the worker's
                    // progress scope (this yt-dlp callback is a plain lambda).
                    progressScope.launch {
                        setForegroundSafely("$pct% · $speed · ETA $eta", pct)
                    }
                }
            }

            // First attempt with the default request (user cookies included
            // when configured). If YouTube's bot-check wall trips, rotate the
            // player client — different clients almost always get through
            // WITHOUT any cookies.
            //
            // The watchdog runs for exactly as long as execute() is inside the
            // call: it is cancelled the moment yt-dlp returns, so the silent
            // ffmpeg merge that happens INSIDE execute() is covered (its lines
            // widen the window) but the post-download save/merge bookkeeping
            // outside it is never watched.
            //
            // It only RECORDS the stall and kills the wedged process — it does
            // not throw. progressScope is a SupervisorJob with no
            // CoroutineExceptionHandler, so an exception escaping this launch
            // would reach the global handler and take the app down; that is
            // exactly the class of bug this worker was hardened against. The
            // throw happens below, on doWork's own coroutine, where the catch
            // block turns it into a clean retry.
            var stalledByWatchdog = false
            val stallJob = progressScope.launch {
                while (true) {
                    delay(5_000)
                    val idle = stallWatchdog.idleMs(SystemClock.elapsedRealtime())
                    if (stallWatchdog.isStalled(SystemClock.elapsedRealtime())) {
                        Log.w(TAG, "yt-dlp silent for ${idle}ms — killing and restarting")
                        stalledByWatchdog = true
                        setForegroundSafely(
                            "Bağlantı takıldı, yeniden deneniyor…", progress.percent
                        )
                        // Kill the wedged process so execute() unblocks instead
                        // of waiting on a pipe that will never produce another
                        // line. The `.part` file survives, so the retry resumes
                        // rather than starting the file over.
                        runCatching { YoutubeDL.destroyProcessById(processId) }
                        break
                    }
                }
            }

            try {
                runDownloadWithClients(
                    request, url, formatId, isPlaylist, outputTemplate, processId, progressCb,
                )
            } finally {
                stallJob.cancel()
            }
            if (stalledByWatchdog) throw DownloadStalledException()

            // yt-dlp returned: the ffmpeg merge is done too, so the job is
            // genuinely complete and the bar can finally read 100 %.
            progressScope.launch {
                setProgress(
                    Data.Builder()
                        .putInt(KEY_PROGRESS, progress.complete())
                        .putString(KEY_SPEED, "0 B/s")
                        .putString(KEY_ETA, "00:00")
                        .build(),
                )
            }

            // ── Step 5: Find the downloaded output ────────────────
            // Use the exact filename captured from yt-dlp output (Step 4).
            // Fallback: newest file/dir for playlists or if parsing failed.
            val downloaded = if (isPlaylist) {
                downloadDir.listFiles()
                    ?.filter { it.isDirectory() }
                    ?.maxByOrNull { it.lastModified() }
            } else {
                // 1) Prefer the exact file yt-dlp reported writing to
                val fromParse = outputFilePath?.let { path ->
                    val f = File(path)
                    if (f.exists() && f.isFile && f.length() > 0) f else null
                }
                fromParse ?: run {
                    // 2) Fallback: scan for video files, preferring the final
                    //    merged output over intermediate DASH parts.
                    //    yt-dlp temp parts use the pattern "title.fNNN.ext"
                    //    while the merged result is "title.ext".
                    val videoExts = setOf("mp4", "webm", "mkv", "m4v", "mov")
                    downloadDir.listFiles()
                        ?.filter { f ->
                            f.isFile && f.length() > 1024 &&
                            f.extension.lowercase() in videoExts &&
                            // Skip DASH temp parts (title.f137.webm etc.)
                            !Regex("\\.f\\d+\\.").containsMatchIn(f.name)
                        }
                        ?.maxByOrNull { it.lastModified() }
                        ?: run {
                            // 3) Last resort: any file >1KB
                            downloadDir.listFiles()
                                ?.filter { it.isFile && it.length() > 1024 }
                                ?.maxByOrNull { it.lastModified() }
                        }
                }
            }

            // ── Step 5.5: Validate the downloaded file ─────────────
            // yt-dlp may produce a valid exit code but leave behind a
            // corrupt, 0-byte, or audio/video-only file (especially when
            // ffmpeg fails to merge separate streams).  Detect this early
            // so the user gets an actionable error instead of a .mp4 that
            // won't open.
            if (!isPlaylist && downloaded != null && downloaded.isFile) {
                validateDownloadedFile(downloaded)
            }

            // ── Step 6: Save to public Downloads folder ────────────
            var savedUri: String? = null
            var savedName: String? = null
            var savedCount = 0
            val customTreeUri = DownloadPrefs.getSaveToUri(applicationContext)

            if (isPlaylist && downloaded != null && downloaded.isDirectory) {
                // Save every file of the playlist, one by one.
                setForegroundSafely("Saving ${downloaded.name}…", 100)
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
                setForegroundSafely("Saving to ${MediaStoreHelper.VIDFETCH_PATH}…", 100)
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
            // Do NOT post anything on NOTIFICATION_ID (the FGS id) manually.
            // WorkManager owns that id: it posts it at setForeground() and
            // CANCELS it when the foreground service stops. Any manual
            // notify(NOTIFICATION_ID, …) races that cancel — the notification
            // visibly blinks (gone → back) in the shade. All in-flight updates
            // below go through setForegroundSafely(), which re-calls
            // setForeground() so WorkManager keeps updating the SAME
            // WorkManager-owned notification. The only separate, persistent
            // completion notification is on COMPLETE_NOTIFICATION_ID below.
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
            // Build an actionable error message that survives the
            // WorkManager → observer → frontend pipeline.
            val errorMsg = if (e is DownloadStalledException) {
                // The engine kept going silent on this network. Say so plainly
                // instead of the generic failure string — the user needs to
                // know it is their connection, not a broken video.
                "The connection kept dropping and the download could not continue. " +
                    "It was restarted automatically several times — try again on a steadier network."
            } else {
                e.message ?: "Download failed"
            }

            // NOTE: no manual notification here — posting on the FGS id races
            // WorkManager's cancellation when the service stops (flicker),
            // and on retry the worker re-promotes itself with a fresh
            // setForeground() anyway. The UI receives the real error via
            // outputData (DownloadBridge forwards it).

            // Pass the real error message to the UI via outputData so
            // DownloadBridge can forward it instead of a generic string.
            val errorData = Data.Builder()
                .putString(KEY_OUTPUT_ERROR, errorMsg)
                .build()

            // Retry up to 3 times for transient errors
            if (runAttemptCount < 3) Result.retry() else Result.failure(errorData)
        } finally {
            activeProcessId = null
            progressScope.cancel()
        }
    }

    // ── Download with automatic bot-check fallback ─────────────────

    /**
     * Builds one yt-dlp request with the full shared option set.
     *
     * Every request in this worker goes through here. The previous code wrote
     * the options out twice and the two copies had already drifted: the retry
     * request silently dropped the user's imported cookies.txt and the network
     * flags. A retry built from the same builder can not drift again.
     *
     * NOTE: `--merge-output-format` is intentionally omitted. Forcing MP4 when
     * the source uses VP9/AV1 produces a container Android's MediaCodec cannot
     * decode. yt-dlp picks the best native container automatically (mp4 for
     * H.264, webm for VP9/AV1) and the MIME type is resolved from the real
     * extension in MediaStoreHelper.mimeTypeFor().
     *
     * @param extraArgs additional single-value flags, e.g. a player-client override
     */
    private fun newRequest(
        url: String,
        formatId: String,
        isPlaylist: Boolean,
        outputTemplate: String,
        extraArgs: List<String> = emptyList(),
    ): YoutubeDLRequest = YoutubeDLRequest(url).apply {
        addOption("-f", formatId)
        if (!isPlaylist) addOption("--no-playlist")
        addOption("--no-warnings")
        addOption("--no-cache-dir")
        for ((flag, value) in NETWORK_OPTIONS) {
            if (value == null) addOption(flag) else addOption(flag, value)
        }
        addOption("-o", outputTemplate)
        // Authenticated YouTube requests (cookies.txt imported by the user in
        // the advanced settings) bypass the bot check.
        val cookieFile = File(applicationContext.filesDir, "cookies.txt")
        if (DownloadPrefs.getCookiesFileName(applicationContext) != null && cookieFile.exists()) {
            addOption("--cookies", cookieFile.absolutePath)
        }
        // --extractor-args arrives as flag/value pairs, flattened.
        extraArgs.forEach { addOption(it) }
    }

    /**
     * Runs the download; if yt-dlp throws a bot-check error, transparently
     * retries with alternate player clients. Callbacks mirror the ones used
     * by the first attempt so progress keeps flowing from whichever client
     * succeeds.
     */
    private suspend fun runDownloadWithClients(
        request: YoutubeDLRequest,
        url: String,
        formatId: String,
        isPlaylist: Boolean,
        outputTemplate: String,
        processId: String,
        progressCb: (Float, Long, String?) -> Unit,
    ) {
        try {
            YoutubeDL.execute(request, processId, true, progressCb)
            return
        } catch (e: Throwable) {
            val msg = (e.message ?: "").lowercase()
            if (!(msg.contains("not a bot") || msg.contains("sign in to confirm"))) throw e
            Log.w("DownloadWorker", "bot check on download — rotating player clients")
            setForegroundSafely("YouTube bot check — alternate client deneniyor…", 0)
        }

        var last: Throwable? = null
        for (retry in BOT_CHECK_ARGS) {
            try {
                // Same builder as the first attempt, so a retry keeps the speed
                // flags AND the user's cookies.
                val retryReq = newRequest(url, formatId, isPlaylist, outputTemplate, retry)
                YoutubeDL.execute(retryReq, processId, true, progressCb)
                return
            } catch (e: Throwable) {
                // Throwable, not Exception: the engine raises Error subclasses
                // (ExceptionInInitializerError) and a worker in the app
                // process that lets one escape takes the whole app down.
                last = e
            }
        }
        throw last ?: IllegalStateException("All download attempts failed")
    }

    // ── Foreground Service Helpers ──────────────────────────────────

    /**
     * Re-promotes (or updates) the WorkManager-owned foreground notification.
     * Calling setForeground() repeatedly with the same ForegroundInfo id is
     * the SUPPORTED way to update a WorkManager FGS notification — the system
     * service updates the existing notification in place, no cancel/post
     * cycle, no flicker. Wrapped in runCatching so a rejected promotion
     * (Android 14+ FGS restrictions while backgrounded) can never crash the
     * worker; the download itself keeps running normally.
     */
    private suspend fun setForegroundSafely(text: String, progress: Int) {
        runCatching {
            setForeground(createForegroundInfo(text, progress))
        }
    }

    private fun createForegroundInfo(text: String, progress: Int): ForegroundInfo {
        return ForegroundInfo(
            NOTIFICATION_ID,
            createNotification(text, progress, done = false),
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
                // Alert (sound/vibration/shade jump) only on the FIRST post.
                // Without this, every rebuild can re-alert on OEM skins and
                // the notification appears to jump/blip in the shade.
                .setOnlyAlertOnce(true)
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
                fileName ?: "Saved to ${MediaStoreHelper.VIDFETCH_PATH}",
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

    // ── Post-download file validation ──────────────────────────

    /**
     * Validates a single downloaded file before saving it to public storage.
     * Throws an actionable exception when the file is:
     *   - 0 bytes (download silently failed)
     *   - Too small to be a valid video (< 1 KB)
     *   - Missing MP4/ISOBMFF ftyp box (corrupt or wrong container)
     *   - An audio-only or video-only stream (ffmpeg merge failed)
     *
     * This prevents the user from ending up with a .mp4 file that
     * Android's video player cannot open.
     */
    private fun validateDownloadedFile(file: File) {
        val size = file.length()

        if (size == 0L) {
            throw IllegalStateException(
                "The downloaded file is empty (0 bytes). " +
                "This usually means the download was blocked or the network dropped."
            )
        }

        // Extremely small files are never valid videos.
        if (size < 1024) {
            throw IllegalStateException(
                "The downloaded file is suspiciously small ($size bytes). " +
                "The download may have been interrupted or the content is not a video."
            )
        }

        // Check for a valid container header (MP4 ftyp, MKV/WebM EBML).
        val ext = file.extension.lowercase()
        if (ext in listOf("mp4", "m4v", "mov", "mkv", "webm")) {
            val header = ByteArray(12)
            try {
                file.inputStream().use { it.read(header) }
            } catch (_: Exception) {
                throw IllegalStateException(
                    "Cannot read the downloaded file — it may be corrupt. " +
                    "Try a different quality or restart the download."
                )
            }

            val isFtyp = header.size >= 8 &&
                header[4] == 'f'.code.toByte() &&
                header[5] == 't'.code.toByte() &&
                header[6] == 'y'.code.toByte() &&
                header[7] == 'p'.code.toByte()

            val isMkv = header.size >= 4 &&
                header[0] == 0x1A.toByte() &&
                header[1] == 0x45.toByte() &&
                header[2] == 0xDF.toByte() &&
                header[3] == 0xA3.toByte()

            if (!isFtyp && !isMkv) {
                val looksLikeText = String(header.sliceArray(0 until minOf(32, header.size)), Charsets.UTF_8)
                val isErrorPage = looksLikeText.contains("<html") || looksLikeText.contains("<!DOCTYPE") || looksLikeText.startsWith("{")
                if (isErrorPage) {
                    throw IllegalStateException(
                        "The downloaded file is not a video — it looks like a web page or error response. " +
                        "The site may have blocked the download."
                    )
                }
                throw IllegalStateException(
                    "The file does not contain a valid video format. " +
                    "This usually happens when ffmpeg fails to merge video and audio streams. " +
                    "Try a lower quality (e.g. 720p) or update the app."
                )
            }
        }

        // ── Playability probe ──────────────────────────────────────
        // Even with correct magic bytes, the file can be unplayable:
        //   - audio-only (ffmpeg merged audio but not video)
        //   - corrupt moov atom (download interrupted during merge)
        //   - wrong codec not supported by Android's MediaCodec
        // MediaMetadataRetriever is the fastest way to verify: if it
        // cannot extract a video track, the file won't play.
        try {
            val retriever = MediaMetadataRetriever()
            retriever.setDataSource(file.absolutePath)
            val hasVideo = retriever.extractMetadata(
                MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO
            )
            val hasAudio = retriever.extractMetadata(
                MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO
            )
            val durationMs = retriever.extractMetadata(
                MediaMetadataRetriever.METADATA_KEY_DURATION
            )?.toLongOrNull() ?: 0L
            retriever.release()

            if (hasVideo != "yes") {
                throw IllegalStateException(
                    "The downloaded file has no video track — it may be audio-only. " +
                    "Try selecting a format that includes video (e.g. 'best')."
                )
            }
            if (hasAudio != "yes") {
                throw IllegalStateException(
                    "The downloaded file has no audio track — the video is muted. " +
                    "Try a format that includes both audio and video (e.g. 'best')."
                )
            }
            if (durationMs <= 0) {
                throw IllegalStateException(
                    "The video file appears to have zero duration. " +
                    "The file may be corrupt — try a different quality."
                )
            }
        } catch (e: IllegalStateException) {
            throw e  // re-throw our own validation errors
        } catch (_: Exception) {
            // MediaMetadataRetriever failed to parse — file is likely corrupt
            throw IllegalStateException(
                "Cannot read the video file — it may be corrupt or in an unsupported format. " +
                "Try a different quality or update the app."
            )
        }
    }
}
