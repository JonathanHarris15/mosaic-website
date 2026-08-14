# ADR 0034 — A Sunday saves the fields you changed, not the Sunday

**Status:** Accepted
**Date:** 2026-08-14
**Extends:** [ADR 0032](0032-a-page-saves-itself-a-dialog-does-not.md) (the Order of Service autosaves, 3s after the last edit).
**Leads to:** [ADR 0035](0035-one-person-per-box.md) (which decides what happens when two people want the same field).

## Context

The church holds a **service guide party**: an evening where the men sit down
together and write the orders of service for the next couple of months. That is
the case this decision exists for — many people editing Sundays at the same
time, in the same room.

The Order of Service sent its **entire in-memory copy** on every autosave. Every
liturgy slot, filled or blank, taken from the snapshot the page loaded when it
opened. With one editor that is merely wasteful. With two it silently destroys
work:

> Two men open the same Sunday. One picks Hymn 1, the other picks Hymn 4.
> Whoever's three-second timer lands second writes the blank it loaded minutes
> ago over the other's hymn.

Nobody sees it happen. From Firestore's side a stale blank is an ordinary field
write — no conflict, no error, no version to reject. The hymn is simply gone,
and the man who chose it has no reason to look again.

Autosave made this worse rather than better. A Save button fires when somebody
decides they are finished; a three-second timer fires while they are still
thinking, over and over, all evening.

## Decision

**A save writes the fields this editor changed and nothing else.**

`flattenServiceForSave` turns the editor's nested model into the shape the
`services` document actually stores. `changedFieldPaths` compares the flattened
snapshot we loaded against the flattened current one and returns dot-path field
updates for the difference only.

A slot nobody touched is **not in the write at all**, so it cannot lose a race it
never entered. Two editors on different slots produce disjoint writes, and both
land.

### 1. The unit is the liturgy slot, not the leaf inside it

A hymn is `{id, name}` and the two are chosen as one act. Diffing inside the
slot could write a name without its id, leaving a cell that reads one hymn while
the printed guide fetches another — wrong in the way that looks right.

One person edits one slot. One slot is the unit.

### 2. Dot paths mean `update()`, never `set(merge)`

`update()` reads `liturgy.hymn1` as a path to one field. `set()` with merge reads
the same string as a field **name containing a dot** and stores a second,
parallel liturgy beside the real one — the exact mess `normalizeDottedKeys`
already exists to clean up after older saves.

A Sunday with no document yet is the one write that cannot use paths, so it lays
the whole thing down with `set()`. Nothing can be racing a document that does
not exist.

### 3. Fields this editor does not model are never written

The guide record, `updatedAt`, `involvementDeferred`, [[Assigned]] and
[[Element authorship]] are not in the flattened shape, so a save cannot touch
them. This is why editing a Sunday's liturgy cannot wipe who is assigned to
write it — a property that came free rather than being arranged.

## Consequences

**The clobber is gone, and so is the need to think about it.** Every surface
that writes a liturgy field now goes through one function per page and writes
one path. The Planning view inherited the property without doing anything.

**Staleness is now a display problem, not a data problem.** With whole-document
writes, being out of date meant destroying somebody's work. Now it only means
seeing an old value — which is what the live listeners fix.

**A field this editor has changed is theirs until it saves.** The diff is what
tells the live listener which fields are safe to adopt from another editor and
which must be left alone. That in turn is why the only remaining conflict —
two people in the *same* field — has to be prevented rather than resolved, which
is [ADR 0035](0035-one-person-per-box.md).

**A test pins the disjointness directly**, not the implementation: two editors
on different slots must produce writes that share no field path.
