# OUTARCH Android supervision client

This Android 13+ client is a supervision companion, not a mobile IDE or remote
shell. Open this folder in Android Studio, build the `app` module, and install
the debug APK on a phone connected to the same private network as the desktop.

Pairing requires the desktop endpoint and six-digit code shown in **Settings →
Mobile supervision companion**. The phone fetches only the invitation's public
key transcript; the code itself is used locally for the HMAC proof and is never
sent. X25519, HKDF-SHA256, and AES-256-GCM match the desktop protocol. The
per-device credential is encrypted by Android Keystore.

The initial UI exposes encrypted Summary, Needs You, and Project Memory reads.
Biometric identity verification is available for sensitive review. Direct
terminal access, terminal input, source files, environment values, and remote
execution are deliberately absent. Worker and recipe mutations remain desktop
Needs You approvals in the protocol.

This repository does not contain a release signing key. Produce a signed APK/AAB
only through a protected release pipeline; never commit the keystore.
