# OUTARCH Bridge for VS Code

This optional extension connects VS Code to the running OUTARCH desktop app
through an authenticated loopback socket.

It synchronizes only bounded project context:

- active project-relative file and cursor position
- diagnostic counts and up to 50 bounded diagnostic records
- Git branch and aggregate working-tree state
- task lifecycle results
- stable terminal identity, ownership, active state, shell activity, and bounded
  command metadata when VS Code shell integration is available

It never streams terminal output, process IDs, environment values, or arbitrary
filesystem paths. Existing VS Code-owned terminals are always observe-only.
OUTARCH can create terminals explicitly marked `mission-control-managed`;
only those terminals accept approved input, focus, and close requests. Commands
that appear to contain credentials and multi-line input are blocked.

## Install during development

Open this directory in VS Code and run the `Run Extension` launch target, or
install the packaged `.vsix` included with the OUTARCH release.

Use **Connect VS Code** from OUTARCH Settings. The launch URI contains a
one-time token that expires after 60 seconds and is consumed by the first valid
same-project handshake.

## Terminal ownership

- `vscode-owned`: created by VS Code, the user, or another extension; Mission
  Control may observe bounded activity metadata but cannot write or close it.
- `mission-control-managed`: created through the OUTARCH Settings UI;
  the bridge can focus it and can write or close it only through Protocol
  requests carrying the exact approval token.

The extension uses VS Code's terminal API. It does not create a second PTY,
attach to terminal output, or duplicate a terminal already owned by EngineAPI.
