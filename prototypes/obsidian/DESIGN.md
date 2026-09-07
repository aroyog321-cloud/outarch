# Mission Control / Obsidian

An independent design overhaul, 5 September 2026. The existing HTML prototypes were excluded from reading and inspiration. No production source, existing prototype, or application package configuration is changed.

## Design read

An operational desktop prototype for developers managing local services, terminals and supervised agents. A Vercel-inspired dark canvas creates hierarchy around readable content. The direction is simple, calm and tactile. Visual variance 5/10 (asymmetric overview, stable shell), motion 3/10 (short feedback only), density 7/10 (readable registers and progressive detail), asset dependence 1/10 (the interface is the artifact), brand fidelity 6/10 (Mission Control name, route vocabulary and operational contracts preserved).

Narrative: orient, inspect, act, verify. Viewing distance: laptop/desktop. Temperature: composed, technical, approachable. Capacity: a 224px sidebar, flexible workspace, optional 300px context pane. At smaller widths, columns collapse and the sidebar becomes an accessible navigation drawer.

## Repository-grounded analysis

This is an interface/workflow investigation, not a fresh exhaustive engine audit or a claim that older audit findings remain unresolved.

| Source inspected | Product implication | Prototype response |
| --- | --- | --- |
| `src/groundstation/renderer/App.jsx` route dispatch and navigation | Groundstation, Workspace, Needs You, Agents, Recipes, History, Settings are core; Projects, Mission AI and Integrations also exist. | All ten destinations share one shell; capability links are visible. |
| `useDecisions.js` | One queue merges engine/integration decisions and renderer transport alerts; acknowledgement is distinct from resolution. | Badge, overview inbox, detailed queue and history derive from one local model. Acknowledge leaves failure visible. |
| `missionApi.js` | Real actions cross an explicit bridge; consequential requests use confirmation tokens. | Prototype does not invoke the bridge. Approvals and terminal commands are explicitly simulated. |
| `recipeBuilderModel.js` | Recipes have explicit dependencies, parallel and ordered templates. | Recipe preview, editable step selection and sequential launch demonstration. |
| `MissionAIScreen.jsx` | Project-aware assistant with suggested questions, evidence and planning. | Focused AI workspace with local scripted responses, evidence links and proposed recovery. |
| `IntegrationsView.jsx` | Six capability families with independent setup and truthful connection states. | Detailed integration directory with setup, permissions, simulated connection state and diagnostic feedback. |
| `App.jsx` Settings groups | Appearance/accessibility, terminal, notifications, defaults, integrations, security, diagnostics, about. | All groups get explicit destinations or functional local preferences. |
| `MISSION_CONTROL_ENTRY_POINT_INVENTORY.md` | Prior audit identified inconsistent recipe labels/destinations. Current code may already address parts of this. | “Recipes” always navigates; “Run recipe” opens a launcher; “Create recipe” opens an editor. |
| `package.json` | React/Radix/xterm/Electron production stack. | Independent HTML/CSS/JS prototype. Native dialog gives modal semantics; locally vendored icons/fonts avoid a build or runtime network dependency. Production should retain Radix/xterm rather than use the simulated terminal. |

## System

- Graphite canvas `#0b0e13`; dark surface `#12171e`; elevated content `#1b222b`.
- Primary text `#eef2f6`, secondary `#b0bac6`, muted `#95a2b1`.
- Soft silver primary action; mint status `#a9ddc4`; amber attention `#edc58b`; rose failure `#f2a7ae`; blue connection context `#afc6f3`.
- Inter Variable is retained as the existing product face, with deliberate 400/500/550/650 weights. JetBrains Mono for commands and evidence. 14px body, 12px captions, 30px page title; numbers tabular.
- 4px base rhythm. 8px within controls, 16–24px between groups, 32px page gutters.
- 8px control radius, 14px panel radius, 20px modal radius. Glass uses translucent graphite, a fine reflective upper edge and restrained shadow. No continuous animated backgrounds.
- Motion: 140ms control color/opacity feedback, 220ms small dialog reveal; no page-load animation. Reduced-motion and reduced-transparency fallbacks, plus persistent manual controls.
- Native semantic links/buttons/forms/dialogs. Escape closes dialogs, focus returns to trigger, skip link, visible focus, input errors and live feedback.

## Experience changes

1. A short project briefing states why attention is needed, followed by real actions.
2. Services live in a table; richer panels are used only for a different purpose: context, launch plans, assistant responses.
3. Overview balances the dominant register with a compact decision queue and event history. Selecting a worker opens an inspector without navigating away.
4. Workspace has split terminals, a worker navigator, view controls and a simulated command loop. Terminals keep opaque readable backgrounds.
5. Needs You uses an inbox/detail layout with evidence, impact, scope and one decision at a time.
6. Agent detail shows reported activity and verifiable checkpoints, without fictional percent-complete meters.
7. Recipe launching previews a dependency chain and names affected workers.
8. History exposes actor/type/search filters and exports the displayed demo records.
9. Integrations remain discoverable, including automation, mobile and plugins.
10. Settings separate preferences from operations; demo scenarios live under Tweaks while the visual system stays intentionally fixed.

## Prototype boundaries

All data is a labelled fictional local fixture. Worker starts/stops, approval decisions, terminal commands, AI responses, integrations and pairing are UI simulations. No shell execution, provider calls, credential storage, real pairing or service control occurs. Preferences and demo state are namespaced in localStorage; reset affects only this prototype. Production adoption needs actual EngineAPI wiring and runtime validation.

One visual system: Vercel-inspired dark. It follows the supplied core palette: black, dark neutral `#171717`, off-white `#fafafa`, white, and interactive blue `#0070f3`; it does not copy Vercel branding or assets. Green, amber and red are tightly reserved for live, needs-review and failure state, and each state also has an icon and text label. Tweaks exposes motion and loading/empty/disconnected scenarios.

Research sources and tradeoffs are in [RESEARCH.md](RESEARCH.md). Usage, interaction coverage and verification are in [README.md](README.md).
