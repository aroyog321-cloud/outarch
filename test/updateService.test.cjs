"use strict";

// The auto-updater offers only a release signed by the OUTARCH release key,
// installs only an archive whose size and SHA-256 match that signature, and
// never overwrites a development checkout.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { UpdateService, compareVersions, APPLY_SCRIPT } = require("../src/service/updateService.cjs");
const { canonicalUpdate } = require("../src/service/updateVerifier.cjs");
const { UPDATE_PUBLIC_KEY } = require("../src/service/updateConfig.cjs");

function keys() {
  return crypto.generateKeyPairSync("ed25519");
}

function releaseRow(privateKey, { version = "2.20.0", archive = Buffer.from("zip-bytes"), tamper = null } = {}) {
  const manifest = {
    manifestVersion: 1,
    version,
    fileName: `OUTARCH-${version}.zip`,
    sha256: crypto.createHash("sha256").update(archive).digest("hex"),
    size: archive.length,
    publishedAt: "2026-09-19T10:00:00.000Z"
  };
  const signature = crypto.sign(null, Buffer.from(canonicalUpdate(manifest)), privateKey).toString("base64url");
  const row = {
    version,
    channel: "stable",
    notes: "Better things",
    download_url: `https://example.supabase.co/storage/v1/object/public/releases/${manifest.fileName}`,
    file_name: manifest.fileName,
    sha256: manifest.sha256,
    size_bytes: manifest.size,
    signature,
    manifest,
    published_at: manifest.publishedAt,
    mandatory: false
  };
  return tamper ? tamper(row) : row;
}

function appFolder(t, { git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-update-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (git) fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

function updater(t, { rows, publicKey, archive = Buffer.from("zip-bytes"), git = false, platform = "win32" }) {
  const appRoot = appFolder(t, { git });
  const workDir = path.join(appRoot, "..", `${path.basename(appRoot)}-work`);
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const fetch = async () => ({ ok: true, status: 200, body: (async function* body() { yield archive; })() });
  return new UpdateService({ rest: { select: async () => rows }, currentVersion: "2.19.0", publicKey, appRoot, workDir, fetch, platform });
}

test("versions compare numerically, with prereleases before their release", () => {
  assert.equal(compareVersions("2.20.0", "2.19.9"), 1);
  assert.equal(compareVersions("2.19.0", "2.19.0"), 0);
  assert.equal(compareVersions("2.19.0-beta.1", "2.19.0"), -1);
  assert.equal(compareVersions("10.0.0", "9.9.9"), 1);
});

test("a correctly signed newer release is offered, downloaded and verified", async t => {
  const { privateKey, publicKey } = keys();
  const service = updater(t, { rows: [releaseRow(privateKey)], publicKey });
  const checked = await service.check();
  assert.equal(checked.state, "available");
  assert.equal(checked.available.version, "2.20.0");
  assert.equal(checked.canInstall, true);
  const downloaded = await service.download();
  assert.equal(downloaded.state, "ready");
  assert.deepEqual(downloaded.progress, { received: 9, total: 9 });
});

test("a release signed by any other key, or edited after signing, is never offered", async t => {
  const { privateKey, publicKey } = keys();
  const stranger = keys();
  const forged = updater(t, { rows: [releaseRow(stranger.privateKey)], publicKey });
  assert.equal((await forged.check()).available, null);

  const edited = updater(t, { rows: [releaseRow(privateKey, { tamper: row => ({ ...row, manifest: { ...row.manifest, size: row.manifest.size + 1 } }) })], publicKey });
  assert.equal((await edited.check()).available, null);

  const mismatched = updater(t, { rows: [releaseRow(privateKey, { tamper: row => ({ ...row, version: "9.9.9" }) })], publicKey });
  assert.equal((await mismatched.check()).available, null, "the row must agree with what was signed");
});

test("an archive swapped on the server fails verification and is not kept", async t => {
  const { privateKey, publicKey } = keys();
  const service = updater(t, { rows: [releaseRow(privateKey)], publicKey, archive: Buffer.from("zip-bytez") });
  await service.check();
  const result = await service.download();
  assert.equal(result.state, "available");
  assert.match(result.error, /checksum/);
});

test("an older or equal version is not an update", async t => {
  const { privateKey, publicKey } = keys();
  const service = updater(t, { rows: [releaseRow(privateKey, { version: "2.19.0" }), releaseRow(privateKey, { version: "2.18.3" })], publicKey });
  assert.equal((await service.check()).state, "up-to-date");
});

test("a development checkout is told about the update but never overwritten", async t => {
  const { privateKey, publicKey } = keys();
  const service = updater(t, { rows: [releaseRow(privateKey)], publicKey, git: true });
  const status = await service.check();
  assert.equal(status.canInstall, false);
  assert.match(status.installBlockedReason, /development checkout/);
  await assert.rejects(() => service.install({ quit: () => {} }), /development checkout/);
});

test("the apply script waits for OUTARCH to close, backs up, restores on failure and restarts", () => {
  assert.match(APPLY_SCRIPT, /Get-Process -Id \$ParentPid/);
  assert.match(APPLY_SCRIPT, /robocopy \$Target \$Backup \/E \/XD node_modules \.git/);
  assert.match(APPLY_SCRIPT, /Restoring the previous version/);
  assert.match(APPLY_SCRIPT, /npm\.cmd install/);
  assert.match(APPLY_SCRIPT, /OPEN_OUTARCH_WINDOWS\.cmd/);
  assert.doesNotMatch(APPLY_SCRIPT, /\/MIR|\/PURGE/, "the copy never deletes the operator's own files");
});

test("the app ships the public half of an Ed25519 release key", () => {
  const key = crypto.createPublicKey(UPDATE_PUBLIC_KEY);
  assert.equal(key.asymmetricKeyType, "ed25519");
});
