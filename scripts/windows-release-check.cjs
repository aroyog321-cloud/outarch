"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function result(name, ok, detail) { return { name, ok: ok === true, detail: String(detail || "") }; }
function runPty(pty, shell, args, expected) {
  return new Promise(resolve => {
    let output = ""; let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => finish(result(shell, false, "ConPTY smoke test timed out")), 8000);
    let processHandle;
    try { processHandle = pty.spawn(shell, args, { name: "xterm-256color", cols: 100, rows: 30, cwd: root, env: { ...process.env } }); }
    catch (error) { finish(result(shell, false, error.message)); return; }
    processHandle.onData(data => { output += data; if (output.length > 64 * 1024) output = output.slice(-64 * 1024); });
    processHandle.onExit(({ exitCode }) => {
      const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      finish(result(shell, exitCode === 0 && clean.includes(expected), exitCode === 0 ? clean.includes(expected) ? "ConPTY output, Unicode, and exit verified" : "Expected output was missing" : `Exited with code ${exitCode}`));
    });
    try { processHandle.resize(112, 34); } catch {}
  });
}

async function main() {
  if (process.platform !== "win32") throw new Error("Windows release acceptance must run on Windows 11");
  const checks = [];
  // Electron's installer needs 22.12 or newer (it require()s an ES module).
  const [major, minor] = process.versions.node.split(".").map(Number);
  checks.push(result("Node.js LTS", major === 22 && minor >= 12, `Node ${process.versions.node}`));
  const renderer = path.join(root, "dist", "groundstation", "renderer", "index.html");
  checks.push(result("Production renderer", fs.existsSync(renderer), fs.existsSync(renderer) ? "Built renderer found" : "Run npm run groundstation:build"));
  let pty;
  try { pty = require("node-pty"); checks.push(result("node-pty native module", typeof pty.spawn === "function", "Native PTY module loaded")); }
  catch (error) { checks.push(result("node-pty native module", false, error.message)); }
  if (pty) {
    const marker = "MC_CONPTY_OK_✓";
    checks.push(await runPty(pty, process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `echo ${marker}`], marker));
    checks.push(await runPty(pty, "powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Write-Output '${marker}'`], marker));
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: "win32",
    architecture: process.arch,
    node: process.versions.node,
    electron: process.versions.electron || null,
    checks,
    passed: checks.every(check => check.ok)
  };
  const reportPath = path.join(root, "windows-acceptance-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
  console.log(`\nReport: ${reportPath}`);
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => { console.error(`FAIL  ${error.message}`); process.exitCode = 1; });
