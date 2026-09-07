# Mission Control — design system contract

Created: 4 September 2026
Covers: T143 (token layers), T145 (theming), T146 (density), T147 (status colour),
T148 (motion), T149 (cascade discipline), T154 (reduced motion).

This is the contract, not a style guide. Every rule here is asserted by
`test/designSystem.test.cjs`, so a change that breaks one fails the build rather
than drifting quietly. The companion documents are
`MISSION_CONTROL_CSS_BASELINE.md` (what the stylesheets were) and
`src/groundstation/renderer/redesign/README.md` (why the redesign layer exists).

---

## 1. The three token layers (T143)

Every value belongs to exactly one layer, and layers only ever read downwards.

| Layer | Lives in | Looks like | Owns |
|---|---|---|---|
| **Primitive** | `redesign/tokens-bridge.css` `:root` | `--mc-void`, `--mc-surface-3`, `--mc-duration-fast`, `--mc-ease-enter` | The raw scale. A colour, a length, a duration. Names describe *what it is*, never where it is used. |
| **Semantic** | `redesign/tokens-bridge.css` `:root` and the theme blocks | `--mc-accent`, `--mc-ok`, `--mc-warning`, `--mc-danger`, `--mc-text-dim`, `--mc-motion-fast` | The role a primitive plays. Names describe *what it means*. This is the only layer a theme redefines. |
| **Component** | The component's own rule | `--mc-manifest-row-height`, `--mc-gs-toolbar-clearance` | A metric that only one component family needs. Composed from semantic tokens. |

**The rules**

1. A component rule reads **semantic** tokens. It may read a primitive only for a
   scale value that has no semantic meaning (a radius, a blur).
2. A component **never** hardcodes a colour. `#hex`, `rgb()` and `hsl()` in a
   component rule are the defect class that produced 30 black slabs in the light
   theme; see §3.
3. The legacy `*-semantic` aliases (`--text-muted-semantic`, …) exist only so the
   two `premium*` stylesheets keep resolving. New component code must not read
   them — they are defined twice from different sources and drift under theme
   switches. Guarded by `sourceIntegrity.test.cjs`.

## 2. Theming redefines semantics, never components (T145)

`.theme-solar` and `.theme-contrast` re-point **semantic tokens** and nothing
else. A theme block that names a component class is a bug: it means that
component is unthemed everywhere the block does not reach, which is how the
Agents tab strip and the workspace folder bar stayed black in Solar Light.

The corollary is the rule that actually gets enforced: **a live component surface
may not paint a dark background with a literal colour**, because nothing restates
it per theme. `cssBaseline.test.cjs` scans for exactly this and names the
offending class. Terminal output surfaces are the one exception — the terminal
keeps its own theme, which Settings states in copy.

## 3. One status colour mapping (T147)

Five semantic roles, used identically everywhere a state is shown — terminals,
agents, recipes, integrations, attention, decisions:

| Role | Token | Means | Never means |
|---|---|---|---|
| Live / healthy | `--mc-ok` | The engine reports it is up and doing its job | "we sent the request", "it probably worked" |
| Attention | `--mc-warning` | A person must decide something | A failure that already happened |
| Failure | `--mc-danger` | It failed, or it is destructive | A warning, a low-severity notice |
| Operational accent | `--mc-accent` | Selection, focus, the primary action | Status of any kind |
| AI | `--mc-ai` | Model-generated or model-assisted | Anything the engine itself produced |

Two consequences worth stating because they are easy to get wrong:

- **The accent is not a status.** A selected row and a running row must not read
  the same. Selection uses `--mc-accent`; running uses `--mc-ok`.
- **Green is engine-reported liveness, never an assumption.** A worker is green
  because the engine says its process is alive, or because a check actually
  passed — never because Mission Control asked for something and did not hear
  back. The audit's complaint about fabricated confidence is about the second
  case, and the rule that answers it is *evidence*, not *hue*: if the engine did
  not report it, it is not green.

  Green covered only "verified passed" until 2026-09-05, with running painted in
  the accent. That collapsed running and selected into one colour, and left the
  most common state in the app with no status colour at all.

Each role carries a `-soft` fill and, where it is used for glow, a `-glow`
variant, so a component never mixes its own alpha.

## 4. Density changes documented metrics (T146)

`.shell.density-{compact,comfortable,spacious}` redefine exactly one set of
tokens — the spacing scale (`--mc-space-1` … `--mc-space-10`), `--mc-control-height`
and `--mc-manifest-row-height`. Components consume those. A component that
adjusts its own margins per density is a bug: density stops being predictable the
moment it is implemented in more than one place.

## 5. Motion (T148, T154, T165)

Duration and easing are separate primitives so a component can borrow one without
the other:

