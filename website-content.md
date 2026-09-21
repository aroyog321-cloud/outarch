# OUTARCH — Product Website Copy & Content Blueprint

---

## 1. Hero Section

### Tagline / Kicker
`LOCAL-FIRST DEVELOPER COMMAND CENTER & SUPERVISION COCKPIT`

### Main Headline (H1)
# Stop Watching Logs. Supervise by Exception.

### Sub-headline
> **OUTARCH** gives developers and autonomous AI agents a high-performance native PTY cockpit. It orchestrates dev servers, databases, containers, and agent workflows—analyzing process streams in real-time and alerting you **only** when your judgment is required.

### Action Buttons (CTAs)
- **Primary CTA:** `Download for Windows (Preview)`
- **Secondary CTA:** `Explore the Architecture & Documentation`
- **Tertiary CTA / Command Badge:** `npm install -g termctl-tui`

### Key Social Proof / Highlights Strip
- ⚡ **Zero-Latency PTY Engine:** Native ConPTY / node-pty session persistence.
- 🛡️ **Needs You Decision Room:** Critical alerts only; never miss a port collision or crash.
- 🤖 **AI Agent Gateway:** Supervise Claude Code, Codex, and Gemini with single-use approval tokens.
- 🔒 **100% Local & Encrypted:** Zero telemetry, local SQLite/JSON state, OS-encrypted keys.

---

## 2. The Problem vs. The Solution

| The Old Way (Chaos) | The OUTARCH Way (Command) |
| :--- | :--- |
| **Fragmented Terminal Sprawl:** 10+ tabs/windows open for frontend, backend, docker, and tests. | **Unified Tiled Canvas:** 1-, 2-, 4-, 6-pane monospace grids + dynamic auto-fitting mosaic layouts. |
| **Log Staring Fatigue:** Wasting time reading hundreds of lines of scrolling terminal logs. | **Automated Evidence Classification:** Stream parsers detect open ports, URLs, passing tests, and git state. |
| **Silent Crashes:** A dev server fails or errors silently; you discover it 10 minutes later. | **CrashLens & Instant Remediation:** Stderr crashes trigger actionable toasts and 1-click port/process restarts. |
| **Unsupervised AI Agents:** External agents executing rogue commands or silent loops. | **Trust Boundaries & Approval Tokens:** Every file mutation or destructive command requires explicit approval. |
| **Manual Multi-Step Boot:** Manually starting DB, running migrations, booting API, and starting UI. | **Workspace Recipes (DAGs):** 1-Click startup DAGs with parallel readiness gates and recovery routines. |

---

## 3. Core Feature Showcases

### Feature 1: The Multi-Terminal Canvas
**Headline:** Monospace Ergonomics Tuned for Modern Engineering  
**Body:**
Switch seamlessly between single-focus, split horizontal/vertical, 2x2 grid, 3x2 grid, or an intelligent auto-packed mosaic layout.
- **Draggable Splitters:** Adjust widths and heights with pixel-perfect snap or double-click to auto-even.
- **Fullscreen Focus Mode (`Alt + F`):** Instantly strip away chrome and sidebar for pure terminal immersion.
- **Pop-out Windows:** Detach any terminal into a standalone native OS window with one click.
- **In-Canvas Browser (`Alt + B`):** Preview web apps side-by-side with your code without leaving the cockpit.

---

### Feature 2: "Needs You" Decision Room
**Headline:** Triage Issues in Seconds with Evidence-Backed Decisions  
**Body:**
OUTARCH doesn't spam you with notifications. It routes critical blockers to a dedicated decision queue where evidence precedes action.
- **Root-Cause Evidence:** Direct access to the failing stderr line, occupied port, or agent diff.
- **Consequence Analysis:** Explains what happens before you click *Restart*, *Stop*, or *Approve*.
- **Single-Click Actions:** 1-Click to restart crashed workers, dismiss alerts, inspect ports, or snooze for 15 minutes.

---

### Feature 3: CrashLens & Local Port Intelligence
**Headline:** Instant Diagnostics for `EADDRINUSE`, Syntax Errors, and OOMs  
**Body:**
When a worker crashes, CrashLens inspects terminal output and offers automated remediation.
- **Port Collision Inspector:** Identifies the exact PID holding your port. If it’s another OUTARCH worker, stop it with one click; if it’s an external app, view its system process details.
- **1-Click AI Diagnosis:** Send the crash log directly to Mission AI to get an instant fix.

