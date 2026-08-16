package com.vidfetch.downloader

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.FileProvider
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Handles saving downloaded video files to the device's public Downloads
 * folder using the modern MediaStore API (Android 10+), or to a
 * user-chosen folder via the Storage Access Framework (all versions).
 *
 * Uses java.io streams only (java.nio.file is unavailable below API 26,
 * and minSdk is 24).
 */
object MediaStoreHelper {

    private const val TAG = "MediaStoreHelper"
    private const val VIDFETCH_DIR = "VidFetch"
    private const val MAX_LISTED = 50

    /**
     * Save a file to the default public Downloads/VidFetch folder.
     *
     * @return The content URI of the saved file, or null if saving failed
     */
    fun saveToDownloads(
        context: Context,
        source: File,
        fileName: String,
        mimeType: String
    ): String? {
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
     * Save a file into a user-chosen folder (SAF tree URI). Works on all
     * supported Android versions — no storage permission required.
     *
     * @param treeUri The tree URI returned by the system folder picker
     * @return The content URI of the saved file, or null if saving failed
     */
    fun saveToTree(
        context: Context,
        treeUri: String,
        source: File,
        fileName: String,
        mimeType: String
    ): String? {
        return try {
            val docTree = DocumentFile.fromTreeUri(context, Uri.parse(treeUri))
                ?: return null

            // Replace an existing file with the same name, if present
            docTree.findFile(fileName)?.takeIf { it.exists() }?.delete()

            val docFile = docTree.createFile(mimeType, fileName) ?: return null

            val wrote = context.contentResolver.openOutputStream(docFile.uri)?.use { output ->
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

            if (!wrote) return null

            Log.i(TAG, "Saved to custom folder: $fileName")
            docFile.uri.toString()
        } catch (e: Exception) {
            Log.e(TAG, "saveToTree failed", e)
            null
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
     * List previously saved files (newest first): the default
     * Downloads/VidFetch folder plus the user's custom folder (if set).
     * Used to power the "Recent downloads" list in the app UI.
     *
     * @param customTreeUri Optional SAF tree URI of a user-chosen folder
     */
    fun queryDownloads(context: Context, customTreeUri: String? = null): JSONArray {
        val items = mutableListOf<JSONObject>()
        val seen = mutableSetOf<String>()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val projection = arrayOf(
                    MediaStore.Downloads._ID,
                    MediaStore.Downloads.DISPLAY_NAME,
                    MediaStore.Downloads.MIME_TYPE,
                    MediaStore.Downloads.SIZE,
                    MediaStore.Downloads.DATE_ADDED,
                    MediaStore.Downloads.RELATIVE_PATH
                )
                val selection = "${MediaStore.Downloads.RELATIVE_PATH} LIKE ?"
                val args = arrayOf("%$VIDFETCH_DIR%")

                context.contentResolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    args,
                    "${MediaStore.Downloads.DATE_ADDED} DESC"
                )?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val id = cursor.getLong(
                            cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)
                        )
                        val uri = ContentUris.withAppendedId(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, id
                        )
                        val uriStr = uri.toString()
                        if (seen.add(uriStr)) {
                            items.add(JSONObject().apply {
                                put("uri", uriStr)
                                put("name", cursor.getString(
                                    cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
                                ) ?: "")
                                put("mime", cursor.getString(
                                    cursor.getColumnIndexOrThrow(MediaStore.Downloads.MIME_TYPE)
                                ) ?: "video/*")
                                put("size", cursor.getLong(
                                    cursor.getColumnIndexOrThrow(MediaStore.Downloads.SIZE)
                                ))
                                put("date", cursor.getLong(
                                    cursor.getColumnIndexOrThrow(MediaStore.Downloads.DATE_ADDED)
                                ))
                            })
                        }
                    }
                }
            } else {
                // Android 9 and below — scan the legacy folder directly
                val dir = File(
                    Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS
                    ),
                    VIDFETCH_DIR
                )
                if (dir.exists()) {
                    dir.listFiles()?.forEach { file ->
                        val uri = FileProvider.getUriForFile(
                            context,
                            "${context.packageName}.fileprovider",
                            file
                        )
                        val uriStr = uri.toString()
                        if (seen.add(uriStr)) {
                            items.add(JSONObject().apply {
                                put("uri", uriStr)
                                put("name", file.name)
                                put("mime", mimeTypeFor(file.name))
                                put("size", file.length())
                                put("date", file.lastModified() / 1000)
                            })
                        }
                    }
                }
            }

            // Merge in files from the user's custom folder (if any)
            if (!customTreeUri.isNullOrEmpty()) {
                queryTreeFolder(context, customTreeUri, items, seen)
            }
        } catch (e: Exception) {
            Log.e(TAG, "queryDownloads failed", e)
        }

        items.sortByDescending { it.optLong("date") }

        val result = JSONArray()
        items.take(MAX_LISTED).forEach { result.put(it) }
        return result
    }

    /**
     * Open a downloaded file with the system's default viewer via a
     * content:// URI (MediaStore on 10+, FileProvider or SAF elsewhere).
     */
    fun openFile(context: Context, uriString: String): Boolean {
        return try {
            val uri = Uri.parse(uriString)
            val mime = context.contentResolver.getType(uri)
                ?: mimeTypeFor(uri.lastPathSegment ?: "")
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            Log.i(TAG, "Opened: $uri")
            true
        } catch (e: Exception) {
            Log.e(TAG, "openFile failed", e)
            false
        }
    }

    /**
     * Guess a MIME type from a file name.
     */
    fun mimeTypeFor(name: String): String {
        return when (name.substringAfterLast('.', "").lowercase()) {
            "webm" -> "video/webm"
            "mkv" -> "video/x-matroska"
            "mov" -> "video/quicktime"
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "wav" -> "audio/wav"
            "ogg" -> "audio/ogg"
            "flac" -> "audio/flac"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "gif" -> "image/gif"
            "mp4" -> "video/mp4"
            else -> "video/mp4"
        }
    }

    // ── Internals ───────────────────────────────────────────────────

    /** Adds files from a user-chosen SAF folder to the list. */
    private fun queryTreeFolder(
        context: Context,
        treeUri: String,
        items: MutableList<JSONObject>,
        seen: MutableSet<String>
    ) {
        val docTree = DocumentFile.fromTreeUri(context, Uri.parse(treeUri)) ?: return
        docTree.listFiles()
            ?.filter { it.isFile && it.length() > 0 }
            ?.forEach { file ->
                val uriStr = file.uri.toString()
                if (seen.add(uriStr)) {
                    items.add(JSONObject().apply {
                        put("uri", uriStr)
                        put("name", file.name ?: "")
                        put("mime", context.contentResolver.getType(file.uri)
                            ?: mimeTypeFor(file.name ?: ""))
                        put("size", file.length())
                        put("date", file.lastModified() / 1000)
                    })
                }
            }
    }

    /**
     * Android 10+ — insert into MediaStore.Downloads via ContentResolver.
     * No storage permission needed.
     *
     * @return the content:// URI of the inserted file, or null on failure
     */
    private fun saveViaMediaStore(
        context: Context,
        source: File,
        fileName: String,
        mimeType: String
    ): String? {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH,
                "${Environment.DIRECTORY_DOWNLOADS}/$VIDFETCH_DIR")
            // Hidden until fully written
            put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val itemUri = context.contentResolver.insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
        ) ?: return null

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

        if (!wrote) return null

        // Now visible to the user
        val updateValues = ContentValues().apply {
            put(MediaStore.Downloads.IS_PENDING, 0)
        }
        context.contentResolver.update(itemUri, updateValues, null, null)

        Log.i(TAG, "Saved to Downloads/VidFetch: $fileName")
        return itemUri.toString()
    }

    /**
     * Android 9 and below — direct copy to public Downloads dir,
     * then trigger a media scan so the Gallery picks it up.
     *
     * @return a FileProvider content:// URI for the copied file, or null
     */
    private fun legacySave(
        context: Context,
        source: File,
        fileName: String,
        mimeType: String
    ): String? {
        return try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS
            )
            val vidFetchDir = File(downloadsDir, VIDFETCH_DIR)
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
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                dest
            ).toString()
        } catch (e: Exception) {
            Log.e(TAG, "Legacy save failed", e)
            null
        }
    }
}
