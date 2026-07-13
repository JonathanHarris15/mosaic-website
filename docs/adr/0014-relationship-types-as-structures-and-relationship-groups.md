# ADR 0014: Relationship Types Become Kind×Priority Structures; Relationship Groups Are First-Class Records; Creation Centralised in the Manager

## Status
Accepted

Supersedes parts of [ADR 0013](0013-elder-tag-projection-and-derived-relationships.md): the Relationship Type model (the `directional` flag) and the rule that Family is edited only in the Membership Directory and is read-only in the Relationships panel.

## Context
The Custom Relationship layer shipped in MS-91 (ADR-0013) is too lightweight and mis-sited:

1. **Relationship Types are a single freeform label + a `directional` boolean.** That can't express the real shapes elders think in — a *prioritized* relationship where each side has its own name (Discipler / Disciplee), versus a *symmetric* one (Friendship). A verb-as-name ("mentors") can't carry two role labels.
2. **There is no way to model a group.** Real pastoral relationships are often one-to-many around a shared thing: Stephen leads a Bible study that Tim, Carter and Nathan are all *in*. That is not three pairwise "leads" edges — it is one group with a leader and a roster. The edge-only model has no home for the group's name, its leader, or its membership.
3. **Relationships are created in the wrong place.** Today a Custom Relationship (and its type) is minted inline on the Shepherding Profile's Add-Relationship card by free-typing a name. Once a type is a real structure (kind, priority, two labels), free-typing can't express it; creation needs a proper form, and it needs one home — not scattered across every profile.
4. **Adding Family is awkward.** ADR-0013 made Family a read-only Projected Relationship editable only in the Membership Directory. Once the profile card becomes a unified "connect this Person" surface, forcing a trip to the directory to record "X is Y's child" is a worse workflow than the very card the elder is already on.

## Decision

**1. A Relationship Type is a two-axis data structure, replacing `directional`.**
Every type carries a **kind** and a **priority**:
- **kind** ∈ `pairwise` (connects two Persons) | `group` (a roster of many). **Immutable after creation** — flipping kind would orphan instances; to change kind you make a new type.
- **priority** ∈ prioritized | non-prioritized. **Prioritized** names two roles — **Holder Label** / **Counterpart Label** for pairwise (Discipler / Disciplee), **Leader Label** / **Member Label** for group — and renders oriented. **Non-prioritized** names one symmetric **Label** (Friendship, or a group's single Member Label) and renders unoriented.

Priority is orthogonal to kind: all four combinations are valid. `directional` is retired; **Prioritized is its enriched successor** (a prioritized pairwise type is the old directional type plus explicit per-side labels).

**2. Two stored instance shapes, both Custom Relationships.**
- **Pairwise Relationship** — a typed edge in `relationships` as `{fromId, toId, typeId}`. When the type is prioritized, **`fromId` is the priority holder** (unchanged from the old directional "from" convention, so existing edges need no rewrite).
- **Relationship Group** — a first-class record in a **new `relationship_groups` collection**: `{ typeId, name, leaderId|null, memberIds[] }`. A prioritized group has exactly one `leaderId`; a non-prioritized group has none. A group may be temporarily leaderless (leader stepped down) and may have an empty roster (freshly created).

Both are elder-authored, stored, and deletable — the Custom Relationship umbrella now spans both shapes, versus Projected Relationships (derived from Family).

**At most one leader for now, but do not close off co-leaders.** Represent leadership so a later move to multiple leaders / member roles is additive, not a rewrite.

**3. Creation is centralised in "Manage Tags and Relationships"; the profile card is demoted to quick-assign.**
The Shepherd Dashboard's **Manage Tags** card becomes **Manage Tags and Relationships**, with two tabs: **Tags** (unchanged) and **Relationships**. The Relationships tab is type-centric: a list of Relationship Types + a **New Relationship Type** form (kind, priority, labels), and — on selecting a type — management of *who holds it* (pairwise pairs; or the type's Relationship Groups, with their names, leaders and rosters). **New types and new named groups can only be created here.**

The profile's relationship card becomes **quick-assign**: it picks only *already-defined* vocabulary — slot this Person into an existing pairwise type (choosing which side they hold), or join them to an existing Relationship Group as member or open-leader. It can also **remove** this Person's own Custom Relationships. It cannot mint types or create new named groups.

