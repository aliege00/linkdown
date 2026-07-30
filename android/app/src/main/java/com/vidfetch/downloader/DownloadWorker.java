package com.vidfetch.downloader;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.CoroutineWorker;
import androidx.work.ForegroundInfo;
import androidx.work.WorkerParameters;
import androidx.work.Data;

import io.woong.ytdl.YoutubeDL;
import io.woong.ytdl.YoutubeDLRequest;
import io.woong.ytdl.YoutubeDLResponse;
import io.woong.ytdl.ProgressData;

import java.io.File;
import kotlin.Unit;
import kotlin.jvm.functions.Function1;

/**
 * WorkManager CoroutineWorker that downloads videos using yt-dlp
 * in a persistent foreground service. Survives app minimization,
 * screen lock, and even process death.
 */
public class DownloadWorker extends CoroutineWorker {

    public static final String KEY_URL = "url";
    public static final String KEY_FORMAT_ID = "formatId";
    public static final String KEY_PROGRESS = "progress";
    public static final String KEY_SPEED = "speed";
    public static final String KEY_ETA = "eta";
    public static final String KEY_FILE_NAME = "fileName";
    public static final String TAG = "vidfetch_download";

    private static final int NOTIFICATION_ID = 1001;

    public DownloadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String url = getInputData().getString(KEY_URL);
        String formatId = getInputData().getString(KEY_FORMAT_ID);

        if (url == null || url.isEmpty()) {
            return Result.failure();
        }
        if (formatId == null || formatId.isEmpty()) {
            formatId = "best";
        }

        try {
            // ── Promote to Foreground Service ──────────────────────
            // This tells Android: "This task is important, don't kill it"
            ForegroundInfo foregroundInfo = createForegroundInfo("Starting download...", 0, false);
            setForeground(foregroundInfo);

            // ── Prepare output path ────────────────────────────────
            File downloadDir = new File(getApplicationContext().getFilesDir(), "downloads");
            if (!downloadDir.exists()) {
                downloadDir.mkdirs();
            }
            String outputTemplate = downloadDir.getAbsolutePath() + "/%(title)s.%(ext)s";

            // ── Build yt-dlp request ───────────────────────────────
            YoutubeDLRequest request = new YoutubeDLRequest(url);
            request.option("-f", formatId);
            request.option("--no-playlist");
            request.option("--no-warnings");
            request.option("--no-cache-dir");
            request.option("--merge-output-format", "mp4");
            request.option("-o", outputTemplate);

            // ── Register progress callback ─────────────────────────
            // This receives real-time download progress from yt-dlp's stderr
            request.progressCallback(new Function1<ProgressData, Unit>() {
                @Override
                public Unit invoke(ProgressData data) {
                    float percent = data.getPercent() != null ? data.getPercent() : 0f;
                    String speed = data.getSpeed() != null ? data.getSpeed() : "0";
                    String eta = data.getEta() != null ? data.getEta() : "--:--";

                    // Update WorkManager progress (observed by UI via LiveData/Flow)
                    Data progressData = new Data.Builder()
                            .putInt(KEY_PROGRESS, Math.round(percent))
                            .putString(KEY_SPEED, speed)
                            .putString(KEY_ETA, eta)
                            .build();
                    setProgress(progressData);

                    // Update the persistent notification
                    updateNotification("Downloading...", Math.round(percent), false);

                    return Unit.INSTANCE;
                }
            });

            // ── Execute download ───────────────────────────────────
            YoutubeDLResponse response = YoutubeDL.getInstance().execute(request);

            // ── Save to public Downloads folder ────────────────────
            String title = response.getTitle() != null ? response.getTitle() : "video";
            String ext = response.getExt() != null ? response.getExt() : "mp4";
            String fileName = sanitizeFileName(title) + "." + ext;

            // Find the downloaded file
            File[] files = downloadDir.listFiles((dir, name) -> name.contains(sanitizeFileName(title)));
            File downloadedFile = null;
            if (files != null && files.length > 0) {
                downloadedFile = files[0];
            }

            if (downloadedFile != null && downloadedFile.exists()) {
                updateNotification("Saving to Downloads...", 100, false);

                // Move to public MediaStore Downloads
                boolean saved = MediaStoreHelper.saveToDownloads(
                        getApplicationContext(),
                        downloadedFile,
                        fileName,
                        "video/mp4"
                );

                if (saved) {
                    // Also register in MediaStore for gallery visibility
                    MediaStoreHelper.registerInMediaStore(
                            getApplicationContext(),
                            downloadedFile.getAbsolutePath(),
                            "video/mp4"
                    );
                }

                // Clean up temp file
                downloadedFile.delete();
            }

            // ── Done ───────────────────────────────────────────────
            updateNotification("Download complete", 100, true);
            return Result.success();

        } catch (Exception e) {
            e.printStackTrace();
            String errorMsg = e.getMessage() != null ? e.getMessage() : "Download failed";
            updateNotification(errorMsg, 0, true);

            // Retry up to 3 times for transient errors
            if (getRunAttemptCount() < 3) {
                return Result.retry();
            }
            return Result.failure();
        }
    }

    // ── Foreground Service Helpers ──────────────────────────────────

    private ForegroundInfo createForegroundInfo(String text, int progress, boolean done) {
        Notification notification = createNotification(text, progress, done);
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        return new ForegroundInfo(NOTIFICATION_ID, notification, type);
    }

    private Notification createNotification(String text, int progress, boolean done) {
        // Tap notification to open the app
        Intent intent = new Intent(getApplicationContext(), MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                getApplicationContext(), 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                getApplicationContext(), DownloadApplication.DOWNLOAD_CHANNEL_ID
        )
                .setContentTitle(done ? "Download complete" : "Downloading video")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setOngoing(!done)
                .setAutoCancel(done)
                .setContentIntent(pendingIntent)
                .setProgress(100, progress, progress == 0);

        if (done) {
            builder.setSmallIcon(android.R.drawable.stat_sys_download_done);
        } else {
            builder.setSmallIcon(android.R.drawable.stat_sys_download);
        }

        return builder.build();
    }

    private void updateNotification(String text, int progress, boolean done) {
        NotificationManager manager = getApplicationContext()
                .getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, createNotification(text, progress, done));
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private String sanitizeFileName(String name) {
        return name.replaceAll("[^a-zA-Z0-9\\-_. ]", "_")
                   .substring(0, Math.min(name.length(), 80));
    }
}
