# OUTARCH data inventory

Internal record of every kind of data OUTARCH touches: where it lives, why,
who can reach it and how long it is kept. The public policies
(`src/groundstation/renderer/legal/outarchPolicies.js`) are written from this
table. Update both together when a feature changes what it collects or sends.

Last reviewed: 2026-09-23 (against the code in this repository).

## Held by OUTARCH (Supabase project `qswiqzootfwkbbbvhfyj`, Mumbai)

| Data | Table / place | Why | Who can read it | Retention |
| --- | --- | --- | --- | --- |
| Email, sign-in identity | `auth.users` (Supabase Auth) | Account and sign-in | The user; admins via dashboard | Account lifetime |
| Name, avatar (Google sign-in only) | `profiles` | Account display | The user (RLS); admins | Account lifetime |
| Plan, start/end | `subscriptions` | Plan limits | The user (RLS); admins | Account lifetime |
| Daily usage counters | `usage_counters` | Mission AI message limit | The user (RLS); admins | Account lifetime |
| Mission AI turn records (surface, call count, time) | `ai_turns` | Quota enforcement by `ai-proxy` | Service role only | Deleted after 2 days (`begin_ai_turn`) |
| Plan requests (plan, message) | `upgrade_requests` | Manual plan requests | The user (RLS); admins | Account lifetime |
| Payment records (order ref, plan, amount, currency, status, method type) | `payments` | Checkout (Cashfree, not yet live) | The user; admins | Currently cascade-deleted with the account (see open items) |
| Sign-in logs (IP, user agent, time) | Supabase Auth logs | Security | Supabase; admins | Supabase's log retention |
| Built-in AI provider keys | `ai_provider_keys` | Built-in Mission AI | `ai-proxy` function only | Until an admin removes them |

Mission AI prompts and answers pass through the `ai-proxy` Edge Function to
Google Gemini or NVIDIA and are **not stored** by OUTARCH.

## On the user's computer (`%APPDATA%\OUTARCH`)

| Data | File | Protection | Retention |
| --- | --- | --- | --- |
| Account session | `account-session.json` | Electron safeStorage (DPAPI); not written if unavailable | Until sign-out |
| Own AI provider keys | `ai-keys.json` | safeStorage; store refuses to run without it | Until removed |
| MCP gateway tokens | `mcp-gateway-credentials.json` | safeStorage | Until revoked |
| Phone pairing keys | `mobile-companion-credentials.json` | safeStorage | Until revoked |
| AI model choices, "Always allow" flags | `ai-preferences.json`, `mission-ai-preferences.json` | Plain JSON (no secrets) | Until changed |
| Project memory preferences | `project-memory.json` | Plain JSON | Until changed |
| Recovery diagnostics | `recovery-diagnostics.json` | Plain JSON, local only | Bounded by the store |
| Known projects | `projects.json` | Plain JSON | Until removed |
| Terms agreement (version, time, app version) | `legal-acceptance.json` | Plain JSON | Until the folder is deleted |
| Update downloads | `updates/` | Signature-verified before install | Replaced by newer updates |
| In-app browser data for localhost pages | `persist:mission-control-browser` partition | Electron session storage | Until cleared |

Mission AI conversations are held in memory only.

## In the user's project folders

Project/workspace file, `<workspace>.activity.json` activity history, session
journal, and `arch_memory.md` (project memory, plus optional pointer lines in
`CLAUDE.md` / `AGENTS.md`). All plain files the user controls.

## Leaves the computer

| Flow | Destination | Data | Trigger |
| --- | --- | --- | --- |
| Plan check | Supabase RPC `get_entitlements` | Session token | Start, focus, every 5 min |
| Update check / download | Supabase `app_releases` + storage | None beyond the request | 20 s after start, every 6 h |
| Mission AI (built-in) | `ai-proxy` → Gemini / NVIDIA | Prompt, conversation, tool results (workspace summary, up to 120 redacted terminal lines, redacted file contents, command output) | User asks a question |
| Mission AI (own key) | Chosen provider directly | Same as above | User asks a question |
| Project memory | Memory model (built-in or own key) | README, project facts, redacted Git change summaries | User agrees to create/update memory |
| Phone Ask | Desktop → its Mission AI provider | Question + read-only tool results | Paired phone with `assistant.ask` |

Local-only links (never leave the machine): MCP gateway (127.0.0.1, token +
scopes), VS Code bridge (127.0.0.1; editor state, diagnostics, Git summary,
VS Code terminal commands/output redacted, last 200 lines in memory), phone
companion (LAN, X25519 + AES-256-GCM end to end).

No analytics, telemetry, advertising or crash reporting exists in the desktop
app, the website, the phone page or the Android client.

## Website (browser storage)

`outarch-website-session` (localStorage, website sign-in session),
`outarch-currency` (localStorage). No cookies set by OUTARCH. Google sign-in
and the Cashfree checkout window (when live) set their own.

## Open items

- `payments` rows cascade-delete with the user; tax/accounting retention needs
  an export or a non-cascading archive before account deletion is offered.
- Data export is self-service (website account page, "Download my data").
  Account deletion is by email request to the support address; no button.
- Support / deletion / security contact: outarch54@gmail.com (app_config.support_email, site.js).
- Website hosting provider not yet recorded (`vercel.json` and `_redirects`
  both exist).
