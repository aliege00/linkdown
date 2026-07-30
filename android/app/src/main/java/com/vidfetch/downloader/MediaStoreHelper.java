package com.vidfetch.downloader;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;

/**
 * Handles saving downloaded video files to the device's public Downloads
 * folder using the modern MediaStore API (Android 10+).
 *
 * No READ/WRITE_EXTERNAL_STORAGE permissions needed on Android 10+.
 */
public class MediaStoreHelper {

    private static final String TAG = "MediaStoreHelper";

    /**
     * Save a file to the public Downloads/VidFetch folder.
     * Works on Android 10+ without storage permissions.
     *
     * @param context  Application context
     * @param source   The temporary downloaded file
     * @param fileName The desired display name (e.g., "My Video.mp4")
     * @param mimeType MIME type (e.g., "video/mp4")
     * @return true if saved successfully
     */
    public static boolean saveToDownloads(Context context, File source,
                                          String fileName, String mimeType) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ uses RELATIVE_PATH — no file path needed
                values.put(MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/VidFetch");
                // Mark as hidden until fully written
                values.put(MediaStore.Downloads.IS_PENDING, 1);
            }

            Uri collectionUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                collectionUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            } else {
                // Android 9 and below — fall back to legacy approach
                collectionUri = MediaStore.Files.getContentUri("external");
            }

            Uri itemUri = context.getContentResolver().insert(collectionUri, values);
            if (itemUri == null) {
                Log.e(TAG, "Failed to insert into MediaStore");
                return legacySave(context, source, fileName);
            }

            // Copy the file contents
            try (FileInputStream input = new FileInputStream(source);
                 OutputStream output = context.getContentResolver().openOutputStream(itemUri)) {

                if (output == null) {
                    Log.e(TAG, "Failed to open output stream");
                    return legacySave(context, source, fileName);
                }

                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, bytesRead);
                }
                output.flush();
            }

            // Mark as no longer pending (visible to user)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                context.getContentResolver().update(itemUri, values, null, null);
            }

            Log.i(TAG, "Saved to Downloads: " + fileName);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "MediaStore save failed", e);
            return legacySave(context, source, fileName);
        }
    }

    /**
     * Register the video in MediaStore.Videos so it appears in gallery apps.
     */
    public static void registerInMediaStore(Context context, String filePath, String mimeType) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Video.Media.DATA, filePath);
            values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Video.Media.IS_PENDING, 0);

            context.getContentResolver().insert(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);

            Log.i(TAG, "Registered in MediaStore: " + filePath);
        } catch (Exception e) {
            Log.w(TAG, "Failed to register in MediaStore", e);
        }
    }

    /**
     * Fallback for Android 9 and below — copy to legacy Downloads path.
     */
    private static boolean legacySave(Context context, File source, String fileName) {
        try {
            File downloadsDir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS);
            File vidFetchDir = new File(downloadsDir, "VidFetch");
            if (!vidFetchDir.exists()) {
                vidFetchDir.mkdirs();
            }

            File dest = new File(vidFetchDir, fileName);
            java.nio.file.Files.copy(source.toPath(), dest.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);

            Log.i(TAG, "Legacy save to: " + dest.getAbsolutePath());
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Legacy save failed", e);
            return false;
        }
    }
}
