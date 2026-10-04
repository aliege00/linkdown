/**
 * Release-build guards for the Android R8 configuration.
 *
 * The debug build never shrinks, so a missing keep rule only shows up in the
 * APK the users download — as a launch crash. These assertions pin the rules
 * that were silently missing once already.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repo root: this test lives in src/__tests__ but reads android/ files. */
const repo = (...p: string[]) => resolve(__dirname, "../..", ...p);

describe("Android release build", () => {
  const gradle = readFileSync(repo("android/app/build.gradle"), "utf-8");
  const rules = readFileSync(repo("android/app/proguard-rules.pro"), "utf-8");

  it("shrinks the release build (so the keep rules must actually cover it)", () => {
    expect(gradle).toContain("minifyEnabled true");
    expect(gradle).toContain("proguard-rules.pro");
  });

  it("keeps the Chaquopy Python runtime used by youtubedl-android", () => {
    // Missing this crashed every release APK on launch:
    // "class p3.a is not a concrete class" inside YoutubeDL.initPython.
    expect(rules).toContain("-keep class com.chaquo.python.** { *; }");
    expect(rules).toContain("-dontwarn com.chaquo.python.**");
  });

  it("keeps the download engine and the Capacitor bridge", () => {
    expect(rules).toContain("-keep class com.yausername.youtubedl_android.** { *; }");
    expect(rules).toContain("-keep class com.getcapacitor.** { *; }");
    expect(rules).toContain("-keep class com.vidfetch.downloader.** { *; }");
  });

  it("declares a versionCode Android accepts as an upgrade", () => {
    const code = gradle.match(/versionCode (\d+)/)?.[1];
    expect(Number(code)).toBeGreaterThan(20604);
  });
});