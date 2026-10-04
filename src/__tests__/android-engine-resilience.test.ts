/**
 * Startup-resilience guards for the Android engine.
 *
 * Both rules below were learned from a shipped crash: the release APK died on
 * launch because an `Error` (not an `Exception`) escaped `initEngine()` and
 * propagated out of `Application.onCreate`.
 *
 * They are asserted as source rules because this suite runs in Node — there
 * is no Android runtime here to execute Kotlin against. CI compiles the Kotlin
 * (pr-check builds a debug APK), so a syntax error still fails the build.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (...p: string[]) => readFileSync(resolve(__dirname, "../..", ...p), "utf-8");

const app = read("android/app/src/main/java/com/vidfetch/downloader/DownloadApp.kt");
const bridge = read("android/app/src/main/java/com/vidfetch/downloader/DownloadBridge.kt");
const gradle = read("android/app/build.gradle");

describe("engine startup cannot kill the app", () => {
  it("catches Throwable around engine init, not just Exception", () => {
    // ExceptionInInitializerError is an Error: with `catch (e: Exception)`
    // it escaped Application.onCreate and the process died on launch.
    expect(app).toMatch(/fun initEngine[\s\S]{0,900}catch \(t: Throwable\)/);
    expect(app).not.toMatch(/fun initEngine[\s\S]{0,900}catch \(t: Exception\)/);
  });

  it("describes engine errors for every Throwable, not only Exception", () => {
    expect(app).toContain("fun describeEngineError(filesDirPath: String, t: Throwable)");
  });

  it("initializes the engine off the main thread at startup", () => {
    // ~60 MB of assets unpacked inline can trip the ANR watchdog.
    expect(app).toContain("initEngineAsync(this)");
    expect(app).toMatch(/Thread\(\{[\s\S]{0,200}initEngine\(context\)/);
    expect(app).not.toMatch(/override fun onCreate\(\)[\s\S]{0,600}?engineError = initEngine\(this\)/);
  });

  it("keeps the lazy retry the bridge already had", () => {
    // ensureEngine() re-inits before every analyze/download, so a startup
    // failure that later resolves does not require an app restart.
    expect(bridge).toContain("DownloadApp.initEngine(context)");
  });
});

describe("the JS boundary never lets an Error escape", () => {
  it("uses Throwable at every bridge catch", () => {
    expect(bridge).not.toContain("catch (e: Exception)");
    expect(bridge).toContain("catch (e: Throwable)");
  });
});

describe("release build no longer shrinks", () => {
  it("keeps R8 off so Chaquopy cannot be obfuscated again", () => {
    expect(gradle).toContain("minifyEnabled false");
    expect(gradle).toContain("shrinkResources false");
  });

  it("still ships the keep rules for whoever re-enables minification", () => {
    const rules = read("android/app/proguard-rules.pro");
    expect(rules).toContain("-keep class com.chaquo.python.** { *; }");
  });
});