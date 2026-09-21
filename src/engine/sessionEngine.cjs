const EventEmitter = require("node:events");
const { stripAnsi } = require("./ansi.cjs");
const { classify } = require("./classifier.cjs");
const { mergeEvidence } = require("./evidenceClassifier.cjs");

function evidenceFactsChanged(previous, next) {
  if (!previous) return true;
  const withoutTimestamp = value => Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== "at"));
  return JSON.stringify(withoutTimestamp(previous)) !== JSON.stringify(withoutTimestamp(next));
}

const MAX_BUFFERED_LINES = 500;
const SNAPSHOT_LINES = 200;
const MAX_PARTIAL_LINE = 64 * 1024;
const MAX_RAW_REPLAY_BYTES = 1024 * 1024;
const RAW_REPLAY_CHUNK_BYTES = 16 * 1024;
const MAX_INPUT_EVIDENCE_EVENTS = 12;
const MAX_INPUT_EVIDENCE_BUFFER = 2048;
const MAX_INPUT_PREVIEW_LENGTH = 180;
const RESTART_EXIT_TIMEOUT_MS = 2500;
const REMOVE_EXIT_TIMEOUT_MS = 2500;
const SHUTDOWN_EXIT_TIMEOUT_MS = 5000;
// A resize makes the terminal (ConPTY on Windows) repaint the visible screen,
// and the repaint arrives as ordinary output. Opening a terminal re-fits it, so
// without this an error already on screen — one you had acknowledged — was read
// again as a new failure and announced a second time.
const REDRAW_WINDOW_MS = 1500;
const REDRAW_HISTORY_LINES = 400;
const MAX_ATTENTION_CLAIMS = 50;

// Rows as they appear on screen. Cursor positioning separates rows in a repaint
// just as a newline does in a log.
function screenLines(text) {
  return stripAnsi(String(text || "").replace(/\u001b\[\d*(?:;\d*)?[Hf]/g, "\n"))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split(/\r\n|\r|\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// The same error printed again differs only in counters, times and line numbers.
function errorSignature(line) {
  return stripAnsi(String(line || "")).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 240);
}

function defaultPtyFactory(command, args, options) {
  // Keep the native dependency behind the default factory so engine tests and
  // non-PTY tooling can inject a deterministic implementation.
  const pty = require("node-pty");
  return pty.spawn(command, args, options);
}

function sanitizeInputPreview(value) {
  let text = String(value || "")
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!text) return { preview: null, redacted: false };
  let redacted = false;
  const replace = (pattern, replacement) => {
    text = text.replace(pattern, (...args) => {
      redacted = true;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    });
  };
  replace(/\b(Bearer)\s+[^\s]+/gi, "$1 [REDACTED]");
  replace(/\b(password|passwd|pwd|token|secret|api[_-]?key|authorization)\s*([=:]\s*|\s+)[^\s]+/gi, "$1$2[REDACTED]");
  replace(/(--(?:password|passwd|token|secret|api-key|apikey)(?:=|\s+))[^\s]+/gi, "$1[REDACTED]");
  replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, "$1[REDACTED]@");
  if (/^[A-Za-z0-9+/_=-]{20,}$/.test(text)) {
    text = "[INPUT REDACTED]";
    redacted = true;
  }
  if (text.length > MAX_INPUT_PREVIEW_LENGTH) text = `${text.slice(0, MAX_INPUT_PREVIEW_LENGTH)}…`;
  return { preview: text, redacted };
}

function normalizeInputSource(value) {
  const source = String(value || "groundstation").toLowerCase();
  return ["groundstation", "mission-ai", "mcp", "mobile", "vscode", "engine"].includes(source)
    ? source
    : "groundstation";
}

