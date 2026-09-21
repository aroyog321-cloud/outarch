# OUTARCH accounts, plans, built-in AI keys and updates

Everything here runs on the Supabase project **qswiqzootfwkbbbvhfyj** (Mumbai,
ap-south-1). Run the SQL snippets in the Supabase dashboard's **SQL Editor**.
The SQL Editor runs with owner rights, so it can reach the `admin` helpers that
app and website users cannot.

## How it fits together

| Piece | Where |
| --- | --- |
| Sign-in (email and password, or Google) | The website's `/auth` page. The app opens it in the browser and receives the session back through `outarch://auth/callback`. |
| Account and plan page, pricing page, checkout | The website's `/account`, `/pricing` and `/checkout` pages. |
| Prices and payments | `public.plan_prices`, `public.payments`; the `billing` and `cashfree-webhook` Edge Functions (section 2) |
| Plans and their limits | The `public.plans` table |
| Who has which plan | The `public.subscriptions` table, or the `admin.user_plans` view |
| Built-in Mission AI keys | The `public.ai_provider_keys` table. Only the `ai-proxy` Edge Function reads it; the app never sees a key. |
| Mission AI message quota | Enforced on the server by `begin_ai_turn()` and the `ai-proxy` function |
| Website address the app uses | The `website_url` row in `public.app_config` |
| Auto-updates | Signed rows in `public.app_releases`, with the ZIPs in the `releases` storage bucket |
| Database history | The `supabase/migrations/` folder in this repo, identical to what is applied |

The app refuses to open until the person is signed in. After that it re-checks
the plan every 5 minutes and whenever the window gets focus. A plan change you
make in the database reaches a running app within 5 minutes. If the internet
drops, the app keeps working on the last known plan for 72 hours.

---

## 1. One-time setup (required)

### 1a. Add the built-in Mission AI keys

The app no longer has any keys inside it. **Until you add at least one key,
Mission AI's built-in models will not work** for anyone. Bring-your-own keys
(Pro and Ultimate) still work.

```sql
-- Lower priority number = tried first. Add as many as you like.
select admin.add_ai_key('gemini', '<your Gemini key>', 'Gemini 1', 10);
select admin.add_ai_key('gemini', '<another Gemini key>', 'Gemini 2', 20);
select admin.add_ai_key('nvidia', '<your NVIDIA key>', 'NVIDIA 1', 10);
```

> **Rotate the old keys.** The Gemini and NVIDIA keys that used to live in
> `src/service/missionAiBuiltinKeys.cjs` are still in this repository's git
> history (`git show HEAD:src/service/missionAiBuiltinKeys.cjs`). Anyone with a
> copy of the repo can read them. Create new keys at the provider, add the new
> ones with `admin.add_ai_key`, and delete the old ones at the provider.

**When a key gets used up**, you don't need to do anything in a hurry. The proxy
notices the refusal (quota, rate limit, revoked key) and parks that key for a
while: 45 seconds for a short rate limit, 1 hour for a daily quota, 30 minutes
for a revoked key. The same request then moves on to the next key, so users
don't see a failure as long as any key still works. To put in a fresh key:

```sql
select admin.add_ai_key('gemini', '<new key>', 'Gemini 3', 5);   -- tried first from now on
update public.ai_provider_keys set enabled = false where label = 'Gemini 1';   -- retire the old one
select * from admin.ai_key_health;   -- state, last error and counts; the key itself is masked
```

### 1b. Tell Supabase Auth where the website lives

Open **Authentication, then URL Configuration**:

- **Site URL**: your website's address, for example `https://outarch.app`.
  While you only run it locally, use `http://localhost:5173`.
- **Redirect URLs**: add each of these:
  - `http://localhost:5173/**`
  - `https://<your website domain>/**`

Without these, Google sign-in, email confirmation and password reset links
fail with a "redirect URL not allowed" error.

### 1c. Turn on Google sign-in

1. Go to Google Cloud Console, then **APIs and Services**, then **Credentials**.
   Create an **OAuth client ID** of type *Web application*.
2. Under **Authorised redirect URIs**, add exactly:
   `https://qswiqzootfwkbbbvhfyj.supabase.co/auth/v1/callback`
3. Under **Authorised JavaScript origins**, add your website domain and
   `http://localhost:5173`.
4. In Supabase, open **Authentication, then Sign In / Providers, then Google**.
   Enable it and paste the client ID and client secret.
5. Configure the OAuth consent screen: app name OUTARCH, your support email,
   and your logo. Publish it so that any Google account can sign in, not only
   test users.

### 1d. Email (strongly recommended)

Supabase's built-in email sender sends only a few emails an hour. That is
enough for testing, but real sign-ups will hit the limit. In **Authentication,
then Emails, then SMTP Settings**, connect a sender such as Resend, Postmark or
Amazon SES. You can also reword the confirmation and reset emails there.

