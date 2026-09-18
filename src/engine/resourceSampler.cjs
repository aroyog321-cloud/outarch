const os = require("node:os");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");

const DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS = 5000;
const MIN_RESOURCE_SAMPLE_INTERVAL_MS = 2000;
const MAX_RESOURCE_SAMPLE_INTERVAL_MS = 30000;
const RESOURCE_SAMPLE_TIMEOUT_MS = 2500;
const RESOURCE_STALE_AFTER_MS = 20000;
const MAX_RESOURCE_WORKERS = 50;

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : null;
}

function runFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: "utf8",
      maxBuffer: 512 * 1024,
      timeout: RESOURCE_SAMPLE_TIMEOUT_MS,
      windowsHide: true,
      ...options
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ""));
    });
  });
}

async function probeWindows(pids) {
  const identifiers = pids.join(",");
  const script = `$ids=@(${identifiers}); $processes=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction Stop); $live=@{}; Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $live[[int]$_.Id]=$_ }; $rows=@(); foreach($root in $ids){ $owned=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$owned.Add([int]$root); $changed=$true; while($changed){ $changed=$false; foreach($p in $processes){ if($owned.Contains([int]$p.ParentProcessId) -and $owned.Add([int]$p.ProcessId)){ $changed=$true } } }; $cpu=0.0; $memory=0.0; $count=0; foreach($pidValue in $owned){ $item=$live[[int]$pidValue]; if($null -ne $item){ $count++; if($null -ne $item.CPU){$cpu += [double]$item.CPU}; $memory += [double]$item.WorkingSet64 } }; if($count -gt 0){ $rows += [PSCustomObject]@{pid=[int]$root;cpuSeconds=$cpu;memoryBytes=$memory;processCount=$count;scope='process-tree'} } }; $rows | ConvertTo-Json -Compress`;
  const output = await runFile("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
  ]);
  if (!output.trim()) return new Map();
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return new Map(rows.map(row => [Number(row.pid), {
    cpuSeconds: Number(row.cpuSeconds),
    memoryBytes: Number(row.memoryBytes),
    processCount: Number(row.processCount),
    scope: row.scope === "process-tree" ? "process-tree" : "root-process",
    source: "windows-process-tree"
  }]).filter(([pid]) => Number.isInteger(pid) && pid > 0));
}

async function probeLinux(pids) {
  const systemStat = await fs.readFile("/proc/stat", "utf8");
  const systemTicks = systemStat.split(/\r?\n/)[0].trim().split(/\s+/).slice(1).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const rows = new Map();
  await Promise.all(pids.map(async pid => {
    try {
      const [stat, status] = await Promise.all([
        fs.readFile(`/proc/${pid}/stat`, "utf8"),
        fs.readFile(`/proc/${pid}/status`, "utf8")
      ]);
      const closing = stat.lastIndexOf(")");
      if (closing < 0) return;
      const fields = stat.slice(closing + 1).trim().split(/\s+/);
      const userTicks = Number(fields[11]);
      const systemProcessTicks = Number(fields[12]);
      const rssKB = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/im)?.[1]);
      rows.set(pid, {
        cpuTicks: Number.isFinite(userTicks) && Number.isFinite(systemProcessTicks) ? userTicks + systemProcessTicks : null,
        systemTicks,
        memoryBytes: Number.isFinite(rssKB) ? rssKB * 1024 : null,
        source: "linux-proc"
      });
    } catch {
      // A process may exit between snapshot collection and /proc reads.
    }
  }));
  return rows;
}

async function probePosixPs(pids) {
  const output = await runFile("ps", ["-o", "pid=,pcpu=,rss=", "-p", pids.join(",")]);
  const rows = new Map();
  for (const line of output.split(/\r?\n/)) {
    const [pidValue, cpuValue, rssValue] = line.trim().split(/\s+/);
    const pid = Number(pidValue);
    if (!Number.isInteger(pid) || pid < 1) continue;
    rows.set(pid, {
      cpuPercent: Number(cpuValue),
      memoryBytes: Number(rssValue) * 1024,
      source: "posix-process"
    });
  }
  return rows;
}

