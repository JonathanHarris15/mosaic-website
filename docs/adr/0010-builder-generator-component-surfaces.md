# ADR 0010: Component Surfaces — Builder vs Generator (supersedes ADR-0008's Bound/Input split)

## Status
Accepted

## Context
ADR-0008 split Components two ways under one model: a **Bound Component** auto-pulls
existing data and never prompts; an **Input Component** declares an Entry Field that the
weekly editor fills in. In practice that axis described *how* a Component gets its value
(derived vs typed) — but it failed to capture the fact that two **different people**
produce a Service Guide:

- **Party 1** builds the Order of Service (preacher, hymns, people, baptism) in the
  **Order of Service editor** (`service-builder.html`).
- **Party 2** assembles and prints the booklet — filling the remaining blanks (the
  missionary nation/capital, the kids lesson, the announcements) in the **Service Guide
  generator** (`service-guide-editor.html`, new; `service-guide.html`, legacy).

The terms also collided: ADR-0008/CONTEXT called the generator the "OOS Editor," so
"the OOS Editor prompts for Entry Fields" pointed at the *generator*, not the Builder.
This caused repeated confusion (see [CONTEXT.md](../../CONTEXT.md) glossary history).

We needed the Order of Service editor to (a) choose the week's Service Guide Template or
toggle back to the legacy system, and (b) prompt the template-driven sections that
belong to Party 1 — without the generator and the Builder fighting over one record.

## Decision

### 1. A Component's organizing axis is its *surface*, not Bound/Input
Every Component declares `surface: 'builder' | 'generator'` — **which party informs it,
on which surface** — fixed in code, not configurable per placement. Bound/Input is
demoted to an implementation detail (a Builder Component may be *prompted*, e.g. baptism
candidates, or *derived*, e.g. a hymn name typed in the Builder driving sheet-music
images). "OOS Editor" is retired; the surfaces are the **Order of Service editor** and
the **Service Guide generator**.

### 2. "Non-static" Builder Components fall out of template composition
A **static** Builder Component is always prompted (the existing fixed liturgy form). A
**non-static** Builder Component is prompted only when the chosen Service Guide Template
places it — discovered from the snapshot, with no separate "this template wants X" flag
(`GuideStore.builderSections`). Baptism and the pastoral-prayer subjects become non-static
Builder Components; the template dropdown **replaces** the "Include Baptism?" checkbox in
the new system, and `hasBaptism` is **derived** from the template
(`templateIncludesBaptism`). The legacy system keeps the checkbox.

### 3. One shared per-week record, partitioned by surface; two surfaces merge
The week keeps one `services/{date}.guide` v2 record and one `values` map. A pure
partition (`partitionEntryFields → { builder, generator }`) decides what each surface
shows; the generator renders only generator-surface fields. The Order of Service editor
applies the template **first** (freezing the snapshot) and writes the record; saves
**merge** values key-wise (`mergeValues`) so the two parties never clobber each other,
and re-snapshot only on an explicit template switch. An explicit per-week
`guideSystem: 'legacy' | 'v2'` (default `v2`) plus one shared routing helper
(`guideHref` / `guideSystemOf`, used by both the Service Calendar and the editor's
"Generate" button) replaces sniffing for a legacy `elements` blob.

## Alternatives Considered
- **Keep Bound/Input, bolt a per-placement surface flag on** — lets one Component be
  builder here and generator there. Rejected: a Component's informing party is a stable
  domain fact; "sometimes-builder-sometimes-generator" is two Components. Per-placement
  config is extra surface for no real case.
- **Move all weekly prompting into the Builder (single-page merge)** — relocate the
  generator's Entry Fields onto the Builder. Rejected for now: it reopens ADR-0008's
  deferred liturgy-merge and discards the deliberate two-party workflow.
- **Two separate value maps (builderValues / generatorValues)** — Rejected: splits one
  conceptual thing (the week's fill-ins) and complicates the resolve pipeline, which
  takes one `values` map.
- **Generic Builder renderer for every non-static Component** — Rejected this round: the
  baptism and prayer-subject sections are bespoke (Person pickers + the ADR-0006
  baptismDate sync + the prayer-request SMS flow), so they stay special-cased and bind to
  existing `liturgy` storage; simple Components can render generically later.

## Consequences
- Components gain `surface`; three builder-surface section Components ship
  (`baptism-candidates`, `pastoral-prayer-subjects`, `congregational-prayer`). Their data
  stays in `liturgy` (not `values`), so the ADR-0006 baptism sync and the prayer-request
  SMS code are untouched — just gated by template presence.
- Past weeks are unaffected: `guideSystem` defaults to `v2`, a legacy `elements` blob
  still routes to the legacy generator, and prayer subjects show unless a template
  explicitly uses congregational prayer (so a pre-seed-marker template still shows them).
- The four Baptism×Prayer **template variants** are **not** seeded here — that authoring
  work is deferred to a later template-system update. The mechanism (this ADR) ships now;
  the default seed stays pastoral + no-baptism.
- The pure surface logic is node-tested (`test/guide-surfaces.test.js`); the Alpine UI
  wiring on the three pages is verified manually.
