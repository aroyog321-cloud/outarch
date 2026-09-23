# OUTARCH Android supervision client

This Android 13+ client is a supervision companion, not a mobile IDE or remote
shell. Open this folder in Android Studio, build the `app` module, and install
the debug APK on a phone connected to the same private network as the desktop.

## Build

Needs JDK 17 and the Android SDK (platform 36). From this folder:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug lintDebug
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. `assembleRelease`
produces an unsigned release APK; sign it only in a protected release pipeline.

## Privacy

Permissions: `INTERNET` (to reach the desktop on the local network) and
`USE_BIOMETRIC` (identity check before a sensitive review, only when asked).
No analytics, crash reporting or push. The pairing credential is encrypted by
the Android Keystore and excluded from cloud backup and device transfer
(`res/xml/data_extraction_rules.xml`). Cleartext HTTP is allowed because the
desktop gateway is reached by LAN address; every payload is end-to-end
encrypted (X25519, HKDF-SHA256, AES-256-GCM). The full notice is **Mobile
companion privacy** in the desktop app and on the website.

Pairing requires the desktop endpoint and six-digit code shown in **Integrations →
Mobile Companion**. The phone fetches only the invitation's public
key transcript; the code itself is used locally for the HMAC proof and is never
sent. X25519, HKDF-SHA256, and AES-256-GCM match the desktop protocol. The
per-device credential is encrypted by Android Keystore.

The initial UI exposes encrypted Summary, Needs You, and Project Memory reads.
Biometric identity verification is available for sensitive review. Direct
terminal access, terminal input, source files, environment values, and remote
execution are deliberately absent. This client has no worker or recipe controls of its own;
the web companion the desktop serves at /mobile has them. In the protocol, start, restart and
recipe runs go straight through while the desktop setting "Run phone requests without asking"
is on, and stop and cancel always wait for a desktop approval.

This repository does not contain a release signing key. Produce a signed APK/AAB
only through a protected release pipeline; never commit the keystore.
