# OUTARCH on the Microsoft Store

This guide covers how OUTARCH for Windows is built, tested and submitted as an MSIX package for the Microsoft Store.

The download flow for users is:

**OUTARCH website → Download for Windows → Microsoft Store web installer → the Store installs OUTARCH**

Microsoft signs the package when it publishes it, so you don't need to buy an OV or EV code-signing certificate. The website never hosts the Windows installer. It links to the Store.

---

## 1. What is already in the repository

| Piece | Where |
|---|---|
| Package identity and listing basics | `packaging/msix/store.config.json` |
| Store logos, tiles and taskbar icons (72 PNGs, every scale) | `packaging/msix/Assets/` (built by `npm run brand:store-assets`) |
| Manifest generator (`AppxManifest.xml`) | `scripts/msix/manifest.cjs` |
| Build: Electron package → `.msix` → `.msixbundle` | `scripts/msix/build-msix.mjs` |
| Package checker | `scripts/msix/verify-msix.mjs` |
| Local install for testing (Developer Mode) | `scripts/msix/install-test.ps1` |
| Windows App Certification Kit runner (needs admin) | `scripts/msix/run-wack.ps1` |
| How the app behaves when it runs from the Store | `src/groundstation/main/distribution.cjs` |
| Tests | `test/microsoftStore.test.cjs` |

### How the Store build differs from the ZIP/folder build

