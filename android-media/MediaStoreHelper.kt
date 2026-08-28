package com.vidfetch.media

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.MediaStore.Video.Media
import java.io.File
import java.io.FileInputStream

/**
 * MediaStoreHelper — Android 11+ (API 30+) Scoped Storage video saver.
 *
 * Saves downloaded video files into the public Downloads/VidFetch/ folder
 * using the MediaStore API, which:
 *   1. Requires NO runtime permissions on Android 11+
 *   2. Makes the video immediately visible in the Gallery / Photos app
 *   3. Works with any download location (app-private, SAF tree, etc.)
 *
 * On Android 10 and below, falls back to direct file writes with
 * WRITE_EXTERNAL_STORAGE permission.
 */
object MediaStoreHelper {

    private const val RELATIVE_PATH = "Download/VidFetch"

    /**
     * Result of a save operation.
     */
    data class SaveResult(
        val success: Boolean,
        val mediaUri: String? = null,
        val displayName: String? = null,
        val error: String? = null
    )

    /**
     * Save a video file to the public Downloads folder via MediaStore.
     *
     * @param context       Android context
     * @param sourceFile    The downloaded video file (app-private or temp)
     * @param displayName   Desired filename (e.g. "My Video.mp4")
     * @param mimeType      MIME type (default: "video/mp4")
     * @param relativePath  Subfolder inside Downloads (default: "VidFetch")
     * @return SaveResult with the MediaStore URI on success
     */
    fun saveVideo(
        context: Context,
        sourceFile: File,
        displayName: String,
        mimeType: String = "video/mp4",
        relativePath: String = RELATIVE_PATH
    ): SaveResult {
        if (!sourceFile.exists()) {
            return SaveResult(success = false, error = "Source file does not exist")
        }

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(context, sourceFile, displayName, mimeType, relativePath)
        } else {
            saveViaLegacy(context, sourceFile, displayName, relativePath)
        }
    }

    // ── Android 11+ (API 30+) — MediaStore API ──────────────────────────────

    private fun saveViaMediaStore(
        context: Context,
        sourceFile: File,
        displayName: String,
        mimeType: String,
        relativePath: String
    ): SaveResult {
        val resolver = context.contentResolver

        // Check for existing file with the same name — append timestamp if duplicate
        val finalName = dedupeDisplayName(resolver, displayName, relativePath, mimeType)

        val contentValues = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, finalName)
            put(MediaStore.Video.Media.MIME_TYPE, mimeType)
            put(MediaStore.Video.Media.RELATIVE_PATH, relativePath)
            // Mark as pending so other apps can't see it until we finish writing
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }

        val collection = Media.EXTERNAL_CONTENT_URI
        val outputUri = resolver.insert(collection, contentValues)
            ?: return SaveResult(success = false, error = "Failed to create MediaStore entry")

        return try {
            resolver.openOutputStream(outputUri)?.use { outputStream ->
                FileInputStream(sourceFile).use { inputStream ->
                    inputStream.copyTo(outputStream)
                }
            } ?: return SaveResult(
                success = false,
                error = "Failed to open output stream for MediaStore"
            )

            // Mark as complete — visible to Gallery / Photos / other apps
            val updateValues = ContentValues().apply {
                put(MediaStore.Video.Media.IS_PENDING, 0)
            }
            resolver.update(outputUri, updateValues, null, null)

            SaveResult(
                success = true,
                mediaUri = outputUri.toString(),
                displayName = finalName
            )
        } catch (e: Exception) {
            // Clean up the failed entry
            resolver.delete(outputUri, null, null)
            SaveResult(success = false, error = "MediaStore save failed: ${e.message}")
        }
    }

    // ── Android 10 and below — direct file write ─────────────────────────────

    private fun saveViaLegacy(
        context: Context,
        sourceFile: File,
        displayName: String,
        relativePath: String
    ): SaveResult {
        return try {
            val downloads = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS
            )
            val targetDir = File(downloads, "VidFetch")
            if (!targetDir.exists()) targetDir.mkdirs()

            val targetFile = File(targetDir, displayName)
            sourceFile.copyTo(targetFile, overwrite = true)

            // Notify the media scanner
            val scannedUri = scanFile(context, targetFile)

            SaveResult(
                success = true,
                mediaUri = scannedUri?.toString(),
                displayName = displayName
            )
        } catch (e: Exception) {
            SaveResult(success = false, error = "Legacy save failed: ${e.message}")
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * If a file with the same name already exists in MediaStore, append a
     * numeric suffix to avoid overwriting.
     */
    private fun dedupeDisplayName(
        resolver: android.content.ContentResolver,
        displayName: String,
        relativePath: String,
        mimeType: String
    ): String {
        val projection = arrayOf(MediaStore.Video.Media.DISPLAY_NAME)
        val selection = "${MediaStore.Video.Media.DISPLAY_NAME} = ? AND ${MediaStore.Video.Media.RELATIVE_PATH} = ?"
        val selectionArgs = arrayOf(displayName, "$relativePath/")

        resolver.query(Media.EXTERNAL_CONTENT_URI, projection, selection, selectionArgs, null)?.use { cursor ->
            if (cursor.count == 0) return displayName
        }

        // File exists — append counter
        val dotIdx = displayName.lastIndexOf('.')
        val name = if (dotIdx > 0) displayName.substring(0, dotIdx) else displayName
        val ext = if (dotIdx > 0) displayName.substring(dotIdx) else ".mp4"

        for (i in 2..999) {
            val candidate = "${name} ($i)$ext"
            val candidateArgs = arrayOf(candidate, "$relativePath/")
            resolver.query(Media.EXTERNAL_CONTENT_URI, projection, selection, candidateArgs, null)?.use { c ->
                if (c.count == 0) return candidate
            }
        }

        return "${name} (${System.currentTimeMillis()})$ext"
    }

    /**
     * Trigger the media scanner on a file so it appears in Gallery immediately
     * (Android 10 and below).
     */
    private fun scanFile(context: Context, file: File): Uri? {
        return try {
            val intent = android.content.Intent(android.content.Intent.ACTION_MEDIA_SCANNER_SCAN_FILE)
            intent.data = Uri.fromFile(file)
            context.sendBroadcast(intent)
            Uri.fromFile(file)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Delete a previously saved video from the public Downloads folder.
     */
    fun deleteVideo(context: Context, mediaStoreUri: String): Boolean {
        return try {
            val uri = Uri.parse(mediaStoreUri)
            context.contentResolver.delete(uri, null, null) > 0
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Check if a given URI is a MediaStore URI (vs. an app-private URI).
     */
    fun isMediaStoreUri(uri: String): Boolean {
        return uri.startsWith("content://media/")
    }
}
