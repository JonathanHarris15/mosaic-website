# ADR 0012: Membership Track as a Field of Truth Projected onto Immutable Tags

## Status
Accepted

## Context
Three overlapping mechanisms encoded "how connected is this Person to the church," and they conflicted:

1. **`Person.membership.status`** — an enum field (`member` / `regular_attender` / `visitor` / `inactive`) defined in ADR-0001, read by the care list, the shepherd dashboard, and the mobile shepherd/content screens.
2. **The `Member` Shepherding Tag** — a plain elder-defined tag that `peoples-page.js` used to gate the entire member-facing directory: non-editors saw only Persons carrying it.
3. **User role** (`member` / `editor` / `elder` / …) — an authorization concept that was informally read as if it also meant church-membership standing.

The People System (MS-81) replaces all three with a single **Membership Track** — one ordered progression a Person moves along: Visitor → Regular Attender → Prospective Member → Member → Moving Membership → Previous Member. Role stays strictly a permission and is out of this decision.

That left a modelling question with real tension baked into the ticket itself, which asked for "one singular membership track… **represented as a tag**" that is also "**baked into the code**… cannot be renamed, deleted, [or] merged." Those two requirements pull opposite ways: a Shepherding Tag (ADR-0011) is by definition user-managed — renameable, mergeable, deletable — and multi-valued (a Person carries a *set* of tags), whereas a membership stage is single-valued, ordered, and must be immutable.

Two things had to be settled together:
1. Is the Track a first-class **field**, a **tag**, or both — and which is the source of truth?
2. The filter system that elders rely on (Filtered Views, People list) works **only** on tags. If the Track were a pure field, membership could not be filtered without building a second, parallel filter mechanism.

## Decision

**1. The Membership Stage is a field of truth on the Person; Membership Tags are its synced projection.**
A single-valued `membershipStage` field on the Person is canonical. From it, the code derives a **defined set of Membership Tags** and keeps them applied so that membership is filterable through the *existing* tag machinery — no parallel filter system. Field and tags are always written together (the ADR-0005 dual-write pattern); the tags are never edited independently.

**2. The stage→tags projection is a set, and Moving Membership deliberately projects two tags.**
Most stages project a single eponymous tag (Visitor→`Visitor`, Regular Attender→`Regular Attender`, Prospective Member→`Prospective Member`, Member→`Member`, Previous Member→`Previous Member`). **Moving Membership projects both its own `Moving Membership` tag and the `Member` tag.** The overlap is intentional: it keeps "the Members directory = every Person carrying the `Member` tag" a single trivial query while still distinguishing those mid-transfer. Advancing along the Track re-derives the whole set — removing tags the new stage does not project, adding those it does.

**3. Membership Tags are a code-defined, immutable subset of Shepherding Tags.**
They are seeded and maintained by the code from the Track and — unlike ordinary tags under ADR-0011 — **cannot be renamed, deleted, merged, or hidden** by any user. This is how the ticket's "represented as a tag" and "baked into the code" requirements are both satisfied: they *are* tags (so they filter and search like tags), but they are the special subset the tag-management UI refuses to mutate.

**4. Inactive is orthogonal to the Track, not a stage on it.**
A Person may be toggled **Inactive**, which removes their spot on the Track (no stage) and projects an `Inactive` tag instead of any stage tag. The record stays fully visible — Inactive is a "dormant / possible-deletion-candidate" axis, not archival and not the same as Previous Member (a genuine stage). The prior stage is retained so clearing Inactive restores it. This subsumes the old `membership.status: 'inactive'`; the existing "active people" filters (`status !== 'inactive'`) become "not Inactive."

**5. A Track move writes one dedicated Membership Change to the Pastoral Record.**
Moving the stage slider generates a single **Membership Change** entry (`fromStage`, `toStage`, editor, source, timestamp, optional Explanation), mirroring Status Change. The underlying Membership Tag swap is performed **silently** and does **not** emit Tag Changes, so the Pastoral Record reads "advanced to Member" rather than two noisy tag mutations, and membership history is derived from these entries.

**Migration.** Existing `membership.status` values map: `visitor`→Visitor, `regular_attender`→Regular Attender, `member`→Member, `inactive`→Inactive (flag, stage cleared). `prospective_member`, `moving_membership`, and `previous_member` have no legacy source and are only ever reached via the slider. The legacy `Member` Shepherding Tag is absorbed into the code-defined `Member` Membership Tag.

## Alternatives Considered

**Track as a pure field, no tags.** Cleanest data model — one single-valued field, no dual-write, no immutable-tag special case. Rejected because the elder filter system (Filtered Views, People list, Care List) operates on tags; membership would be unfilterable there without building and maintaining a second, parallel filter mechanism keyed on the field. Reusing the tag filter is the entire reason the ticket asked for a tag representation.

**Track as pure tags, no field.** The stage is implied by which of the code-defined tags a Person carries. Rejected: nothing enforces single-valuedness (a Person could end up with zero or two stage tags), the slider has no single value to bind to, and there is no clean anchor for a Membership Change record or for "restore prior stage" after Inactive.

**Reuse ordinary Tag Changes instead of a Membership Change.** Let the silent tag swap emit its normal Tag Changes. Rejected: every slider move would produce two entries (remove old stage tag + add new), which is both noisy and semantically wrong — the reader wants the transition, not two tag edits.

**Model each stage as a fully ordinary, elder-editable tag.** Simplest to build (no special subset). Rejected: elders could rename "Member" to something else, merge stages together, or delete a stage, corrupting a state machine the whole directory and migration depend on.

## Consequences
- Every write path that changes a Person's stage must go through the dual-write that sets `membershipStage`, re-derives the Membership Tag set, and appends a Membership Change — the field, the tags, and the record are three things kept in sync, as in ADR-0005/0011.
- The tag-management UI (`shepherding-tags`) must recognise the code-defined Membership Tags and refuse rename / delete / merge / hide on them, while leaving ordinary tags fully editable.
- Because Moving Membership carries the `Member` tag, any code that means "is a current member" must query the `Member` tag (or `stage ∈ {Member, Moving Membership}`), not "stage == Member." The directory's Members tab relies on the tag form.
- Both the web surface (`peoples-page.js`) and the mobile native People screens (`mobile/screens-content.js`, which currently filter on the old `member` / `regular_attender` / `visitor` enum) must migrate to the new stages and tags in lockstep.
- A Person's membership history becomes a first-class, queryable thing (the Membership Change feed) — new capability the old enum never had.
