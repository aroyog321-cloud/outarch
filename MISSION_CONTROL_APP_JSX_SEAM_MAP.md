# App.jsx responsibility map & extraction seams (T014)

`src/groundstation/renderer/App.jsx` is **1,661 lines**, 38 imports, ~55 top-level
declarations. `GroundstationApp()` (lines 1350–1658) is the god component:
**25 `useState`, 24 `useCallback`, 17 `useEffect`, 2 `useMemo`, 4 `useRef`, 6 keyboard
listeners**. This maps what it owns and where it can be cut **without touching**
EngineAPI, the Protocol, IPC, PTY ownership, persistence, the keyboard map, or the
seven-route contract.

## What GroundstationApp owns, by cluster

| Cluster | State atoms | Callbacks / effects | Already-extracted model it leans on |
|---|---|---|---|
| **Routing** | `view`, `integrationSection` | Alt-letter nav effect, `aria-current`, palette route jumps | `NAVIGATION`, `PRIMARY_NAV_COUNT=7`, `NAV_ALIASES`, `NAV_SHORTCUTS` |
| **Command palette** | `paletteOpen`, `paletteQuery` | Ctrl-K effect, `COMMAND_RECENTS_KEY` recents | in-file `CommandPalette`, `Command` |
| **Workspace focus** | `focusedTerminal`, `expandedTerminal`, `selectedWorker`, `workerFocusId`, `inspectorOpen`, `quickLookId` | Alt-1‥6 focus effect, Space quick-look effect | `useTerminalLayout` |
| **Modal stack** | `workerDialog`, `confirmation`, `recipesOpen`, `missionGraphOpen`, `missionAiPrompt`, `broadcastOpen`, `helpOpen` | one big Escape-precedence effect, F1/`?` help effect | `ConfirmationDialog` shape |
| **Projects** | `projects`, `projectsLoading` | `chooseProject`, `openProject`, `executeProjectOpen` | `project.open` / `project.choose` |
| **Agents** | `agentAdapters`, `agentsLoading` | `createAgent`, adapter-fetch effect | `AgentWorkspace` view |
| **Recipes** | `recipesOpen` | `deleteRecipe`, `runRecipeAction`, `launchRecipe`, `openRecipeBuilder` | `recipe.*`, `useTerminalLayout.applyLayout` |
| **Presets** | `presetCommands` | fetch effect | `preset.list` |
| **History cursor** | `historyCursors` | `HISTORY_CURSOR_KEY` | `HistoryView`, `memory.summary` |
| **Terminal alerts** | `terminalAlerts` | `onTerminalError` / `onTerminalRecovered` | feeds `useDecisions` |
| **Notices** | — | `setNotice` (text → toast severity regex) | `useToast` |
| **Model layer (leave alone)** | — | — | `useMissionState`, `useDecisions`, `useInterfacePreferences`, `useTerminalLayout`, `useToast` |

## Seams — extract in this order, full suite between each

### 1. Pure helpers → `renderer/lib/` (zero risk, unblocks the rest)
`timeAgo`, `runtime`, `eventTitle`, `evidenceSummary`, `sessionEvents`, `healthFor`,
`needsAttention`, `workerKind`, `workerProfile`, `agentPhase`, `sessionSummary`,
`decisionFor`, `recipeStatus`, `manifestState`, `evidenceBadges`, `workerActivity`,
`orderManifest`, `matchesFilter`, `layoutForCount`, `resourceValue`.
→ `lib/format.js`, `lib/worker.js`, `lib/manifest.js`. No hooks, no JSX — move + re-export.

### 2. Constants → `renderer/lib/`
`NAVIGATION`, `PRIMARY_NAV_COUNT`, `SECONDARY_DESTINATIONS`, `NAV_SHORTCUTS`,
`NAV_ALIASES`, `ICON_PATHS`, and every `*_KEY` string → `lib/nav.js`, `lib/storageKeys.js`.
The seven-route list stays exactly as-is; this only relocates it.

