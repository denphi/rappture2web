# TODO — Styling & UX for small windows / iframe (MCP-size) embedding

> **Implemented 2026-07-11:** the layout now uses a `100dvh` flex column with
> an in-flow footer, switches to exclusive full-height Inputs/Results tabs at 900px,
> supports minimal embed chrome, stacks narrow input controls, uses an
> overflow toolbar menu, overlays 3D panels, and enlarges touch targets. The
> configured suite passes all 40 viewport/iframe and real-renderer cases plus 176 non-visual
> tests. The unchecked alternatives below are retained as design history and
> possible follow-up refinements.
>
> **Fixed 2026-07-13/14 — dead Results/⋯ buttons in embedded iframes.** Two
> distinct causes, both fixed:
>
> 1. *Script-blocked iframes* (`<iframe sandbox>` without `allow-scripts`):
>    the buttons rendered but no JS ran, leaving results and toolbar actions
>    permanently `display:none`. JS-dependent narrow-layout rules are now gated
>    on an `html.rp-js` marker class (inline script in `base.html`); without
>    scripts the UI falls back to a static stacked layout with both panes
>    visible, an inline toolbar, no dead buttons, and a `<noscript>` banner.
>    Regression test: `test_iframe_with_scripts_blocked_degrades_gracefully`.
>
> 2. *com_mcp chat / rappturemcp MCP-App transport* (the reported case):
>    rappturemcp strips rappture2web's REST/WebSocket bootstrap from the
>    inlined JS and re-implements the init calls — but its list predated
>    `initCompactLayout()`, so the pane switch and ⋯ menu were never wired
>    even though scripts ran. Fixed on both sides: `rappture.js` now registers
>    the UI-local wiring in its own `DOMContentLoaded` listener outside the
>    strippable bootstrap block (idempotent), and rappturemcp's bootstrap now
>    calls `rappture.initCompactLayout()` (guarded) for older inlined assets.
>    Verified end-to-end against the exact com_mcp srcdoc iframe
>    (`sandbox="allow-scripts allow-forms"`).

Goal: make the tool UI usable and pleasant in narrow, short viewports — the kind
of embed an MCP host or a docs iframe gives you (roughly **360–700px wide**,
often **≤ 600px tall**). Today it *functions* at these sizes but the UX is poor:
the sidebar and results fight for space, the header math breaks when the toolbar
wraps, input labels eat half the row, and there's no way to reclaim space.

All line references are to the current `main`.

---

## 1. Fix the broken viewport-height math (highest impact)

The layout height is computed from **hardcoded** header/footer heights:

- `rappture2web/static/css/rappture.css:17-19` — `--rp-header-height: 76px`,
  `--rp-header-height-with-toolbar: 124px`.
- `rappture2web/static/css/rappture.css:224-227` — `.rp-main { height: calc(100vh - var(--rp-header-height) - var(--rp-footer-height)); }`

**Problem:** in a narrow iframe the toolbar (`.rp-toolbar-actions`) and brand bar
wrap onto extra lines, so the *real* header is taller than 76/124px. The
`calc()` then under- or over-subtracts, leaving the results pane clipped or a
dead gap, and the `position: fixed` footer (`:743`) overlaps content because its
height was subtracted from a stale total. The `@media (max-width:768px)` block
(`:1446-1447`) re-hardcodes 68/118px — same fragility at a second breakpoint.

**Fix (pick one):**
- [x] **Preferred:** drop the `calc()` entirely. Make `body` a
  `display:flex; flex-direction:column; height:100dvh` column with header
  (auto), `.rp-main` (`flex:1; min-height:0`), footer (auto) as flex children.
  Height then tracks the *actual* header/footer size at any wrap. Removes the
  need for `--rp-header-height*` vars and the per-breakpoint overrides.
- [x] Switch `100vh` → `100dvh` regardless — `vh` includes mobile browser
  chrome and is wrong inside short iframes.
- [x] Make the footer part of the flex column (not `position: fixed`) so it can
  never overlap results.

## 2. Collapse to single-column much earlier + make it intentional

- `rappture2web/static/css/rappture.css:228-246` — `.rp-layout` is `flex` (row)
  with `.rp-sidebar { width: min(40vw,780px); min-width: 320px; }`.
