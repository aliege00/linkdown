package com.vidfetch.media

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.File

/**
 * MediaStore Capacitor Plugin
 *
 * Bridges the MediaStoreHelper to JavaScript so the React frontend
 * can save downloaded videos to the public gallery.
 *
 * Register in MainActivity:
 *   import com.vidfetch.media.MediaStorePlugin
 *   // ...
 *   registerPlugin(MediaStorePlugin::class.java)
 */
@CapacitorPlugin(
    name = "MediaStore",
    permissions = [
        Permission(
            alias = "storage",
            strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE]
        )
    ]
)
class MediaStorePlugin : Plugin() {

    private var pendingCall: PluginCall? = null

    /**
     * Save a file to the public Downloads/VidFetch/ folder via MediaStore.
     *
     * JS call:
     *   MediaStore.saveToGallery({
     *     filePath: "/data/.../video.mp4",
     *     displayName: "My Video.mp4",
     *     mimeType: "video/mp4"        // optional, defaults to video/mp4
     *   })
     *
     * Returns:
     *   { success: true, mediaUri: "content://media/...", displayName: "My Video.mp4" }
     */
    @PluginMethod
    fun saveToGallery(call: PluginCall) {
        val filePath = call.getString("filePath")
            ?: return call.reject("filePath is required")

        val displayName = call.getString("displayName")
            ?: File(filePath).name

        val mimeType = call.getString("mimeType") ?: "video/mp4"

        // On Android 10+ we don't need WRITE_EXTERNAL_STORAGE for MediaStore,
        // but we still check for older devices.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasStoragePermission()) {
            pendingCall = call
            requestPermissionForAlias("storage", call, "handleStoragePermission")
            return
        }

        performSave(call, filePath, displayName, mimeType)
    }

    /**
     * Check if the app has WRITE_EXTERNAL_STORAGE permission (Android 9 and below).
     */
    @PluginMethod
    fun checkPermission(call: PluginCall) {
        val result = JSObject()
        result.put("granted", hasStoragePermission() || Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        result.put("apiLevel", Build.VERSION.SDK_INT)
        result.put("needsPermission", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
        call.resolve(result)
    }

    /**
     * Open the saved video with the default gallery / video player.
     */
    @PluginMethod
    fun openInGallery(call: PluginCall) {
        val mediaUri = call.getString("mediaUri")
            ?: return call.reject("mediaUri is required")

        try {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(
                    android.net.Uri.parse(mediaUri),
                    "video/*"
                )
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity?.startActivity(intent)
            call.resolve(JSObject().put("success", true))
        } catch (e: Exception) {
            call.reject("Could not open video in gallery: ${e.message}")
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    @PermissionCallback
    private fun handleStoragePermission(call: PluginCall) {
        if (hasStoragePermission()) {
            val filePath = call.getString("filePath") ?: return call.reject("filePath is required")
            val displayName = call.getString("displayName") ?: File(filePath).name
            val mimeType = call.getString("mimeType") ?: "video/mp4"
            performSave(call, filePath, displayName, mimeType)
        } else {
            call.reject("Storage permission denied. Grant it in Settings → Apps → VidFetch → Permissions.")
        }
    }

    private fun performSave(call: PluginCall, filePath: String, displayName: String, mimeType: String) {
        val sourceFile = File(filePath)
        if (!sourceFile.exists()) {
            return call.reject("File not found: $filePath")
        }

        val result = MediaStoreHelper.saveVideo(
            context = requireContext(),
            sourceFile = sourceFile,
            displayName = displayName,
            mimeType = mimeType
        )

        if (result.success) {
            val jsResult = JSObject()
            jsResult.put("success", true)
            jsResult.put("mediaUri", result.mediaUri)
            jsResult.put("displayName", result.displayName)
            call.resolve(jsResult)
        } else {
            val errorMsg = result.errorTr ?: result.error ?: "Save failed"
            call.reject(errorMsg, result.errorCode ?: "SAVE_FAILED", null)
        }
    }

    private fun hasStoragePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+: no storage permission needed for MediaStore
            true
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10-12: MediaStore write doesn't need permission
            true
        } else {
            // Android 9 and below: need WRITE_EXTERNAL_STORAGE
            context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
        }
    }
}