function isPowerShellExecutable(file) {
  const executable = String(file).split(/[\\/]/).at(-1).toLowerCase();
  return ["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(executable);
}

class RawReplayBuffer {
  constructor(maxBytes = MAX_RAW_REPLAY_BYTES) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.head = 0;
    this.byteLength = 0;
    this.truncated = false;
  }

  clear() {
    this.chunks = [];
    this.head = 0;
    this.byteLength = 0;
    this.truncated = false;
  }

  append(value) {
    const text = String(value);
    if (!text) return;
    const bytes = Buffer.byteLength(text);
    const last = this.chunks.at(-1);
    if (last && last.bytes + bytes <= RAW_REPLAY_CHUNK_BYTES) {
      last.text += text;
      last.bytes += bytes;
    } else {
      this.chunks.push({ text, bytes });
    }
    this.byteLength += bytes;

    while (this.byteLength > this.maxBytes && this.chunks.length - this.head > 1) {
      const removed = this.chunks[this.head++];
      this.byteLength -= removed.bytes;
      this.truncated = true;
    }

    if (this.byteLength > this.maxBytes) {
      const only = this.chunks[this.head];
      const encoded = Buffer.from(only.text);
      let start = encoded.length - this.maxBytes;
      while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start++;
      only.text = encoded.subarray(start).toString("utf8");
      only.bytes = Buffer.byteLength(only.text);
      this.byteLength = only.bytes;
      this.truncated = true;
    }

    if (this.head > 1024 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  snapshot() {
    return {
      data: this.chunks.slice(this.head).map(chunk => chunk.text).join(""),
      byteLength: this.byteLength,
      complete: !this.truncated
    };
  }
}

function preparePowerShellArgs(file, args, compatibilityEnabled = false) {
  const nextArgs = [...args];
  if (!compatibilityEnabled || !isPowerShellExecutable(file)) return nextArgs;
  const hasNonInteractiveEntry = nextArgs.some(arg =>
    /^(?:-(?:command|c|file|f|encodedcommand|e|ec|noninteractive))$/i.test(String(arg))
  );
  if (hasNonInteractiveEntry) return nextArgs;

  // PSReadLine requires ConPTY Win32 key-event records. Ink cannot reliably
  // transfer that console input mode to a raw attached stream. Plain
  // PowerShell line input remains fully interactive over ordinary PTY bytes.
  if (!nextArgs.some(arg => /^-noexit$/i.test(String(arg)))) nextArgs.push("-NoExit");
  nextArgs.push(
    "-Command",
    "Remove-Module PSReadLine -ErrorAction SilentlyContinue"
  );
  return nextArgs;
}

function resolveLaunch(command, args, options = {}) {
  const platform = options.platform || process.platform;
  const powershellCompatibility = options.powershellCompatibility === true;
  if (args.length > 0 || !/\s/.test(command.trim())) {
    return {
      file: command,
      args: preparePowerShellArgs(command, args, powershellCompatibility)
    };
  }

  if (platform === "win32") {
    if (powershellCompatibility) {
      throw new Error(
        "powershellCompatibility requires the executable in command and options in the args array"
      );
    }
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command]
    };
  }

  return {
    file: process.env.SHELL || "/bin/sh",
    args: ["-lc", command]
  };
}

function disposeRegistration(registration) {
  if (registration && typeof registration.dispose === "function") {
    registration.dispose();
  }
}

function sameConfigurationValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => value === right[index]);
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
    const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
    return leftEntries.length === rightEntries.length &&
      leftEntries.every(([key, value], index) =>
        key === rightEntries[index][0] && value === rightEntries[index][1]
      );
  }
  return left === right;
}

function waitForSessionExit(session, timeoutMs) {
  let timer;
  let settled = false;
  let onExit;
  let onDisposed;
  let finishWait;

  const completion = new Promise(resolve => {
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.off("exit", onExit);
      session.off("disposed", onDisposed);
      resolve(result);
    };
    finishWait = finish;
    onExit = () => finish("exited");
    onDisposed = () => finish("disposed");
    session.once("exit", onExit);
    session.once("disposed", onDisposed);
    timer = setTimeout(() => finish("timeout"), timeoutMs);
  });

  return {
    completion,
    cancel: () => finishWait("cancelled")
  };
}

class Session extends EventEmitter {
  constructor(def, options = {}) {
    super();

    this.id = def.id;
    this.name = def.name || def.id;
    this.command = def.command || (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "sh");
    this.args = Array.isArray(def.args) ? [...def.args] : [];
    this.cwd = def.cwd || process.cwd();
    this.env = def.env && typeof def.env === "object" ? { ...def.env } : {};
    this.powershellCompatibility = def.powershellCompatibility === true;
    this.autoStart = def.autoStart !== false;

    this.ptyFactory = options.ptyFactory || def.ptyFactory || defaultPtyFactory;
    this.cols = options.cols || 120;
    this.rows = options.rows || 30;

    this.lines = [];
    this.proc = null;
    this.status = this.autoStart ? "starting" : "idle";
    this.spawnError = null;
    this.exitCode = null;
    this.exitSignal = null;
    this.startTime = null;
    this.endTime = null;
    this.lastOutputAt = null;
    this.correlationId = null;
    this.activity = null;
    this.attentionRequired = false;
    this.attentionReason = null;
    this.attentionSince = null;
    // T069 — where the attention came from decides whether later output may
    // clear it. "output" is an inference from a log line and is supersedable;
    // "lifecycle" is a spawn failure or a non-zero exit, which is the fact that
    // the process is dead and no amount of later text can undo.
    this.attentionOrigin = null;
    // Signatures of the error lines behind the current attention, and — once
    // acknowledged — the ones the operator has already seen, with the input
    // count at that moment. An acknowledged error printed again is not news
    // until something changes: a restart, a command typed, a success or a new
    // build cycle in between.
    this._attentionClaims = new Set();
    this._acknowledged = null;
    this._redrawUntil = 0;
    this.evidence = {};
    this._partialLine = "";
    this._rawReplay = new RawReplayBuffer();
    this._outputSequence = 0;
    this._inputEvidence = [];
    this._inputEvidenceBuffer = "";
    this._inputEvidenceBytes = 0;
    this._inputCount = 0;
    this.lastInputAt = null;
    this._ptyRegistrations = [];
    this._stopRequested = false;
    this._disposed = false;
    this._runSequence = 0;
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", { status });
  }

