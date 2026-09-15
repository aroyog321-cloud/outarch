"use strict";

// Local CLI usage import.
//
// Mission AI's own requests are metered at the network boundary, but the agent
// CLIs running inside terminals authenticate themselves and never pass through
// this app. What they do leave behind is a local transcript. This reads the
// numeric usage out of those transcripts and nothing else.
//
// What is deliberately NOT read: prompts, responses, tool arguments, file
// contents, environment, credentials. Only counts, model ids and the identifiers
// needed to deduplicate are projected out of each line; everything else in the
// record is discarded at parse time rather than filtered later.
//
// Format reference (Claude Code): ~/.claude/projects/<encoded-project>/<session>.jsonl,
// one JSON object per line, token counts at message.usage.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// A transcript can be very large and is appended to constantly, so a full
// re-read on every import would be wasteful and would re-count everything.
const MAX_LINE_BYTES = 256 * 1024;
const MAX_FILES_PER_SCAN = 400;
const MAX_BYTES_PER_FILE = 32 * 1024 * 1024;

/**
 * Claude Code records output_tokens as a placeholder (1 or 2) rather than the
 * real value on assistant lines. Treating that as truth would under-report cost
 * by orders of magnitude, so a suspicious pair is recorded as unknown output
 * rather than as a number this app cannot stand behind.
 *
 * Upstream: anthropics/claude-code issue #25941.
 */
function outputTokensAreTrustworthy(inputTokens, outputTokens) {
  if (typeof outputTokens !== "number") return false;
  if (outputTokens > 2) return true;
  // A genuine 1-2 token completion is possible, but not after a substantial
  // prompt — that combination is the known placeholder.
  return !(typeof inputTokens === "number" && inputTokens > 100);
}

function readCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

/**
 * Claude Code encodes the project directory into the folder name by replacing
 * each non-alphanumeric character with a dash — one dash per character, not one
 * per run. A Windows path keeps the doubled dash from its drive colon and
 * separator ("D:\work" becomes "D--work"), and a POSIX path keeps the leading
 * dash from its root. Collapsing runs here would silently fail to match any real
 * folder. The transform is lossy, so it is only ever compared against a known
 * path, never used to reconstruct one.
 */
function encodeProjectPath(projectPath) {
  return String(projectPath || "").replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Projects one transcript line down to the numeric usage record. Returns null
 * for any line that is not an assistant turn carrying usage.
 */
function projectUsageLine(line, { provider = "claude", sessionId = null } = {}) {
  if (typeof line !== "string" || line.length > MAX_LINE_BYTES) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;

  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    // A partially written last line is normal while a CLI is running.
    return null;
  }
  if (!entry || entry.type !== "assistant") return null;

  const usage = entry.message?.usage;
  if (!usage || typeof usage !== "object") return null;

  const input = readCount(usage.input_tokens);
  const rawOutput = readCount(usage.output_tokens);
  const cacheRead = readCount(usage.cache_read_input_tokens);
  const cacheWrite = readCount(usage.cache_creation_input_tokens);
  if (input === null && rawOutput === null && cacheRead === null && cacheWrite === null) return null;

  const outputTrusted = outputTokensAreTrustworthy(input, rawOutput);

  return {
    // Deduplication key. Every entry carries a uuid; the message id is used as a
    // fallback so a transcript written by an older CLI still deduplicates.
    sourceEventId: entry.uuid || entry.message?.id || null,
    provider,
    model: typeof entry.message?.model === "string" ? entry.message.model : null,
    source: "local-import",
    agentSessionId: entry.sessionId || sessionId,
    at: Date.parse(entry.timestamp) || Date.now(),
    outcome: "success",
    tokens: {
      input,
      output: outputTrusted ? rawOutput : null,
      cacheRead,
      cacheWrite,
      reasoning: null
    },
    // Cached prompt tokens are reported separately from input by this provider,
    // so the two buckets do not overlap.
    countSemantics: "disjoint",
    coverage: outputTrusted ? "complete" : "partial",
    // Recorded so the UI can explain a partial total rather than just showing a
    // smaller number than the person expects.
    unreliableFields: outputTrusted ? [] : ["output"]
  };
}

