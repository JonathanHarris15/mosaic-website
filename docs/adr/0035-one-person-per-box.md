# ADR 0035 — One person per box, rather than a merge

**Status:** Accepted
**Date:** 2026-08-14
**Follows:** [ADR 0034](0034-a-sunday-saves-the-fields-you-changed.md), which removed every conflict except this one.
**Leads to:** [ADR 0039](0039-a-list-is-the-field-a-diff-cannot-split.md), which applies this decision to the field
ADR-0034's diff could not make disjoint.

## Context

Field-level saves mean two editors on *different* slots never collide. What is
left is two editors in the **same** slot, and the service guide party makes that
ordinary rather than rare: a dozen men, a handful of Sundays, and no way to see
who is already working on what.

The usual answers are all expensive:

- **Operational transform / CRDT.** Correct, and vastly more machinery than a
  church website has any business carrying for a fixed set of named liturgy
  slots, most of which hold a hymn title.
- **Last write wins.** What we already had. It is the bug.
- **Ask the user.** "Your version or theirs?" is a question nobody in a
  guide-writing session wants, and the honest answer is usually "I did not know
  anyone else was in here" — which means the question came too late.

The men are also **in one room**. Anything they can settle by looking up and
speaking does not need to be settled in software.

## Decision

**One person per box, refused at the door.**

A box someone else holds does not open. Not "opens and warns", not "opens and
merges on close" — it has no editor to click into, and it carries their face and
their name instead.

Two people are therefore never in the same box, so there is never a version to
choose between. The whole class of conflict is prevented rather than resolved.

The cost is that you occasionally wait for somebody. In a room where you can see
them, that is cheap — and cheaper than any of the alternatives above.

### 1. A claim is a heartbeat, not a flag

**A lock that outlives its holder is worse than no lock.** Somebody shuts a
laptop mid-hymn and, with a stored flag, that hymn is uneditable until a
developer clears it by hand — on the one evening of the year the church has
everybody in a room to get the work done.

So a claim is held only while its holder keeps saying so. It expires after
**30 seconds** and beats every **10**, which tolerates three missed beats before
anybody is treated as gone; a lock must not flicker on a poor connection while
its holder is still typing into it.

Releasing when you leave a box, and deleting your claim when you close the page,
are **courtesies that make the common case instant**. Expiry is what makes it
correct.

### 2. The document id is the lock

Presence lives at `presence/{uid}` — one document per signed-in editor, named
after them. That is what lets the security rules say *you may write your own and
nobody else's*, so a claim cannot be released, stolen or forged by writing over
it. Keyed any other way, the whole scheme would rest on the honour system.

It also gives "one box at a time" for free: there is nowhere to hold two.

### 3. Presence may remove a lock. It may never remove an editor.

Learned the hard way, twice. Presence starts late — it waits on sign-in — and on
both surfaces it was started from inside the handler that also **grants editing
rights**, a handler that catches. So a throw inside presence did not surface as a
missing badge; it skipped the grant on one page and actively revoked it on the
other. The application went read-only and looked like a styling bug.

Three rules follow, and they are load-bearing:

- Starting presence cannot throw at its caller. There is no version of this
  worth crashing a page over — at worst you cannot see who else is here.
- Editing rights are granted **before** presence is started, never after.
- With presence not running, `holder()` is nobody and **every claim succeeds** —
  the page simply has no locking, which is how it worked before this existed.

The same episode produced a fourth rule with wider reach: the loop that draws
the calendar's rows now catches per row, because an exception on any single
Sunday used to abandon the loop and leave every row after it read-only with
nothing on screen to say why.

### 4. Being *here* is per page; holding a box is not

Presence answers two different questions and they scope differently.

**Who else is on this page** is `surface` + `pageKey`, always set. Without both,
"also here" meant "signed in with the app open somewhere", and a man reading the
calendar appeared to be sitting on a Sunday he had never opened. A presence
badge that is wrong is worse than one that is absent.

**Which box is held** is `dateKey` + `fieldKey`, null while you hold none, and
deliberately **crosses surfaces**: a hymn claimed in the [[Planning view]] locks
that hymn on the Order of Service page too. A lock that only held within one
screen would be decoration.

The two must stay separate because the calendar can hold a box on any Sunday
while sitting on no particular one.

## Consequences

**No merge, no transform, no conflict dialog, ever.** The simplification is the
point, and it is only available because the liturgy is a fixed set of named
slots rather than free prose.

**You can be made to wait.** If somebody sits in a box and wanders off, you wait
up to thirty seconds. Judged cheaper than any correctness the alternatives buy,
and visible: their face is on the box, and they are across the table.

**Presence is best-effort by design.** It can fail entirely and the evening
still works — you lose sight of the others, not the ability to edit.

**Live keystrokes were deliberately not built.** "Locked, with a face on it,
updating when they leave" was agreed as enough. Streaming characters can be
added later without disturbing any of the above; nothing here assumes it is
absent.
