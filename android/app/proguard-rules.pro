# VidFetch ProGuard/R8 rules.
# minifyEnabled=true is on for release; these rules keep the reflection-driven
# download engine (youtubedl-android), the FFmpeg wrapper and the Capacitor
# JS bridge intact.

# ── youtubedl-android (io.github.junkfood02.youtubedl-android) ─────────────
# The library loads its bundled Python runtime and yt-dlp binary via JNI and
# reflection; R8 must not rename or strip these classes.
-keep class com.yausername.youtubedl_android.** { *; }
-keep class com.yausername.ffmpeg.** { *; }
-dontwarn com.yausername.**

# JNI-registered natives in the library
-keepclasseswithmembernames class * {
    native <methods>;
}

# ── Capacitor ──────────────────────────────────────────────────────────────
# Plugins are discovered and invoked reflectively from the JS bridge.
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    public <methods>;
    @com.getcapacitor.PluginMethod *;
}
# Our own bridge classes must keep their @PluginMethod methods.
-keep class com.vidfetch.downloader.** { *; }

# ── WorkManager / Lifecycle ────────────────────────────────────────────────
-keep class androidx.work.** { *; }
-dontwarn androidx.work.**

# ── JS interface (WebView bridge) ─────────────────────────────────────────
-keepclassmembers class fqcn.of.javascript.interface.for.webview {
    public *;
}

# ── General hardening ──────────────────────────────────────────────────────
# Keep annotations used by Capacitor/Jackson-style parsing.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
# Preserve stack-trace readability for crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# org.json is used heavily by Capacitor's JSObject.
-dontwarn org.json.**
