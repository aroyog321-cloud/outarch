"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const {
  CliUsageImporter,
  projectUsageLine,
  encodeProjectPath,
  outputTokensAreTrustworthy
} = require("../src/service/usageCliImport.cjs");
const { UsageLedger } = require("../src/service/usageLedger.cjs");

const assistantLine = (overrides = {}) => JSON.stringify({
  type: "assistant",
  uuid: overrides.uuid || "evt-1",
  sessionId: "sess-1",
  timestamp: "2026-09-08T10:00:00.000Z",
  message: {
    id: "msg_1",
    model: overrides.model || "claude-opus-5",
    usage: {
      input_tokens: overrides.input ?? 1500,
      output_tokens: overrides.output ?? 420,
      cache_read_input_tokens: overrides.cacheRead ?? 200,
      cache_creation_input_tokens: overrides.cacheWrite ?? 0
    },
    // Content must never be projected out; it is here to prove it is dropped.
    content: [{ type: "text", text: "SECRET ANSWER TEXT" }]
  }
});

test("a transcript line yields counts and identity, and no content whatsoever", () => {
  const record = projectUsageLine(assistantLine());
  assert.equal(record.tokens.input, 1500);
  assert.equal(record.tokens.output, 420);
  assert.equal(record.tokens.cacheRead, 200);
  assert.equal(record.model, "claude-opus-5");
  assert.equal(record.sourceEventId, "evt-1");
  assert.equal(record.source, "local-import");

  // Nothing derived from the message body may survive the projection.
  assert.equal(JSON.stringify(record).includes("SECRET ANSWER TEXT"), false);
  assert.equal("content" in record, false);
});

test("the known placeholder output_tokens bug is recorded as unknown, not as 1 token", () => {
  // anthropics/claude-code#25941: output_tokens is written as 1-2 regardless of
  // the real completion size. Trusting it would under-report cost enormously.
  const record = projectUsageLine(assistantLine({ input: 24_000, output: 1 }));
  assert.equal(record.tokens.input, 24_000);
  assert.equal(record.tokens.output, null, "a placeholder is unknown, never a real count");
  assert.equal(record.coverage, "partial");
  assert.deepEqual(record.unreliableFields, ["output"]);

  // A genuinely tiny completion after a tiny prompt is still believable.
  const honest = projectUsageLine(assistantLine({ input: 40, output: 2 }));
  assert.equal(honest.tokens.output, 2);
  assert.equal(honest.coverage, "complete");
});

test("outputTokensAreTrustworthy separates a real short reply from the placeholder", () => {
  assert.equal(outputTokensAreTrustworthy(50, 2), true);
  assert.equal(outputTokensAreTrustworthy(9000, 1), false);
  assert.equal(outputTokensAreTrustworthy(9000, 850), true);
  assert.equal(outputTokensAreTrustworthy(100, null), false);
});

test("non-assistant lines, partial lines and noise are ignored", () => {
  assert.equal(projectUsageLine(JSON.stringify({ type: "user", message: { content: "hi" } })), null);
  assert.equal(projectUsageLine(JSON.stringify({ type: "assistant", message: {} })), null);
  assert.equal(projectUsageLine('{"type":"assistant","message":{"usage":{'), null, "a half-written line is normal");
  assert.equal(projectUsageLine(""), null);
  assert.equal(projectUsageLine("not json at all"), null);
});

function fixtureImporter(files, ledger) {
  const dirs = new Map();
  const contents = new Map();
  for (const [filePath, body] of Object.entries(files)) {
    contents.set(filePath, body);
    const dir = path.dirname(filePath);
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push({ name: path.basename(filePath), isFile: () => true, isDirectory: () => false });
  }
  const root = "/home/dev/.claude/projects";
  const projectDirs = [...new Set([...contents.keys()].map(file => path.basename(path.dirname(file))))]
    .map(name => ({ name, isFile: () => false, isDirectory: () => true }));

  return new CliUsageImporter({
    ledger,
    roots: [{ provider: "claude", dir: root }],
    readDir: dir => (dir === root ? projectDirs : dirs.get(dir) || []),
    readFile: file => contents.get(file) ?? "",
    statFile: file => ({ size: Buffer.byteLength(contents.get(file) ?? "", "utf8") }),
    setContent: (file, body) => contents.set(file, body)
  });
}

test("an import records usage once and skips it on a re-scan", () => {
  const ledger = new UsageLedger();
  const file = path.join("/home/dev/.claude/projects", "D--work-acme", "sess-1.jsonl");
  const importer = fixtureImporter({
    [file]: `${assistantLine({ uuid: "a" })}\n${assistantLine({ uuid: "b", input: 900, output: 300 })}\n`
  }, ledger);

  const first = importer.import({ projectId: "proj-1", projectPath: "D:\\work\\acme" });
  assert.equal(first.recordsImported, 2);
  assert.equal(ledger.getAggregate().callCount, 2);

  // Nothing changed on disk, so a second scan imports nothing new.
  const second = importer.import({ projectId: "proj-1", projectPath: "D:\\work\\acme" });
  assert.equal(second.recordsImported, 0);
  assert.equal(ledger.getAggregate().callCount, 2, "a re-scan must not double-count");
});

test("usage is attributed to the project only when the transcript belongs to it", () => {
  const ledger = new UsageLedger();
  const mine = path.join("/home/dev/.claude/projects", "D--work-acme", "sess-1.jsonl");
  const other = path.join("/home/dev/.claude/projects", "D--work-somethingelse", "sess-2.jsonl");
  const importer = fixtureImporter({
    [mine]: `${assistantLine({ uuid: "mine" })}\n`,
    [other]: `${assistantLine({ uuid: "theirs" })}\n`
  }, ledger);

  importer.import({ projectId: "proj-1", projectPath: "D:\\work\\acme" });

  const scoped = ledger.getAggregate({ projectId: "proj-1" });
  assert.equal(scoped.callCount, 1, "only this project's transcript is credited to it");
  assert.equal(ledger.getAggregate().callCount, 2, "the other one is still recorded, unassigned");
});

test("encodeProjectPath matches the CLI's folder naming for comparison", () => {
  // One dash per character, not one per run: the POSIX root keeps its leading
  // dash, and a Windows drive keeps the doubled dash from ":" plus separator.
  assert.equal(encodeProjectPath("/Users/you/code/my-app"), "-Users-you-code-my-app");
  assert.equal(encodeProjectPath("D:\\work\\acme"), "D--work-acme");
});

test("a partially reported import reaches the ledger as partial coverage, not as cheap", () => {
  const ledger = new UsageLedger();
  const file = path.join("/home/dev/.claude/projects", "D--work-acme", "sess-1.jsonl");
  const importer = fixtureImporter({
    [file]: `${assistantLine({ uuid: "placeholder", input: 30_000, output: 1 })}\n`
  }, ledger);

  const summary = importer.import({ projectId: "proj-1", projectPath: "D:\\work\\acme" });
  assert.equal(summary.partialRecords, 1);

  const totals = ledger.getAggregate({ projectId: "proj-1" });
  assert.equal(totals.callCount, 1);
  assert.equal(totals.breakdown.input, 30_000);
  assert.equal(totals.breakdown.output, 0, "an unknown output contributes nothing rather than a wrong number");
});
