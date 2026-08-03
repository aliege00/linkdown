package com.vidfetch.downloader

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Handles saving downloaded video files to the device's public Downloads
 * folder using the modern MediaStore API (Android 10+).
 *
 * On Android 10+ no storage permissions are needed — we write via
 * ContentResolver. On Android 9 and below we fall back to direct file copy.
 *
 * Uses java.io streams only (java.nio.file is unavailable below API 26,
 * and minSdk is 24).
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveViaMediaStore(context, source, fileName, mimeType)
            } else {
                legacySave(context, source, fileName, mimeType)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Save failed, falling back to legacy copy", e)
            legacySave(context, source, fileName, mimeType)
        }
    }

    /**
     * Register the video with the media store so it shows up in the
     * Gallery app. On Android 10+ the MediaStore.Downloads insert already
     * registers the file, so this only matters for older Android versions.
     */
    fun registerInMediaStore(context: Context, filePath: String, mimeType: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return
        try {
            MediaScannerConnection.scanFile(
                context, arrayOf(filePath), arrayOf(mimeType), null
            )
            Log.i(TAG, "Media scan triggered for: $filePath")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to trigger media scan", e)
        }
    }

    /**
     * Android 10+ — insert into MediaStore.Downloads via ContentResolver.
     * No storage permission needed.
     */
    private fun saveViaMediaStore(
        context: Context,
        source: File,
        fileName: String,
        mimeType: String
    ): Boolean {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH,
                "${Environment.DIRECTORY_DOWNLOADS}/VidFetch")
            // Hidden until fully written
            put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val itemUri = context.contentResolver.insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
        ) ?: return false

        val wrote = context.contentResolver.openOutputStream(itemUri)?.use { output ->
            FileInputStream(source).use { input ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (input.read(buffer).also { bytesRead = it } >= 0) {
                    output.write(buffer, 0, bytesRead)
                }
                output.flush()
            }
            true
        } ?: false

        if (!wrote) return false

        // Now visible to the user
        val updateValues = ContentValues().apply {
            put(MediaStore.Downloads.IS_PENDING, 0)
        }
        context.contentResolver.update(itemUri, updateValues, null, null)

        Log.i(TAG, "Saved to Downloads/VidFetch: $fileName")
        return true
    }

    /**
     * Android 9 and below — direct copy to public Downloads dir,
     * then trigger a media scan so the Gallery picks it up.
     */
    private fun legacySave(
        context: Context,
        source: File,
        fileName: String,
        mimeType: String
    ): Boolean {
        return try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS
            )
            val vidFetchDir = File(downloadsDir, "VidFetch")
            if (!vidFetchDir.exists()) vidFetchDir.mkdirs()

            val dest = File(vidFetchDir, fileName)

            FileInputStream(source).use { input ->
                FileOutputStream(dest).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    while (input.read(buffer).also { bytesRead = it } >= 0) {
                        output.write(buffer, 0, bytesRead)
                    }
                    output.flush()
                }
            }

            MediaScannerConnection.scanFile(
                context, arrayOf(dest.absolutePath), arrayOf(mimeType), null
            )

            Log.i(TAG, "Legacy save to: ${dest.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Legacy save failed", e)
            false
        }
    }
}