**4. Family becomes authorable from the profile via write-through, superseding ADR-0013.**
The quick-assign card can add and remove **Family** relations. This **writes through to the `families` collection** (find-or-create the Family; set spouse or append to `childIds`) — never a parallel edge in `relationships` — so `families` stays the single source of truth and Family stays a Projected Relationship for display. Removal is **scoped to the individual** (pull this Person from `childIds`); a **spouse** removal necessarily ends the pairing for both, since a spouse link is one mutual field. Full family restructuring still lives in the Membership Directory.

**5. Relations Viewer: directional arrows and group bubbles (desktop-only).**
- A **prioritized** relationship renders with an **arrowhead** (Holder → Counterpart); non-prioritized renders as a plain line.
- A **Relationship Group** is a first-class **bubble** (convex hull) around its member nodes, labelled with the group name, given a **distinct primary/secondary colour with a faint background fill** so overlapping/irregular bubbles (people in several groups, leaders leading several) stay legible. A prioritized group draws **one line from the leader to the bubble itself** — not a star to each member. `buildGraph` emits, per group, a hull descriptor `{ name, typeId, colour, leaderId|null, memberIds[] }`. Exact hull maths / clustering forces are authored in Cloud Design.

**6. Migration is an idempotent backfill.**
A backfill (sibling of `backfill-elder-tag.js`) sets `kind: 'pairwise'` on every existing type, maps `directional:true → priority:true` (seeding `holderLabel = counterpartLabel = the old name`) and `directional:false → priority:false` (`label = old name`); code reads old-shape docs defensively during rollout. No groups pre-exist.

**7. Lifecycle.**
Deleting a type in use **cascades with a count-confirm** (removes the type and its instances). A prioritized group may be temporarily leaderless. Deleting/merging a Person **cascades** into every group's `memberIds`, clears any `leaderId` they held, and removes their Pairwise Relationships.

**8. Platform.**
The **manager surface** (renamed card + Relationships tab) and the **profile quick-assign** ship on **both desktop and mobile** (native Preact) — both platforms already have a Manage Tags screen and a profile Relationships panel. The **Relations Viewer** stays **desktop-only**. Data model + backfill are platform-neutral.

## Alternatives Considered

**Model groups as edges in `relationships` (a star from the leader, or a clique).** Rejected: an edge set has nowhere to store the group's name or its identity, "what groups is this Person in?" becomes a fragile edge-reconstruction, a leaderless group has no representative edge at all, and the viewer wants a single group object to draw a bubble and attach the leader line to — not N edges to re-cluster.

**Keep creating types (and now groups) inline on the profile by free-typing.** Rejected: a type is now a structure with a kind, a priority, and two labels; a free-text box can't express that, and scattering creation across every profile makes the vocabulary impossible to curate. A single manager form is the right home; the profile keeps only the cheap "apply existing" action.

**Honour ADR-0013 and keep Family directory-only.** Rejected: once the profile card is the unified place to connect a Person, bouncing the elder to the directory to record a parent/child is the worse workflow. Write-through preserves the single source of truth (no duplicate edges), so the only added cost is a second authoring surface onto the same `families` data — a good trade.

**Fold Elder Assignment into a prioritized Group type** (an elder "leads" their Care Group). Rejected: it would lose the one-elder-per-Person constraint, the Assignment Change audit entry in the Pastoral Record, the Care Group reverse-set, and the By-Elder viewer preset. Elder Assignment, Care Group, and Family stay first-class and separate; this revamp is only the Custom Relationship layer.

## Consequences
- **Supersedes ADR-0013** on two points: the Relationship Type model (`directional` → kind×priority) and Family panel authorability (read-only-in-panel → write-through add/remove). CONTEXT.md's Relationship Type, Custom Relationship, Relationship, and Projected Relationship entries are updated, and Pairwise Relationship / Relationship Group are added.
- A **new `relationship_groups` collection** joins the read path; the Relationships panel, the manager, and `buildGraph` now merge pairwise edges, group rosters, Family, and Elder Assignment.
- A **migration/backfill** and defensive old-shape reads are required; firestore.rules must permit elder writes to `relationship_groups` and to the enriched `relationship_types`.
- The **Relations Viewer** gains a group-bubble layer (hull rendering + colour assignment + leader-to-bubble edge + membership clustering), authored with Cloud Design.
- **Person delete/merge** must additionally reconcile `relationship_groups` (roster + leader slot).
- Follow-on (not this round): co-leaders / member roles within a group; mobile Relations Viewer; richer group visuals.
