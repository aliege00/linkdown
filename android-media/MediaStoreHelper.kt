package com.vidfetch.media

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.provider.MediaStore.Video.Media
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.IOException

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
 *
 * Edge-case handling:
 *   - Disk-full detection before writing (prevents crash + partial files)
 *   - File existence + readability validation
 *   - Pending-entry cleanup on any failure (no orphan MediaStore rows)
 *   - Bilingual error messages (Turkish + English) for user-facing results
 */
object MediaStoreHelper {

    private const val RELATIVE_PATH = "Download/VidFetch"
    /** Minimum free space to attempt a save (2 MB safety margin). */
    private const val MIN_FREE_SPACE_BYTES = 2 * 1024 * 1024L

    /**
     * Result of a save operation.
     */
    data class SaveResult(
        val success: Boolean,
        val mediaUri: String? = null,
        val displayName: String? = null,
        val error: String? = null,
        /** Human-readable error in Turkish. */
        val errorTr: String? = null,
        /** Error code for programmatic handling. */
        val errorCode: String? = null
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
        // ── Pre-flight: file exists + readable ──
        if (!sourceFile.exists()) {
            return SaveResult(
                success = false,
                error = "Source file does not exist: ${sourceFile.absolutePath}",
                errorTr = "Kaynak dosya bulunamadı: ${sourceFile.name}",
                errorCode = "FILE_NOT_FOUND"
            )
        }
        if (!sourceFile.canRead()) {
            return SaveResult(
                success = false,
                error = "Source file is not readable: ${sourceFile.absolutePath}",
                errorTr = "Kaynak dosya okunamıyor: ${sourceFile.name}",
                errorCode = "FILE_NOT_READABLE"
            )
        }
        if (sourceFile.length() == 0L) {
            return SaveResult(
                success = false,
                error = "Source file is empty (0 bytes)",
                errorTr = "Kaynak dosya boş (0 byte) — indirme başarısız olmuş olabilir",
                errorCode = "FILE_EMPTY"
            )
        }

        // ── Pre-flight: disk space ──
        val diskCheck = checkDiskSpace(sourceFile.length())
        if (diskCheck != null) return diskCheck

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
        var outputUri: Uri? = null

        try {
            // Check for existing file with the same name — append timestamp if duplicate
            val finalName = dedupeDisplayName(resolver, displayName, relativePath)

            val contentValues = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, finalName)
                put(MediaStore.Video.Media.MIME_TYPE, mimeType)
                put(MediaStore.Video.Media.RELATIVE_PATH, relativePath)
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }

            val collection = Media.EXTERNAL_CONTENT_URI
            outputUri = resolver.insert(collection, contentValues)
                ?: return SaveResult(
                    success = false,
                    error = "Failed to create MediaStore entry",
                    errorTr = "Medya deposuna kayıt oluşturulamadı",
                    errorCode = "MEDIASTORE_INSERT_FAILED"
                )

            // Stream-copy the file into the MediaStore entry
            resolver.openOutputStream(outputUri)?.use { outputStream ->
                FileInputStream(sourceFile).use { inputStream ->
                    try {
                        inputStream.copyTo(outputStream)
                    } catch (e: IOException) {
                        // Likely disk full during write
                        val msg = e.message?.lowercase() ?: ""
                        val errorCode = if (msg.contains("no space") || msg.contains("disk full") || msg.contains("failed to allocate")) {
                            "DISK_FULL"
                        } else {
                            "WRITE_FAILED"
                        }
                        return SaveResult(
                            success = false,
                            error = "Write failed during copy: ${e.message}",
                            errorTr = if (errorCode == "DISK_FULL")
                                "Depolama alanı dolu — yeterli disk alanı yok"
                            else
                                "Dosya yazma hatası: ${e.message}",
                            errorCode = errorCode
                        )
                    }
                }
            } ?: run {
                cleanupPendingEntry(resolver, outputUri)
                return SaveResult(
                    success = false,
                    error = "Failed to open output stream for MediaStore",
                    errorTr = "Medya deposu için çıkış akışı açılamadı",
                    errorCode = "OUTPUT_STREAM_FAILED"
                )
            }

            // Mark as complete — visible to Gallery / Photos / other apps
            val updateValues = ContentValues().apply {
                put(MediaStore.Video.Media.IS_PENDING, 0)
            }
            resolver.update(outputUri, updateValues, null, null)

