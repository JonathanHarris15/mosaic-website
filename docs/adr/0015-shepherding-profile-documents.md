# 15. Shepherding-Profile documents as a per-person tree over shared records

Date: 2026-07-15

## Status

Accepted

## Context

A **Shepherding Profile** (the elder-only view of a Person) needs a **Documents**
tab beside its **Pastoral Record**: a per-person place to keep documents, organised
into folders, that behaves like the global **Document Library** but is private to
that Person. An elder must be able to **opt a given document into** the global
Library, and when they do it must be the **same file in two places** — editing it in
either surface edits the one record — not a copy (MS-98).

The existing Document Library already models folders as an in-memory tree
`{ children: [...] }` of `folder` / `document` nodes, persisted as a single
Firestore document `elder_document_structure/root`; a `document` node holds no
content, only a reference (`id`) into the flat `elder_documents` collection. All the
folder logic (create / rename / move / drag-drop / delete-cascade / "Move to…") is
pure tree manipulation; the only thing binding it to the one global library is that
it loads and saves `root`.

## Decision

1. **Extract the tree logic into `shepherding-documents-core.js`** — pure,
   Firestore-free functions over a `{ children: [...] }` tree, unit-tested. Both the
   Library and the profile tab drive their views through it. (`treeDocIds`/
   `containsDoc` are added for the membership tests below.)

2. **One directory component, parameterised by scope.** `documentLibrary` takes a
   `{ structureDocId, ownerPersonId, embedded }` config. Defaults (`root`, `null`)
   reproduce the global Library exactly; a profile tab passes
   `structureDocId: 'person_<personId>'` and `ownerPersonId: <personId>`.

   *Amended (MS-283).* The config takes a fourth key, **`identity`**, and it is a
   **function, not three values**. An embedded directory has no auth gate of its own,
   so the host must tell it who is signed in — but scope and identity do not arrive
   together. The Person's id comes off the URL and is there at once; the signed-in
   Elder arrives later from the auth callback. The tab mounts on the first, and an
   Alpine `x-data` expression is evaluated exactly once, so identity passed by value
   was captured as null and stayed null for the life of the page. Every create on the
   tab threw before Firestore was contacted.

   A reader — `identity: () => ({ user, name, permissionLevel })` — is read afresh
   each time, so the ordering stops mattering. Gating the mount on identity instead
   was considered and rejected: it works, but it leaves the embedded component
   permanently dependent on the host resolving auth before it renders, which is the
   assumption that broke. A reader cannot break that way.

3. **Per-person folder tree.** Each Person's tree is its own structure document
   `elder_document_structure/person_<personId>`. The existing `isElder()` rule
   already governs every doc id under `elder_document_structure`, so no rule change.

4. **`ownerPersonId` on `elder_documents`.** A document created in a profile tab
   carries `ownerPersonId`; a plain Library document does not. This is the flag the
   shared surfaces filter on.

5. **Opt-in = the same record referenced from two trees.** Opting a profile document
   into the Library inserts its `{ type:'document', id }` node into the `root` tree —
   no copy. This mirrors the Person-Panel precedent (one Shepherding Note surfaced in
   two places by id). A denormalized `inLibrary` boolean on the record projects
   "is it opted in," kept in sync on opt-in / opt-out (like other denormalized
   projections in this codebase, e.g. `shepherdingStatus`), so the @-mention filter
   need not load the root tree.

6. **Shared-surface hiding.** The global Library directory renders only nodes present
   in `root`, so profile docs are naturally absent there. The @-mention pickers, which
   read every `elder_documents` record, filter out `ownerPersonId && !inLibrary`.

7. **Delete reconciliation for shared references.** Deleting from the **owning
   profile** deletes the record and prunes it from `root` if it was opted in.
   Removing from the **Library** keeps the record (it stays on the profile) — an
   opt-out — and clears `inLibrary`.

8. **An Elder Document is refused without an author (MS-283).** `buildElderDocument`
   in the core assembles the record and throws `MISSING_AUTHOR` rather than emitting
   one with a missing `authorUid` or `authorName`. An untraceable pastoral record is
   worse than a create that failed: it exists, it stands in the Pastoral Record, and
   nothing surfaces the problem. Assembling the record in the core rather than in the
   click handler is what makes that rule testable at all — the same reason decision 1
   moved the tree logic here.

## Consequences

- The engine is reused wholesale; the coupling to the global library was just the
  two hard-coded `root` reads/writes.
- "Same file in two places" is a genuine single record, so edits never fork.
- The `inLibrary` flag is a denormalization: it must be written on every opt-in /
  opt-out / delete path. Tree membership in `root` remains the ultimate source of
  truth for "in the Library"; the flag is only a projection for the mention filter.
- A future third surface referencing the same record would generalise the
  two-tree delete rule to an N-tree reference count.

## Alternatives considered

- **Subtree inside the single global `root` document.** Rejected: every profile load
  would read/write the one growing global document, reintroducing contention, and
  "hide from the Library" becomes an in-tree filtering problem rather than a separate
  tree.
- **Copying the document into the profile.** Rejected outright — it violates the
  explicit "same file, edit once" requirement and would fork content.
