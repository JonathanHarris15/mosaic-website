# ADR 0008: Service Guide Template System — Full Replacement + Per-Week Snapshot

## Status
Accepted

## Context
The Service Guide is currently built from **eight hardcoded page types** (`title_page`,
`order_of_service`, `hymn_pages`, `pastoral_prayer`, `sermon_notes`, `kids_section`,
`announcements`, `custom_page`). Each has a bespoke editor panel and a bespoke print template in
`service-guide.js`, the booklet is fixed at **exactly 16 pages** with a hand-written imposition
table, and `sermon_notes` is the de-facto padding mechanism. Adding or changing a page means a code
change. The Order of Service editor (`service-builder.js`) and the Service Guide generator
(`service-guide.js`) are also two separate pages.

We want churches to compose their own pages (HTML/CSS + reusable Components) into named **Service
Guide Templates**, pick a default, override per week, and generate a variable-length booklet — all
from a single tool launched off the Service Calendar. See the executable plan in
[docs/plans/service_guide_template_system.md](../plans/service_guide_template_system.md) and the
glossary in [CONTEXT.md](../../CONTEXT.md) ("Service Guide Template System").

Three choices in this design are hard to reverse, surprising without context, and the result of
real trade-offs. They are recorded here.

## Decision

### 1. Full replacement, not coexistence
The eight hardcoded page types are **removed** and reborn as developer-seeded **Page Templates** and
**Components** inside one general engine. No special-cased page code survives. The seeded default
Service Guide Template must reproduce today's 16-page booklet 1:1 — that is the v1 acceptance gate.

A **Component** is a developer-authored preset placed in a Page Template via a custom HTML tag, of
two kinds under one model: an **Input Component** declares an Entry Field the OOS Editor prompts for
weekly; a **Bound Component** auto-pulls existing data (Service fields, the Order of Service, the
`hymns` collection, the ESV API) and never prompts. Components ship in code, not Firestore.

### 2. Components own their pagination (discrete, in v1)
A section that spans a variable number of physical pages — hymn sheet music being the real driver
(1–3 images per hymn) — is handled by the **Bound Component emitting its own ordered list of whole
pages** (`render(ctx) → fragment[]`, one fragment per physical page). The render pipeline counts the
emitted pages and lets the **Filler Page** expand or contract to hit the template's configured
target page count (a multiple of 4; default 16). The fixed imposition table is replaced by a
**generated** saddle-stitch imposition for any multiple-of-4 count. v1 supports **discrete**
pagination only (each fragment is exactly one page); continuous text reflow is deferred.

### 3. Per-week snapshot (past weeks freeze)
Each week's `services/{date}.guide` stores a **frozen snapshot** of its fully resolved guide
structure (pages, their HTML/CSS, resolved Style Preset, derived Entry Fields) plus the filled
`values`, taken when the template is applied to that week. Editing a `guide_template` afterwards
affects **future weeks only**; re-opening and reprinting a past week reproduces what was handed out
then. Switching a week's template re-snapshots, preserving `values` whose Entry Field keys survive.

## Alternatives Considered

**Coexist / hybrid** — keep hymn/prayer/kids as native code and let templates govern only new custom
pages. Rejected: two parallel mechanisms is more long-term complexity, and the special-casing is
exactly what motivated the rework. (Accepted cost: a bigger, riskier overhaul up front.)

**Repeating Page Templates** for variable-length sections — a template flagged "repeating", cloned
once per bound item. Rejected in favour of components-own-pagination so one component (`hymn-sheet`)
encapsulates both its data and its page count; the page author drops one tag rather than wiring a
repeat binding. (Accepted cost: page count is less predictable from the template alone — mitigated
by the Filler Page absorbing the variance and an overflow warning.)

**Continuous reflow engine** in v1 — measure and break long content across pages. Rejected for v1:
the only real multi-page need (hymns) is discrete, and a measure/break engine carries significant
build cost and print-fidelity risk. The `render → fragment[]` interface is kept reflow-compatible
for a later phase.

**Live-reference templates (past weeks update)** — every week always reflects the current template.
Rejected: reprinting an old week could differ from the copy congregants received, silently
rewriting history. (A "freeze, but offer refresh" middle option was considered and deferred as
extra UI for no v1 need.)