```
--mc-duration-fast: 120ms;   --mc-ease-standard: ease-out;
--mc-duration-base: 190ms;   --mc-ease-enter: cubic-bezier(.16, 1, .3, 1);
--mc-duration-enter: 260ms;
--mc-motion-fast:  var(--mc-duration-fast)  var(--mc-ease-standard);
--mc-motion-base:  var(--mc-duration-base)  var(--mc-ease-standard);
--mc-motion-enter: var(--mc-duration-enter) var(--mc-ease-enter);
```

**Zero motion has one owner** (`redesign/surfaces.css`), and it owns it twice:
the OS `prefers-reduced-motion` preference and the in-app Motion setting
(`.shell.motion-reduced`) resolve to the same rule, so an operator who cannot use
the OS control gets the same result. It works in two layers — setting the three
durations to `0ms` stills everything composed from the tokens, and a blanket rule
catches legacy stylesheets that hardcode their own timings. Eighteen duplicated
blocks across fourteen stylesheets were folded into this one.

**What may animate** (T165): navigation, selection, expansion, progress, success,
failure, attention. **What may not**: layout. No transition may name `width`,
`height`, `margin`, `padding`, `top` or `left` — a reflow during a state change
is the single most common cause of a UI that feels unstable.

## 6. Cascade discipline (T149)

The redesign layer loads last (asserted by `cssBaseline.test.cjs`) and reaches
the specificity it needs with `#root#root .shell`, not with `!important`. Two
ratchets hold this: the `!important` and raw-colour totals may only go down.
Both counters read the whole file **including comments**, so a comment that
quotes the literal value it is replacing will fail the build — describe values in
words.

A new component must not depend on import order beyond "the redesign layer is
last". If a rule needs more than `#root#root .shell` to win, the legacy selector
it is fighting should be deleted instead.

---

## 7. Resource states (T141)

Nine states, each with its own tone **and** its own non-colour signal, because
colour alone is not a distinction for every operator and the High-contrast theme
compresses the palette. `ResourceState` in `StatusChip.jsx` is the only place
they are drawn.

| State | Means | Signal beyond colour |
|---|---|---|
| `loading` | We do not know yet | Pulsing dot |
| `ready` | We asked and it answered | Solid fill |
| `empty` | We asked, it answered, there is nothing | No dot at all |
| `stale` | Older answer; the refresh failed | Hollow dot |
| `offline` | Not connected right now | Dashed border |
| `unconfigured` | Works, but you have not set it up | Dashed, stronger border |
| `unavailable` | This build or platform cannot | Dotted border, hollow dot |
| `disabled` | You cannot right now, for a stated reason | Solid border, reduced contrast |
| `error` | We tried and it failed | Danger fill, `role="alert"` |

The three pairs worth never collapsing, because collapsing them is how an app
lies: **`empty` vs `loading`** (nothing at all vs nothing *yet*), **`unavailable`
vs `disabled`** (cannot ever vs cannot now), and **`stale` vs `ready`** (old
truth vs current truth). `loading` also carries `aria-busy`, which is what tells
a screen reader the value is not final.

## 8. Persistent versus transient feedback (T142)

| Feedback | Lifetime | Why |
|---|---|---|
| A failure (`toast.danger`) | Until dismissed | A failure that vanishes in 4.5s is one the operator may never have seen, and "did that work?" is the question this app exists to answer. |
| Anything carrying an action | Until acted on or dismissed | An action you cannot reach is not an offer. |
| Success and info | 4.5s | Reassurance, and reassurance that piles up is noise. |
| A diagnostic result (test notification, port inspection) | Stays on the page | You may need to read it twice while fixing something else. A toast is the wrong shape for it. |

## 9. Text (T157, T158)

**Case.** Navigation and page titles name a place, so they are Title Case
("Needs You", "Mission Control Settings"). Everything else the operator reads as
a sentence — button labels, field labels, help text, empty states — is sentence
case ("Add terminal worker", "Restore defaults"). Section kickers are the one
uppercase treatment, and they are decorative labels, never content.

**Truncation.** Two utilities, and no component invents a third:

- `.mc-truncate` — end truncation, for names, titles and labels. The interesting
  part is the beginning.
- `.mc-truncate-path` — start truncation, for paths, commands and identifiers.
  The interesting part of `C:/very/long/path/to/frontend` is `frontend`.

Anything truncated must carry the full value in `title` or `aria-label`. A
truncated element with neither has lost information, and the stylesheet marks it
with a dotted warning underline rather than letting it pass unnoticed.

## 10. Cursor affordances (T159)

One rule each, so a control never contradicts itself: `pointer` for anything
activatable, `not-allowed` for disabled and `aria-disabled`, `col-resize` /
`row-resize` on separators by orientation, and `text` on code, paths, and
evidence — which stay selectable even inside a clickable row, because their
whole purpose is being copied.
