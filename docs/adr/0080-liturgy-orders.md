# ADR 0080 — A Sunday follows one of the congregation's Liturgy Orders

**Status:** Accepted
**Date:** 2026-10-07
**Supersedes:** the "Use legacy system" toggle and the template-gated Builder Components of [ADR 0010](0010-builder-generator-component-surfaces.md); the Irregular Service as a way to vary a Sunday
**Keeps:** [ADR 0006](0006-baptism-candidates-as-person-references.md), [ADR 0034](0034-a-sunday-saves-the-fields-you-changed.md), [ADR 0057](0057-a-printable-reads-live-data-the-snapshot-on-an-event-is-the-frozen-copy.md)

## Context

The Order of Service was one fixed list of fourteen slots, written into the
code in four places: the editor's rows, the Services table's planning
columns, the printable catalog, and the MCP read. A Sunday that did not fit
had two ways out. It could be marked Irregular, which swapped the whole
liturgy for a free list of `{ key, value, type }` rows that nothing else
could read. Or the week's guide could go back to the legacy generator through
"Use legacy system", which brought the old "Include Baptism?" checkbox back
with it.

Neither is a tool another church can use. A communion Sunday is not
irregular; it is a second kind of Sunday that comes round every month. A
church whose service has an offertory has to wait for a code change before
any of its Sundays can say so.

## Decision

**A congregation keeps Liturgy Elements and Liturgy Orders. A Sunday names
one order. Values stay where they are.**

- A **Liturgy Element** is `{ id, name, primitive, hasRole, hasNote }`. The
  primitive is one of four, closed: `song` (`{ id, name }`), `scripture` (a
  string), `text` (a string), `people` (an ordered list of `{ id, name }`).
  `hasRole` means one person carries it, stored at `carriedBy.<id>` on the
  Sunday. `hasNote` means it gets the per-slot note at `notes.<id>`. The id
  is fixed once made, renaming included, and the primitive is fixed too.
- A **Liturgy Order** is `{ id, name, elementIds }`, each element at most
  once.
- Both live in their own collections, `liturgy_elements` and
  `liturgy_orders`, with the same rule as `guide_templates`: anybody reads,
  an editor writes.
- **Standard** (`standard`) is seeded in code (`liturgy-order-core.js`): the
  fourteen old slots under their old ids, every one with `hasRole: false` and
  `hasNote: true`. An empty collection reads as the seed, so a congregation
  that never opens the new page loses nothing. Standard cannot be deleted.
- A Sunday stores `liturgyOrderId`. Absent means Standard, and so does an id
  whose order has gone. Values stay at `liturgy.<elementId>`, notes at
  `notes[elementId]`, authorship at `decidedBy[elementId]`. **Changing the
  order moves the pointer and nothing else**: values the new order does not
  carry are hidden, and come back when the order changes back.
- The service leader, preacher, music leader, worship helpers and the two
  people being prayed for **are not elements**. Every Sunday has them, other
  code reads them by name, and moving them would turn an identity of the
  Sunday into something an order could leave out.

What reads the order:

1. **The Order of Service** shows the Sunday's order's elements, in order,
   with a **Liturgy order** select in the header and a manage button through
   to the new page. The select is a field-level save of `liturgyOrderId`
   (ADR 0034). Rows do not drag here. The progress is the same tally as the
   home card: the leaders, then each element of the order.
2. **The Liturgy Orders page** (`liturgy-orders.html`) adds, renames and
   deletes elements and orders, and orders an order's elements by dragging or
   with move-up and move-down buttons. It saves a draft with one Save, in one
   batch. Deleting an element takes it out of every order and writes no
   Sunday. It is reached from the Order of Service and from the Services
   table.
3. **The Services table** draws one liturgy column per element of the orders
   toggled on above it. The columns are the union of those orders: Standard
   first in its own order, then the others by name, each element at its
   first sighting. Standard alone is the default, and the toggles are
   remembered per device (`localStorage`). The old reference columns (Sermon,
   Baptism, Pastoral Prayer) and the fixed planning column list are gone,
   because the elements are those columns now.