## Consequences
- The per-week `guide` shape changes from an embedded `elements` blob to
  `{ guideTemplateId, snapshot, values, format: 'v2' }`. Existing guides lack `format: 'v2'` and are
  rendered **read-only via a kept legacy path** — there is no bulk migration.
- Rendering becomes a pure pipeline `(snapshot, values, serviceContext) → physical pages → imposed
  spreads → print`, testable with golden-file fixtures independent of any UI.
- New global collections: `style_presets`, `page_templates`, `guide_templates`. Components remain in
  a code catalog; adding/altering one is a deploy, by design.
- Template authoring is open to **editor+** (same as weekly editing), so the authoring UI must carry
  guardrails (preview-before-save, reset-to-seeded-default). The snapshot model (decision 3) is what
  makes this safe: a bad template edit cannot retroactively break an already-printed week.
- The OOS editor and Service Guide generator merge into one calendar-launched page; `service-builder`
  and `service-guide` are superseded.
- This mirrors the denormalization trade-off in [ADR 0005](./0005-pastoral-record-status-denormalization.md)
  and [ADR 0007](./0007-prayer-request-one-time-generation.md): a frozen per-record snapshot is kept
  alongside the live source because the historical view needs its own stable record.

## Implementation notes (v1)

What shipped, including small refinements to the plan made during the build:

- **The engine is a pure module.** `guide-engine.js` (expand → filler → imposition),
  `guide-components.js` (the Component catalog), `guide-seed.js` (the eight page types reborn +
  the default template), and `guide-store.js` (snapshot/freeze/override + thin Firestore adapter)
  are dual-export IIFE modules with no DOM/Firestore/Alpine, tested under `node --test`
  (`test/guide-*.test.js`). The Phase-1 golden test pins the 16-page reproduction.
- **Components are hyphenated custom tags.** A hyphen is required so the engine finds Components
  without a full HTML parser. Two plan names changed accordingly: `theme` → `service-theme`,
  `schedule` → `preaching-schedule`.
- **Page placements carry `params`.** A `guide_templates` page entry is
  `{ pageTemplateId, role, params }`; the single Hymn page is placed seven times, each
  `params.field` binding a liturgy slot, with `params['omit-on-baptism']` on hymn2. This kept the
  "eight Page Templates" count rather than seeding one per slot.
- **Filler keeps ≥ 1 page** (`minFiller` default 1), matching today's always-one-sermon-notes-page
  behaviour; overflow warns rather than dropping content, and imposition pads to a multiple of 4.
- **Legacy is kept, not migrated.** `service-builder.html` and `service-guide.html` remain. The
  Service Calendar routes v2/new weeks to the new `service-guide-editor.html` and legacy weeks to
  the old generator. Removing the dead hardcoded code (plan Phase 5) is deferred until the seeded
  templates are confirmed in production.
- **Liturgy editing was not absorbed** into the unified editor in v1: the structured pickers stay
  in the Builder (which the editor links to) to avoid destabilising the involvement-sync code. The
  single-page merge of liturgy editing remains the plan's eventual target.

## Designed booklet + granular Order-of-Service Components (2026-06-26)