### 3. Leaf components → own files
`Icon`, `EmptyState`, `SinceLastCheck`, `GroundstationOnboarding`, `WorkerFocusDialog`,
`WorkerQuickLook`, `AttentionInbox`, `ManifestToolbar`, `WorkerInspector`,
`ActivityWaterline`, `ManifestList`, `ReferenceManifestRow`, `ReferenceRecipePanel`,
`GroundstationStatusBar`, `WorkerFolders`, `WorkerResourceIntelligence`,
`SettingChoice`, `NotificationSettings`, `VSCodeBridgeSettings`, `ResourceLinks`.
Props-only; each is a mechanical move + import.

### 4. Route views → `renderer/views/`
`LiveGroundstationView`, `WorkspaceView`, `NeedsView`, `HistoryView`, `SettingsView`,
`SettingsHub`, `AppSidebar`, `CommandPalette` (+ `Command`), `ConfirmationDialog`.
These already take props and only call `missionApi()` for their own domain. Move,
then repoint the string-coupled tests (`read("App.jsx")` → `read("views/<X>.jsx")`).

### 5. Behavior hooks → `renderer/hooks/` (last, one at a time)
| New hook | Absorbs |
|---|---|
| `useAppNavigation()` | `view`, `integrationSection`, Alt-letter effect, palette route jumps |
| `useCommandPalette()` | `paletteOpen`, `paletteQuery`, Ctrl-K effect, recents localStorage |
| `useWorkspaceFocus()` | the 6 focus/selection atoms, Alt-1‥6 effect, Space quick-look effect |
| `useModalStack()` | the 7 modal atoms + the Escape-precedence chain + F1/`?` effect |
| `useProjectSwitcher()` | `projects`, `projectsLoading`, the 3 project callbacks |
| `useAgentAdapters()` | `agentAdapters`, `agentsLoading`, `createAgent`, fetch effect |
| `useRecipes()` | `recipesOpen` + the 4 recipe callbacks |
| `usePresetCommands()`, `useHistoryCursor()`, `useTerminalAlerts()`, `useNotice()` | the small singletons |

### 6. Result
`GroundstationApp()` collapses to a ~120-line composition root: call the hooks, render
the route switch, render the modal stack. Target: App.jsx (or `GroundstationApp.jsx`)
under 200 lines; nothing else over ~250.

## Contracts that must survive every step

- `missionApi()` request/subscribe surface — hooks *call* it, never wrap or replace it.
- `useMissionState` snapshot + `events.activate` sequence handshake — untouched.
- `useTerminalLayout` slot model and `applyLayout` — untouched; PTYs stay engine-owned.
- `NAVIGATION` seven core routes + `PRIMARY_NAV_COUNT = 7`.
- Keyboard map: Ctrl-K palette, Alt-G/W/R/N/A/I/H/S nav, Alt-1‥6 terminal focus,
  Space quick-look, F1/`?` help, Escape precedence — identical behaviour after the move.
- `ConfirmationDialog` request shape `{ title, detail, recovery, confirmLabel, run }`.
- localStorage keys and payload shapes: `mission-control.history-cursor.v1`,
  `mission-control.command-recents.v1`, `mission-control.decision-queue.v1`,
  `mission-control.groundstation-favorites.v1`.
- StrictMode stays disabled (the terminal double-subscribe note in `main.jsx`).

## Cost

The tax is the source-string-coupled renderer tests: each `read("App.jsx")` +
`assert.match` that targets a moved symbol must repoint to the new file. Mechanical,
but it means **steps 3–5 are one-component-per-commit with `npm test` between**, never a
batch move. Steps 1–2 are safe to do together.

No task here changes runtime behaviour; T014's deliverable is this map. The moves
themselves are separate tasks (architecture phase) and each needs its own green suite.
