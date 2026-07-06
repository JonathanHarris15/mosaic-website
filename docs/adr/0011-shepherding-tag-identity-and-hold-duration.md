# ADR 0011: Shepherding Tag Stable Identity and Derived Hold Duration

## Status
Accepted

## Context
Two capabilities are being added to Shepherding Tags: **Rename** / **Tag Merge**, and **Hold Duration** (how long a Person has continuously carried a tag, filterable on a Filtered View).

Both run into how tags were originally modelled. A Shepherding Tag's Firestore document ID *was* its name (`people_tags/{name}`), and each Person's `tags` array stored those same name strings. Under that model:

- **Rename is impossible without a data migration.** Changing the name means changing the document ID, which means rewriting every Person's `tags` array and every historical Tag Change that referenced the old name. A "rename" was really a delete-and-recreate that stripped the tag from everyone.
- **Hold Duration has nowhere stable to anchor.** Duration must be tied to a tag's identity across a rename; a name-as-identity model loses that thread the moment the name changes.

Two data-model questions had to be settled together:
1. Should a tag's identity be its name, or a stable ID independent of the name?
2. Should Hold Duration be a denormalized field on the Person (written on every tag change, like `shepherdingStatus` in ADR-0005), or derived on demand from the Tag Change history?

## Decision

**1. A Shepherding Tag has a stable identity independent of its name.**
New tags are created with an auto-generated document ID and carry their display name in a `name` field. `person.tags` and every Tag Change store that stable ID, never the name. Renaming a tag updates only the `name` field — no Person document and no history entry is touched.

Existing tags are **not** migrated. Their document ID already *is* a name string; that string is simply treated as an opaque stable ID from now on. Because it doubles as the pre-existing name, any display surface that has not yet been updated to resolve name-by-ID degrades to showing the old name rather than breaking. Renaming a legacy tag updates its `name` field and leaves the ID (the old name) in place as the opaque identity.

A **Tag Merge** is the one operation that still rewrites references: it replaces the merged tag IDs with the surviving tag ID in every affected Person's `tags` array and rewrites the `tagId` on those Persons' Tag Change entries so the surviving tag inherits the history (and therefore the Hold), then deletes the merged tag documents.

**2. Hold Duration is derived from the Tag Change history, not denormalized.**
A Person's Tag Hold for a tag is computed from the `people/{id}/shepherding_activity` entries: the current hold begins at the most recent `added` Tag Change with no later `removed`. No `heldSince`/`tagAppliedAt` field is written.

This deliberately departs from ADR-0005, which kept `shepherdingStatus` denormalized *because the People list renders every Person's current status inline on every load*. Hold Duration is not that: it is shown on tag chips and used by an opt-in Hold-Duration filter, not sorted or displayed for every Person on every page. The Tag Change history it derives from already exists (written by the ADR-0005 dual-write), so denormalizing would add a redundant field and a fourth thing every tag-toggle call site must keep in sync, for a value most page loads never read.

## Alternatives Considered

**Keep name-as-identity; make Rename a batched reference rewrite.** Every rename would rewrite all carriers' `tags` arrays and all history entries — the same heavy, all-or-nothing migration a Merge does, but for the far more common Rename. Rejected: renames should be cheap and identity-preserving; only Merge genuinely combines two identities.

**Migrate all existing tags to fresh random IDs up front.** A one-time pass rewriting every `person.tags` entry and every Tag Change. Rejected as unnecessary risk: an existing name-as-ID is already a serviceable stable ID, so the migration buys nothing but exposure to a bulk-rewrite bug.

**Denormalize Hold Duration onto the Person (`tagAppliedAt` map).** Cheap to filter without reading sub-collections, consistent with ADR-0005. Rejected here because, unlike status, hold is not rendered for every Person on every load; the read cost lands only when the Hold-Duration filter is actually used, and the source history already exists.

## Consequences
- Display surfaces must resolve a tag's name from its ID rather than printing the ID. Legacy, name-keyed surfaces (`peoples-page.js`, `analytics.js`) keep working for existing tags because ID == name there; new random-ID tags created elsewhere will show as their raw ID on those surfaces until they are updated to resolve by ID.
- A tag applied before Tag Changes were recorded (or via a write path that skipped the dual-write) has no `added` entry, so its Hold Duration is unknown. Surfaces show "unknown," and the Hold-Duration filter excludes such Persons rather than guessing.
- The Hold-Duration filter reads Tag Change history (a `shepherding_activity` collection-group query keyed on `tag_change`), which requires the corresponding Firestore index. It is fetched only when a Filtered View actually uses the filter.
- Tag Merge remains a bulk, batched rewrite and must chunk to stay within Firestore's per-batch write limit when a tag is held by many Persons.
- A tag's `name` is snapshotted onto each Tag Change at write time; renaming a tag does not rewrite past Tag Change labels, so old history entries keep the name the tag had when the change was recorded. This is intentional — the record reflects what the elder saw at the time.
