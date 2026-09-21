"use strict";

// OUTARCH's auto-updater.
//
// Releases are rows in the Supabase table public.app_releases, published by
// scripts/release/publish-release.cjs. Each row carries a manifest (version,
// file name, SHA-256, size) signed with the OUTARCH release key; the app
// verifies that signature against the public key built into it before it even
// offers the update, and verifies the downloaded archive's size and SHA-256
// against the signed manifest before it installs anything. A row someone else
// inserted, or an archive swapped on the server, is refused.
//
// OUTARCH ships as a folder (a ZIP the operator extracted), so installing is a
// file copy: the archive is unpacked into a staging folder, and a small
// PowerShell script — started just before the app quits — waits for it to
// exit, backs up the files it will replace, copies the new ones in, reinstalls
// dependencies only if package-lock.json changed, and starts OUTARCH again. If
// the copy fails it restores the backup and starts the old version.
//
// A development checkout (a folder with .git) is never overwritten: it is told
// an update exists and pointed at git instead.

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { spawn: nodeSpawn, execFile: nodeExecFile } = require("node:child_process");
const { verifyUpdateManifest, verifyUpdateArtifact } = require("./updateVerifier.cjs");
const { UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_DELAY_MS } = require("./updateConfig.cjs");

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function compareVersions(a, b) {
  const left = SEMVER.exec(String(a || ""));
  const right = SEMVER.exec(String(b || ""));
  if (!left || !right) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference) return difference > 0 ? 1 : -1;
  }
  // A prerelease sorts before its release.
  if (left[4] && !right[4]) return -1;
  if (!left[4] && right[4]) return 1;
  if (left[4] && right[4]) return left[4] < right[4] ? -1 : left[4] > right[4] ? 1 : 0;
  return 0;
}

function cleanNotes(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 4000);
}

const APPLY_SCRIPT = String.raw`param(
  [int]$ParentPid,
  [string]$Source,
  [string]$Target,
  [string]$Backup,
  [string]$Log,
  [string]$LockHash
)
$ErrorActionPreference = 'Stop'
function Write-Log([string]$Message) { Add-Content -LiteralPath $Log -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message) }
function Start-Outarch { Start-Process -FilePath (Join-Path $Target 'OPEN_OUTARCH_WINDOWS.cmd') -WorkingDirectory $Target }
try {
  Write-Log "Waiting for OUTARCH ($ParentPid) to close"
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 400 }
  if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw "OUTARCH did not close; the update was not applied" }
  Start-Sleep -Seconds 1
  Write-Log "Backing up the current version"
  if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Recurse -Force }
  & robocopy $Target $Backup /E /XD node_modules .git /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "backup failed (robocopy $LASTEXITCODE)" }
  Write-Log "Copying the new version"
  & robocopy $Source $Target /E /NFL /NDL /NJH /NJS /NP /R:3 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copy failed (robocopy $LASTEXITCODE)" }
  $lock = Join-Path $Target 'package-lock.json'
  $after = if (Test-Path -LiteralPath $lock) { (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }
  if ($after -ne $LockHash) {
    Write-Log "Dependencies changed; installing"
    Push-Location -LiteralPath $Target
    & npm.cmd install --no-audit --no-fund *>> $Log
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { throw "npm install failed ($npmExit)" }
  }
  Write-Log "Update applied"
  Start-Outarch
} catch {
  Write-Log ("Update failed: " + $_)
  if (Test-Path -LiteralPath $Backup) {
    Write-Log "Restoring the previous version"
    & robocopy $Backup $Target /E /NFL /NDL /NJH /NJS /NP /R:3 /W:1 | Out-Null
  }
  Start-Outarch
}
`;

class UpdateService extends EventEmitter {
  #rest;
  #currentVersion;
  #publicKey;
  #appRoot;
  #workDir;
  #channel;
  #fetch;
  #spawn;
  #execFile;
  #platform;
  #now;
  #fs;
  #state;
  #release;
  #progress;
  #error;
  #checkedAt;
  #archivePath;
  #timer;
  #firstTimer;
  #busy;
  #lastEmitAt;
  #blocked;