  _appendLine(line) {
    this.lines.push(stripAnsi(String(line)));
    if (this.lines.length > MAX_BUFFERED_LINES) {
      this.lines.splice(0, this.lines.length - MAX_BUFFERED_LINES);
    }
  }

  _consumeOutput(data) {
    const normalized = String(data).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = (this._partialLine + normalized).split("\n");
    this._partialLine = parts.pop() || "";

    for (const line of parts) this._appendLine(line);

    if (this._partialLine.length > MAX_PARTIAL_LINE) {
      this._appendLine(`${this._partialLine.slice(0, MAX_PARTIAL_LINE)} [truncated]`);
      this._partialLine = "";
    }
  }

  _commitInputEvidence(source) {
    const sanitized = sanitizeInputPreview(this._inputEvidenceBuffer);
    this._inputEvidenceBuffer = "";
    if (!sanitized.preview) return;
    this._inputCount++;
    const event = {
      sequence: this._inputCount,
      at: this.lastInputAt,
      source,
      kind: "command",
      preview: sanitized.preview,
      redacted: sanitized.redacted,
      byteLength: this._inputEvidenceBytes
    };
    this._inputEvidenceBytes = 0;
    this._inputEvidence.push(event);
    if (this._inputEvidence.length > MAX_INPUT_EVIDENCE_EVENTS) {
      this._inputEvidence.splice(0, this._inputEvidence.length - MAX_INPUT_EVIDENCE_EVENTS);
    }
    this.emit("input-evidence", JSON.parse(JSON.stringify(event)));
  }

  _recordInput(data, source) {
    const text = String(data || "");
    if (!text) return;
    this.lastInputAt = Date.now();
    const normalizedSource = normalizeInputSource(source);
    for (const character of text) {
      if (character === "\b" || character === "\u007f") {
        this._inputEvidenceBuffer = this._inputEvidenceBuffer.slice(0, -1);
        continue;
      }
      if (character === "\r" || character === "\n") {
        this._commitInputEvidence(normalizedSource);
        continue;
      }
      this._inputEvidenceBytes += Buffer.byteLength(character);
      if (this._inputEvidenceBuffer.length < MAX_INPUT_EVIDENCE_BUFFER) {
        this._inputEvidenceBuffer += character;
      }
    }
  }

  _supervisionSummary() {
    return {
      activity: this.activity,
      attentionRequired: this.attentionRequired,
      attentionReason: this.attentionReason,
      attentionSince: this.attentionSince
    };
  }

  _emitSupervisionIfChanged(previous) {
    const next = this._supervisionSummary();
    if (
      previous.activity !== next.activity ||
      previous.attentionRequired !== next.attentionRequired ||
      previous.attentionReason !== next.attentionReason ||
      previous.attentionSince !== next.attentionSince
    ) {
      this.emit("supervision", next);
    }
  }

  _attentionReasonFrom(text) {
    const lines = stripAnsi(String(text))
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
    // The line that is the error, not whatever printed after it — a chunk that
    // ends with the shell prompt used to make the prompt the reason.
    const claim = [...lines].reverse().find(line => classify(line) === "claim");
    const reason = claim || lines.at(-1) || "Terminal output needs attention";
    return reason.length > 240 ? `${reason.slice(0, 237)}...` : reason;
  }

  /**
   * Output that arrives just after a resize and repeats rows already in the
   * buffer is the terminal repainting its screen. Returns null for real output,
   * or the rows that are new (usually none) when it is a repaint.
   */
  _redrawFrom(text, at) {
    if (!(at <= this._redrawUntil)) return null;
    const rows = screenLines(text);
    if (!rows.length) return null;
    const history = this.lines.slice(-REDRAW_HISTORY_LINES)
      .concat(stripAnsi(this._partialLine))
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const novel = rows.filter(row => !history.some(line => line.includes(row)));
    // Nothing on screen already: this is new output that happened to follow a resize.
    if (novel.length === rows.length) return null;
    return { novel, text: novel.length ? `${novel.join("\n")}\n` : "" };
  }

