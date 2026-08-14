# ADR 0017: Relationship Types Can Be Shared With Editors, One At A Time, By Elder Decision

## Status
Accepted. Amends [ADR 0013](0013-elder-tag-projection-and-derived-relationships.md) and [ADR 0014](0014-relationship-types-as-structures-and-relationship-groups.md), which established the Relationship graph as elder-only.

## Context

The Relationship layer — Pairwise Relationships, Relationship Groups, and the Relationship Types they share — has been **elder-only for read as well as write** since ADR-0012/0013. That was deliberate: it records who is discipling whom, who is in which care group, who is walking with whom through what. It is pastoral data, and it is never surfaced in the member-facing directory.

The Roles & Serving Scheduler (ADR-0016) then asked for something that cuts across that line. A **Servant Role** can carry restriction rules, and the headline rule the church actually wants is *"don't put a married couple in Kids together."* Two more surfaced during planning: *"don't staff this Role with two people from the same house group"* and its opposite, *"staff this Role from one house group, so they already know each other."*

All three read the Relationship graph. But the **Roles Manager is an editor+ surface** — the people who schedule serving are not necessarily elders. So as things stood:

- An editor (or even an admin) could not list Relationship Types to author such a rule at all — the read is denied.
- Nor could any non-elder surface evaluate one, because judging a rule needs the edges and rosters.

The conflict is not cosmetic. Either serving loses its most-wanted rules, or something about the elder-only boundary has to give.

## Decision

**An elder may mark an individual Relationship Type "Shared with Editors."** Only shared Types — and the edges and Relationship Groups carrying them — become readable at **editor and above**. Everything else stays exactly as elder-only as before.

Five things make this narrow rather than a general widening:

**1. Per Type, never wholesale.** The unit of disclosure is one Relationship Type. Sharing "Marriage" says nothing about "Discipleship." An elder can give serving what it needs to avoid pairing spouses without exposing pastoral care relationships.

**2. Elder-controlled.** Only an elder can change the setting, in the Relationships manager they already use. Editors consume the decision; they cannot make it.

**3. Closed by default, and closed on failure.** Nothing is shared unless the stored value is the boolean `true`. A truthy string out of a form, a `1` out of a checkbox, or a missing field all read as *not shared*. The security rule tests equality against `true` rather than inequality against `false`, so a record the backfill never reached stays private.

**4. The floor is editor.** Members, viewers, and signed-out visitors read none of it, shared or not. This does not become member-facing data, and no current surface asks it to.

**5. Writes do not move.** Creating, editing, and deleting Relationships, Groups, and Types remains elder-only and untouched.

### The decision is projected onto records, not looked up

The setting lives on the Type, but the security rule has to answer it about an **edge** or a **group**, and those store only `{ ..., typeId }`.

A rule *could* resolve the Type per document with a `get()`. It shouldn't: that is one lookup per document a query returns, which is slow and runs into the rules engine's lookup limits on any real list query.

So the answer is **copied onto each record** and kept honest by re-projection whenever an elder flips the setting — the same write-through already used for Membership Tags, the Elder Tag, and Family relations (ADR-0014 §4). The Type stays the source of truth; the record carries a cache the rules can read directly.

### The client must constrain its own queries

Firestore evaluates read rules **per returned document** and fails an entire list query if any document would fail it. A non-elder client therefore has to filter to shared records itself (`where('sharedWithEditors', '==', true)`).

This is worth stating loudly because the failure mode is misleading: an unconstrained query does not return fewer rows, it errors — and the error presents as *"this church has no relationship types."*

## Alternatives rejected

**Widen the whole Relationship graph to editors.** One line of rules, no new concept, no projection. Rejected as far too blunt: it would expose every discipling pair and every care-group roster to anyone with an editor account, in exchange for a scheduling convenience. The pastoral cost is wildly out of proportion to the benefit, and disclosure cannot be undone.

**Drop relationship-based restrictions entirely.** Keep Tag rules only; express "no married couple" by tagging people. Rejected because it loses the epic's headline rule and pushes the church into maintaining a hand-curated tag that duplicates a relationship the app already knows about — exactly the parallel-data-universe mistake ADR-0016 §2 exists to prevent.

**Answer marriage from the public Families graph instead.** `families` is already world-readable and stores `husbandId`/`wifeId`, so the married-couple rule could have been built with no permission change at all. *(It is not world-readable any more — [ADR 0031](0031-the-directory-asks-for-an-account.md) closed it to signed-in accounts, which weakens this alternative further without changing why it was rejected.)* Genuinely tempting, and rejected for two reasons. It answers *only* marriage — the same-house-group rules have no equivalent, so a second mechanism would be needed almost immediately. And leaning on it would have quietly made Families the de facto relationship model for serving, splitting the domain in two: some restrictions reading Families, others reading Relationships, with no principle saying which.

**Make the Roles Manager elder-only.** Contradicts the Feature's own audience and, more practically, the people who schedule serving at this church are not the elders.

## Consequences

- The claim "the Relationship graph is elder-only," stated plainly in ADR-0013 and ADR-0014, is **no longer absolute**. Those ADRs point here. Anyone reasoning about relationship privacy has to read this one too.
- **A Group-kind Type is a bigger disclosure than a pairwise one.** Sharing one Group Type exposes entire rosters, and a roster names everyone in it. This is intended — the same-group and not-same-group serving rules need it (MS-141) — but it is why the elder-facing copy describes who will be able to see the relationship rather than implying a single pair.
- Every relationship record now carries a projected copy of its Type's setting, which must be kept in step. Toggling a Type rewrites its records; a new record inherits from its Type; a record whose Type has vanished is stamped closed.
- `isEditor()` includes **admin**, so a church admin who is not an elder also gains shared relationship data. Consistent with "editor and above", and noted here because it is easy to miss when reading the tier list.
- The projection is a cache, and caches can go stale. The re-projection path and the backfill are the two things that keep it honest; if a third write path to relationships is ever added, it has to stamp too.
