/**
 * Download-folder + "the download died when I switched tabs" regression tests.
 *
 * Two shipped reports are covered here.
 *
 * 1. "I switch tabs while a download runs and the download stops."
 *    It never actually stopped — WorkManager kept fetching — but ALL of the
 *    UI for it lived in `DownloaderCard`'s React state, and the dashboard used
 *    to unmount that card on every tab switch. The progress bar, the page
 *    state machine, the stall watchdog and the cancel handle were all
 *    destroyed and rebuilt empty, so the user came back to a blank form while
 *    the file quietly finished in the notification shade. The same hole made
 *    an Android Activity recreation lose the event stream entirely, because
 *    the WorkManager observer was only attached on the `startDownload` call.
 *
 * 2. "Save to `Download`, not `Downloads`" — and ask for file access once.
 *    `Environment.DIRECTORY_DOWNLOADS` is the literal string "Download"
 *    (singular); the UI labelled the destination "Downloads/VidFetch", which
 *    matched no folder on the device.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (...p: string[]) => readFileSync(resolve(__dirname, "../..", ...p), "utf-8");

const bridge = read("android/app/src/main/java/com/vidfetch/downloader/DownloadBridge.kt");
const helper = read("android/app/src/main/java/com/vidfetch/downloader/MediaStoreHelper.kt");
const card = read("src/components/DownloaderCard.tsx");
const dashboard = read("src/pages/Dashboard.tsx");
const native = read("src/lib/ytdlp-native.ts");

// ─── 1. The download must survive a tab switch ──────────────────────────────

describe("download tab is never unmounted", () => {
  it("renders the downloader outside the animated tab switcher", () => {
    // Inside AnimatePresence the keyed motion.div is unmounted on switch,
    // which destroyed every piece of download state.
    const main = dashboard.slice(dashboard.indexOf("<main"), dashboard.indexOf("</main>"));
    const presence = main.indexOf("<AnimatePresence");
    const cardAt = main.indexOf("<DownloaderCard");
    expect(presence, "AnimatePresence block not found").toBeGreaterThan(-1);
    expect(cardAt, "DownloaderCard not found inside <main>").toBeGreaterThan(-1);
    expect(
      cardAt,
      "DownloaderCard must be mounted outside AnimatePresence or a tab switch destroys it",
    ).toBeLessThan(presence);
  });

  it("hides the download tab instead of removing it", () => {
    const main = dashboard.slice(dashboard.indexOf("<main"), dashboard.indexOf("</main>"));
    expect(main).toMatch(/<div hidden=\{tab !== "download"\}>/);
    // …and the animated switcher now only ever holds the other two tabs.
    const presence = main.slice(main.indexOf("<AnimatePresence"));
    expect(presence).toContain('tab !== "download"');
  });
});

describe("a remounted card re-adopts the running download", () => {
  it("asks the device what is running on mount", () => {
    expect(native).toContain("export async function getActiveDownload(");
    expect(native).toContain("export async function watchActiveDownload(");
    expect(card).toContain("const snapshot = await getActiveDownload();");
    expect(card).toContain("if (cancelled || !snapshot?.active) return;");
  });

  it("restores the bar, the page state and the cancel handle", () => {
    expect(card).toContain("workIdRef.current = snapshot.workId || null;");
    expect(card).toContain('updateState("downloading");');
    expect(card).toContain("percent: snapshot.percent,");
    // Without the workId the "Cancel" button would silently do nothing.
    expect(card).toMatch(/getActiveDownload[\s\S]{0,400}workIdRef\.current = snapshot\.workId/);
  });

  it("keeps listening after adopting, so completion still arrives", () => {
    expect(card).toContain("const stop = await watchActiveDownload({");
    expect(card).toContain("if (cancelled) stop();");
    expect(card).toMatch(/return \(\) => \{\s*cancelled = true;\s*detach\?\.\(\);/);
  });

  it("guards the adopted download with the same stall watchdog", () => {
    expect(card).toMatch(/snapshot\?\.active[\s\S]{0,2000}startStallWatchdog\(\)/);
    // One shared helper, so a download this card started and one it adopted
    // can never drift apart.
    expect(card.match(/safetyTimerRef\.current = setInterval/g)).toHaveLength(1);
  });

  it("never calls a hook from inside the re-attach effect", () => {
    // The adopted download is wired through plain closures and refs; a hook
    // called inside the async body would be an invalid hook call.
    const from = card.indexOf('// ── Re-attach to a download this component did not start');
    const effect = card.slice(from, card.indexOf("// Load the list of files already saved"));
    // Start AFTER the opening `useEffect(` so the effect's own declaration is
    // not counted as a nested hook call.
    const open = effect.indexOf("useEffect(() => {");
    const body = effect.slice(open + "useEffect(() => {".length);
    const hookCalls = body.match(/\b(useState|useEffect|useRef|useCallback|useMemo)\s*\(/g) ?? [];
    expect(hookCalls, "hooks must not be called from the re-attach effect").toHaveLength(0);
    expect(body).toContain("startStallWatchdog();");
  });
});

describe("the native side keeps reporting after the Activity is recreated", () => {
  it("re-attaches observers on plugin load, not only on startDownload", () => {
    expect(bridge).toMatch(/override fun load\(\) \{[\s\S]{0,200}reattachRunningWork\(\)/);
    expect(bridge).toContain("private fun reattachRunningWork()");
    expect(bridge).toContain("getWorkInfosForUniqueWork(DownloadWorker.UNIQUE_WORK_NAME)");
  });

  it("forwards progress while a retry is waiting out its backoff", () => {
    // ENQUEUED is the state the job sits in between a watchdog kill and the
    // restart. Ignoring it left the screen frozen for the whole backoff.
    expect(bridge).toContain("WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED ->");
  });

  it("never observes the same work twice", () => {
    // A double observer delivers every progress event twice.
    expect(bridge).toContain("if (!observedWorkIds.add(workId)) return");
    expect(bridge).toContain("observedWorkIds.remove(workId)");
  });

  it("exposes the state a fresh UI needs", () => {
    expect(bridge).toContain("@PluginMethod\n    fun getActiveDownload(call: PluginCall)");
    for (const key of ["active", "state", "workId", "percent", "speed", "eta", "item", "itemCount"]) {
      expect(bridge).toContain(`put("${key}"`);
    }
  });
});

// ─── 2. Download/VidFetch ────────────────────────────────────────────────────

describe("the destination folder is Download/VidFetch", () => {
  it("is derived from DIRECTORY_DOWNLOADS, which is singular", () => {
    expect(helper).toContain('const val VIDFETCH_DIR = "VidFetch"');
    expect(helper).toMatch(/val VIDFETCH_PATH = "\$\{Environment\.DIRECTORY_DOWNLOADS\}\/\$VIDFETCH_DIR"/);
  });

  it("saves through that one constant", () => {
    expect(helper).toContain("put(MediaStore.Downloads.RELATIVE_PATH, VIDFETCH_PATH)");
    // No hand-written second spelling that could drift.
    const relPaths = Array.from(
      helper.matchAll(/RELATIVE_PATH,\s*([^)]*)\)/g),
    ).map((m) => m[1].trim());
    for (const p of relPaths) expect(p).toBe("VIDFETCH_PATH");
  });

  it("labels it Download/VidFetch everywhere in the UI", () => {
    expect(card).not.toContain("Downloads/VidFetch");
    expect(card).toContain("Download/VidFetch");
    expect(dashboard).not.toContain("Downloads/VidFetch");
  });
});

describe("the folder is prepared once, on app entry", () => {
  it("asks the device to prepare it when the card mounts", () => {
    expect(card).toContain("void ensureDownloadFolder().catch(() => {});");
  });

  it("checks for the folder BEFORE asking for any permission", () => {
    // The order is the whole point: an existing folder must never trigger a
    // prompt, which is what made the app ask on every launch.
    const ensure = helper.slice(
      helper.indexOf("fun ensureVidFetchFolder("),
      helper.indexOf("fun ensureVidFetchFolder(") + 1400,
    );
    expect(ensure.indexOf("if (folderExists(context)) return true")).toBeGreaterThan(-1);
    expect(ensure.indexOf("if (folderExists(context)) return true")).toBeLessThan(
      ensure.indexOf("checkSelfPermission"),
    );
  });

  it("requests nothing on Android 10+, where no permission is required", () => {
    expect(helper).toMatch(
      /fun needsStoragePermission\(\): Boolean =\s*Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.Q/,
    );
    // The predicate itself must not look at any permission, or it would ask
    // on every modern device.
    const predicate = helper.slice(
      helper.indexOf("fun needsStoragePermission()"),
      helper.indexOf("fun needsStoragePermission()") + 300,
    );
    expect(predicate).not.toContain("checkSelfPermission");
  });

  it("only prompts when a grant is genuinely required", () => {
    const method = bridge.slice(
      bridge.indexOf("fun ensureDownloadFolder(call: PluginCall)"),
      bridge.indexOf("@PermissionCallback"),
    );
    expect(method).toContain("MediaStoreHelper.needsStoragePermission() &&");
    expect(method).toContain("ContextCompat.checkSelfPermission(");
    // The no-prompt branch resolves instead of requesting.
    expect(method).toContain("resolveFolderState(call, requested = false)");
  });

  it("never shows a folder picker on its own", () => {
    // A SAF picker on every launch would be far worse than the bug it fixes;
    // picking a folder stays an explicit user action.
    const method = bridge.slice(
      bridge.indexOf("fun ensureDownloadFolder(call: PluginCall)"),
      bridge.indexOf("@PermissionCallback"),
    );
    expect(method).not.toContain("ACTION_OPEN_DOCUMENT_TREE");
    expect(method).not.toContain("startActivityForResult");
  });
});

describe("a missing storage grant can no longer look like success", () => {
  it("throws an actionable error instead of returning null", () => {
    // legacySave returned null on SecurityException; the worker read a null
    // URI as "saved" and reported "Download complete" for a file that was
    // never written.
    const legacy = helper.slice(
      helper.indexOf("private fun legacySave("),
      helper.indexOf("// ── Download folder bootstrap"),
    );
    expect(legacy).toContain("if (e is SecurityException) {");
    expect(legacy).toContain("throw IllegalStateException(");
    expect(legacy).toContain("did not grant permission to write to the Download folder");
  });

  it("rejects when WRITE_EXTERNAL_STORAGE is already held", () => {
    expect(helper).toContain("Manifest.permission.WRITE_EXTERNAL_STORAGE");
    expect(helper).toContain("import android.Manifest");
    expect(helper).toContain("import androidx.core.content.ContextCompat");
  });
});