- The single-column stack only kicks in at `@media (max-width:768px)` (`:1431`).

**Problem:** between ~600–768px the sidebar still sits side-by-side at its 320px
floor, leaving the results pane <300px — unusable for a plot/3D view. In MCP
embeds the *width* is often 400–500px, so the results pane is the thing that
matters and it's being starved.

- [x] Raise the stacking breakpoint (or add a `~900px` intermediate) so the
  sidebar stacks above results well before 768px.
- [x] Add a **container query** (`@container`) on the main workspace, with a
  viewport media-query fallback — an iframe's viewport ≠ the tool's real box, and
  container queries respond to the *actual* embed width.
- [x] At narrow sizes, use exclusive full-height Inputs/Results panes so neither
  pane is forced into a clipped vertical share.

## 3. Add a sidebar collapse / toggle (reclaim space on demand)

There is **no** way to hide inputs and give results the full width. On a phone
or a 420px MCP frame the user is stuck scrolling a tall input form to reach a
plot.

- [x] Add a persistent **"Inputs ⟷ Results" toggle** (or a collapsible sidebar
  drawer) in the header/toolbar for narrow layouts. Two tabs ("Inputs",
  "Results") that swap which pane is visible works well in tiny frames.
- [x] Remember the choice (localStorage keyed by tool) so re-runs don't reset it.
- [x] `resize: horizontal` on `.rp-sidebar` (`:245`) is mouse-only and useless on
  touch / when stacked — hide it in the narrow/stacked layout.
- [x] After toggling, call the existing plot resize path
  (`rappture.js:_plotResizeObserver` / `Plotly.Plots.resize`, `:33`,`:960`) so
  plots re-fit the new width. A `ResizeObserver` on `.rp-content` is likely
  already close — verify it fires on the toggle.

## 4. Input widgets: the 160px label column is too rigid

- `rappture2web/static/css/rappture.css:285-294` — leaf inputs use
  `grid-template-columns: 160px 1fr`.
- `:1660-1668` — structure params use `130px 1fr`.

**Problem:** in a ~360–420px sidebar, 160px of fixed label leaves ~180px for the
control, and long labels wrap awkwardly while the control stays cramped.

- [x] Below a threshold, switch leaf widgets to **single-column stacked**
  (`grid-template-columns: 1fr`, label above control). Cleanest via a container
  query on the sidebar/widget, else the narrow media block.
- [ ] Or make the label column fluid: `minmax(0, 160px) 1fr` / `clamp()` so it
  shrinks before the control does.
- [x] `.rp-number-controls` + `.rp-preset-select` (`:430-449`, preset
  `max-width:160px`) overflow on narrow rows — let them wrap to a second line.

## 5. Header / toolbar density in narrow frames

- `.rp-brand-bar` min-height 76px + `.rp-toolbar` (`:98`,`:157`) is a lot of
  vertical chrome to spend when the frame is only ~500px tall.
- `.rp-powered-by` (`:106`) + brand text + toolbar links can consume 30–40% of a
  short iframe before any tool content shows.

- [x] In short/narrow layouts, shrink brand-bar height, hide the
  `rp-brand-platform` sub-label and/or the "Powered by" line (keep it in a
  footer/menu), and reduce toolbar link padding.
