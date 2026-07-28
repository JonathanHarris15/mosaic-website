# ADR 0013: Elder-ness Projected onto an Immutable Elder Tag; Family & Elder Relationships Derived, Not Stored

## Status
Accepted

## Context
The Relations Viewer + elder-assignment feature needs two things the existing model doesn't provide, and both touch how "who is an elder" and "who is related to whom" are represented.

1. **Elder-ness must be a Person attribute, not just a User role.** Today "elder" is a User *role* (`elder`), an authorization concept. But the feature needs elders to be **nodes in a relationship graph** and the **assignable set** for Elder Assignment — i.e. elder-ness has to be a queryable, graph-visible property of a *Person*, not a fact buried in the `users` collection.

2. **Family and Elder Assignment must appear as relationships without becoming a second source of truth.** Family already lives in the `families` collection (ADR-0012 / MS-88) and Elder Assignment will live as a field on the Person. The Relationships panel and the Relations Viewer must *show* these as relationships — but if building a Family or assigning an elder also wrote edge documents into the `relationships` collection, every family/assignment change would have to keep those edges in sync, and the edges could drift from their source.

This mirrors the exact tension ADR-0012 resolved for membership (a field of truth vs. a filterable tag representation), so we resolve it the same way.

## Decision

**1. The `elder` User role projects an immutable Elder Tag onto the linked Person.**
When a Person's Linked User (`people.userId` ↔ `users.personId`) has role `elder`, the code applies an **Elder Tag** to that Person; unlinking, or a role change away from `elder`, removes it. The Elder Tag is the canonical answer to "which Persons are elders," and therefore supplies the assignable-elder set. The User role remains the source of truth (it grants shepherding *access*); the tag is its synced projection.

**2. The Elder Tag is a Projected Tag — the generalisation of the Membership-Tag idea.**
ADR-0012 introduced code-defined, immutable tags for membership. We generalise that into a **Projected Tag**: a Shepherding Tag projected from a source-of-truth field, never hand-applied, and immutable — it **cannot be renamed, deleted, merged, or visibility-toggled**. There are now two families: **Membership Tags** (projected from the Membership Stage) and the **Elder Tag** (projected from the elder User role). The Elder Tag's directory visibility is fixed **visible to members** — eldership is a public office.

**3. Family and Elder Assignment surface as *derived* relationships, never stored edges.**
The `relationships` collection continues to hold only **Custom Relationships** — the freeform, elder-authored, deletable edges (`{fromId, toId, typeId}`). Everything else is computed at read time:
- The **Relationships panel** on the Shepherding Profile merges Custom Relationships with **Family** relations derived via FamilyCore (spouse, parents, children, siblings; gendered labels with neutral fallback). Family relations render read-only and **cannot be deleted from the panel** — you edit the Family in the Membership Directory. Only Custom Relationships get a delete affordance.
- **Elder Assignment** is a single field on the Person (`shepherding.assignedElderId`, holding the *elder's Person id*). It does **not** appear in the Relationships panel at all; it feeds only the Relations Viewer.
- The **Relations Viewer** graph is the union of all three — Custom Relationships, Family (spouse + parent→child edges), and Elder Assignment — computed at load. "Non-deletable auto relationships" therefore falls out for free: a derived relationship simply has no stored edge to delete.

**4. Elder Assignment is one elder per member, logged like a Membership Change.**
A Person has at most one assigned Elder; an Elder shepherds many (their Care Group). Setting/clearing/changing it writes an **Assignment Change** to the Pastoral Record (previous elder → new elder, who, source, timestamp, optional Explanation), mirroring Membership Change.

## Alternatives Considered

**Keep elder-ness as role-only, resolve on the fly.** Everywhere that needs "is this Person an elder" would join `people.userId` → `users.role`. Rejected: it can't make an elder a graph node or a filterable Person attribute without that join everywhere, and the assignable-elder list would be a cross-collection query rather than a tag lookup. Projecting to a tag reuses all existing tag machinery (filters, chips, the directory).

**A hand-applied "Elder" tag.** Reuses tag infra but creates a second source of truth for elder-ness that can drift from the actual role (someone tagged Elder who isn't, or vice versa). Rejected in favour of a code-maintained projection with no drift.

**Materialise Family/Elder relationships as real `relationships` edges.** Simpler read path (one collection). Rejected: it duplicates the source of truth and demands sync on every family edit / reassignment, exactly the drift ADR-0012 avoided for membership tags. Derivation keeps one source of truth and makes "auto relationships aren't deletable" automatic.

**Store `assignedElderId` as the elder's User uid.** Rejected: the graph and the Projected-Relationship path are Person↔Person; a uid would force a User→Person hop at every render. The elder's Person id keeps everything in Person-space.

## Consequences
- A new projection path must apply/remove the Elder Tag whenever a Linked User's role or link changes — a sibling of the membership dual-write. The tag-management UI must refuse rename/delete/merge/hide on the Elder Tag exactly as it does for Membership Tags (generalise the "is this a Projected Tag?" check).
- The Relationships panel and Relations Viewer do more compute on load (merge + dedupe across `relationships`, `families`, and assignment fields) instead of reading one collection — negligible at Mosaic's scale, and the price of a single source of truth.
- FamilyCore needs a small addition to resolve **siblings** (the other children of the family of origin) for the panel's projected list.
- Deleting or merging a Person must consider derived relationships (family membership, assignments pointing at them) as well as stored Custom Relationship edges — the derived ones follow automatically once the source is fixed, but an assignment pointing at a deleted elder-Person needs handling.
- This feature is **desktop-first**: the Shepherding Profile relationships surface is already desktop-only, so the Assigned Elder section, Family projection, and Relations Viewer ship on desktop; mobile receives only the (essentially free) Elder Tag projection this round, with panel/section/graph parity as a fast-follow.

## Amended by

- **[ADR 0017](0017-shared-relationship-types-elder-controlled-editor-disclosure.md)** — the Relationship graph is no longer unconditionally elder-only for *read*. An elder may mark an individual Relationship Type "Shared with Editors", which makes that Type and the records carrying it readable at editor+. Everything unshared, and every write, stays elder-only as described above.
