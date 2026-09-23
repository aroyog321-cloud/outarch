# Changelog

## 1.0.0

- Named OUTARCH Bridge throughout, with the OUTARCH icon in the Extensions view.
- The package installs again: it is now built with forward-slash paths, which
  VS Code requires (`node scripts/package-vsix.cjs`).
- Runs only in trusted workspaces, because it can open files and manage the
  terminals OUTARCH creates.
- Status messages name OUTARCH instead of the old internal name, and the
  Connect command points to Integrations → VS Code Bridge.
- The README now states that, with shell integration, commands and output of
  VS Code terminals are shared with the desktop app (redacted, last 200 lines,
  memory only).

## 0.2.0

- Managed terminals: OUTARCH can create terminals it owns and send approved
  input to them.
- Editor, diagnostics, Git and task synchronization over an authenticated
  loopback socket.