4. **Printables** read the catalog. A Sunday's fields are one per element,
   keyed by its id, so a box bound to `hymn1` or `sermon` still resolves.
   `sunday_rows` walks the Sunday's order. Hymn sheets read the order's
   `song` elements. A Printable still stores which field feeds which box,
   never the value (ADR 0057).
5. **The MCP read** (`service-read-core.js`) emits a Sunday in its order. It
   uses the order the Sunday names, or Standard. Each row carries the
   element's id, name and primitive, and its carrier and note when the
   element has them. The people being prayed for come back as `prayedFor`,
   beside the rows. The dotted-key normalisation is kept.

Two smaller rules:

- **`hasBaptism` is derived on save.** It is true when the Sunday's order
  carries the `baptism` element and somebody is on it. It is no longer a
  checkbox or a template's decision. The candidates' `baptismDate` side
  effect (ADR 0006) is unchanged.
- **An old Irregular Sunday still reads.** Its `irregularElements` are shown,
  read-only, under the Order of Service, and come back from the MCP read as
  `irregularElements`. Nothing makes a new one, and there is no second
  editor for them.

The legacy generator (`service-guide.html`) is no longer a destination.
"Generate Service Guide" always opens the template editor, which offers a
pre-template week a rebuild.

## Alternatives considered

- **One settings document holding every element and order.** One read and
  one write, but every save rewrites every order, two editors on the page
  overwrite each other whole, and the document is a new shape no rule or
  page here uses. Rejected for two collections shaped like `guide_templates`.
- **Elements as fields on `guide_templates`, so a guide template is the
  order.** Rejected: a guide template decides pages, and the guide is made
  second (ADR 0010). Tying what the Order of Service asks for to the
  booklet's layout is the coupling this replaces.
- **Copy the order's element list onto each Sunday.** A Sunday would then
  carry its own order and could be rearranged on its own. Rejected: editing
  the shared order would no longer reach the Sundays already planned, the
  Services table would have no column order to share, and it is the
  Irregular Service again under another name. The pointer is one field, and
  a Sunday that wants a different shape picks, or makes, another order.
- **Drag on the Order of Service.** It would either rewrite the order every
  other Sunday shares, from inside one Sunday, or quietly start a per-Sunday
  copy. Rejected for both reasons; the select is one tap from the page that
  reorders.
- **Union columns in toggle order or in catalog order.** Toggle order makes
  the table depend on what somebody clicked first. Catalog order puts a new
  element wherever it was created. Standard first, then by name, gives the
  same table to everybody who toggles the same orders, and reads a Standard
  Sunday left to right.
- **Make the leaders and prayer people elements.** Rejected; see the
  Decision. They stay fields on the Sunday.
- **Autosave on the Liturgy Orders page** (ADR 0032's default for a page
  editor). Rejected: each step of a rearrangement would be live on every
  Sunday that follows the order. The page keeps a draft, saves with one
  button, and asks before leaving with one unsaved.
- **Fall back to Standard when the functions cannot read the catalog.**
  Rejected for the MCP read: a quiet fallback would return a communion
  Sunday as though it were Standard, to an assistant that cannot tell. The
  read fails instead. The pages do fall back, because a person can see
  what they are looking at.

## Consequences

- Another church adds an element by saving one. No code names a new
  element's id.
- A new element id becomes a key under `liturgy`, `notes` and `carriedBy`,
  and a printable field name. The core refuses the names already used on the
  Sunday (`RESERVED_IDS`).
- The MCP write allowlist and the note keys are still the Standard seed. An
  assistant can read every element, and write only Standard's. Widening that
  is its own decision, with its own review of what an assistant may write.
- Values of a deleted element stay on the Sundays that have them, unread. A
  clean-up is a later, explicit job, not a side effect of deleting.
- The Order of Service list on the old guide (`<oos-list>`) still prints
  Standard's slots. The guide system is being replaced by Printables
  (MS-401), and Printables walk the order.
- `firestore.rules` gains two matches, copied from `guide_templates`. No
  other rule changes.