class CliUsageImporter {
  #ledger;
  #roots;
  #seen;
  #offsets;
  #readFile;
  #readDir;
  #statFile;

  constructor(options = {}) {
    this.#ledger = options.ledger || null;
    // Injectable so the scan can be tested against a fixture tree.
    this.#roots = options.roots || [
      { provider: "claude", dir: path.join(os.homedir(), ".claude", "projects") }
    ];
    this.#readFile = options.readFile || fs.readFileSync;
    this.#readDir = options.readDir || fs.readdirSync;
    this.#statFile = options.statFile || fs.statSync;
    // Deduplication across repeated scans. A transcript is appended to, so the
    // same lines are seen again on every import.
    this.#seen = new Set();
    this.#offsets = new Map();
  }

  #listTranscripts(root) {
    const files = [];
    let projectDirs = [];
    try {
      projectDirs = this.#readDir(root.dir, { withFileTypes: true });
    } catch {
      // No CLI history for this provider on this machine, which is not an error.
      return files;
    }
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;
      const fullDir = path.join(root.dir, projectDir.name);
      let entries = [];
      try {
        entries = this.#readDir(fullDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        files.push({
          provider: root.provider,
          encodedProject: projectDir.name,
          sessionId: entry.name.replace(/\.jsonl$/, ""),
          filePath: path.join(fullDir, entry.name)
        });
        if (files.length >= MAX_FILES_PER_SCAN) return files;
      }
    }
    return files;
  }

  /**
   * Reads any transcript content that has appeared since the last scan and
   * records its usage. Returns a summary rather than the records themselves,
   * because the records belong in the ledger and nowhere else.
   */
  import({ projectId = null, projectPath = null } = {}) {
    const wanted = projectPath ? encodeProjectPath(projectPath) : null;
    const summary = {
      filesScanned: 0,
      recordsImported: 0,
      duplicatesSkipped: 0,
      partialRecords: 0,
      providers: new Set()
    };

    for (const root of this.#roots) {
      for (const transcript of this.#listTranscripts(root)) {
        // Attribution is only claimed when the transcript's own directory says
        // it belongs to this project. Anything else is recorded unassigned
        // rather than credited to whichever project happens to be open.
        const belongsHere = wanted !== null && transcript.encodedProject.toLowerCase() === wanted.toLowerCase();

        let size = 0;
        try {
          size = this.#statFile(transcript.filePath).size;
        } catch {
          continue;
        }
        const previous = this.#offsets.get(transcript.filePath) || 0;
        // A file that shrank was rotated or truncated; re-read it from the start
        // and let the id set stop anything already counted.
        const start = size < previous ? 0 : previous;
        if (size === previous) continue;
        if (size > MAX_BYTES_PER_FILE && start === 0) {
          this.#offsets.set(transcript.filePath, size);
          continue;
        }

        let content = "";
        try {
          content = this.#readFile(transcript.filePath, "utf8");
        } catch {
          continue;
        }
        this.#offsets.set(transcript.filePath, size);
        summary.filesScanned += 1;

        const lines = start > 0 ? content.slice(start).split("\n") : content.split("\n");
        for (const line of lines) {
          const record = projectUsageLine(line, {
            provider: transcript.provider,
            sessionId: transcript.sessionId
          });
          if (!record) continue;
          const key = record.sourceEventId
            ? `${transcript.provider}:${record.sourceEventId}`
            : `${transcript.filePath}:${record.at}:${record.tokens.input}`;
          if (this.#seen.has(key)) {
            summary.duplicatesSkipped += 1;
            continue;
          }
          this.#seen.add(key);

          if (record.coverage === "partial") summary.partialRecords += 1;
          summary.providers.add(transcript.provider);
          summary.recordsImported += 1;

          this.#ledger?.record({
            ...record,
            projectId: belongsHere ? projectId : null,
            attribution: belongsHere ? "explicit" : "unassigned"
          });
        }
      }
    }

    return { ...summary, providers: [...summary.providers] };
  }
}

module.exports = {
  CliUsageImporter,
  projectUsageLine,
  encodeProjectPath,
  outputTokensAreTrustworthy
};
