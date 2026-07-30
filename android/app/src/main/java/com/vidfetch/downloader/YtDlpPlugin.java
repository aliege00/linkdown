package com.vidfetch.downloader;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.ExistingWorkPolicy;

import io.woong.ytdl.YoutubeDL;
import io.woong.ytdl.YoutubeDLRequest;
import io.woong.ytdl.YoutubeDLResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

/**
 * Capacitor plugin that bridges yt-dlp video download functionality
 * from native Kotlin to the web-based UI.
 *
 * Exposes methods:
 *   - extractInfo(url)        — Get video metadata & available formats
 *   - startDownload(url, formatId) — Start a foreground-service download
 *   - cancelDownload(workId)  — Cancel an active download
 *   - addListener('downloadProgress', ...) — Listen for progress events
 */
@CapacitorPlugin(name = "YtDlp")
public class YtDlpPlugin extends Plugin {

    private static final String TAG = "YtDlpPlugin";
    private static final String EVENT_PROGRESS = "downloadProgress";
    private static final String EVENT_COMPLETE = "downloadComplete";
    private static final String EVENT_ERROR = "downloadError";

    private UUID currentWorkId = null;

    /**
     * Extract video metadata and available formats from a URL.
     * Returns the same structure as the old /api/info endpoint.
     */
    @PluginMethod
    public void extractInfo(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        new Thread(() -> {
            try {
                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.option("--dump-json");
                request.option("--no-download");
                request.option("--no-playlist");
                request.option("--no-warnings");

                YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);

                // Parse the JSON output
                String jsonOutput = response.getOut();
                if (jsonOutput == null || jsonOutput.isEmpty()) {
                    call.reject("No output from yt-dlp");
                    return;
                }

                // Take the first line (first video if playlist)
                String firstLine = jsonOutput.split("\n")[0];
                JSONObject data = new JSONObject(firstLine);

                // Build clean format list matching the old API structure
                JSONArray formats = new JSONArray();
                JSONArray rawFormats = data.optJSONArray("formats");
                if (rawFormats != null) {
                    for (int i = 0; i < rawFormats.length(); i++) {
                        JSONObject f = rawFormats.getJSONObject(i);
                        String vcodec = f.optString("vcodec", "none");
                        String acodec = f.optString("acodec", "none");

                        // Skip text-only (subtitles, etc.)
                        if ("none".equals(vcodec) && "none".equals(acodec)) continue;

                        JSONObject clean = new JSONObject();
                        clean.put("format_id", f.optString("format_id", ""));
                        clean.put("ext", f.optString("ext", ""));
                        clean.put("resolution", f.optString("resolution", "unknown"));
                        clean.put("filesize", f.opt("filesize"));
                        clean.put("vcodec", "none".equals(vcodec) ? JSONObject.NULL : vcodec);
                        clean.put("acodec", "none".equals(acodec) ? JSONObject.NULL : acodec);
                        clean.put("fps", f.opt("fps"));
                        clean.put("tbr", f.opt("tbr"));

                        formats.put(clean);
                    }
                }

                // Determine best format
                String bestFormatId = "best";
                for (int i = 0; i < formats.length(); i++) {
                    JSONObject f = formats.getJSONObject(i);
                    if (f.has("vcodec") && !f.isNull("vcodec") &&
                        f.has("acodec") && !f.isNull("acodec")) {
                        bestFormatId = f.optString("format_id", "best");
                        break;
                    }
                }

                // Build response matching the existing VidFetch API format
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("id", data.optString("id", ""));
                result.put("title", data.optString("title", "Unknown"));
                result.put("duration", data.opt("duration"));
                result.put("thumbnail", data.optString("thumbnail", ""));
                result.put("uploader", data.optString("uploader",
                        data.optString("channel", "Unknown")));
                result.put("uploader_url", data.optString("uploader_url",
                        data.optString("channel_url", "")));
                result.put("webpage_url", data.optString("webpage_url", url));
                result.put("formats", formats);
                result.put("best_format_id", bestFormatId);
                result.put("ffmpeg_available", true);

                call.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "extractInfo failed", e);
                call.reject(e.getMessage() != null ? e.getMessage() : "Extraction failed");
            }
        }).start();
    }

    /**
     * Start downloading a video in the background using WorkManager.
     * Returns the work ID so the caller can observe progress.
     */
    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String formatId = call.getString("formatId");
        if (formatId == null || formatId.isEmpty()) formatId = "best";

        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        // Build input data for the worker
        Data inputData = new Data.Builder()
                .putString(DownloadWorker.KEY_URL, url)
                .putString(DownloadWorker.KEY_FORMAT_ID, formatId)
                .build();

        // Network constraint — don't start without internet
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        // Create the work request
        OneTimeWorkRequest workRequest = new OneTimeWorkRequest.Builder(DownloadWorker.class)
                .setInputData(inputData)
                .setConstraints(constraints)
                .addTag(DownloadWorker.TAG)
                .build();

        currentWorkId = workRequest.getId();

        // Enqueue the work
        WorkManager.getInstance(getContext())
                .enqueueUniqueWork(
                        "download_" + System.currentTimeMillis(),
                        ExistingWorkPolicy.KEEP,
                        workRequest
                );

        // Observe progress and emit events to the web UI
        observeWork(workRequest.getId());

        // Return the work ID so the JS side can track it
        JSObject result = new JSObject();
        result.put("workId", workRequest.getId().toString());
        call.resolve(result);
    }

    /**
     * Cancel a download by its work ID.
     */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String workIdStr = call.getString("workId");
        if (workIdStr != null) {
            try {
                UUID workId = UUID.fromString(workIdStr);
                WorkManager.getInstance(getContext()).cancelWorkById(workId);
                call.resolve();
            } catch (Exception e) {
                call.reject("Invalid workId: " + workIdStr);
            }
        } else if (currentWorkId != null) {
            WorkManager.getInstance(getContext()).cancelWorkById(currentWorkId);
            call.resolve();
        } else {
            call.reject("No active download to cancel");
        }
    }

    /**
     * Observe WorkManager progress and fire events to the web UI.
     */
    private void observeWork(UUID workId) {
        WorkManager.getInstance(getContext())
                .getWorkInfoByIdLiveData(workId)
                .observeForever(workInfo -> {
                    if (workInfo == null) return;

                    if (workInfo.getState() == WorkInfo.State.RUNNING) {
                        Data progress = workInfo.getProgress();
                        int percent = progress.getInt(DownloadWorker.KEY_PROGRESS, 0);
                        String speed = progress.getString(DownloadWorker.KEY_SPEED);
                        String eta = progress.getString(DownloadWorker.KEY_ETA);

                        JSObject event = new JSObject();
                        event.put("percent", percent);
                        event.put("speed", speed != null ? speed : "0");
                        event.put("eta", eta != null ? eta : "--:--");
                        notifyListeners(EVENT_PROGRESS, event);

                    } else if (workInfo.getState() == WorkInfo.State.SUCCEEDED) {
                        notifyListeners(EVENT_COMPLETE, new JSObject());

                    } else if (workInfo.getState() == WorkInfo.State.FAILED ||
                               workInfo.getState() == WorkInfo.State.CANCELLED) {
                        JSObject event = new JSObject();
                        event.put("error", "Download " + workInfo.getState().name().toLowerCase());
                        notifyListeners(EVENT_ERROR, event);
                    }
                });
    }
}
