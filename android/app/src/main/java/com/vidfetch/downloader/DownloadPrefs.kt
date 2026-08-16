package com.vidfetch.downloader

import android.content.Context

/**
 * Persists the user's chosen download folder (a SAF tree URI) across
 * app restarts. When no folder is chosen, downloads go to the default
 * Downloads/VidFetch folder.
 */
object DownloadPrefs {

    private const val PREFS = "vidfetch_prefs"
    private const val KEY_SAVE_TO_URI = "save_to_uri"
    private const val KEY_SAVE_TO_NAME = "save_to_name"
    private const val KEY_COOKIES_FILE_NAME = "cookies_file_name"

    fun getSaveToUri(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SAVE_TO_URI, null)

    fun getSaveToName(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SAVE_TO_NAME, null)

    fun saveLocation(context: Context, uri: String, name: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SAVE_TO_URI, uri)
            .putString(KEY_SAVE_TO_NAME, name)
            .apply()
    }

    fun clearLocation(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_SAVE_TO_URI)
            .remove(KEY_SAVE_TO_NAME)
            .apply()
    }

    /**
     * Name of the user-provided cookies.txt file (Netscape format) used to
     * authenticate YouTube requests. The file content lives in
     * context.filesDir/cookies.txt; only the display name is persisted here.
     */
    fun getCookiesFileName(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_COOKIES_FILE_NAME, null)

    fun saveCookiesFileName(context: Context, name: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_COOKIES_FILE_NAME, name)
            .apply()
    }

    fun clearCookies(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_COOKIES_FILE_NAME)
            .apply()
    }
}
