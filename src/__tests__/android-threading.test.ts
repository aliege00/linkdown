/**
 * Android main-thread regression guard.
 *
 * The released APK crashed on every download start with:
 *
 *   java.lang.IllegalStateException: Cannot invoke observeForever on a
 *   background thread
 *       at androidx.lifecycle.LiveData.observeForever(LiveData.java:224)
 *       at com.vidfetch.downloader.DownloadBridge.observeWork(...)
 *       at com.vidfetch.downloader.DownloadBridge.startDownload(...)
 *
 * Capacitor dispatches `@PluginMethod` calls on a background HandlerThread,
 * so every Android API that asserts the main thread has to be wrapped.
 * These assertions read the actual Kotlin source so the same mistake fails
 * CI instead of shipping as a crash no unit test would catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bridge = readFileSync(
  resolve(
    __dirname,
    "../../android/app/src/main/java/com/vidfetch/downloader/DownloadBridge.kt",
  ),
  "utf-8",
);

/** Body of a Kotlin function/companion block starting at `header`. */
function blockOf(header: string): string {
  const start = bridge.indexOf(header);
  expect(start, `${header} must exist in DownloadBridge.kt`).toBeGreaterThan(-1);
  // Brace-count from the opening brace so nested lambdas are included and the
  // block ends at its own closing brace (indentation varies by nesting level).
  let depth = 0;
  for (let i = bridge.indexOf("{", start); i < bridge.length; i++) {
    const ch = bridge[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return bridge.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated block for ${header}`);
}

describe("DownloadBridge main-thread safety", () => {
  it("exposes a runOnMain helper that hops to the main looper", () => {
    expect(bridge).toContain("private val mainHandler by lazy { Handler(Looper.getMainLooper()) }");
    const helper = blockOf("private fun runOnMain(");
    expect(helper).toContain("Looper.myLooper() == Looper.getMainLooper()");
    expect(helper).toContain("mainHandler.post(block)");
  });

  it("never calls observeForever outside the main-thread guarded helper", () => {
    // observeWork() may only delegate to attachWorkObserver() through
    // runOnMain { … }; the actual observeForever() therefore lives inside
    // attachWorkObserver(), which is documented as main-thread-only.
    expect(blockOf("private fun observeWork(")).toMatch(/runOnMain\s*{/);
    // The comment may mention observeForever; the actual call may not.
    expect(blockOf("private fun observeWork(")).not.toContain(
      "liveData.observeForever(observer)",
    );

    const attach = blockOf("private fun attachWorkObserver(");
    expect(attach).toContain("liveData.observeForever(observer)");
    // The KDoc above the signature (outside the braces) must state the contract.
    expect(bridge).toContain(
      "/** Attaches the progress observer. MUST be called on the main thread. */",
    );
  });

  it("requests notification permission on the main thread", () => {
    const fn = blockOf("private fun requestNotificationPermissionIfNeeded()");
    expect(fn).toContain("Looper.myLooper() != Looper.getMainLooper()");
    expect(fn).toContain("runOnMain { requestNotificationPermissionIfNeeded() }");
    // The ActivityCompat call must come after the guard, never before it.
    expect(fn.indexOf("runOnMain { requestNotificationPermissionIfNeeded() }")).toBeLessThan(
      fn.indexOf("ActivityCompat.requestPermissions("),
    );
  });

  it("detaches forever-observers on destroy so the plugin cannot leak", () => {
    expect(bridge).toContain("override fun handleOnDestroy()");
    const destroy = blockOf("override fun handleOnDestroy()");
    expect(destroy).toContain("runOnMain {");
    expect(destroy).toContain("liveData.removeObserver(observer)");
    expect(destroy).toContain("activeObservers.clear()");
    expect(destroy).toContain("super.handleOnDestroy()");
  });

  it("unregisters observers when work reaches a terminal state", () => {
    const attach = blockOf("private fun attachWorkObserver(");
    // One removal per terminal branch (SUCCEEDED, FAILED/CANCELLED) and one
    // in handleOnDestroy(); a matching activeObservers.remove keeps the
    // tracking list from growing across downloads.
    expect(attach.split("liveData.removeObserver(observer)").length - 1).toBe(2);
    expect(attach.split("activeObservers.remove(liveData to observer)").length - 1).toBe(2);
  });
});