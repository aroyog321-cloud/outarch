# Obsidian: research and design rationale

Research date: 5 September 2026. Scope: an independent, interactive HTML/CSS/JavaScript concept for Mission Control's complete application experience. This document describes design evidence and proposed acceptance criteria; it does not claim production integration, measured usability improvements, or superiority to competing products. The existing prototype was neither inspected nor used as a visual reference for this research.

## Design thesis

Make Groundstation a calm place to understand a development session and act on it. Premium quality should come from legible information, precise alignment, coherent navigation, useful details, and predictable interactions. Smoked glass provides a recognizable material for the shell and temporary controls; the work itself remains on stable, dark surfaces.

The proposed identity is graphite, silver, and restrained mint. Silver identifies the principal action. Mint gives the application a subtle signature and marks healthy demo states alongside explicit labels. Amber indicates an unresolved decision; red indicates failure. These are project design decisions, not colors prescribed by the sources below. Every operational reading in the prototype is a labelled simulation.

## Evidence and implications

### 1. Material needs a functional purpose

Microsoft describes acrylic as a way to establish hierarchy and preserve contextual relationships. Its guidance cautions against adjacent or stacked acrylic surfaces, favors opaque persistent content divisions, and recommends acrylic for transient or overlapping supporting surfaces. It also documents GPU cost and solid fallbacks when transparency is unavailable or disabled. [Microsoft: Acrylic material](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)

**Application decision:** concentrate blur in the command palette, dialogs, and restrained shell chrome. Use opaque or nearly opaque surfaces for worker rows, log output, code, and approval evidence. A thin edge highlight and subtle shadow may suggest thickness without introducing another blurred layer. Provide a reduced-transparency option. The tradeoff is deliberately less dramatic glass in exchange for steadier contrast and lower rendering cost.

### 2. Separate navigation from content

Apple's materials guidance distinguishes the functional layer of navigation and controls from the content layer. It advises sparing use of Liquid Glass and cautions that applying it throughout content muddies hierarchy. The WWDC presentation demonstrates the same principle and explicitly discusses avoiding glass on glass. [Apple: Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Apple: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)

**Application decision:** retain a recognizable sidebar, with consistent page titles and actions. Let workspace content be the visual anchor. This prototype borrows the conceptual separation of layers; CSS blur does not reproduce Apple's native optical material, adaptive luminance, compositor behavior, or accessibility integration. Native Liquid Glass is not a dependency or a claimed feature of this web prototype.

### 3. Dense operations deserve structured rows

