#!/usr/bin/env node
// One-command release-signing setup.
//
// The CI job fails fast with "Signing secrets missing" until the four
// SIGNING_* secrets exist. Doing that by hand is five steps and one base64
// blob that is easy to mangle — this script does all of it in one pass:
//
//   1. generates the keystore with keytool (JDK 17+ required)
//   2. base64-encodes it (the exact format CI decodes)
//   3. uploads SIGNING_KEY / SIGNING_STORE_PASSWORD / SIGNING_KEY_ALIAS /
//      SIGNING_KEY_PASSWORD with `gh secret set`
//   4. verifies the secrets are actually there (names only, never values)
//
// It NEVER prints a password or the keystore, and it never writes the
// keystore into the repository (it goes to ~/.vidfetch/ or --out, and
// android/app/release.keystore is gitignored).
//
// Usage:
//   node scripts/setup-signing.mjs                 # interactive passwords
//   node scripts/setup-signing.mjs --dry-run       # check everything, change nothing
//   node scripts/setup-signing.mjs --alias mykey --validity 10000
//   node scripts/setup-signing.mjs --repo owner/name
//
// Requires: keytool (JDK) + the GitHub CLI authenticated as a repo admin.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

// ── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const DRY_RUN = has("dry-run");
const ALIAS = flag("alias", "vidfetch");
const VALIDITY = flag("validity", "10000");
const REPO = flag("repo", "aliege00/linkdown");
const OUT = flag("out", join(homedir(), ".vidfetch", `release-${ALIAS}.keystore`));
const STORE_PASS = flag("password", process.env.SIGNING_STORE_PASSWORD || null);
const KEYSTORE = flag("keystore", OUT);

const t = (s) => `\x1b[36m${s}\x1b[0m`;
const ok = (s) => console.log(`✅ ${s}`);
const info = (s) => console.log(`   ${s}`);
const die = (s) => {
  console.error(`❌ ${s}`);
  process.exit(1);
};

// ── preflight ─────────────────────────────────────────────────────────
function hasTool(cmd, args = ["-help"]) {
  const r = spawnSync(cmd, args, { stdio: "ignore" });
  return !r.error;
}

console.log(`\nVidFetch release-signing setup${DRY_RUN ? " (dry run — nothing will change)" : ""}\n`);

if (!hasTool("keytool", ["-help"])) {
  die(
    "keytool not found. Install a JDK 17+ (macOS: `brew install openjdk@17`, " +
      "Ubuntu: `sudo apt install openjdk-17-jdk`, Windows: temurin-jdk) and retry.",
  );
}
ok("keytool found (JDK)");

if (!hasTool("gh", ["--version"])) {
  die("gh (GitHub CLI) not found. Install it and run `gh auth login` first.");
}
const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
if (auth.status !== 0) {
  die("gh is not authenticated. Run `gh auth login` (needs repo admin to set secrets).");
}
ok(`gh authenticated for ${REPO}`);

let keystoreExists = existsSync(KEYSTORE);
if (!keystoreExists && !STORE_PASS) {
  info("No keystore yet and no --password given → passwords will be prompted.");
}

// ── keystore ──────────────────────────────────────────────────────────
async function askHidden(question, fallback) {
  if (fallback) return fallback;
  const { Writable } = await import("node:stream");
  // Mute the output so the password is never echoed to the terminal.
  const mute = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: mute, terminal: true });
  process.stdout.write(`${question}: `);
  const answer = await new Promise((res) => rl.question("", res));
  process.stdout.write("\n");
  rl.close();
  return answer;
}

if (!keystoreExists) {
  if (DRY_RUN) {
    info(`would run: keytool -genkeypair -v -keystore ${KEYSTORE} -alias ${ALIAS} …`);
    die("dry run: create the keystore for real first, then re-run to upload the secrets.");
  }

  const storePass = await askHidden("Keystore store password (remember it — it cannot be recovered)", STORE_PASS);
  if (!storePass || storePass.length < 6) die("password too short (use at least 6 characters).");
  // PKCS12 keystores (the Android default, and what Gradle expects) do NOT
  // support a key password that differs from the store password. Ask once
  // instead of failing later with an opaque keytool error.
  const keyPass = storePass;

  mkdirSync(dirname(KEYSTORE), { recursive: true });
  const res = spawnSync(
    "keytool",
    [
      "-genkeypair", "-v",
      "-keystore", KEYSTORE,
      "-alias", ALIAS,
      "-keyalg", "RSA",
      "-keysize", "2048",
      "-validity", VALIDITY,
      "-storetype", "PKCS12",
      "-storepass", storePass,
      "-keypass", keyPass,
      "-dname", "CN=VidFetch, OU=Release, O=VidFetch, L=Istanbul, C=TR",
    ],
    { stdio: ["pipe", "pipe", "pipe"], input: `${storePass}\n${storePass}\n${storePass}\n`, encoding: "utf-8" },
  );
  if (res.status !== 0 || !existsSync(KEYSTORE)) {
    die(`keytool failed: ${(res.stderr || res.stdout || "").trim().slice(0, 300)}`);
  }
  keystoreExists = true;
  ok(`keystore created: ${KEYSTORE}`);
  console.log(
    "   ⚠️  Back this file up NOW. If it is lost, users cannot install updates over\n" +
      "      the current app (the signature changes) — they would have to uninstall.",
  );
} else {
  ok(`reusing existing keystore: ${KEYSTORE}`);
}

const key = readFileSync(KEYSTORE).toString("base64");

// ── secrets ───────────────────────────────────────────────────────────
if (DRY_RUN) {
  info(`would upload 4 secrets to ${REPO} (SIGNING_KEY is ${key.length} base64 chars)`);
  process.exit(0);
}

const storePass = await askHidden("Keystore store password (to upload)", STORE_PASS);
const keyPass = storePass; // PKCS12: one password for both (see above)

const secrets = {
  SIGNING_KEY: key,
  SIGNING_STORE_PASSWORD: storePass,
  SIGNING_KEY_ALIAS: ALIAS,
  SIGNING_KEY_PASSWORD: keyPass,
};

for (const [name, value] of Object.entries(secrets)) {
  const r = spawnSync("gh", ["secret", "set", name, "-R", REPO, "-b", value], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    die(`failed to set ${name}: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
  }
  console.log(`✅ ${name} set (${value.length} chars, value not shown)`);
}

// ── verify ────────────────────────────────────────────────────────────
const listed = spawnSync("gh", ["secret", "list", "-R", REPO], { encoding: "utf-8" });
if (listed.status === 0) {
  const names = listed.stdout
    .split("\n")
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
  const missing = Object.keys(secrets).filter((n) => !names.includes(n));
  if (missing.length) die(`still missing after upload: ${missing.join(", ")}`);
  ok("all four secrets are visible to the repo");
} else {
  console.log("⚠️  could not list secrets (no permission?) — the uploads above succeeded.");
}

console.log(
  "\n🎉 Signing is set up. The next `Build APK` run on main will pass the signing step.\n" +
    "   Trigger one with:  gh workflow run build-apk.yml --ref main\n",
);