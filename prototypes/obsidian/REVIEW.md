# Obsidian prototype review

Review date: 5 September 2026. Scope: the standalone `prototypes/obsidian` HTML/CSS/JavaScript design study. This is not a review of the production Electron renderer, its engine, PTYs, credentials, IPC or external integrations.

## Coverage

| Area | Evidence | Result |
| --- | --- | --- |
| Navigation and information architecture | Ten routes, sidebar order, project switcher, command palette, route changes | Covered in the focused renderer check |
| Groundstation workflow | Worker search/filter, worker creation, inspection, failure acknowledgement/recovery, recipe launcher | Covered in the focused renderer check |
| Workspace workflow | Split/focus terminal layout and simulated terminal input | Covered in the focused renderer check |
| Decision workflow | Detail, acknowledgement, explicit approval confirmation, resolution | Covered in the focused renderer check |
| Recipes | Validation, editing, preview and ordered simulated launch | Covered in the focused renderer check |
| Mission AI | Starter prompt, free-text entry and labelled scripted response | Covered in the focused renderer check |
| Preferences | Material preference persistence and density/transparency controls | Covered in the focused renderer check |
| Responsive behavior | Every route at 960, 720, 390 and 320px, no page-width overflow | Covered in the focused renderer check |
| Keyboard | Native controls, command palette arrows/Enter/Escape, Alt route shortcuts, focus restoration after dialog | Source inspected; command palette interaction checked |
| Screen reader | Native labels, landmarks, semantic controls, live toast region | Source inspected; not tested with a screen reader |
| Visual quality | Desktop Groundstation, Workspace, Needs You, Settings, Integrations, Mission AI captures | Captured and inspected in `verification/` |

## Result

The dedicated check completed **25/25** passing checks with no renderer errors. It wrote the evidence to `verification/results.json` and saved representative desktop/mobile captures.

The following properties are deliberately true in this prototype:

- It never invokes the Mission Control bridge, a shell, a provider, credentials, filesystem permissions, a real device, or a real plugin.
- Decisions require distinct approval/rejection controls; acknowledging a failure does not represent it as recovered.
- The worker register is the primary operational surface, while glass is used for shell/chrome and overlays rather than terminal text or evidence.
- Static labels accompany color states. Motion is brief, opt-out and never carries the sole meaning.

## Limits before production adoption

No formal accessibility conformance claim is made. A production review must test the actual Electron renderer with keyboard-only use, a screen reader, operating-system high contrast, 200% zoom, live PTY output, real error/connection scenarios, and representative projects. Contrast also needs measuring on the final composited materials and all production state variants.

The prototype’s simulated state is intentionally not a replacement for the engine-owned worker lifecycle, permission/confirmation system, terminal transport, persistent configuration, or secure credential storage.
