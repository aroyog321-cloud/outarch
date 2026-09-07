# Duplicated capability entry points (T249)

Every place a capability can be triggered from Groundstation, the sidebar, status
areas, the command palette, and Integrations. The test is T249's rule: a contextual
shortcut earns its place only when its **destination and behaviour are predictable** —
the same label must not do two different things.

## Inventory

### Add worker — 6+ entry points, all identical → **predictable, keep all**
| Surface | Handler |
|---|---|
| Groundstation onboarding "Add your first worker" | `setWorkerDialog({ mode: "create" })` |
| WorkspaceView "Add terminal worker" button | same |
| Every empty terminal slot "+ Create worker" | same |
| `Ctrl/⌘ N` | same |
| Command palette "Add a new worker" (shortcut N) | same |
All open the one create dialog. No conflict.

### Ask Mission AI — 7 entry points, one destination → **predictable, keep**
Groundstation status bar, worker inspector, terminal pane (CrashLens), History event
panel, Recipes view, Integrations overview hero, worker dialog. Each seeds a
context-specific prompt; all land on the same Mission AI dialog. The Integrations
overview one passes **no** context (`openMissionAI()`) despite a project-aware hero —
minor, worth seeding.

### Mission Graph — 3 entry points, one destination → **predictable, keep**
LiveGroundstationView, WorkspaceView, palette "Open Mission Graph" → all
`setMissionGraphOpen(true)`.

### Start / stop all workers — 2 surfaces, same behaviour, **label drift**
| Surface | Label | Handler |
|---|---|---|
| WorkspaceView buttons | "Start workspace" / "Stop workspace" | `startWorkspace` / `stopWorkspace` |
| Command palette | "Start all idle workers" / "Stop all running workers" | same |
Same action, two names. Pick one verb.

### Recipes — **the real problem: one label, two destinations**
| Surface | Label | Actually does |
|---|---|---|
| Sidebar | "Recipes" | navigates to the **Recipes route** (`setView("recipes")`) |
| Command palette | "Open workspace recipes" | navigates to the **Recipes route** |
| Groundstation status bar | "Recipes" | opens the **WorkspaceRecipes builder dialog** (`openRecipeBuilder()`) |
| Groundstation `ReferenceRecipePanel` | "Manage" | opens the **builder dialog** |
| Groundstation onboarding | "Create a recipe" | opens the **builder dialog** |
| WorkspaceView | "Recipes" | opens the **builder dialog** |
| Recipes route (`RecipesView`) | "New recipe" / "Edit graph" | opens the **builder dialog** (correct — explicit create/edit) |

A "Recipes" button in the status bar and a "Recipes" item in the sidebar do different
things. Someone who learns one is surprised by the other. Palette also names the same
route "Open workspace recipes" while the sidebar calls it "Recipes".

## Recommendation

1. **"Recipes" always means "go to the Recipes route."** Rewire the Groundstation
   status-bar button, `ReferenceRecipePanel` "Manage", the onboarding "Create a recipe"
   button, and the WorkspaceView "Recipes" button to `onNavigate("recipes")`.
2. **The builder dialog opens only from an explicit create/edit action**, and only
   from inside the Recipes route (`RecipesView` "New recipe" / "Edit graph" / "Duplicate"),
   where it already lives. `MissionGraph`'s "Open recipes" should navigate too.
3. Rename palette "Open workspace recipes" → "Open Recipes"; unify the workspace
   start/stop verb across the buttons and the palette.
4. Seed the Integrations-overview "Ask Mission AI" with a project-context prompt.

Items 1–3 change navigation behaviour, so they need visual sign-off before shipping —
this doc is the inventory (the T249 deliverable); the rewire is the follow-up.

`test/entryPointInventory.test.cjs` pins the current wiring so the consolidation shows
up as an intentional diff (and a *new* divergent "Recipes" destination fails the build).