  _updateSupervision(text) {
    const nextActivity = classify(text);
    if (!nextActivity) return null;

    const lines = screenLines(text);
    const claims = nextActivity === "claim" ? lines.filter(line => classify(line) === "claim") : [];
    if (this._acknowledged) {
      // Something changed since the acknowledgement: a command was typed, or
      // the worker reported a success or started a new cycle. A failure after
      // that is news again.
      const moved = this._inputCount !== this._acknowledged.inputCount
        || lines.some(line => ["nominal", "progress"].includes(classify(line)));
      if (moved) this._acknowledged = null;
    }
    if (
      nextActivity === "claim" &&
      !this.attentionRequired &&
      this._acknowledged &&
      claims.length > 0 &&
      claims.every(line => this._acknowledged.signatures.has(errorSignature(line)))
    ) {
      // The error the operator acknowledged, printed again. It stays acknowledged.
      return { acknowledged: true };
    }

    const previous = this._supervisionSummary();
    this.activity = nextActivity;
    if (nextActivity === "claim" && !this.attentionRequired) {
      this.attentionRequired = true;
      this.attentionReason = this._attentionReasonFrom(text);
      this.attentionSince = Date.now();
      this.attentionOrigin = "output";
    }
    if (nextActivity === "claim" && this.attentionRequired) {
      for (const line of claims) {
        if (this._attentionClaims.size >= MAX_ATTENTION_CLAIMS) break;
        this._attentionClaims.add(errorSignature(line));
      }
    }
    // T069 — a build that failed and then succeeded is history, not a decision.
    // Attention inferred from a log line is superseded when the same worker
    // later reports success, so a recovered watch-mode server or a re-run test
    // suite stops demanding an acknowledgement it no longer needs. Attention
    // raised by the lifecycle is never cleared this way: the process is dead,
    // and only a restart resolves that.
    if (nextActivity === "nominal" && this.attentionRequired && this.attentionOrigin === "output" && this.status !== "failed") {
      this.attentionRequired = false;
      this.attentionReason = null;
      this.attentionSince = null;
      this.attentionOrigin = null;
      this._attentionClaims = new Set();
    }
    this._emitSupervisionIfChanged(previous);
    return null;
  }

  _raiseAttention(reason) {
    const previous = this._supervisionSummary();
    this.activity = "claim";
    if (!this.attentionRequired) {
      this.attentionRequired = true;
      this.attentionReason = this._attentionReasonFrom(reason);
      this.attentionSince = Date.now();
    }
    // Always upgrade the origin: a worker whose output merely looked bad and
    // then actually exited non-zero must stop being clearable by a later line.
    this.attentionOrigin = "lifecycle";
    this._emitSupervisionIfChanged(previous);
  }

  _resetSupervision() {
    const previous = this._supervisionSummary();
    // A new run (or a new launch definition) owes nothing to the last one's
    // acknowledgements.
    this._attentionClaims = new Set();
    this._acknowledged = null;
    this.activity = null;
    this.attentionRequired = false;
    this.attentionReason = null;
    this.attentionSince = null;
    this.attentionOrigin = null;
    this._emitSupervisionIfChanged(previous);
  }

  _disposePtyRegistrations() {
    for (const registration of this._ptyRegistrations) {
      disposeRegistration(registration);
    }
    this._ptyRegistrations = [];
  }