            return SaveResult(
                success = true,
                mediaUri = outputUri.toString(),
                displayName = finalName
            )
        } catch (e: FileNotFoundException) {
            cleanupPendingEntry(resolver, outputUri)
            return SaveResult(
                success = false,
                error = "File not found during save: ${e.message}",
                errorTr = "Kaydetme sırasında dosya bulunamadı: ${e.message}",
                errorCode = "FILE_NOT_FOUND"
            )
        } catch (e: SecurityException) {
            cleanupPendingEntry(resolver, outputUri)
            return SaveResult(
                success = false,
                error = "Permission denied: ${e.message}",
                errorTr = "İzin reddedildi — Ayarlar → Uygulamalar → VidFetch → İzinler bölümünden izin verin",
                errorCode = "PERMISSION_DENIED"
            )
        } catch (e: Exception) {
            cleanupPendingEntry(resolver, outputUri)
            return SaveResult(
                success = false,
                error = "MediaStore save failed: ${e.message}",
                errorTr = "Medya deposuna kaydetme başarısız: ${e.message}",
                errorCode = "UNKNOWN_ERROR"
            )
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
            if (!targetDir.exists()) {
                if (!targetDir.mkdirs()) {
                    return SaveResult(
                        success = false,
                        error = "Failed to create target directory",
                        errorTr = "Hedef klasör oluşturulamadı — izin gerekebilir",
                        errorCode = "MKDIR_FAILED"
                    )
                }
            }

            // Disk space check for legacy path
            val diskCheck = checkDiskSpace(sourceFile.length(), targetDir)
            if (diskCheck != null) return diskCheck

            val targetFile = File(targetDir, displayName)
            sourceFile.copyTo(targetFile, overwrite = true)

            // Notify the media scanner
            val scannedUri = scanFile(context, targetFile)

            SaveResult(
                success = true,
                mediaUri = scannedUri?.toString(),
                displayName = displayName
            )
        } catch (e: IOException) {
            val msg = e.message?.lowercase() ?: ""
            if (msg.contains("no space") || msg.contains("disk full")) {
                SaveResult(
                    success = false,
                    error = "Disk full: ${e.message}",
                    errorTr = "Depolama alanı dolu — lütfen yeterli alan açın",
                    errorCode = "DISK_FULL"
                )
            } else {
                SaveResult(
                    success = false,
                    error = "Legacy save failed: ${e.message}",
                    errorTr = "Eski yöntemle kaydetme başarısız: ${e.message}",
                    errorCode = "WRITE_FAILED"
                )
            }
        } catch (e: Exception) {
            SaveResult(
                success = false,
                error = "Legacy save failed: ${e.message}",
                errorTr = "Kaydetme başarısız: ${e.message}",
                errorCode = "UNKNOWN_ERROR"
            )
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Check if there's enough disk space for the file being saved.
     * Returns a SaveResult with error if space is insufficient, null if OK.
     */
    private fun checkDiskSpace(
        requiredBytes: Long,
        dir: File = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    ): SaveResult? {
        return try {
            val stat = StatFs(dir.absolutePath)
            val availableBytes = stat.availableBlocksLong * stat.blockSizeLong
            if (availableBytes < requiredBytes + MIN_FREE_SPACE_BYTES) {
                val freeMB = availableBytes / (1024 * 1024)
                val needMB = requiredBytes / (1024 * 1024)
                SaveResult(
                    success = false,
                    error = "Insufficient disk space: need ~${needMB}MB, only ${freeMB}MB available",
                    errorTr = "Depolama alanı yetersiz: ~${needMB}MB gerekli, yalnızca ${freeMB}MB mevcut",
                    errorCode = "DISK_FULL"
                )
            } else null
        } catch (e: Exception) {
            // If we can't check disk space, proceed optimistically
            null
        }
    }

    /**
     * If a file with the same name already exists in MediaStore, append a
     * numeric suffix to avoid overwriting.
     */
    private fun dedupeDisplayName(
        resolver: android.content.ContentResolver,
        displayName: String,
        relativePath: String
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
     * Clean up a pending MediaStore entry that was never completed.
     */
    private fun cleanupPendingEntry(
        resolver: android.content.ContentResolver,
        uri: Uri?
    ) {
        if (uri == null) return
        try {
            resolver.delete(uri, null, null)
        } catch (_: Exception) {
            // Best-effort cleanup — don't crash if delete fails
        }
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
        } catch (_: Exception) {
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
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Check if a given URI is a MediaStore URI (vs. an app-private URI).
     */
    fun isMediaStoreUri(uri: String): Boolean {
        return uri.startsWith("content://media/")
    }

    /**
     * Get the free disk space in bytes. Useful for pre-download checks.
     */
    fun getFreeDiskSpace(dir: File = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)): Long {
        return try {
            val stat = StatFs(dir.absolutePath)
            stat.availableBlocksLong * stat.blockSizeLong
        } catch (_: Exception) {
            -1L
        }
    }
}
