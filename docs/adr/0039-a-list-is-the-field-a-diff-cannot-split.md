# ADR 0039 — A list is the field a diff cannot split, so it gets a lock and a row identity

**Status:** Accepted
**Date:** 2026-08-25
**Completes:** [ADR 0034](0034-a-sunday-saves-the-fields-you-changed.md) (a save writes the fields you changed) and [ADR 0035](0035-one-person-per-box.md) (one person per box), which between them removed every clobber on a Sunday except this one.

## Context

Music assignments were being reported as lost, or as swapped between people.
Not often, not reproducibly, and never with an error — which is why it went on
for a while: the screen agreed with itself, and the man who lost a helper had no
reason to look again.

Three separate defects turned out to be behind it, and all three come from the
same place. **Music Helpers is a list**, and the two ADRs above were both
written about fields that are not.

ADR-0034 made a save write only the fields this editor changed, so two men on
different slots produce disjoint writes. ADR-0035 then prevented the only
conflict that leaves — two men in the *same* slot — by refusing the second one
at the door. Between them, a Sunday became safe to edit a dozen-up at a guide
party.

Both decisions assume a field is a **value**: a hymn, a name, an id. That
assumption held for every slot on the Sunday except the ones that hold a
**collection of Persons** — the Music Helpers, the Baptism Candidates, and the
elements of an irregular service.

### The three ways a list broke

**1. A row was addressed by its position, and the picker inside it was not.**

Each row of a list mounts its own people-picker. A picker takes the entry
*object* once, when its row is first drawn, and mutates that object from then
on. Alpine reuses a row whose key is unchanged — it refreshes the loop variable
and leaves the row's `x-data` alone. Keyed by position, the arithmetic is
merciless:

> Helpers are Ann and Ben. Take Ann out. Row 0 is reused, so it now *displays*
> Ben's position while its picker is still holding Ann's object. The box reads
> "Ann". The document says "Ben". Type a new name into that box and it goes
> into an object that is no longer on the model.

Saved nowhere, shown wrong, no error. That is the "switched around" report, and
the irregular elements had it worse: they are draggable, so a single reorder
re-pointed every picker on the screen at once.

**2. The live listener swapped the list out instead of bringing it in line.**

ADR-0034's listener applies a remote change through `applyFlatFieldPath`, which
mutates a liturgy slot **in place** on purpose — there is a comment saying why
and a test pinning it, because the pickers hold the slot object. The lists were
assigned wholesale instead. So the moment another editor touched the helpers,
every helper box on your screen was holding an object off the model, silently,
until you reloaded.

**3. A list cannot be diffed into disjoint writes.**

`changedFieldPaths` compares arrays whole and writes them whole — "a list is
edited as a list", which is right: an id without its name is the failure
ADR-0034 §1 exists to prevent, and splitting a list per index has the same
shape. But it means two men each *adding* a helper are not making the disjoint
writes every other pair of slots makes. They are both writing `musicHelpers`,
and the second one wins with a list assembled before the first one existed.

That is the exact clobber ADR-0034 was written to remove, surviving on the one
field its mechanism could not split.

## Decision

**A list is edited as a list, so it is claimed as a list — and its rows are
identified by what is in them, not by where they are.**

### 1. A row belongs to its entry (`_rowId`)

Every entry in an editable list carries a `_rowId`: a handle minted when the
entry appears and held for as long as the entry lives. The `x-for` keys on it.
Remove an entry and the rows that remain are the rows they already were; drag
one and its row goes with it.

**It is screen state, not part of the Sunday.** `flattenServiceForSave` strips
it, so it never reaches Firestore. `serviceSnapshot` strips it, so a Sunday
whose rows were merely re-keyed never reads as a Sunday with unsaved work — a
handle that counted as an edit would make opening a Sunday dirty it, and the
three-second autosave would then write it.

A handle minted while *adopting* a remote change is derived from the entry
rather than from a counter. The adoption path runs over both the live model and
the loaded snapshot, and two counter values would leave those two disagreeing
about a Sunday nobody had touched.

### 2. A list of Persons is reconciled, never replaced

When a remote change arrives, the list is brought in line **in place**: an entry
still in it keeps its object and its row, one that has gone takes its row with
it, and a new one gets both. Matched by Person id first, so somebody who merely
moved up the list is not rebuilt.

The array itself is mutated rather than reassigned, for the same reason as the
liturgy slot: the `x-for` is bound to that array, and a fresh one would leave
every row on screen iterating a list the model no longer has.

This is not a new principle. It is the principle `applyFlatFieldPath` already
applied to every slot that holds an object, extended to the slots that hold
several.

### 3. The music box is claimed, and leader and helpers are one box

ADR-0035 chose prevention over resolution for the conflict field-level saves
could not make disjoint, and gave the reasoning: a fixed set of named slots does
not justify a CRDT, last-write-wins *is* the bug, and asking the user comes too
late to be a real question. Every word of that applies here, so the answer is
the same one rather than a new one.

The Music Leader and the Music Helpers under him are claimed as a **single
box**. They are one box on screen already, and putting a name against music for
a Sunday is one act. A box each would be finer-grained without being more true,
and would still leave the helper list — the part that actually clobbers —
sharing one claim between its rows.

The cost is that a second man wanting to add a helper waits, with the first
man's face on the box. In a room where he is across the table, ADR-0035 already
judged that cheap.

### 4. Only a list of Persons is reconciled; the irregular elements are rebuilt

The irregular elements are declared by ADR-0034 to be written whole by whoever
owns them, so a remote change rebuilds their rows rather than reconciling them.
They still take handles, because the `x-for` needs something to key on. The
distinction is deliberate: reconciling needs a stable notion of *which entry is
which*, and a Person id is one. An element keyed by a free-text label is not.

## Consequences

**The three defects were one defect.** Row identity, in-place reconciliation and
the lock are three answers to "this field holds several things and the model
assumed one". Fixing any one alone leaves the others looking like separate,
mysterious bugs — which is roughly how they were reported.

**ADR-0034's guarantee is now unconditional.** Before this, "two editors on
different slots produce disjoint writes" had an unstated exception that nobody
had written down. It no longer has one.

**Every list on the Sunday is covered, not just the one that was reported.**
Baptism Candidates and the irregular elements had the identical row-identity
defect and were fixed with it. A bug found in one instance of a shape is a bug
in the shape.

**The lock is coarser than the save.** A save still writes only the fields you
changed; the claim covers the leader and the helpers together. The two do not
have to agree, and making the claim as fine as the diff would buy nothing here —
the diff cannot split the list, which is the whole reason the claim exists.

**Presence stays best-effort**, exactly as ADR-0035 §3 requires: with presence
not running, the claim succeeds and the page simply has no locking. A lock that
could take the editor down with it is the failure that section was written
about, and nothing here reopens it.

**The single-value people boxes are still unlocked.** Service Leader, Preacher
and the rest take no claim, because ADR-0034 already makes each of them one
atomic field: two men in one of those boxes is a last-write-wins on a single
name, not a list assembled from a stale copy. Worth revisiting, but it is a
different and much smaller problem than the one this decision closes.

**A test pins the shape rather than the fix**: a row handle must never appear in
what is written to Firestore, and must never make an untouched Sunday read as
dirty.