  spawn() {
    if (this._disposed) return false;
    if (this.isAlive()) return false;
    // Admission: the engine owner may cap how many processes run at once (the
    // operator's plan). A refused start changes nothing about the session; it
    // simply does not launch, and says why.
    this.admissionRefusal = null;
    if (typeof this.admit === "function") {
      let refusal = null;
      try { refusal = this.admit(this); } catch { refusal = null; }
      if (refusal) {
        this.admissionRefusal = String(refusal).slice(0, 300);
        return false;
      }
    }

    this._disposePtyRegistrations();
    this.proc = null;
    this.spawnError = null;
    this.exitCode = null;
    this.exitSignal = null;
    this.startTime = Date.now();
    this.correlationId = `${this.id}:run:${this.startTime}:${++this._runSequence}`;
    this.endTime = null;
    this.lastOutputAt = null;
    this.evidence = {};
    this._partialLine = "";
    this._rawReplay.clear();
    this._outputSequence = 0;
    this._inputEvidence = [];
    this._inputEvidenceBuffer = "";
    this._inputEvidenceBytes = 0;
    this._inputCount = 0;
    this.lastInputAt = null;
    this._stopRequested = false;
    this._resetSupervision();
    this._setStatus("starting");

    let proc;
    try {
      const launch = resolveLaunch(this.command, this.args, {
        powershellCompatibility: this.powershellCompatibility
      });
      proc = this.ptyFactory(launch.file, launch.args, {
        name: "xterm-color",
        cols: this.cols,
        rows: this.rows,
        cwd: this.cwd,
        env: { ...process.env, ...this.env }
      });
      this.proc = proc;
    } catch (err) {
      this.spawnError = err instanceof Error ? err.message : String(err);
      this.endTime = Date.now();
      this._appendLine(`[failed to start: ${this.spawnError}]`);
      this._setStatus("failed");
      this._raiseAttention(`Failed to start: ${this.spawnError}`);
      this.emit("spawn-error", { error: this.spawnError });
      return false;
    }

    const onData = data => {
      if (this.proc !== proc || this._disposed) return;
      const text = String(data);
      const sequence = ++this._outputSequence;
      // The replay stays byte-exact: a repaint is still what the screen shows.
      this._rawReplay.append(text);
      const at = Date.now();
      const redraw = this._redrawFrom(text, at);
      let supervisionText;
      if (redraw) {
        // Only rows that were not already on screen are output. A pure repaint
        // is not activity, adds nothing to the log and re-reports nothing.
        for (const row of redraw.novel) this._appendLine(row);
        supervisionText = redraw.text;
        if (supervisionText) this.lastOutputAt = at;
      } else {
        this.lastOutputAt = at;
        supervisionText = this._partialLine + text;
        this._consumeOutput(text);
      }
      if (supervisionText) {
        const previousEvidence = this.evidence;
        this.evidence = mergeEvidence(this.evidence, supervisionText, at);
        for (const [category, evidence] of Object.entries(this.evidence)) {
          if (evidenceFactsChanged(previousEvidence[category], evidence)) {
            this.emit("evidence", { category, evidence: JSON.parse(JSON.stringify(evidence)) });
          }
        }
      }
      const supervision = supervisionText ? this._updateSupervision(supervisionText) : null;
      // Readers of the raw stream (service discovery, build and port-conflict
      // events) are told what this chunk really is, so they draw the same
      // conclusion as the engine instead of re-reading a repaint or an
      // acknowledged error as news.
      this.emit("data", text, {
        sequence,
        at,
        source: "pty",
        ...(redraw ? { redraw: true, analysisText: redraw.text } : {}),
        ...(supervision?.acknowledged ? { acknowledged: true } : {})
      });
    };

    const onExit = info => {
      if (this.proc !== proc || this._disposed) return;

      if (this._partialLine) {
        this._appendLine(this._partialLine);
        this._partialLine = "";
      }

      this.exitCode = Number.isInteger(info?.exitCode) ? info.exitCode : null;
      this.exitSignal = Number.isInteger(info?.signal) ? info.signal : null;
      this.endTime = Date.now();
      this.proc = null;
      this._disposePtyRegistrations();

      const intentionallyStopped = this._stopRequested;
      this._stopRequested = false;
      this._setStatus(intentionallyStopped || this.exitCode === 0 ? "exited" : "failed");
      if (!intentionallyStopped && this.exitCode !== 0) {
        const suffix = this.exitCode === null ? "without an exit code" : `with code ${this.exitCode}`;
        this._raiseAttention(`Process exited ${suffix}`);
      }
      this.emit("exit", {
        exitCode: this.exitCode,
        signal: this.exitSignal,
        intentional: intentionallyStopped
      });
    };

    let dataRegistration;
    let exitRegistration;
    try {
      dataRegistration = proc.onData(onData);
      exitRegistration = proc.onExit(onExit);
    } catch (err) {
      disposeRegistration(dataRegistration);
      disposeRegistration(exitRegistration);
      try {
        proc.kill();
      } catch (killError) {
        // Listener setup already failed; continue surfacing the original error.
      }
      this.proc = null;
      this.spawnError = err instanceof Error ? err.message : String(err);
      this.endTime = Date.now();
      this._appendLine(`[failed to initialize PTY listeners: ${this.spawnError}]`);
      this._setStatus("failed");
      this._raiseAttention(`Failed to initialize PTY listeners: ${this.spawnError}`);
      this.emit("spawn-error", { error: this.spawnError });
      return false;
    }

    this._ptyRegistrations = [dataRegistration, exitRegistration].filter(Boolean);
    this._setStatus("running");
    return true;
  }

  isAlive() {
    return this.proc !== null && (this.status === "starting" || this.status === "running");
  }

  start() {
    if (this._disposed) return { ok: false, error: "session is disposed" };
    if (this.isAlive()) return { ok: false, error: "session is already running" };
    return this.spawn()
      ? { ok: true }
      : { ok: false, error: this.admissionRefusal || this.spawnError || "session failed to start", ...(this.admissionRefusal ? { code: "PLAN_REQUIRED" } : null) };
  }

  write(data, options = {}) {
    if (!this.isAlive()) return false;
    try {
      this.proc.write(data);
      this._recordInput(data, options.source);
      return true;
    } catch (err) {
      return false;
    }
  }