---

### Feature 4: Workspace Recipes & DAG Startup Stacks
**Headline:** Launch Complex Microservice Environments in Perfect Dependency Order  
**Body:**
Stop running fragile shell scripts to start your project. Workspace Recipes manage multi-process startups with strict readiness gates.
- **Readiness Checks:** Wait for PostgreSQL on port `5432` before starting the backend API; wait for HTTP `200 OK` on `/health` before launching the frontend.
- **Automated DAG Recovery:** If step 3 fails, fix the issue and click **Recover**—OUTARCH re-executes only the failed steps.
- **AI Recipe Designer:** Ask Mission AI to examine your repository and automatically build a ready-to-run recipe.

---

### Feature 5: Multi-Model AI Assistant & Secure MCP Gateway
**Headline:** Connect Any LLM Directly to Your Live Terminal State  
**Body:**
Supervise autonomous AI agents and ask questions about your running processes.
- **Bring Your Own Keys (BYOK):** Connect Gemini, OpenAI, Anthropic, OpenRouter, Groq, NVIDIA NIM, or Local Ollama with OS-level credential encryption.
- **Secure Model Context Protocol (MCP):** Expose your terminal state and logs safely to Claude Code, Cursor, and Codex through fine-grained capability grants and one-time approvals.
- **Broadcast Bar (`Ctrl + Shift + B`):** Securely send synchronized commands across multiple terminals with automated secret redaction.

---

### Feature 6: Ecosystem Bridges (VS Code & Mobile Companion)
**Headline:** Seamless Integration with Your Existing Tools  
**Body:**
- **VS Code Extension Bridge:** Synchronize active file context, line/col numbers, diagnostics, Git ahead/behind counts, and managed editor terminals.
- **Android Mobile Companion:** Monitor builds, receive push alerts on your phone over local LAN with cryptographic key exchange (X25519, HKDF-SHA256, AES-256-GCM), and approve decisions with biometrics.

---

## 4. Technical Specifications & Architecture

- **Engine Core:** Node.js 20+ / ConPTY (Windows) / native pseudo-terminal subsystem.
- **Desktop Frontend:** Electron 40 / React 18 / Radix UI / `@xterm/xterm` 6.0 / Tailwind CSS.
- **TUI Client:** Ink 4 / React terminal rendering.
- **Telemetry Policy:** 100% Zero-Telemetry. No tracking, no external pings, no cloud telemetry.
- **Security & Privacy:**
  - OS-level encrypted credentials (DPAPI on Windows / Keychain / Secret Service).
  - Terminal stream secret sanitization (automatic `[REDACTED]` for API keys, passwords, and bearer tokens).
  - Destructive action reconciliation and sandbox boundaries.

---

## 5. Frequently Asked Questions (FAQ)

#### Q: How is OUTARCH different from Windows Terminal or iTerm2?
**A:** Standard terminal emulators are passive shells—they display text and do nothing else. OUTARCH is an active supervision engine that owns native PTY sessions, analyzes logs in real-time, extracts structured metrics (ports, tests, git, memory), detects crashes, and automates multi-process workflows with DAG dependency graphs.

#### Q: Does OUTARCH send my code or terminal output to the cloud?
**A:** Never. OUTARCH is 100% local-first. Terminal output and project state never leave your machine. When using AI features, API calls go directly to the provider whose API key you configured, and credentials are encrypted using your OS keychain.

#### Q: Can I run AI coding agents like Claude Code or Codex inside OUTARCH?
**A:** Yes. OUTARCH provides a native Secure MCP Gateway and specialized AI agent supervision that tracks agent phases, tool calls, and requests your explicit approval before any command or file change is executed.

#### Q: Does my process keep running if I close the Groundstation window?
**A:** Yes. The authoritative `SessionEngine` manages processes in background PTYs. You can close and reopen Groundstation or switch between the Desktop UI and the TUI without interrupting running jobs.

---

## 6. Final Call to Action (CTA)

### Headline
### Ready to Supervise Your Workspace with Total Confidence?

### Subhead
Download OUTARCH today and transform how you build, run, and supervise modern applications and AI agents.

```bash
# Quick Launch via CLI
npm install -g termctl-tui
termctl
```