With confirmation on (the default), a new email account must click the link in
its confirmation email before it can sign in. The website shows a "check your
inbox" screen and a resend button for this.

### 1e. When the website goes live

1. Deploy the `website/` folder (`npm run build`, output in `dist/`).
   `website/vercel.json` and `website/public/_redirects` send every address to
   the site, so `/auth`, `/account`, `/pricing`, `/checkout` and the policy
   pages all load directly.
2. Set the two build variables from `website/.env.example`: `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_PUBLISHABLE_KEY`. Both are public values.
3. Point every installed app at the new address. No new app build is needed:

```sql
update public.app_config set value = '"https://outarch.app"' where key = 'website_url';
update public.app_config set value = '"support@outarch.app"' where key = 'support_email';
```

4. Add the domain to the Redirect URLs (step 1b) and to Google (step 1c).

---

## 2. Online payments (Cashfree)

Pro and Ultimate are **prepaid**: 1 month or 12 months, no auto-renewal.
Prices are rows in `public.plan_prices` (₹700 / $7.30 and ₹1,000 / $10.42 a
month; a year costs 10 months). The website shows rupees to visitors in India
and dollars to everyone else, and anyone can switch.

How a purchase works:

1. `/checkout` shows what the purchase will do (from `checkout_quote()`), asks
   for a mobile number (Cashfree requires one; it is not stored) and calls the
   `billing` Edge Function, which prices the order **from the database**,
   records it in `public.payments` and opens a Cashfree order.
2. Cashfree's checkout opens in a pop-up (UPI, cards, netbanking, wallets).
3. When Cashfree reports the payment, `public.apply_payment()` switches the plan
   on. Two paths report it, and either is enough: the checkout page asks
   `billing` to verify the order, and Cashfree calls the `cashfree-webhook`
   function (signature-checked). Applying the same order twice does nothing.
4. The desktop app picks the plan up within 5 minutes, or at once when the
   buyer presses **Open OUTARCH** (`outarch://account/refresh`).

Buying the same plan again adds the time to the end. Buying Ultimate while on
Pro starts Ultimate now and carries the Pro days left over, converted at the two
monthly prices (30 Pro days become 21 Ultimate days). Buying Pro while Ultimate
runs is refused at checkout.

### 2a. Switch Cashfree on

In the Supabase dashboard open **Edge Functions, then Secrets** and add:

| Secret | Value |
| --- | --- |
| `CASHFREE_CLIENT_ID` | Cashfree dashboard, Developers, API keys |
| `CASHFREE_CLIENT_SECRET` | same place (also used to check webhook signatures) |
| `CASHFREE_ENV` | `sandbox` while testing, `production` when live |
| `CASHFREE_CURRENCIES` | `INR`, or `INR,USD` once Cashfree enables international payments. Until then dollar buyers are charged the rupee price and told so before they pay. |
| `SITE_URL` | optional; your website address. Defaults to `app_config.website_url`. It must be `https://` for Cashfree to send buyers back after a bank or UPI redirect. |

Then in Cashfree, **Developers, Webhooks**, add
`https://qswiqzootfwkbbbvhfyj.supabase.co/functions/v1/cashfree-webhook` for
payment events. Until the two keys are set, checkout shows a **Request plan**
button that files an upgrade request instead (section 2c).

Test with Cashfree's sandbox keys first: the checkout page shows a "Test mode"
badge and Cashfree's test cards and UPI IDs complete without real money. When
Cashfree approves the account, swap in the production keys and set
`CASHFREE_ENV` to `production`.

Cashfree reviews the website before approving it. It needs the business name,
address and contact details on the policy pages: fill them in
`website/src/lib/site.js`, and set the support email:

```sql
update public.app_config set value = '"support@your-domain"' where key = 'support_email';
```

### 2b. Check payments, refunds

```sql
select * from admin.payments;                                   -- every checkout, newest first
select * from admin.payments where status = 'paid' and paid_at > now() - interval '7 days';
```

Refunds are made in the Cashfree dashboard. After refunding, mark the order and
move the person back if needed:

```sql
update public.payments set status = 'refunded' where id = 'oa_...';
select admin.set_plan('someone@example.com', 'free');
```