- [x] If the toolbar actions wrap to 2+ lines, collapse them into an overflow
  "⋯" menu instead of stacking (ties into #1's height fragility).
- [x] Add an **embed/compact mode** query param (e.g. `?embed=1` or
  `?chrome=minimal`) that the template (`base.html:23`, `tool.html`) honors to
  drop non-essential chrome for MCP/iframe hosts. Cleaner than guessing from
  width alone.

## 6. Results toolbar, output selector & fullscreen on small screens

- `.rp-output-tabs` / `.rp-output-selector` (`:820-845`) — selector
  `max-width:420px`, fine, but the tab row doesn't wrap gracefully.
- `.rp-fullscreen-btn` (`:892`) + fullscreen toolbar (`:943-1017`) — fullscreen
  uses `position: fixed; inset:0` which, inside an iframe, only fills the iframe
  (often desired) — **verify** it isn't clipped by the frame and that the
  fullscreen run-menu (`:978`) doesn't overflow the frame edge.
- [x] Make fullscreen the *primary* affordance in narrow embeds (a plot at
  360×300 is nearly useless otherwise) — surface the button more prominently.
- [x] Let `.rp-output-tabs` wrap and the selector go full-width under ~500px.

## 7. 3D / field control panels eat the whole frame

- `.rp-3d-panel { width: 240px }` (`:1102`) docked beside the canvas
  (`:1080-1084`).

**Problem:** 240px of side panel next to a canvas in a 400px frame leaves ~140px
for the actual 3D view.

- [x] In narrow layouts, make the 3D/field control panel an **overlay drawer**
  (absolute-positioned, slides over the canvas) instead of stealing width, or
  collapse it by default (the collapse mechanism already exists — `.collapsed`,
  `:1109`; it now defaults collapsed below the width threshold).

## 8. Touch & spacing polish

- [x] Audit tap targets: several controls are 28–30px
  (`.rp-seq-btn` 28px `:1594`, `.rp-run-*` 30px, `.rp-3d-btn` small). Bump to
  ≥40px in the narrow/touch layout for comfortable tapping.
- [x] Run-history rows (`:1244`) are `cursor: grab` drag-reorder — drag is
  hostile on touch; provide the up/down buttons (already present, `:1320`) as
  the primary reorder path on small screens and enlarge them.
- [x] Verify horizontal scroll never appears at 360px: wide offenders are the
  periodic-element table (`:1493` has `overflow-x:auto`, good), data tables
  (`:1555`), and driver-XML / log string outputs — wrap each in an
  `overflow-x:auto` container.

## 9. Testing / verification

- [x] Add a manual QA checklist (or Playwright viewport snapshots) at
  **360×640, 420×600, 500×500, 768×500, 1024×768** covering: header height
  correct (no clipped/overlapping results, #1), single-column stacking (#2),
  sidebar toggle (#3), a plot output, a 3D field output, and a long input form.
- [x] Test literally inside a small `<iframe>` (not just a narrow browser
  window) — `dvh`/`vh` and `position:fixed` behave differently there, which is
  the whole point.

Automated real-renderer fixtures:

- `examples/zoo/curve/test/defaults.xml` — Plotly curve and fullscreen.
- `examples/zoo/field/test/defaults.xml` — 2D and 3D field renderers.
- `examples/3D/run1772755170142000.xml` — Crystal Viewer drawing/WebGL output.

Manual stress fixtures (kept out of routine screenshots because of their size):

- `examples/3D/pntoy_b1836eb342042de9efc15b61dc5b547e1037084d.xml`
  — 5.7 MB, hundreds of curves plus fields and sequences.
- `examples/3D/qdot_e27bcd4d3500207cdbb7f2722a9de3c18a09993e.xml`
  — 3.3 MB, curves, fields, images, and a sequence.

UX review follow-up:

- [x] Integrate the narrow overflow menu into the brand row instead of spending
  a separate toolbar row on one button.
- [x] Keep Simulate sticky and reachable while scrolling long input forms.
- [x] Give collapsed renderer controls a 40px keyboard-operable handle with
  focus, Enter/Space activation, and synchronized `aria-expanded`.
- [x] Switch narrow workspaces to Results after a successful run-XML upload.

WCAG 2.1 AA / ADA-oriented remediation:

- [x] Remove duplicate footer/results live regions so status changes are not
  announced multiple times or as an entire plot subtree.
- [x] Associate boolean, integer, string, and loader descriptions/hints with
  their controls.
- [x] Label run-selection checkboxes, list items, color dialogs, palette colors,
  and cache state controls.
- [x] Make run renaming available with Enter/F2 instead of requiring a mouse
  double-click.
- [x] Transfer focus to Results after narrow simulation/upload navigation and
  support arrow-key navigation between workspace panes.
- [x] Disable run-row drag behavior in narrow/touch layouts and improve dark
  renderer-panel heading contrast.

---

### Suggested order

1. **#1** (height math) and **#2** (early stacking) — biggest UX wins, unblock
   everything else.
2. **#3** (sidebar toggle) + **#5** embed mode — give users control of the space.
3. **#4** (input layout) + **#6/#7** (results & 3D panels) — per-widget polish.
4. **#8/#9** — touch polish and regression coverage.
