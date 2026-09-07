# Mission Control / Obsidian

Open **index.html** directly in a modern browser. No install, build or server is needed. The root-level `MISSION-CONTROL-OBSIDIAN.html` is a shortcut to the same prototype. Keep this folder together when sharing it; fonts and icons are local.

This is a separate dark-mode redesign prototype. Existing prototypes and production application files were not used as visual inspiration or modified.

## Explore

- **Groundstation:** brief, worker register, search, filters, decision previews, agents, recent activity and recipe launch.
- **Workspace:** split/focus layout, worker selection, simulated command input (`help`, `pwd`, `clear`, `npm test`), broadcast input.
- **Needs You:** inbox/detail layout, evidence, acknowledge-without-resolving, deny, explicit one-time approval.
- **Agents:** select collaborators, review checkpoints, pause/resume or add a simulated agent.
- **Recipes:** create/edit, require at least one worker, preview dependencies, run a staged demo launch.
- **History:** search by event/actor, filter event type, export filtered JSON.
- **Settings:** appearance, density, reduced motion/transparency, terminal text size, demo notifications, project defaults, security explanation, diagnostics, reset.
- **Mission AI:** three suggested prompts plus free text; answers are explicitly scripted and link to relevant evidence/actions.
- **Integrations:** Mission AI, VS Code Bridge, MCP, Automation, Mobile Companion, Plugins; manage simulated connections and inspect scope.
- **Projects:** add a fictional project label/path and switch context. All projects share the demo fixture, as the screen explains.

The command palette opens with **Ctrl/⌘ K**. Arrow keys select commands, Enter opens, Escape closes. **Alt 1–7** navigates the main routes. Dialogs use the browser’s native modal focus behavior.

**Tweaks** in the bottom status bar exposes motion and loading/empty/disconnected Groundstation scenarios. The prototype is intentionally locked to one Vercel-inspired dark system: black, white, graphite and `#0070f3` blue. Green, amber and red are reserved only for readable live, attention and failure status. “Reset demo” restores only this prototype’s namespaced localStorage state.

## Implementation and limits

Native HTML, CSS and JavaScript. Inter Variable and JetBrains Mono are local, with bundled SIL licenses. Lucide 0.468.0 is locally vendored under ISC. No runtime CDN dependency. User-generated text is escaped before rendering. No engine bridge is imported.

All operational data is fictional. Commands, process controls, approvals, AI answers, integrations and pairing are visual simulations. No real shell, AI provider, credential store, filesystem grant or paired device is involved. Local browser storage is best effort; if unavailable, the current session remains usable.

This is a product design prototype, not production integration. Use the app’s existing React/Radix/xterm/EngineAPI stack when adopting it. In particular, the simulated terminal must never replace real xterm/PTY behavior, nor may UI state grant real authority.

## Design work

- [Research with primary sources](RESEARCH.md)
- [Repository analysis and design system](DESIGN.md)
- [Review and verification](REVIEW.md)
- [Asset provenance](brand-spec.md)

## Focused check

From the repository root:

```powershell
node --check prototypes/obsidian/app.js
node node_modules/electron/cli.js prototypes/obsidian/verify.cjs
```

The second command opens a hidden, sandboxed renderer with an in-memory partition, without the production engine. It checks routes, key interactions and reflow and writes screenshots and results into `verification/`. It does not open or mutate your normal browser demo state.