async function platformResourceProbe(pids, platform = process.platform) {
  const safePids = [...new Set((Array.isArray(pids) ? pids : [])
    .map(Number)
    .filter(pid => Number.isInteger(pid) && pid > 0))]
    .slice(0, MAX_RESOURCE_WORKERS);
  if (!safePids.length) return new Map();
  if (platform === "win32") return probeWindows(safePids);
  if (platform === "linux") return probeLinux(safePids);
  return probePosixPs(safePids);
}

function workerHealth(session, resources, options = {}) {
  const now = Number(options.now) || Date.now();
  const totalMemoryBytes = Number(options.totalMemoryBytes) || os.totalmem();
  if (!session) return { tone: "unknown", label: "Unknown", summary: "Worker state is unavailable.", signals: [] };
  if (session.status === "failed") return { tone: "critical", label: "Failed", summary: session.attentionReason || "The engine reported a failed worker.", signals: ["lifecycle"] };
  if (session.attentionRequired) return { tone: "attention", label: "Needs you", summary: session.attentionReason || "The worker requires operator review.", signals: ["attention"] };
  if (!session.isAlive) return { tone: "idle", label: "Idle", summary: "The worker is not currently consuming process resources.", signals: [] };
  if (!resources?.available) return { tone: "observing", label: "Observing", summary: "Waiting for the next engine-owned process sample.", signals: [] };
  if (now - Number(resources.sampledAt || 0) > RESOURCE_STALE_AFTER_MS) return { tone: "observing", label: "Sample stale", summary: "The last process sample is stale; lifecycle state remains authoritative.", signals: ["stale"] };

  const memorySystemPercent = totalMemoryBytes > 0
    ? boundedNumber((resources.memoryBytes / totalMemoryBytes) * 100, 0, 100)
    : null;
  const signals = [];
  if (Number(resources.cpuPercent) >= 90) signals.push("high-cpu");
  if (Number(memorySystemPercent) >= 20) signals.push("high-memory");
  if (signals.length) {
    return {
      tone: "pressure",
      label: "Resource pressure",
      summary: signals.includes("high-cpu") && signals.includes("high-memory")
        ? "CPU and memory are elevated; OUTARCH is observing the worker."
        : signals.includes("high-cpu")
          ? "CPU is elevated; this may be expected during builds or tests."
          : "This process holds a significant share of system memory.",
      signals
    };
  }
  return { tone: "healthy", label: "Healthy", summary: "Lifecycle and process resource signals are within the observation thresholds.", signals: [] };
}

class ResourceSampler {
  constructor(options = {}) {
    this.probe = typeof options.probe === "function" ? options.probe : platformResourceProbe;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.totalMemoryBytes = Number(options.totalMemoryBytes) || os.totalmem();
    this.previousCpu = new Map();
    this.samples = new Map();
    this.sampling = null;
  }

  async sample(sessions = []) {
    if (this.sampling) return this.sampling;
    const operation = this.#sample(Array.isArray(sessions) ? sessions : []);
    this.sampling = operation;
    try {
      return await operation;
    } finally {
      if (this.sampling === operation) this.sampling = null;
    }
  }

  async #sample(sessions) {
    const sampledAt = this.now();
    const active = sessions
      .filter(session => session?.isAlive && Number.isInteger(session.pid) && session.pid > 0)
      .slice(0, MAX_RESOURCE_WORKERS);
    const activeIds = new Set(active.map(session => session.id));
    for (const id of [...this.samples.keys()]) if (!activeIds.has(id)) this.samples.delete(id);
    for (const pid of [...this.previousCpu.keys()]) if (!active.some(session => session.pid === pid)) this.previousCpu.delete(pid);
    if (!active.length) return { sampledAt, workerCount: 0, availableCount: 0 };

