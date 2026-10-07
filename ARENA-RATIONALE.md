# Liturgy Orders — candidate A rationale

The decision record is `docs/adr/0080-liturgy-orders.md`. This note says what
I weighed and what I turned down.

## Shape of the change

One pure module, `public/liturgy-order-core.js` (synced to `functions/shared/`),
owns the model: the four primitives, the Standard seed, `catalogFrom` (an
empty collection reads as the seed), `orderFor` (absent or dangling id reads
as Standard), the table-column union, and every management edit as a
function from catalog to new catalog. Each surface reads through it: the
Order of Service, the home and phone tally, the Services table, printables,
and the MCP read. None of them names a Standard element id to decide
behaviour. The one exception is `baptism`, because of the ADR 0006 side
effect.

## Where the records live

| Option | Verdict |
| --- | --- |
| **Two collections, `liturgy_elements` and `liturgy_orders`, rules copied from `guide_templates`** | **Chosen.** One doc per record, the same read/write rule the task names. The management page writes its draft in one batch, and deletes the docs the draft dropped. |
| One settings doc holding every element and order | Rejected. Every save rewrites everything, two editors clobber each other whole, and there is no precedent shape in the rules. |
| Elements and orders on `guide_templates` (the guide template *is* the order) | Rejected. It ties what the Order of Service asks for to the booklet's page layout, which is the ADR 0010 coupling this change removes. The guide is made second. |
| Seed Standard into Firestore on first load | Rejected. The seed lives in code, and an empty collection reads as it. No page writes on read, and a fresh project works signed out. |

## How a Sunday references an order

| Option | Verdict |
| --- | --- |
| **A pointer: `liturgyOrderId`, absent = Standard. Values stay at `liturgy.<id>`, notes at `notes[id]`, carrier at `carriedBy.<id>`** | **Chosen.** Changing the order is one field-level write (ADR 0034). Hidden values survive and come back. A deleted order reads as Standard rather than as an empty Sunday. |
| Copy the element list onto the Sunday | Rejected. Edits to the shared order would not reach planned Sundays. The table would have no shared column order. It is the Irregular Service again under a new name. |
| Per-Sunday drag override on top of the pointer | Rejected. A drag on the Order of Service either rewrites the shared order from inside one Sunday or forks a hidden copy. The Order of Service has no drag. Reordering happens only on `liturgy-orders.html`, one tap from the select. |
| Move preacher, leaders and prayer people onto elements | Ruled out by the brief, and I agree. They are identities of every Sunday, read by name across the app. |

## How the table union is ordered

| Option | Verdict |
| --- | --- |
| **Standard first in its own order, then the other toggled orders by name, each element at its first sighting** | **Chosen.** Everybody who ticks the same orders sees the same table. A Standard row still reads the service left to right. A shared element is one column. |
| Toggle order (the order somebody clicked) | Rejected. The table would depend on click history, and two people would see different tables for the same ticks. |
| Catalog order (when each element was created) | Rejected. A new element lands wherever it was made, which is not a liturgical place. |
| Interleave orders by position | Rejected. It has no stable answer when two orders disagree about the order of shared elements. |

Toggles default to Standard alone and persist in `localStorage`
(`calendarLiturgyOrders`). A remembered id whose order has gone drops out.
An empty selection remembered on purpose stays empty.

## Smaller calls

- **Prayer people are not rows.** The MCP read returns them as `prayedFor`
  beside the liturgy rows. The table keeps them as the **Prayed For**
  identity column. Printables keep them as Sunday fields. I rejected pinning
  them as pseudo-rows after `scriptureReading` ("Pastoral Prayer"), because
  that would make an element out of something the brief says stays a field.
- **`people` cells are read-only in the table.** Naming a baptism candidate
  writes the person's `baptismDate` (ADR 0006), and that path lives on the
  Order of Service.
- **`hasBaptism` is derived on save**: the order carries `baptism` and
  somebody is on it. The checkbox is gone with the legacy toggle.
- **The functions catalog read throws instead of falling back to Standard.**
  A quiet fallback would hand an assistant a communion Sunday as Standard.
  The pages do fall back, because a person can see the page.
- **The MCP write allowlist and `NOTE_KEYS` stay the Standard seed.** Widening
  what an assistant may write is its own decision, so it gets a comment, not
  a change.
- **Management page saves with a button, not autosave.** Each step of a
  rearrangement would otherwise be live on every Sunday that follows the
  order. There is Save (disabled until dirty), Discard, and a
  leave-with-draft prompt. This is recorded as the ADR 0032 exception in
  CONTEXT.md.
- **Old `isIrregular` Sundays** show their `irregularElements` read-only on
  the Order of Service and in the MCP read. There is no second editor.
- **Printables:** a Sunday's fields are one per element, keyed by id, so old
  bindings (`hymn1`, `sermon`) resolve. `sunday_rows` walks the order, and
  hymn sheets read its song elements. The "no pastoral fields" guard was
  narrowed to `/pastoral(?! prayer)/`, because the seeded element is named
  "Pastoral Prayer". It holds a scripture reference, not pastoral data.
- **Design:** `.m-row__handle` was added to the Row component in
  `build/design-components.mjs`, since a second reorderable list would copy
  it. The order toggles use `m-toolbar`, `m-label` and `m-check`. The style
  guide's new "Named shapes" section names these classes.

## Known limits

- The old guide's `<oos-list>` still prints Standard's slots. Printables,
  which replace the guide, walk the order.
- A deleted element's values stay on Sundays, unread. Cleaning them up is
  a separate, explicit job.
- `npm run check:design` exits 1 on the base commit as well. The cause is
  raw colours and ghost classes in files this branch did not restyle, and
  that check is not part of PR CI.

## Verification

- `npm test`: 5552 pass, 0 fail, 20 skipped (the emulator-gated tests).
- `npm run lint --prefix functions`: clean.
- New tests:
  - `test/liturgy-order-core.test.js`: the seed, the union, and the edits.
  - `test/liturgy-order-surfaces.test.js`: no "Use legacy system", no
    `service-guide.html` links, and script order.
  - `test/service-read-core.test.js`.
  - Updated planning-view, printable, home-tally and readiness tests.
  - An emulator test for the MCP read in a saved order.
- Browser walkthrough against the Hosting, Firestore and Auth emulators
  with fictional data: 18/18 checks.
