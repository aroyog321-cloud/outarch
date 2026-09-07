# Asset provenance

Mission Control remains the product name. The existing renderer's text-based MC mark and product name are retained as text, without inventing a replacement logo or importing any prior prototype imagery. No repository image logo was found in the non-prototype source asset inventory.

This is an interface study, so photography and decorative product images are intentionally unnecessary. No previous prototype screenshot, HTML composition or CSS has been reused.

| Asset | Local path | Source / license |
| --- | --- | --- |
| Inter Variable Latin | `assets/inter.woff2` | Existing `@fontsource-variable/inter` dependency; SIL OFL in `INTER-LICENSE.txt` |
| JetBrains Mono Variable Latin | `assets/mono.woff2` | Existing `@fontsource-variable/jetbrains-mono` dependency; SIL OFL in `MONO-LICENSE.txt` |
| Lucide icons 0.468.0 | `assets/lucide.min.js` | Pinned upstream UMD bundle from `https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js`; ISC license |

The UI uses one icon vocabulary throughout. The pinned bundle is vendored so the prototype opens offline. For a production implementation, use individual icon imports and the existing bundler to remove unused icons.

Color, type, spacing, material and motion decisions are in `DESIGN.md`; the authoritative prototype tokens live in `obsidian.css`.