To change a price, edit `public.plan_prices` (and `plans.price_label`, which
the app's upgrade dialog shows). Orders already paid keep their price.

### 2c. Setting a plan by hand

Before Cashfree is on, "Request plan" creates a row in
`public.upgrade_requests`. You take the payment however you like, then:

```sql
select * from public.upgrade_requests where status = 'open' order by created_at;

select admin.set_plan('someone@example.com', 'pro', 30);        -- Pro for 30 days
select admin.set_plan('someone@example.com', 'ultimate', 365);  -- Ultimate for a year
select admin.set_plan('someone@example.com', 'ultimate');       -- Ultimate, never expires
select admin.set_plan('someone@example.com', 'free');           -- back to Free

select * from admin.user_plans order by joined_at desc;         -- everyone and their plan
```

`set_plan` also marks that person's open request for that plan as done. When
`current_period_end` passes, the person drops to Free automatically. Nothing
needs to run for that to happen.

### Plan limits

The plans live in `public.plans.limits`. Edit them in the Table Editor and the
change reaches every app within 5 minutes. In these limits, `null` means
unlimited.

| Limit | Free | Pro | Ultimate |
| --- | --- | --- | --- |
| `terminals` | 3 | 8 | null |
| `projects` / `projectSwitching` | 1 / false | null / true | null / true |
| `mcp` | `none` | `read` (read-only tools) | `full` |
| `mobileCompanion` | false | true | true |
| `vscodeBridge` | false | false | true |
| `recipes` / `recipeTrialDays` | 1 / 3 | 3 / null | null / null |
| `byokKeys` | 0 | 1 | null |
| `missionAiMessages` / `missionAiPeriod` | 3 / `day` | null / `day` | null / `day` |

What a plan costs lives in `public.plan_prices` (section 2). The app's upgrade
dialog shows `plans.price_label`, currently `₹700 / month ($7.30)` and
`₹1,000 / month ($10.42)`; keep it in step when you change a price.

---

## 3. Publishing an update

Every installed OUTARCH checks for updates 20 seconds after it starts and then
every 6 hours. It installs only a release whose signature verifies against the
public key built into it (`src/service/updateConfig.cjs`). The matching private
key is at `%USERPROFILE%\.outarch\release-signing-key.pem`.

> **Back up that private key somewhere safe and never share it.** If you lose
> it, installed apps can never be updated again. If someone else gets it, they
> can push code to every OUTARCH.

To release:

1. Bump `"version"` in `package.json`, for example to `2.19.1`.
2. Get the **service role key**: Supabase dashboard, then Project Settings,
   then API Keys. Then run:

```bat
set SUPABASE_SERVICE_ROLE_KEY=<service role key>
node scripts/release/publish-release.cjs --notes "What changed" --upload
```

This builds the renderer, packs `release/OUTARCH-<version>.zip`, signs it,
uploads it to the `releases` bucket and publishes the row. Leave out `--upload`
to only build and sign locally. `--mandatory` marks the release as mandatory
in the database; the app currently offers it like any other update.

In the app, **Settings, then About** shows update status and an "Update now"
button, and the status bar shows a chip when an update is ready. Installing:

1. Backs up the current copy.
2. Replaces the files.
3. Runs `npm install` only if `package-lock.json` changed.
4. Restarts the app.

If anything fails, the backup is restored.

To withdraw a release:

```sql
update public.app_releases set enabled = false where version = '2.19.1';
```

A developer checkout (a folder with `.git` in it) is never overwritten. There,
the updater only reports that a release is available.

---

## 4. Agent permission notifications (no setup)

When an AI agent in any terminal (Claude Code, Codex, Gemini CLI, Copilot,
Cursor, OpenCode, Goose, Aider) stops to ask for permission, OUTARCH:

- shows an in-app notice with a sound, and an **Open terminal** button;
- shows a Windows desktop notification with a sound when OUTARCH is in the
  background or minimised. Clicking it brings OUTARCH forward on that terminal.

The notice clears itself as soon as you answer in that terminal. Windows' own
**Do not disturb** or **Focus** mode will still silence desktop notifications.

---

## 5. What is and isn't locked down

- **Enforced on the server:** Mission AI message quotas and the built-in keys.
  They cannot be bypassed from the app.
- **Enforced by the app** (the main process, not just the screen): terminals,
  projects, MCP, mobile companion, VS Code bridge, recipes and BYOK. OUTARCH
  ships as readable JavaScript, so a determined person could edit their own copy
  to lift these. The fix for that is shipping a packaged, signed build rather
  than the source ZIP.
- The command-line tool (`bin/termctl.js`) has no sign-in and no plan limits.

## 6. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "redirect URL not allowed" after Google or an email link | Add the site to Redirect URLs (step 1b). |
| Google button shows "provider is not enabled" | Do step 1c. |
| Browser says it can't open the `outarch://` link | Start OUTARCH once from `OPEN_OUTARCH_WINDOWS.cmd`; it registers the link handler on every start. Then select **Open OUTARCH** on the website page again. |
| Built-in Gemini shows "Not set up", or Mission AI says the server has no key | No enabled keys, or every key is cooling down: `select * from admin.ai_key_health;` |
| A plan change hasn't shown up | It takes up to 5 minutes. Refocusing the app window, or opening Settings, then Account, then Refresh, picks it up immediately. |
| Confirmation emails stop arriving | You've hit the built-in email limit. Set up SMTP (step 1d). |