  resize(cols, rows) {
    if (!this.isAlive()) return false;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return false;

    try {
      this.proc.resize(cols, rows);
      this.cols = cols;
      this.rows = rows;
      // The terminal repaints its screen in answer; see REDRAW_WINDOW_MS.
      this._redrawUntil = Date.now() + REDRAW_WINDOW_MS;
      return true;
    } catch (err) {
      return false;
    }
  }

  kill() {
    if (!this.isAlive()) return false;
    this._stopRequested = true;
    try {
      this.proc.kill();
      return true;
    } catch (err) {
      this._stopRequested = false;
      return false;
    }
  }

  async restart(timeoutMs = RESTART_EXIT_TIMEOUT_MS) {
    if (this._disposed) return { ok: false, error: "session is disposed" };

    if (this.isAlive()) {
      const exitWait = waitForSessionExit(this, timeoutMs);

      if (!this.kill()) {
        exitWait.cancel();
        return { ok: false, error: "unable to stop the existing PTY" };
      }

      const outcome = await exitWait.completion;
      if (outcome === "disposed") {
        return { ok: false, error: "session was disposed during restart" };
      }
      if (outcome !== "exited") {
        return { ok: false, error: "existing PTY did not exit; restart aborted to avoid a duplicate process" };
      }
    }

    return this.spawn()
      ? { ok: true }
      : { ok: false, error: this.admissionRefusal || this.spawnError || "session failed to start", ...(this.admissionRefusal ? { code: "PLAN_REQUIRED" } : null) };
  }

  rename(name) {
    const nextName = String(name || "").trim();
    if (!nextName) return false;
    if (nextName === this.name) return true;
    this.name = nextName;
    this.emit("renamed", { name: nextName });
    return true;
  }

  setAutoStart(enabled) {
    if (typeof enabled !== "boolean") return false;
    if (this.autoStart === enabled) return true;
    this.autoStart = enabled;
    this.emit("autostart", { autoStart: enabled });
    return true;
  }

  definition() {
    return {
      id: this.id,
      name: this.name,
      command: this.command,
      args: [...this.args],
      cwd: this.cwd,
      env: { ...this.env },
      powershellCompatibility: this.powershellCompatibility,
      autoStart: this.autoStart
    };
  }

  reconfigure(definition) {
    if (this._disposed) return { ok: false, error: "session is disposed" };
    if (this.isAlive()) {
      return { ok: false, error: "stop the session before changing its configuration" };
    }
    if (!definition || definition.id !== this.id) {
      return { ok: false, error: "session id cannot be changed" };
    }

    const previous = this.definition();
    const next = {
      id: this.id,
      name: definition.name,
      command: definition.command,
      args: [...definition.args],
      cwd: definition.cwd,
      env: { ...definition.env },
      powershellCompatibility: definition.powershellCompatibility === true,
      autoStart: definition.autoStart !== false
    };
    const fields = ["name", "command", "args", "cwd", "env", "powershellCompatibility", "autoStart"];
    const changedFields = fields.filter(field => !sameConfigurationValue(previous[field], next[field]));
    if (!changedFields.length) {
      return { ok: true, changedFields: [], session: this.summary() };
    }

    this.name = next.name;
    this.command = next.command;
    this.args = next.args;
    this.cwd = next.cwd;
    this.env = next.env;
    this.powershellCompatibility = next.powershellCompatibility;
    this.autoStart = next.autoStart;

    const launchChanged = changedFields.some(field =>
      ["command", "args", "cwd", "env", "powershellCompatibility"].includes(field)
    );
    if (launchChanged) {
      this.lines = [];
      this.spawnError = null;
      this.exitCode = null;
      this.exitSignal = null;
      this.startTime = null;
      this.endTime = null;
      this.lastOutputAt = null;
      this.correlationId = null;
      this.evidence = {};
      this._partialLine = "";
      this._rawReplay.clear();
      this._outputSequence = 0;
      this._inputEvidence = [];
      this._inputEvidenceBuffer = "";
      this._inputEvidenceBytes = 0;
      this._inputCount = 0;
      this.lastInputAt = null;
      this._stopRequested = false;
      this._resetSupervision();
      this._setStatus("idle");
    }

    const session = this.summary();
    this.emit("reconfigured", { changedFields: [...changedFields], session });
    return { ok: true, changedFields, session };
  }

  acknowledgeAttention() {
    if (!this.attentionRequired) return false;
    const previous = this._supervisionSummary();
    const signatures = new Set(this._attentionClaims);
    if (this.attentionReason) signatures.add(errorSignature(this.attentionReason));
    this._acknowledged = { signatures, inputCount: this._inputCount };
    this._attentionClaims = new Set();
    this.activity = null;
    this.attentionRequired = false;
    this.attentionReason = null;
    this.attentionSince = null;
    this.attentionOrigin = null;
    this._emitSupervisionIfChanged(previous);
    return true;
  }

