# Security policy

## Reporting a vulnerability

Please report security problems in OUTARCH privately. Do not open a public
issue.

- Email **outarch54@gmail.com** with **"Security"** in the subject. The same
  address is on the website's contact page, in `/.well-known/security.txt`, and
  in the desktop app under **Settings → Legal & privacy**.
- Include what you found, the steps to reproduce it, the version you tested
  (Settings → About) and any proof-of-concept.

We acknowledge reports, keep reporters updated and credit them if they wish.
The full policy, including the safe-harbour rules for good-faith research, is
the **Security & responsible disclosure** document (`/security` on the website,
and in the app).

## Supported versions

Only the latest release receives security fixes. The desktop app offers
signed updates in the app; install them promptly.

## Scope

- The OUTARCH desktop app, its engine and the `outarch` CLI (`src/`)
- The phone companion page served by the desktop app
- The OUTARCH Bridge extension for VS Code (`integrations/vscode/`)
- The Android client (`mobile/android/`)
- The OUTARCH website (`website/`) and the account backend functions
  (`supabase/functions/`)

Out of scope: third-party AI providers, MCP clients, VS Code itself, and the
tools you run in OUTARCH terminals.

## For maintainers

- Never commit secrets. `.gitignore` blocks `.env*`, private keys, keystores
  and credential folders; built-in AI keys live only in Supabase
  (`ai_provider_keys`, readable only by the `ai-proxy` function).
- The release-signing private key stays outside the repository
  (`%USERPROFILE%\.outarch\release-signing-key.pem`).
- Follow `docs/legal/INCIDENT_RESPONSE.md` if a vulnerability is exploited or
  personal data may be affected.
