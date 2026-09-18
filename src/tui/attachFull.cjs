const ESC_BYTE = 0x1b;
const CTRL_BACKSLASH_BYTE = 0x1c;
const CTRL_RIGHT_BRACKET_BYTE = 0x1d;
const ESCAPE_WINDOW_MS = 500;
const WINDOWS_REDRAW_SETTLE_MS = 60;
const MAX_QUEUED_ATTACH_BYTES = 1024 * 1024;
const HOST_INPUT_MODES = ["\x1b[?9001h", "\x1b[?9001l", "\x1b[?1004h", "\x1b[?1004l"];
const WINDOWS_INPUT_MODE_OFF = "\x1b[?9001l\x1b[?1004l";

function asBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
}

function sanitizeHostOutput(data) {
  return String(data).replace(/\x1b\[\?(?:9001|1004)[hl]/g, "");
}

function createHostOutputSanitizer() {
  let carry = "";
  return data => {
    let output = sanitizeHostOutput(carry + String(data));
    carry = "";
    const maxPrefix = Math.max(...HOST_INPUT_MODES.map(mode => mode.length - 1));
    for (let length = Math.min(maxPrefix, output.length); length > 0; length--) {
      const suffix = output.slice(-length);
      if (HOST_INPUT_MODES.some(mode => mode.startsWith(suffix))) {
        carry = suffix;
        output = output.slice(0, -length);
        break;
      }
    }
    return output;
  };
}

function createDetachInputHandler({ forward, detach, escapeWindowMs = ESCAPE_WINDOW_MS }) {
  let pendingEscape = false;
  let escapeTimer = null;
  let closed = false;

  const clearEscapeTimer = () => {
    if (escapeTimer) clearTimeout(escapeTimer);
    escapeTimer = null;
  };

  const flushPendingEscape = () => {
    if (!pendingEscape || closed) return;
    pendingEscape = false;
    escapeTimer = null;
    forward(Buffer.from([ESC_BYTE]));
  };

  const requestDetach = () => {
    clearEscapeTimer();
    pendingEscape = false;
    detach();
  };

  const onData = chunk => {
    if (closed) return;
    const data = asBuffer(chunk);
    if (data.length === 0) return;

    if (pendingEscape) {
      clearEscapeTimer();
      pendingEscape = false;
      if (data[0] === ESC_BYTE) {
        requestDetach();
        return;
      }
      forward(Buffer.concat([Buffer.from([ESC_BYTE]), data]));
      return;
    }

    const controlDetachIndex = data.findIndex(
      byte => byte === CTRL_RIGHT_BRACKET_BYTE || byte === CTRL_BACKSLASH_BYTE
    );
    if (controlDetachIndex !== -1) {
      if (controlDetachIndex > 0) forward(data.subarray(0, controlDetachIndex));
      requestDetach();
      return;
    }

    if (data.length >= 2 && data[0] === ESC_BYTE && data[1] === ESC_BYTE) {
      requestDetach();
      return;
    }

    if (data.length === 1 && data[0] === ESC_BYTE) {
      pendingEscape = true;
      escapeTimer = setTimeout(flushPendingEscape, escapeWindowMs);
      return;
    }

    forward(data);
  };

  const close = () => {
    closed = true;
    clearEscapeTimer();
    pendingEscape = false;
  };

  return { onData, close };
}

async function attachFull(engineApi, sessionId, io = {}) {
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  const signal = io.signal;
  const redrawSettleMs = io.redrawSettleMs ?? (process.platform === "win32" ? WINDOWS_REDRAW_SETTLE_MS : 0);
  const stream = engineApi.attachRawStream(sessionId);

  if (!stream) {
    return { attached: false, reason: "session is not running" };
  }

  const snapshot = engineApi.getSnapshot(sessionId);
  let offData = () => {};
  let offExit = () => {};
  let finished = false;
  let attachError = null;
  let liveOutput = false;
  const queuedOutput = [];
  let queuedOutputBytes = 0;
  const sanitizeLiveOutput = createHostOutputSanitizer();
  const wasRaw = Boolean(stdin.isRaw);
  const wasPaused = typeof stdin.isPaused === "function" ? stdin.isPaused() : false;

  let resolveAttach;
  const completion = new Promise(resolve => {
    resolveAttach = resolve;
  });

  const recordAttachError = err => {
    if (!attachError) {
      attachError = err instanceof Error ? (err.stack || err.message) : String(err);
    }
  };

  const resize = () => {
    const cols = Number.isInteger(stdout.columns) ? stdout.columns : 120;
    const rows = Number.isInteger(stdout.rows) ? stdout.rows : 30;
    stream.resize(cols, rows);
  };

  const restoreInput = () => {
    stdin.off("data", inputHandler.onData);
    stdout.off?.("resize", resize);
    signal?.removeEventListener("abort", onAbort);
    inputHandler.close();

    if (typeof stdin.setRawMode === "function" && stdin.isRaw !== wasRaw) {
      try {
        stdin.setRawMode(wasRaw);
      } catch (err) {
        // Some Windows terminal hosts tear down raw mode before cleanup.
      }
    }
    if (wasPaused && typeof stdin.pause === "function") stdin.pause();
  };

  const finish = reason => {
    if (finished) return;
    finished = true;
    for (const cleanup of [offData, offExit, restoreInput]) {
      try {
        cleanup();
      } catch (err) {
        recordAttachError(err);
      }
    }
    try {
      stdout.write(`${WINDOWS_INPUT_MODE_OFF}\x1b[?25h\r\n[Returning to OUTARCH]\r\n`);
    } catch (err) {
      recordAttachError(err);
    }
    resolveAttach({
      attached: true,
      reason,
      ...(attachError ? { error: attachError } : {})
    });
  };

  const inputHandler = createDetachInputHandler({
    forward: data => stream.write(data),
    detach: () => finish("detached")
  });
  const onAbort = () => finish("aborted");

  try {
    const removeData = stream.onData(data => {
      if (liveOutput) {
        try {
          stdout.write(sanitizeLiveOutput(data));
        } catch (err) {
          recordAttachError(err);
          finish("attach-error");
        }
        return;
      }
      const text = String(data);
      queuedOutput.push(text);
      queuedOutputBytes += Buffer.byteLength(text);
      while (queuedOutputBytes > MAX_QUEUED_ATTACH_BYTES && queuedOutput.length > 1) {
        queuedOutputBytes -= Buffer.byteLength(queuedOutput.shift());
      }
    });
    offData = typeof removeData === "function" ? removeData : () => {};
    const removeExit = stream.onExit(() => finish("session-exited"));
    offExit = typeof removeExit === "function" ? removeExit : () => {};
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      finish("aborted");
      return completion;
    }

    // Match the child screen buffer to the real host terminal before replay.
    // PowerShell/PSReadLine renders with cursor-relative updates, so replaying
    // a 120-column buffer into a wider terminal corrupts later command lines.
    resize();
    if (redrawSettleMs > 0) {
      await new Promise(resolve => setTimeout(resolve, redrawSettleMs));
      if (finished) return completion;
    }

    stdout.write("\x1b[2J\x1b[H");
    const replay = typeof stream.replay === "function" ? stream.replay() : null;
    const rawReplay = typeof replay === "string" ? replay : replay?.data || "";
    const replayComplete = typeof replay === "string" || replay?.complete !== false;
    if (rawReplay && replayComplete) {
      // Reconstruct the exact ConPTY screen, including PSReadLine's cursor
      // controls. Replaying stripped snapshot lines leaves PowerShell's
      // internal cursor state out of sync and corrupts subsequent input.
      stdout.write(sanitizeHostOutput(rawReplay));
    } else if (snapshot?.lines?.length) {
      stdout.write(`${snapshot.lines.join("\r\n")}\r\n`);
    }
    liveOutput = true;
    const pendingOutput = queuedOutput.splice(0);
    // When replay is available it already contains everything queued between
    // subscription and this point. Writing the queue too would duplicate it.
    if (!rawReplay || !replayComplete) {
      for (const data of pendingOutput) stdout.write(sanitizeLiveOutput(data));
    }

    stdout.on?.("resize", resize);
    stdin.on("data", inputHandler.onData);
    if (typeof stdin.setRawMode === "function" && !stdin.isRaw) {
      stdin.setRawMode(true);
    }
    // Ink unrefs stdin when its UI is unmounted. Full Attach must take
    // ownership back or an otherwise idle Node process can exit immediately
    // on Windows even though this completion promise is still pending.
    if (typeof stdin.ref === "function") stdin.ref();
    if (typeof stdin.resume === "function") stdin.resume();
  } catch (err) {
    recordAttachError(err);
    finish("attach-error");
  }

  return completion;
}

module.exports = {
  attachFull,
  createDetachInputHandler,
  ESC_BYTE,
  CTRL_BACKSLASH_BYTE,
  CTRL_RIGHT_BRACKET_BYTE,
  WINDOWS_INPUT_MODE_OFF,
  sanitizeHostOutput,
  createHostOutputSanitizer
};