  summary(now = Date.now()) {
    const stop = this.endTime || now;
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      command: this.command,
      args: [...this.args],
      cwd: this.cwd,
      pid: this.proc?.pid ?? null,
      startTime: this.startTime,
      lastOutputAt: this.lastOutputAt,
      lastInputAt: this.lastInputAt,
      inputEvidence: this._inputEvidence.slice(-6).map(item => ({ ...item })),
      correlationId: this.correlationId,
      runtimeMs: this.startTime === null ? 0 : Math.max(0, stop - this.startTime),
      exitCode: this.exitCode,
      exitSignal: this.exitSignal,
      spawnError: this.spawnError,
      evidence: JSON.parse(JSON.stringify(this.evidence)),
      ...this._supervisionSummary(),
      envKeys: Object.keys(this.env),
      powershellCompatibility: this.powershellCompatibility,
      autoStart: this.autoStart,
      isAlive: this.isAlive()
    };
  }

  snapshot() {
    const partial = this._partialLine ? [stripAnsi(this._partialLine)] : [];
    const visibleLines = [...this.lines, ...partial].slice(-SNAPSHOT_LINES);
    return {
      ...this.summary(),
      lines: visibleLines,
      recentLines: visibleLines.slice(-8),
      lastLine: visibleLines.at(-1) || ""
    };
  }

  attachRawStream() {
    if (!this.isAlive()) return null;

    return {
      id: this.id,
      write: (data, options) => this.write(data, options),
      resize: (cols, rows) => this.resize(cols, rows),
      isAlive: () => this.isAlive(),
      replay: () => ({
        ...this._rawReplay.snapshot(),
        throughSequence: this._outputSequence
      }),
      onData: callback => {
        this.on("data", callback);
        return () => this.off("data", callback);
      },
      onExit: callback => {
        this.on("exit", callback);
        return () => this.off("exit", callback);
      }
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.emit("disposed");
    if (this.isAlive()) {
      try {
        this.proc.kill();
      } catch (err) {
        // The process may already be exiting. Disposal still must continue.
      }
    }
    this.proc = null;
    this._disposePtyRegistrations();
    this.removeAllListeners();
  }
}

class SessionEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessions = new Map();
    this.ptyFactory = options.ptyFactory || defaultPtyFactory;
    this._sessionCleanups = new Map();
    // Asked before any process starts, however it was asked to start (autoStart,
    // a click, a recipe, an MCP client). Returns null to allow, or the reason.
    this.spawnGuard = typeof options.spawnGuard === "function" ? options.spawnGuard : null;
    // Recovery gate. When the previous session ended unexpectedly, the engine
    // still loads every worker definition but must not relaunch processes
    // before the operator has seen what was running. This defers the launch
    // only; each worker keeps its saved autoStart preference, so suppressing
    // one boot never rewrites the workspace.
    this.deferAutoStart = options.deferAutoStart === true;
  }

  /**
   * Ends the deferral and starts the workers that would have started at load.
   * Returns the ids actually spawned so the caller can report them.
   */
  releaseAutoStart() {
    this.deferAutoStart = false;
    const started = [];
    for (const session of this.sessions.values()) {
      if (session.autoStart && !session.isAlive()) {
        session.spawn();
        started.push(session.id);
      }
    }
    return started;
  }

  _wireSession(session) {
    const correlated = info => ({ id: session.id, correlationId: session.correlationId, ...info });
    const bindings = [
      ["data", (data, metadata = {}) => this.emit("session:output", correlated({
        data,
        outputSequence: Number.isInteger(metadata.sequence) ? metadata.sequence : null,
        source: metadata.source || "pty",
        at: metadata.at || Date.now()
      }))],
      ["status", info => this.emit("session:status", correlated(info))],
      ["exit", info => this.emit("session:exit", correlated(info))],
      ["spawn-error", info => this.emit("session:spawn-error", correlated(info))],
      ["supervision", info => this.emit("session:supervision", correlated(info))],
      ["evidence", info => this.emit("session:evidence", correlated({ name: session.name, ...info }))],
      ["input-evidence", info => this.emit("session:input-evidence", correlated(info))],
      ["renamed", info => this.emit("session:renamed", correlated(info))],
      ["autostart", info => this.emit("session:autostart", correlated(info))],
      ["reconfigured", info => this.emit("session:reconfigured", correlated(info))]
    ];

    for (const [event, listener] of bindings) session.on(event, listener);
    this._sessionCleanups.set(session.id, () => {
      for (const [event, listener] of bindings) session.off(event, listener);
    });
  }

  create(def) {
    if (!def?.id) throw new Error("session id is required");
    if (this.sessions.has(def.id)) {
      throw new Error(`session id already in use: ${def.id}`);
    }

    const session = new Session(def, { ptyFactory: this.ptyFactory });
    session.admit = candidate => this._admit(candidate);
    this.sessions.set(session.id, session);
    this._wireSession(session);
    this.emit("session:created", { id: session.id, session: session.summary() });
    if (session.autoStart && !this.deferAutoStart) session.spawn();
    else if (session.autoStart) session._setStatus("idle");
    return session;
  }

  _admit(candidate) {
    if (!this.spawnGuard) return null;
    let running = 0;
    for (const session of this.sessions.values()) {
      if (session !== candidate && session.isAlive()) running += 1;
    }
    return this.spawnGuard({ id: candidate.id, name: candidate.name, running }) || null;
  }

  setSpawnGuard(guard) {
    this.spawnGuard = typeof guard === "function" ? guard : null;
  }

  list() {
    return [...this.sessions.values()].map(session => session.summary());
  }

  get(id) {
    return this.sessions.get(id);
  }

  getSnapshot(id) {
    return this.get(id)?.snapshot() || null;
  }

  getDefinition(id) {
    return this.get(id)?.definition() || null;
  }

  write(id, data, options = {}) {
    return this.get(id)?.write(data, options) || false;
  }

  attachRawStream(id) {
    return this.get(id)?.attachRawStream() || null;
  }

  start(id) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.start();
  }

  async restart(id) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.restart();
  }

  async remove(id, timeoutMs = REMOVE_EXIT_TIMEOUT_MS) {
    const stopped = await this.stopForRemoval(id, timeoutMs);
    if (!stopped.ok) return stopped;
    return this.finalizeRemove(id);
  }

  async stopForRemoval(id, timeoutMs = REMOVE_EXIT_TIMEOUT_MS) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };

    if (session.isAlive()) {
      const exitWait = waitForSessionExit(session, timeoutMs);

      if (!session.kill()) {
        exitWait.cancel();
        return { ok: false, error: "unable to stop the existing PTY" };
      }
      const outcome = await exitWait.completion;
      if (outcome === "disposed") {
        return { ok: false, error: "session was disposed during removal" };
      }
      if (outcome !== "exited") {
        return { ok: false, error: "PTY did not exit; removal aborted to avoid losing process ownership" };
      }
    }

    return { ok: true };
  }

  finalizeRemove(id) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    if (session.isAlive()) {
      return { ok: false, error: "cannot finalize removal while the PTY is still running" };
    }

    this._sessionCleanups.get(id)?.();
    this._sessionCleanups.delete(id);
    session.dispose();
    this.sessions.delete(id);
    this.emit("session:removed", { id });
    return { ok: true };
  }

  kill(id) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.kill()
      ? { ok: true }
      : { ok: false, error: "session is not running or could not be killed" };
  }

  rename(id, name) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.rename(name)
      ? { ok: true }
      : { ok: false, error: "name cannot be empty" };
  }

  setAutoStart(id, enabled) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.setAutoStart(enabled)
      ? { ok: true }
      : { ok: false, error: "autoStart must be a boolean" };
  }

  reconfigure(id, definition) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.reconfigure(definition);
  }

  acknowledge(id) {
    const session = this.get(id);
    if (!session) return { ok: false, error: `no such session: ${id}` };
    return session.acknowledgeAttention()
      ? { ok: true }
      : { ok: false, error: "session does not currently need attention" };
  }

  resize(id, cols, rows) {
    return this.get(id)?.resize(cols, rows) || false;
  }

  async stopAll(timeoutMs = SHUTDOWN_EXIT_TIMEOUT_MS) {
    const activeSessions = [...this.sessions.values()].filter(session => session.isAlive());
    const outcomes = await Promise.all(activeSessions.map(async session => {
      const exitWait = waitForSessionExit(session, timeoutMs);
      if (!session.kill()) {
        exitWait.cancel();
        return { id: session.id, outcome: "kill-failed" };
      }
      return { id: session.id, outcome: await exitWait.completion };
    }));
    const pendingIds = outcomes
      .filter(result => result.outcome !== "exited" && result.outcome !== "disposed")
      .map(result => result.id);
    return pendingIds.length ? { ok: false, pendingIds } : { ok: true, pendingIds: [] };
  }

  dispose() {
    for (const [id, session] of this.sessions) {
      this._sessionCleanups.get(id)?.();
      session.dispose();
    }
    this._sessionCleanups.clear();
    this.sessions.clear();
    this.removeAllListeners();
  }
}

module.exports = {
  Session,
  SessionEngine,
  MAX_BUFFERED_LINES,
  SNAPSHOT_LINES,
  REMOVE_EXIT_TIMEOUT_MS,
  SHUTDOWN_EXIT_TIMEOUT_MS,
  resolveLaunch,
  RawReplayBuffer,
  MAX_RAW_REPLAY_BYTES
};