  constructor(options = {}) {
    super();
    if (!options.rest) throw new TypeError("UpdateService requires a Supabase client");
    if (!options.publicKey) throw new TypeError("UpdateService requires the release public key");
    this.#rest = options.rest;
    this.#currentVersion = String(options.currentVersion || "0.0.0");
    this.#publicKey = options.publicKey;
    this.#appRoot = path.resolve(options.appRoot || path.resolve(__dirname, "..", ".."));
    this.#workDir = path.resolve(options.workDir || path.join(require("node:os").tmpdir(), "outarch-updates"));
    this.#channel = typeof options.channel === "function" ? options.channel : () => "stable";
    this.#fetch = options.fetch || global.fetch;
    this.#spawn = options.spawn || nodeSpawn;
    this.#execFile = options.execFile || nodeExecFile;
    this.#platform = options.platform || process.platform;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#fs = options.fs || fs;
    this.#state = "idle";
    this.#release = null;
    this.#progress = null;
    this.#error = null;
    this.#checkedAt = null;
    this.#archivePath = null;
    this.#timer = null;
    this.#firstTimer = null;
    this.#busy = null;
    this.#lastEmitAt = 0;
    this.#blocked = undefined;
  }

  // ------------------------------------------------------------------ status

  #installBlockedReason() {
    if (this.#platform !== "win32") return "Automatic install is available on Windows. Download this update and replace the app folder.";
    if (this.#fs.existsSync(path.join(this.#appRoot, ".git"))) return "This copy of OUTARCH is a development checkout, so it is never overwritten. Update it with git.";
    try {
      const probe = path.join(this.#appRoot, `.outarch-write-test-${process.pid}`);
      this.#fs.writeFileSync(probe, "");
      this.#fs.unlinkSync(probe);
    } catch {
      return "OUTARCH cannot write to the folder it runs from. Download this update and replace the folder yourself.";
    }
    return null;
  }

  // Probing the folder writes a file, so it is done once, not on every progress tick.
  #blockedReason() {
    if (this.#blocked === undefined) this.#blocked = this.#installBlockedReason();
    return this.#blocked;
  }

  status() {
    const blocked = this.#release ? this.#blockedReason() : null;
    return {
      state: this.#state,
      currentVersion: this.#currentVersion,
      available: this.#release ? {
        version: this.#release.version,
        notes: this.#release.notes,
        size: this.#release.size,
        publishedAt: this.#release.publishedAt,
        mandatory: this.#release.mandatory
      } : null,
      progress: this.#progress ? { ...this.#progress } : null,
      error: this.#error,
      checkedAt: this.#checkedAt,
      canInstall: Boolean(this.#release) && !blocked,
      installBlockedReason: blocked
    };
  }

  #emit(force = true) {
    const now = this.#now();
    if (!force && now - this.#lastEmitAt < 200) return;
    this.#lastEmitAt = now;
    this.emit("change", this.status());
  }

  #set(state, error = null) {
    this.#state = state;
    this.#error = error;
    this.#emit();
  }

  // ------------------------------------------------------------------ check

  async check() {
    if (this.#busy) return this.status();
    if (["downloading", "installing"].includes(this.#state)) return this.status();
    this.#set("checking");
    try {
      const channel = encodeURIComponent(String(this.#channel() || "stable").replace(/[^a-z0-9._-]/gi, "").slice(0, 32) || "stable");
      const rows = await this.#rest.select("app_releases", `select=version,channel,notes,download_url,file_name,sha256,size_bytes,signature,manifest,published_at,mandatory&channel=eq.${channel}&enabled=is.true&order=published_at.desc&limit=10`);
      this.#checkedAt = this.#now();
      const candidates = (Array.isArray(rows) ? rows : [])
        .filter(row => row && SEMVER.test(String(row.version)) && compareVersions(row.version, this.#currentVersion) > 0)
        .sort((a, b) => compareVersions(b.version, a.version));
      let chosen = null;
      for (const row of candidates) {
        try { chosen = this.#verifyRow(row); break; }
        catch { /* an unverifiable row is skipped */ }
      }
      if (!chosen) {
        // A newer row that fails verification is never offered, and never
        // explained as anything but "no update" to someone who cannot act on it.
        if (this.#release && compareVersions(this.#release.version, this.#currentVersion) > 0 && this.#state !== "error") {
          this.#set(this.#archivePath ? "ready" : "available");
        } else {
          this.#release = null;
          this.#set("up-to-date");
        }
        return this.status();
      }
      const sameAsBefore = this.#release && this.#release.version === chosen.version && this.#release.sha256 === chosen.sha256;
      this.#release = chosen;
      if (!sameAsBefore) this.#archivePath = null;
      this.#set(this.#archivePath ? "ready" : "available");
      if (!sameAsBefore) this.emit("available", this.status());
    } catch (error) {
      this.#set(this.#release ? (this.#archivePath ? "ready" : "available") : "idle", this.#release ? null : `Could not check for updates: ${error.message}`);
    }
    return this.status();
  }

  #verifyRow(row) {
    const manifest = row.manifest && typeof row.manifest === "object" ? row.manifest : null;
    if (!manifest) throw new Error("release has no manifest");
    const verified = verifyUpdateManifest({ ...manifest, signature: row.signature }, this.#publicKey);
    if (verified.version !== row.version || verified.fileName !== row.file_name || verified.sha256 !== String(row.sha256).toLowerCase() || verified.size !== Number(row.size_bytes)) {
      throw new Error("release row does not match its signed manifest");
    }
    let url;
    try { url = new URL(String(row.download_url)); } catch { throw new Error("release download URL is invalid"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("release must be downloaded over https");
    return {
      version: verified.version,
      fileName: verified.fileName,
      sha256: verified.sha256,
      size: verified.size,
      publishedAt: verified.publishedAt,
      manifest: verified,
      url: url.toString(),
      notes: cleanNotes(row.notes),
      mandatory: row.mandatory === true
    };
  }

  // --------------------------------------------------------------- download

  async download() {
    if (!this.#release) throw new Error("There is no update to download");
    if (this.#archivePath && this.#state === "ready") return this.status();
    if (this.#busy) return this.#busy;
    const release = this.#release;
    this.#busy = (async () => {
      const directory = path.join(this.#workDir, "downloads");
      this.#fs.mkdirSync(directory, { recursive: true });
      const target = path.join(directory, release.fileName);
      const partial = `${target}.part`;
      this.#progress = { received: 0, total: release.size };
      this.#set("downloading");
      try {
        // A copy already on disk from an earlier run is reused if it verifies.
        if (this.#fs.existsSync(target)) {
          try {
            await verifyUpdateArtifact(target, release.manifest);
            this.#archivePath = target;
            this.#progress = { received: release.size, total: release.size };
            this.#set("ready");
            return this.status();
          } catch {
            try { this.#fs.unlinkSync(target); } catch { /* replaced below */ }
          }
        }
        const response = await this.#fetch(release.url, { redirect: "follow" });
        if (!response.ok || !response.body) throw new Error(`the download server answered ${response.status}`);
        const out = this.#fs.createWriteStream(partial);
        let received = 0;
        try {
          for await (const chunk of response.body) {
            received += chunk.length;
            if (received > release.size) throw new Error("the download is larger than the signed release");
            if (!out.write(chunk)) await new Promise(resolve => out.once("drain", resolve));
            this.#progress = { received, total: release.size };
            this.#emit(false);
          }
        } finally {
          await new Promise(resolve => out.end(resolve));
        }
        await verifyUpdateArtifact(partial, release.manifest);
        this.#fs.renameSync(partial, target);
        this.#archivePath = target;
        this.#progress = { received: release.size, total: release.size };
        this.#set("ready");
      } catch (error) {
        try { this.#fs.unlinkSync(partial); } catch { /* nothing partial */ }
        this.#archivePath = null;
        this.#progress = null;
        this.#set("available", `The update could not be downloaded: ${error.message}`);
      }
      return this.status();
    })().finally(() => { this.#busy = null; });
    return this.#busy;
  }

  // ---------------------------------------------------------------- install

  #run(file, args) {
    return new Promise((resolve, reject) => {
      this.#execFile(file, args, { windowsHide: true, timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, error => (error ? reject(error) : resolve()));
    });
  }

  async #extract(archive, destination) {
    this.#fs.rmSync(destination, { recursive: true, force: true });
    this.#fs.mkdirSync(destination, { recursive: true });
    try {
      // bsdtar ships with Windows 10 and later and reads ZIP archives.
      await this.#run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", destination]);
    } catch {
      await this.#run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`]);
    }
  }

  #locateRoot(staging) {
    if (this.#fs.existsSync(path.join(staging, "package.json"))) return staging;
    const entries = this.#fs.readdirSync(staging, { withFileTypes: true }).filter(entry => entry.isDirectory());
    if (entries.length === 1 && this.#fs.existsSync(path.join(staging, entries[0].name, "package.json"))) return path.join(staging, entries[0].name);
    throw new Error("the update archive does not contain OUTARCH");
  }

  #fileHash(file) {
    try { return crypto.createHash("sha256").update(this.#fs.readFileSync(file)).digest("hex"); }
    catch { return ""; }
  }

  /**
   * Unpack, check, and hand over to the apply script. `quit` is called once
   * the script is running; it must close OUTARCH the normal way so terminals
   * are stopped cleanly.
   */
  async install({ quit } = {}) {
    if (!this.#release) throw new Error("There is no update to install");
    this.#blocked = undefined;
    const blocked = this.#blockedReason();
    if (blocked) throw new Error(blocked);
    if (!this.#archivePath) await this.download();
    if (!this.#archivePath) throw new Error(this.#error || "The update could not be downloaded");
    const release = this.#release;
    this.#set("installing");
    try {
      await verifyUpdateArtifact(this.#archivePath, release.manifest);
      const staging = path.join(this.#workDir, `staging-${release.version}`);
      await this.#extract(this.#archivePath, staging);
      const root = this.#locateRoot(staging);
      const pkg = JSON.parse(this.#fs.readFileSync(path.join(root, "package.json"), "utf8"));
      if (pkg.name !== "termctl-tui") throw new Error("the update archive is not an OUTARCH release");
      if (pkg.version !== release.version) throw new Error(`the archive says it is version ${pkg.version}, not ${release.version}`);
      if (!this.#fs.existsSync(path.join(root, "src", "groundstation", "main", "index.cjs"))) throw new Error("the update archive is incomplete");

      const script = path.join(this.#workDir, "apply-update.ps1");
      this.#fs.writeFileSync(script, APPLY_SCRIPT, "utf8");
      const log = path.join(this.#workDir, "update.log");
      const backup = path.join(this.#workDir, `backup-${this.#currentVersion}`);
      const lockHash = this.#fileHash(path.join(this.#appRoot, "package-lock.json"));
      const child = this.#spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", script,
        "-ParentPid", String(process.pid),
        "-Source", root,
        "-Target", this.#appRoot,
        "-Backup", backup,
        "-Log", log,
        "-LockHash", lockHash
      ], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref?.();
      this.emit("installing", this.status());
      if (typeof quit === "function") await quit();
      return this.status();
    } catch (error) {
      this.#set("ready", `The update could not be installed: ${error.message}`);
      throw error;
    }
  }

  // ---------------------------------------------------------------- schedule

  start() {
    this.stop();
    this.#firstTimer = setTimeout(() => { void this.check(); }, UPDATE_FIRST_CHECK_DELAY_MS);
    this.#firstTimer.unref?.();
    this.#timer = setInterval(() => { void this.check(); }, UPDATE_CHECK_INTERVAL_MS);
    this.#timer.unref?.();
  }

  stop() {
    if (this.#firstTimer) clearTimeout(this.#firstTimer);
    if (this.#timer) clearInterval(this.#timer);
    this.#firstTimer = null;
    this.#timer = null;
  }

  dispose() {
    this.stop();
    this.removeAllListeners();
  }
}

module.exports = { APPLY_SCRIPT, UpdateService, compareVersions };
