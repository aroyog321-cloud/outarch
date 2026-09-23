OUTARCH — WINDOWS 11
====================

OUTARCH is the new name of Mission Control. Your projects, keys and
layouts are carried over automatically the first time OUTARCH opens.

1. Extract the entire ZIP before running it.
2. Install Node.js 22 LTS (22.12 or newer) if it is not already installed.
3. Double-click OPEN_OUTARCH_WINDOWS.cmd.

The launcher installs the Windows desktop dependencies on first use, builds the
renderer when it has changed, and opens OUTARCH. If OUTARCH is already open,
its window is brought to the front instead of starting a second copy.

OPTIONAL RELEASE CHECK
----------------------
Double-click VERIFY_OUTARCH_WINDOWS.cmd to rebuild the renderer and run
native CMD and PowerShell ConPTY smoke checks on this Windows machine.

IMPORTANT
---------
Do not open mission-control-prototype.html to look for recent changes. That file
is the preserved static v1.7 visual reference. It cannot connect to EngineAPI,
own a workspace, show live PTYs, or display the newer supervision features.

WHERE THE LATEST VISIBLE CHANGES ARE
------------------------------------
- Groundstation: the live project stage and bounded supervision briefing are
  now the default five-second scan.
- Workspace: terminals are the hero; use Ctrl+F in the active pane to search.
- Needs You: compact decision queue with approval evidence and impact.
- Projects: type to search recent roots and press Enter to open the first match.
- Settings: choose theme, density, terminal appearance, integrations, mobile,
  and extensions from the category sidebar.
- Press F1 or ? to open the keyboard reference. The bottom status bar shows the
  engine contract, current project, live worker count, and last signal.
- Agents: select a local agent and assign a Mission Contract. The existing
  detail area then shows Summary, Progress, Lifecycle, Evidence, Files,
  Approvals, and Terminal.
- Needs You: mission and MCP permission requests appear here only when a real
  request is pending.
- Workspace Recipes and Mission Graph remain contextual in the toolbar.
- VS Code Bridge, Mission AI, and Secure MCP Gateway remain in Settings.

OUTARCH intentionally does not fabricate demo missions, approvals,
workers, or progress. A feature that depends on real engine state appears after
you create or connect that state.

OPTIONAL PROJECT
----------------
Drag a termctl.config.json path onto OPEN_OUTARCH_WINDOWS.cmd, or run:

  OPEN_OUTARCH_WINDOWS.cmd --config D:\Projects\app\termctl.config.json

Without --config, OUTARCH opens termctl.config.json in this folder, or
the safe one-shell onboarding workspace if that file does not exist.