Only the packaging changes. SessionEngine, EngineAPI, node-pty, the renderer and every feature are the same code. The Store build (marked by `"outarchDistribution": "microsoft-store"` in the package's own `package.json`, and by Windows when it runs from the package):

- **Updates come from the Store.** The built-in updater never checks, downloads or installs anything. Settings > Updates shows "Microsoft Store keeps OUTARCH up to date." The ZIP build keeps its signed updater unchanged.
- **The package sets the app's identity.** The process doesn't set its own AppUserModelID or write the HKCU toast registration. Taskbar pins, Start and notifications all belong to the package.
- **The package manifest registers `outarch://`,** so sign-in from the website still hands off to the app. Nothing is written to HKCU pointing at the versioned install folder.
- **The first terminal starts in the home folder** when Windows starts the app in `System32` or in its read-only install folder.
- **Data lives in `%APPDATA%\OUTARCH`,** the same folder the ZIP build uses. Someone who moves from the ZIP to the Store keeps projects, keys and preferences. (Only one of the two runs at a time. They share the single-instance lock.)

### Why the package has no MSIX file-system virtualization

By default MSIX redirects an app's writes to `%APPDATA%` and `HKCU` into a private per-package copy. That would break OUTARCH:

- The MCP setup edits other apps' config files, for example `%APPDATA%\Claude\claude_desktop_config.json`. Claude Desktop would never see the change.
- The terminals run the user's own tools (npm, git, pip, Claude Code, Codex…), and those run inside the package's process tree. `npm install -g`, credential helpers and tool settings would vanish into the private copy.

So the manifest declares `desktop6:FileSystemWriteVirtualization` and `RegistryWriteVirtualization` as `disabled`, which requires the restricted capability **`unvirtualizedResources`**. This was tested on this machine: a write to `%APPDATA%` from inside the package landed in the real folder.

### Why `RunAsNode` stays on and there is no asar archive

node-pty's Windows backend forks `conpty_console_list_agent.js` with `ELECTRON_RUN_AS_NODE` when a terminal is closed, and it starts a worker script by path. The build turns off Node's `--inspect` flags and `NODE_OPTIONS` (Electron fuses) but leaves RunAsNode on. It also ships every file as a real file (`asar: false`). Both were tested inside the package: spawn, output and kill of a PowerShell PTY worked.

---

## 2. One-time setup

0. **Put the website online first (required).** The app sends people to `app_config.website_url` to sign in. Until the site is deployed, that is `http://localhost:5173`, which only works on your own PC while `cd website && npm run dev` is running. Microsoft's certification testers and every Store user would get stuck at the sign-in screen, and certification fails. Deploy `website/` (for example to Vercel; `vercel.json` is included), then follow steps 1b and 1e in `OUTARCH_ACCOUNTS_AND_UPDATES.md`: set `website_url` to the real `https://` address and add it to Supabase Auth's site URL and redirect URLs. Check by signing in from an installed copy on another PC or network.
1. **Windows 11 SDK:** gives you `makeappx`, `makepri`, `signtool` and the App Certification Kit. <https://developer.microsoft.com/windows/downloads/windows-sdk/>
2. **Node.js 22.12+** and `npm install` in the repository.
3. **A Partner Center developer account:** <https://partner.microsoft.com/dashboard/registration>. Individual or company. Check the current registration fee there.
4. **Python 3 with Pillow:** only needed if you change the logo and want to regenerate the Store images.

### Reserve the app in Partner Center

1. Partner Center > **Apps and games** > **New product** > **MSIX or PWA app**, then reserve the name **OUTARCH**.
2. Open the app > **Product management** > **Product identity**. Copy these three values into `packaging/msix/store.config.json`:

   | Partner Center shows | store.config.json key |
   |---|---|
   | `Package/Identity/Name` (for example `12345YourName.OUTARCH`) | `identityName` |
   | `Package/Identity/Publisher` (`CN=XXXXXXXX-XXXX-…`) | `publisher` |
   | `Package/Properties/PublisherDisplayName` | `publisherDisplayName` |

   Also write down the **Store ID** (12 characters, for example `9NXXXXXXXXXX`). The website needs it in step 6.

`npm run package:store` refuses to build while the placeholders are still in the config. A mismatched identity is the most common reason an upload gets rejected.

---

## 3. Build the Store package

```powershell
npm test                      # the whole suite must pass
npm run package:store         # out\msix\store\OUTARCH_<version>.0_x64.msix + OUTARCH_<version>.0.msixbundle
npm run package:msix:verify   # unpacks and checks the package
```

- **Version.** Set `package.json` → `version` (for example `2.19.0` becomes MSIX `2.19.0.0`). Every submission needs a higher version than the one before. The Store requires the fourth number to be `0`, and the build always makes it `0`.
- **Architectures.** The default is `x64`, set by `"architectures"` in the config. For ARM64 PCs, add `"arm64"` or pass `--arch x64,arm64`. The bundle then carries both, since node-pty ships ARM64 binaries. Test the ARM64 package on an ARM64 PC before you submit it.
- **What gets uploaded.** Upload the `.msixbundle` and leave it unsigned. The Store signs it.

---

## 4. Test before you submit

### Quick install in Developer Mode (no certificate, no admin)

Turn on Settings > System > For developers > **Developer Mode**, then run:

```powershell
npm run package:msix:test            # test build: publisher "CN=OUTARCH Local Test"
npm run package:msix:install-test    # unpacks that exact .msix and registers it
# open "OUTARCH" from Start
npm run package:msix:install-test -- -Remove   # uninstall
```

Windows never installs an *unsigned* `.msix` that contains a desktop program, so this script registers the unpacked contents, the same way Visual Studio deploys packaged apps. The app runs with the full package identity. Verified on 2026-09-23 on Windows 11 build 26200: it launched from Start as package `OUTARCH.Desktop.Placeholder_2.19.0.0_x64__km4h6y8gz47de` and showed the sign-in screen, node-pty worked inside the package, and `%APPDATA%` writes were not virtualized.

### Test the signed .msix file itself (optional, needs admin once)

```powershell
# 1. A self-signed certificate whose subject matches the test publisher
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=OUTARCH Local Test" -KeyUsage DigitalSignature `
  -FriendlyName "OUTARCH MSIX test" -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
$password = Read-Host -AsSecureString "PFX password"
Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\.outarch\msix-test.pfx" -Password $password
# 2. Trust it (elevated PowerShell)
Export-Certificate -Cert $cert -FilePath "$env:TEMP\outarch-test.cer"
Import-Certificate -FilePath "$env:TEMP\outarch-test.cer" -CertStoreLocation Cert:\LocalMachine\TrustedPeople
# 3. Build signed and install by double-clicking the .msix, or with Add-AppxPackage
$env:OUTARCH_MSIX_CERT_PASSWORD = "<the password>"
node scripts/msix/build-msix.mjs --mode test --sign "$env:USERPROFILE\.outarch\msix-test.pfx"
Add-AppxPackage out\msix\test\OUTARCH_2.19.0.0_x64.msix
```

Keep the `.pfx` out of the repository. `.gitignore` already blocks `*.pfx`.

### Windows App Certification Kit

From an **elevated** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\msix\run-wack.ps1
```

This runs the same automated checks Partner Center runs. WACK needs admin, so it was **not** run while preparing this build. Run it once before your first submission.

### Checklist on the installed package

- [ ] Opens from Start. The taskbar button groups with the pinned Start entry.
- [ ] Sign in with the browser returns to the app (`outarch://`).
- [ ] Open a project, start and stop a few terminals, and close one while it is busy.
- [ ] MCP gateway > install to Claude Desktop, then check that the file changed in `%APPDATA%\Claude`.
- [ ] Mobile companion pairs (Windows Firewall asks once, as with the ZIP build).
- [ ] Settings > Updates says the Store keeps OUTARCH up to date.
- [ ] Uninstall from Start > right-click > Uninstall.

---

## 5. Partner Center submission

Create a submission for the app and fill in each section:

**Packages:** upload `out\msix\store\OUTARCH_<version>.0.msixbundle`. Device family: Windows 10/11 Desktop.

**Pricing and availability:** set the price to **Free**. The Microsoft Store web installer only works for free apps. Paid plans are sold on your website (see "Payments" below). Choose your markets. For Visibility, pick "Public audience, discoverable".

**Properties:**
- Category: **Developer tools**.
- Privacy policy URL: your website's `/privacy` page, for example `https://<your-domain>/privacy`. It is required because the app signs in and talks to the network.
- Support contact: your support email or the website.
- System requirements: Windows 10 version 2004 (build 19041) or later, x64, 8 GB RAM recommended.

**Age ratings:** complete the IARC questionnaire. OUTARCH has user-generated content (terminal output) and internet access, but no user-to-user communication.

**Restricted capabilities (you must justify them).** Paste this into "Why do you need the restricted capabilities?":

> **runFullTrust:** OUTARCH is a desktop developer tool built with Electron. It runs as a full-trust Win32 application: it starts and supervises the developer's own command-line programs (PowerShell, Node.js, git, AI coding agents) in pseudo-terminals (Windows ConPTY) on the developer's request.
>
> **unvirtualizedResources:** OUTARCH is a terminal and developer command center. The programs a developer runs in its terminals (npm, git, pip, Claude Code, Codex and so on) must read and write their normal configuration in %APPDATA% and HKCU, exactly as they do in Windows Terminal; with write virtualization their settings would silently disappear into a private package copy. OUTARCH's MCP setup also writes, only when the user asks, the MCP client configuration of other developer tools (for example %APPDATA%\Claude\claude_desktop_config.json) so those tools can connect to it. File-system and registry write virtualization are therefore disabled in the manifest.

**Store listing (English):**
- Description: the website's hero and features copy works well. Start with "OUTARCH is a local-first developer command center…"
- Short description: "Run and supervise every terminal, dev server and AI coding agent of a project from one window."
- Screenshots: at least one 1920×1080 or 1366×768 PNG of the app with a real project. Four is a good number: Groundstation, Workspace, Mission AI, Integrations.
- Store logos: optional. The package logos are used.
- Keywords: terminal, developer tools, AI agents, MCP, command center, PTY, dev server.

**Submission options > Notes for certification.** This matters because the app shows a sign-in screen first. Give the testers an account:

> OUTARCH requires a free account. Click "Sign in with your browser"; the browser opens our website; sign in with the test account below and the browser returns to the app (outarch:// link). Test account: <email> / <password> (Ultimate plan, so every feature can be reviewed). After sign-in, click "Open a folder" and choose any folder to create a project, then add a terminal.

Create that account in Supabase and give it a long plan, for example `select admin.set_plan('<email>', 'ultimate', 365);`.

**Payments (Store policy 10.8):** non-game apps may use their own payment system for in-app digital purchases. OUTARCH's Pro and Ultimate plans are bought on the website (Cashfree), which is allowed. Make sure the listing and the app describe plan prices honestly.

Certification usually takes from a few hours to three business days.

---

## 6. After the app is live: switch the website to the Store

When the app is published, set its Store ID once in Supabase (SQL editor, or the Supabase MCP):

```sql
insert into public.app_config (key, value, description)
values ('microsoft_store_id', '"9NXXXXXXXXXX"', 'OUTARCH in the Microsoft Store. The website''s Download for Windows button opens the Store web installer.')
on conflict (key) do update set value = excluded.value;
```

The website reads `app_config.microsoft_store_id` (see `website/src/lib/catalog.js`). Once it is set:

- **Download for Windows** links to `https://apps.microsoft.com/detail/<StoreID>?mode=direct`. That is the Microsoft Store web installer: a small installer signed by Microsoft that installs OUTARCH through the Store.
- The steps in the download section change to the Store flow (no ZIP, no Node.js), and a "View in the Microsoft Store" link appears.
- Until the ID is set, the section shows the ZIP download as before. Rebuild and redeploy the website (`cd website && npm run build`) to ship this change.

To take the ZIP download off the website completely, also disable its release rows: `update public.app_releases set enabled = false;`. Installed ZIP copies then stop being offered updates, so tell those users to move to the Store first.

---

## 7. Shipping an update

1. Raise `version` in `package.json`, for example `2.20.0`.
2. `npm test`, then `npm run package:store`, then `npm run package:msix:verify`.
3. Partner Center > the app > **Update** submission > Packages > upload the new `.msixbundle` and remove the old one > Submit.
4. The Store installs the update for every user. OUTARCH doesn't ask or download anything itself.

Don't change `identityName`, `publisher` or `applicationId` after the first release. Windows would treat the new package as a different app.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `store.config.json is not ready for a store build` | Copy the Product identity values from Partner Center (section 2). |
| Upload says the identity or publisher doesn't match | `identityName` and `publisher` must equal Product identity *exactly*. |
| Upload says the version must be higher | Raise `package.json` → `version`. |
| `makeappx.exe was not found` | Install the Windows 11 SDK, or set `OUTARCH_WINDOWS_SDK_BIN` to its `bin` folder. |
| `0x80073D2B … unsigned package cannot include Executable activations` | Use `npm run package:msix:install-test` (Developer Mode) or a signed test build. |
| Sign-in link opens the ZIP copy instead of the Store app | The ZIP build registered `outarch://` under HKCU. Remove it (`reg delete HKCU\Software\Classes\outarch /f`) or uninstall the ZIP copy. |
| A terminal in the Store app can't write where the ZIP build could | Check that the installed manifest still has `unvirtualizedResources` (`npm run package:msix:verify`). |
