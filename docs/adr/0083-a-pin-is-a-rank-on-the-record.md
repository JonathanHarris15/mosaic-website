# ADR 0083 — A pin is a rank on the record, and the shelf is one shelf

**Status:** Accepted
**Date:** 2026-10-19
**Ticket:** MS-693

## Context

MS-693 adds a Resources library: the church's shelf of old Bible studies,
sermon manuscripts, outlines, the new-member packet, and the Google Docs
somebody keeps updating. Every member reads it; editors fill it.

The approved design (Variant A) puts a **Pinned** card above the browser at
the root of the library. An editor drags rows inside that card to say what the
congregation sees first, and a pin may be a folder or a file. Three questions
had to be answered before any of it could be written down, and all three have
an obvious answer that is wrong.

**Where does the order live?** The obvious answer is a list of ids in one
document — `resources_config/pins` with `order: [...]`. It is one read, one
write, and trivially correct when one person is dragging.

**What is a folder, and what does it hold?** The obvious answer is a nested
tree, because a file manager looks like a tree.

**What does a Google Doc look like in the library?** The obvious answer is to
fetch it and keep a copy, so everything on the shelf is one kind of thing.

## Decision

### A pin is a `pinRank` number on the record itself

Every resource and every folder may carry a `pinRank`. Carrying one **is**
being pinned; the Pinned card is everything that has one, in ascending rank
order, ties broken on the name. Nothing else records a pin.

Ranks are spaced `PIN_STEP = 1000` apart, and dropping a row between two
neighbours writes the **midpoint** — so a drag is one write to one record, and
it discards nobody else's. Only when two neighbours have closed to within
`MIN_PIN_GAP = 0.01` is the whole pinned list renumbered, which at a step of
1000 takes tens of drops between the same two rows.

`ResourcesCore.planPinMove()` is the single place that works out the write.
The page, the MCP tool and the tests all call it, so a drag in the browser and
`resource_reorder_pins` from an assistant land the same number in the same
field.

### A resource remembers its folder; a folder does not remember its resources

The same shape ADR-0054 chose for the Forms library, for the same reason, and
`FilingCore` is reused unchanged — breadcrumbs, direct contents, the count
beneath a folder, and whether a move would put a folder inside itself.

Folders are records in `resource_folders` holding a name and a `parentId`.
Resources are records in `resources` holding a `folderId`. The absence of
either is the top level, and an unknown one reads as the top level too, so a
resource whose folder was deleted comes back to the root instead of vanishing.

### A link entry is a link, never a copy

A resource is one of two kinds. A `file` has bytes in Cloud Storage and a
`storagePath` pointing at them. A `link` has a `url` and no bytes at all.

A Google Doc is a link. The church edits the Doc where it lives, people comment
on it there, and it changes after we would have copied it — so a copy in
Storage is a document that is wrong in a way nobody can see. The row says
"Link", opens in a new tab, and the library is honest about not owning it.

### The record keeps a path, never a download URL

A `file` resource stores `storagePath` and the page fetches the bytes with the
reader's own ID token. `getDownloadURL()` is never called on this path: it
mints a token that serves the file to anyone holding it, signed out, forever,
with `storage.rules` never consulted (ADR-0046). A member-only shelf one
forwarded link away from the open internet is not a member-only shelf.

### One new permission key, and no new read key

Writing is `resources.edit`, through the existing `editsWith()` door
(ADR-0082). Reading is the member rung the catalog already has — the Firestore
rule says `isMember()` and the Storage rule restates it.

There is no `resources.view`, because there is nothing it could turn off: one
shelf, published by definition, read by the whole congregation. A key that is
on for everybody who can reach the page is a switch with one position.

Because Resources is a **new** surface, putting `resources.edit` on the editor
presets takes nothing away from anybody: an account whose saved map lacks the
key loses no door it ever had. `scripts/backfill-resources-edit-key.js` adds it
to maps that were saved before this shipped.

## Consequences

**What this buys.**

Two editors reordering pins at the same moment both get what they asked for.
With a list-of-ids document, the second save would have silently thrown the
first away — the same clobber ADR-0054 kept the folder tree out of, arriving by
a different door.

A pin survives everything that happens to the thing pinned. Rename it, move it
to another folder, and its place in the Pinned card is untouched, because the
rank travels on the record rather than in a list that names it.

Unpinning is clearing one field. There is no second document to keep in step,
so there is no state where a pin points at something that is gone.

**What it costs.**

Pin order is a sort over records already in memory rather than a given list.
At church scale that is free, and the page has both collections loaded anyway.

`pinRank` is a float, and floats have a floor. The renormalisation at
`MIN_PIN_GAP` is what keeps that from ever mattering, and it is the one write
in this design that touches more than one record.

The Pinned card spans two collections, so a reorder may write a folder record
or a resource record. Both take the same gate, which is why
`resource_folders` is gated on `resources.edit` rather than something narrower.

**What is deliberately not decided here.**

Per-folder or per-group visibility. The ticket asks for one shared library and
this builds one; a resource carries no visibility stamp, and adding one later
is a new field plus a clause in two rules files, not a reshaping.

Versioning. Replacing a file replaces it. The shelf is where the church keeps
things, not where it keeps their history.

Nothing about the Printables or Forms libraries changes.
