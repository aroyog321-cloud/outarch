# OUTARCH security incident response plan

Use this when a vulnerability is being exploited, a secret is exposed, or
personal data may have been accessed without permission. Keep a written,
timestamped log from step 1 onwards.

1. **Detect and record.** Note when and how it was found, who reported it and
   what is known. Open a private incident log.
2. **Contain.** Stop the leak first: revoke or rotate exposed keys (Supabase
   service role, `ai_provider_keys`, Cashfree secrets, release-signing key),
   disable the affected Edge Function or feature, pull a bad release from
   `app_releases`.
3. **Assess scope.** Which systems (Supabase tables, functions, website, app
   releases) and which data (see `DATA_INVENTORY.md`) were affected? Which
   users, and from when to when?
4. **Preserve evidence.** Export Supabase logs, function logs and relevant
   rows before they age out. Do not alter them.
5. **Assess harm to users.** Could the data identify people, expose their
   code or keys, or cause financial loss?
6. **Notify where the law requires.** Under India's DPDP Act and Rules, a
   personal data breach must be reported to the Data Protection Board and to
   affected users in the form and time the Rules set. Take legal advice on
   what applies and when; other countries' laws may also apply. Tell affected
   users what happened, what data was involved, what we are doing and what
   they should do (for example rotate an API key).
7. **Eradicate and fix.** Patch the cause, ship a signed update, and verify
   the fix.
8. **Recover.** Restore services, re-issue credentials, watch for recurrence.
9. **Document.** Final report: timeline, cause, impact, notifications sent,
   fixes.
10. **Review.** Within two weeks, a blameless review: what would have caught it
    sooner, and what changes (tests, alerts, policies) follow.

## Keys to rotate first

| Secret | Where it lives | How to rotate |
| --- | --- | --- |
| Built-in AI provider keys | `ai_provider_keys` | Provider console, then `admin.add_ai_key` / remove old |
| Supabase service role / JWT secret | Supabase dashboard | Rotate in dashboard; redeploy functions |
| Cashfree client secret | Edge Function secrets | Cashfree dashboard, then update secrets |
| Release-signing key | `%USERPROFILE%\.outarch\release-signing-key.pem` | Only if exposed: new key means every installed app must be updated by hand |

Known item (2026-09-23): two NVIDIA API keys from before the move to
server-side keys remain in this repository's git history
(`src/service/missionAiBuiltinKeys.cjs` in early commits). Rotate them at
NVIDIA and do not publish this repository's history.