    let probed;
    try {
      probed = await this.probe(active.map(session => session.pid));
    } catch {
      probed = new Map();
    }
    const values = probed instanceof Map ? probed : new Map(Object.entries(probed || {}).map(([pid, value]) => [Number(pid), value]));
    let availableCount = 0;

    for (const session of active) {
      const raw = values.get(session.pid);
      if (!raw) {
        this.samples.set(session.id, {
          available: false,
          scope: "root-process",
          pid: session.pid,
          sampledAt
        });
        continue;
      }

      let cpuPercent = boundedNumber(raw.cpuPercent, 0, Math.max(100, os.cpus().length * 100));
      const cpuSeconds = boundedNumber(raw.cpuSeconds, 0, Number.MAX_SAFE_INTEGER);
      const cpuTicks = boundedNumber(raw.cpuTicks, 0, Number.MAX_SAFE_INTEGER);
      const systemTicks = boundedNumber(raw.systemTicks, 0, Number.MAX_SAFE_INTEGER);
      const previous = this.previousCpu.get(session.pid);
      if (cpuPercent === null && cpuSeconds !== null && previous && sampledAt > previous.sampledAt) {
        cpuPercent = boundedNumber(
          ((cpuSeconds - previous.cpuSeconds) * 1000 / (sampledAt - previous.sampledAt)) * 100,
          0,
          Math.max(100, os.cpus().length * 100)
        );
      }
      if (cpuPercent === null && cpuTicks !== null && systemTicks !== null && previous?.cpuTicks !== undefined && previous?.systemTicks !== undefined) {
        const processDelta = cpuTicks - previous.cpuTicks;
        const systemDelta = systemTicks - previous.systemTicks;
        if (processDelta >= 0 && systemDelta > 0) {
          cpuPercent = boundedNumber(
            (processDelta / systemDelta) * os.cpus().length * 100,
            0,
            Math.max(100, os.cpus().length * 100)
          );
        }
      }
      if (cpuSeconds !== null) this.previousCpu.set(session.pid, { cpuSeconds, sampledAt });
      else if (cpuTicks !== null && systemTicks !== null) this.previousCpu.set(session.pid, { cpuTicks, systemTicks, sampledAt });
      const memoryBytes = boundedNumber(raw.memoryBytes, 0, Number.MAX_SAFE_INTEGER);
      const sample = {
        available: memoryBytes !== null || cpuPercent !== null,
        scope: raw.scope === "process-tree" ? "process-tree" : "root-process",
        source: String(raw.source || "platform-process").slice(0, 40),
        pid: session.pid,
        ...(Number.isInteger(raw.processCount) ? { processCount: Math.min(1024, Math.max(1, raw.processCount)) } : {}),
        cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
        memoryBytes: memoryBytes === null ? null : Math.round(memoryBytes),
        memoryMB: memoryBytes === null ? null : Math.round((memoryBytes / 1024 / 1024) * 10) / 10,
        sampledAt
      };
      if (sample.available) availableCount++;
      this.samples.set(session.id, sample);
    }
    return { sampledAt, workerCount: active.length, availableCount };
  }

  get(sessionId) {
    const value = this.samples.get(sessionId);
    return value ? { ...value } : null;
  }

  clear() {
    this.previousCpu.clear();
    this.samples.clear();
  }
}

function normalizeResourceSampleInterval(value) {
  if (value === 0) return 0;
  if (!Number.isInteger(value)) return DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS;
  return Math.min(MAX_RESOURCE_SAMPLE_INTERVAL_MS, Math.max(MIN_RESOURCE_SAMPLE_INTERVAL_MS, value));
}

module.exports = {
  DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS,
  MAX_RESOURCE_WORKERS,
  RESOURCE_STALE_AFTER_MS,
  ResourceSampler,
  normalizeResourceSampleInterval,
  platformResourceProbe,
  workerHealth
};