Carbon recommends data tables for locating resources and performing tasks. It places search and global controls in a toolbar, favors giving dense tables generous width, and uses expansion or detail surfaces to progressively disclose additional information. Individual actions need distinct click targets. Carbon also describes visible row hover, concise column headings, and inline actions when the action set is small. [Carbon: Data table usage](https://carbondesignsystem.com/components/data-table/usage/)

**Application decision:** Groundstation uses an operational register with status, worker identity, command, evidence, and direct actions. One selected worker opens a contextual inspector. Secondary columns yield first when space shrinks. Search operates locally; filters explain the empty result. Recipe and integration surfaces can use richer blocks when they communicate genuinely different capabilities, while repeated worker and history records remain rows.

### 4. Dark mode must keep readable text readable

WCAG's minimum text contrast is 4.5:1 for normal text and 3:1 for qualifying large text, with defined exceptions. Placeholder text is also covered. The guidance warns that thin glyphs can appear weaker than their computed contrast suggests. [W3C: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

**Application decision:** primary content uses an off-white foreground; secondary content remains intentionally readable rather than disappearing into gray. Reserve faint colors for decoration, not commands or evidence. Measure contrast against the actual composited background, including hover and selection. Do not claim WCAG conformance merely because the base palette passes: every route, state, focus treatment, and interaction needs verification.

### 5. Floating surfaces must preserve keyboard orientation

WCAG 2.4.11 requires that keyboard-focused components are not entirely hidden by author-created content. Sticky regions and translucent overlays can still obscure interaction. W3C's dialog pattern moves focus into an opened dialog, contains Tab navigation, supports Escape, and normally returns focus to the invoking element. [W3C: Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), [W3C: Modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

**Application decision:** use semantic buttons and labelled controls, a visible focus ring, and a keyboard-operable command palette. Dialogs have a close control and restore focus. Route changes identify the new page. Toasts never become the only record of a consequential result. Scroll containers reserve enough space that toolbars and footers cannot cover focused controls.

### 6. Density and target size are different decisions

WCAG 2.5.8 generally specifies targets of at least 24 by 24 CSS pixels, while allowing defined spacing and other exceptions. This is an AA criterion; a blanket statement that AA requires every target to be 44 pixels would be inaccurate. [W3C: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

**Application decision:** maintain comfortable hit areas around compact icons, with larger controls for primary touch actions. On smaller viewports, simplify secondary evidence and change layout before shrinking labels and controls. Test at narrow widths and browser zoom; desktop density should not depend on tiny pointer targets.

### 7. CSS glass needs graceful degradation

MDN explains that `backdrop-filter` affects the region behind an element; some transparency is necessary to see it. It identifies broad availability in current browsers while warning about older versions. [MDN: backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)

**Application decision:** supply a readable solid background first, enhance it with partial transparency and blur under `@supports`, and make the opaque appearance equally intentional. Avoid animated full-screen blur. The page cannot see the Windows desktop through its normal document background; the visible material is an in-page effect. Native Electron window translucency would be separate implementation work.

### 8. Motion should clarify one change at a time

`prefers-reduced-motion` communicates the user's preference to remove, reduce, or replace nonessential animation. MDN identifies large scaling and panning as possible vestibular triggers. [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

**Application decision:** use brief transitions for state feedback and overlay entry, avoid looping decorative motion, and remove nonessential transforms when reduced motion is requested. Motion duration and easing are prototype choices to be reviewed in context; there is no universal timing value that proves an interface is premium.

### 9. A terminal surface carries a different trust boundary

xterm.js warns that terminal data is untrusted, that embedders must avoid unsafe DOM insertion, and that its demo transport is not a production security solution. [xterm.js: Security](https://xtermjs.org/docs/guides/security/)

**Application decision:** the prototype renders labelled sample terminal content and simulates local interactions. It does not establish a PTY, execute commands, request secrets, or present a real agent connection. Production adoption must retain the application's existing terminal transport and lifecycle contracts; integrating a terminal renderer is separate from designing its surrounding controls. Dynamic names, commands, and prompt text require safe text rendering.

## Whole-application information architecture

The following matrix is a design proposal based on the requested application scope, not a claim about implementation completeness. The main navigation preserves Groundstation, Workspace, Needs You, Agents, Recipes, History, and Settings in that order. Mission AI and Integrations are discoverable secondary destinations; Projects is reachable through the project switcher.

| Destination | Main question | Proposed composition and interaction |
| --- | --- | --- |
| Groundstation | What is running, and what needs me? | Compact session summary, attention strip, wide worker register, contextual worker inspector, useful activity. Direct terminal and recipe entry points. |
| Workspace | Where do I do focused work? | Terminal takes the dominant area; worker/session navigation stays compact. Switching, adding, and splitting sessions preserve a clear active target. |
| Needs You | What decision or recovery is waiting? | Actionable queue with source, scope, evidence, and per-item decision controls. Acknowledgement and recovery are different states. |
| Agents | Who is working, with which capabilities? | Agent roster plus selected-agent detail, tool access, current activity, and associated terminal. Status and provider identity are separate. |
| Recipes | How do I repeat a workflow? | Searchable named workflows, prerequisites and worker sequence in detail, an explicit Run control, and a visible simulated result. |
| History | What happened, and why? | Filterable chronological events with worker, time, outcome, and evidence detail; export gives a usable local artifact. |
| Settings | How do I control my environment? | Labelled categories, predictable forms, visible save/reset feedback, appearance and accessibility controls; no real credential collection in a demo. |
| Mission AI | How can assistance help this session? | Context summary, starter actions, readable response and next action; simulated responses explicitly identify themselves. |
| Integrations | What can this workspace connect to? | MCP, VS Code Bridge, mobile access, and plugins together in a capability inventory, with individual configuration details and demo connection states. |
| Projects | Which context am I operating in? | Searchable project list behind the switcher, selected-project state, and an explicit route back to that project's Groundstation. |

## Implementation choice and tradeoffs

Use plain HTML, CSS, and JavaScript for an isolated, inspectable prototype that can be opened locally. Browser-native controls and locally available assets reduce installation friction. Add a library only when it solves a concrete requirement more reliably than a small local implementation. A large component framework does not itself establish visual quality, and importing multiple design systems would make consistency harder to judge.

The prototype should prioritize coherent navigation and meaningful state changes over backend imitation. Shared in-memory demo state can connect Groundstation, Needs You, History, and Workspace so that a simulated restart or approval produces consistent visible feedback. Any persistence belongs in a namespaced local prototype store, with a reset action, and must be described accurately.

## Review criteria

- [ ] A new user can identify project context, running work, and the next required action from Groundstation without opening Settings.
- [ ] All ten destinations contain purpose-specific content and share the same shell, spacing, controls, and type hierarchy.
- [ ] Every visible actionable control either changes meaningful demo state, opens relevant detail, navigates, or clearly explains its demo limit.
- [ ] The terminal and all connection/provider results are identified as simulated; no UI implies a live backend.
- [ ] Keyboard navigation, command palette, dialogs, Escape, and focus restoration work.
- [ ] Search and filters include empty-result behavior; acknowledgement never falsely becomes successful recovery.
- [ ] Narrow viewports and zoom keep navigation and primary actions reachable without page-wide horizontal overflow.
- [ ] Reduced motion and reduced transparency remain usable; missing blur support does not affect readability.
- [ ] Contrast is checked on actual surfaces and states. Any automated accessibility results are recorded with their scope and limits.
- [ ] Existing prototypes and production source remain intact. A fresh reviewer can open this prototype from its own directory.

## What this research does not establish

These sources support material, information, and interaction choices. They do not prove that this concept is best in its category, that it improves task completion time, or that it is ready for production. Next-stage evaluation should use representative tasks: locate a failed worker, understand its evidence, recover it, review scoped access, find a recipe, switch project, and inspect history. Observe time, mistakes, and confidence before making competitive claims.
