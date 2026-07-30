package com.vidfetch.downloader

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Handles saving downloaded video files to the device's public Downloads
 * folder using the modern MediaStore API (Android 10+).
 *
 * On Android 10+ no storage permissions are needed — we write via
 * ContentResolver. On Android 9 and below we fall back to direct file copy.
 *
 * Also registers the video in MediaStore.Videos so it appears in gallery apps.
 */
object MediaStoreHelper {

    private const val TAG = "MediaStoreHelper"

    /**
     * Save a file to the public Downloads/VidFetch folder.
     *
     * @param context  Application context
     * @param source   The temporary downloaded file
     * @param fileName The desired display name (e.g., "My Video.mp4")
     * @param mimeType MIME type (e.g., "video/mp4")
     * @return true if saved successfully
     */
    fun saveToDownloads(
        context: Context,
        source: File,
        fileName: String,
        mimeType: String
    ): Boolean {
        return try {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+ uses RELATIVE_PATH — no raw file path needed
                    put(MediaStore.Downloads.RELATIVE_PATH,
                        "${Environment.DIRECTORY_DOWNLOADS}/VidFetch")
                    // Mark as hidden until fully written
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
            }

            val collectionUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Downloads.EXTERNAL_CONTENT_URI
            } else {
                MediaStore.Files.getContentUri("external")
            }

            val itemUri = context.contentResolver.insert(collectionUri, values)
            if (itemUri == null) {
                Log.e(TAG, "Failed to insert into MediaStore, falling back to legacy")
                return legacySave(context, source, fileName)
            }

            // Copy file contents via ContentResolver stream
            context.contentResolver.openOutputStream(itemUri)?.use { output ->
                FileInputStream(source).use { input ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } >= 0) {
                        output.write(buffer, 0, bytesRead)
                    }
                    output.flush()
                }
            } ?: run {
                Log.e(TAG, "Failed to open output stream, falling back to legacy")
                return legacySave(context, source, fileName)
            }

            // Mark as no longer pending (now visible to the user)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val updateValues = ContentValues().apply {
                    put(MediaStore.Downloads.IS_PENDING, 0)
                }
                context.contentResolver.update(itemUri, updateValues, null, null)
            }

            Log.i(TAG, "Saved to Downloads: $fileName")
            true

        } catch (e: Exception) {
            Log.e(TAG, "MediaStore save failed", e)
            legacySave(context, source, fileName)
        }
    }

    /**
     * Register the video in MediaStore.Videos so it appears in the Gallery app.
     */
    fun registerInMediaStore(context: Context, filePath: String, mimeType: String) {
        try {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DATA, filePath)
                put(MediaStore.Video.Media.MIME_TYPE, mimeType)
                put(MediaStore.Video.Media.IS_PENDING, 0)
            }
            context.contentResolver.insert(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                values
            )
            Log.i(TAG, "Registered in MediaStore: $filePath")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register in MediaStore", e)
        }
    }

    /**
     * Fallback for Android 9 and below — direct file copy to public Downloads dir.
     */
    private fun legacySave(context: Context, source: File, fileName: String): Boolean {
        return try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS
            )
            val vidFetchDir = File(downloadsDir, "VidFetch")
            if (!vidFetchDir.exists()) vidFetchDir.mkdirs()

            val dest = File(vidFetchDir, fileName)
            Files.copy(source.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING)

            Log.i(TAG, "Legacy save to: ${dest.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Legacy save failed", e)
            false
        }
    }
}