A complete visual redesign of the booklet (imported from a Claude Design project, "Church service
guide redesign") was implemented as a **second seeded Service Guide Template, `seed_mosaic`
("Mosaic Booklet (Designed)"), made the church default**; the original 16-page booklet is **kept
but demoted** to `isDefault: false` ("…(Legacy)"). The change is purely additive — new Style Preset
(`seed_mosaic_print`, carrying the design's color/type/layout tokens), new page templates
(`seed_m_*`), new Components — so every existing golden test still pins the legacy booklet 1:1.
`buildSeed` now returns `guideTemplates` (plural); `seedAll` seeds them all; the editor already
picked the default by the `isDefault` flag.

The redesign forced a decision the original engine left open: **how does an editor author the Order
of Service page?** Its `<oos-list>` is one line and the engine has **no loop/repeat construct**, so
the liturgy list could not be laid out by hand. Three options were weighed: (a) keep `<oos-list>` as
a code Component (place-only, not authorable); (b) add a row-level **loop primitive** to the engine;
(c) **decompose the liturgy into granular, fixed-slot value Components**. We chose **(c)**. The
insight: the liturgy is a *fixed, named set of slots* (`preparatoryHymn`, `callToWorship`, `sermon`,
…), **not a variable-length array**, so iteration is never required — only ~16 named values the
editor arranges by hand (static labels in page HTML on the left, value tags on the right). A tag's
**presence on the page is the request** to the Order of Service editor (consistent with
[ADR 0010](./0010-builder-generator-component-surfaces.md)); a slot a template omits is simply never
placed, so it can never render an empty/dangling row, and structural variation between Sundays
(baptism, fewer hymns) is a **different Page/Template**, not a conditional inside one page. The
dynamic per-week hiding (`removedHymns`, `omit-on-baptism`) therefore lives **only in the legacy
path / `<oos-list>`**, which is retained as a one-drop convenience.

Consequences / what shipped:
- New granular Builder Components (all `surface: 'builder'`, auto-filled from the Service):
  `<hymn-preparatory|hymn-1|hymn-2|hymn-mid-1|hymn-mid-2|hymn-end-1|hymn-end-2>` (names),
  `<ref-call-to-worship|ref-call-to-confession|ref-assurance|ref-scripture-reading|ref-sermon|ref-benediction>`
  (references), `<preacher-name|music-leader-name|service-leader-name>` (roles), plus
  `<hymn-name>/<hymn-image>/<hymn-attribution>` (bind to a page's `params.field`) and
  `<mosaic-schedule>` (the genuinely variable preaching-schedule list — still a Component, as a list
  must be). Tested in `test/guide-designed-components.test.js` and `test/guide-mosaic-template.test.js`.
- **Per-slot scripture *text* is deferred**: only the theme key verse has ESV text today, and no page
  in the design shows per-slot text, so only `*-ref` Components were built; a matching `*-text`
  family waits for a data source.
- **Hymn-page pagination is deferred** (the one real loop case left): the designed Hymn page
  (`seed_m_hymn`) is `emitsPages: 'single'` and renders the *first* sheet image only via
  `<hymn-image>`; multi-image hymns still need the multi-page `<hymn-sheet>` mechanism, to be
  redesigned in a later pass.
- Brand fonts (Cinzel / EB Garamond / Libre Franklin / UnifrakturCook) were added to the editor and
  Manager heads; the Mosaic Print preset resets `.preview-page` padding to 0 (incl. the print layer)
  so the designed pages own their margins.

### Follow-on refinements (2026-06-26)

- **Per-template page numbering.** A Service Guide Template carries `numberStartPage` (1-based; the
  physical page where numbering begins, default 2 = only the cover unnumbered). The Mosaic booklet
  uses 3 so the cover + explainer are front matter and the Order of Service is page "1". Threaded
  through `pageNumber(index,total,numberStartPage)` → `buildSnapshot` (frozen per week) →
  `resolveGuide` → the editor; the Manager template editor exposes a "Start numbering on page" field.
- **Auto-grow replaces overflow-warn (supersedes decision #2's "warn").** `resolveGuide` now sizes the
  booklet to `ceil4(max(floor, realCount + minFiller))` — the smallest multiple of 4 holding all real
  pages plus the filler, never below the floor. It never overflows; extra content bumps it up by four
  and the filler re-balances. `overflow` is retained (always `false`) for back-compat. The manual
  **Target-pages control was removed** from the Manager (`targetPageCount` survives only as the
  internal floor, default 16). This keeps editor preview == print (the old warn-path let the editor
  show N pages while imposition silently padded to a multiple of 4).
- **Sermon Notes split.** The "Main Idea of the Sermon" notes page (`seed_m_notes`, with the sermon
  reference) is now a **non-filler** page so it appears exactly once and is always present; a new blank
  `seed_m_notes_blank` is the **Filler**. Guarantees ≥1 notes page regardless of booklet size.
- **Hymn pagination (the one true loop case).** Hymns are the only content that paginates. A new
  multi-page Component `mosaic-hymn-sheet` emits one physical page per sheet image; the Page Template
  `seed_m_hymn` is `emitsPages:'component'` with the header in the (repeated) wrapper and the Component
  supplying the big title on the **first** page only, the image on every page, and the attribution on
  the **last** page only. Extra hymn pages flow through the auto-grow above. Design refresh also
  landed: PT Serif cover wordmark, icon-only cover seal, and the ✦ star replaced by a hexagon
  ornament (`.m-hex`) throughout.
