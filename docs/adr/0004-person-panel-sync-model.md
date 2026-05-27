# ADR 0004: Person Panel — Sync Model and TipTap Node Architecture

## Status
Accepted

## Context
Elders writing Meeting Minutes in the Document editor need to record observations about specific people and have those observations appear on the person's Shepherding Profile — without switching tabs or copy-pasting. The feature is a "Person Panel": an embedded block inside an Elder Document's TipTap editor that is 1-to-1 linked with a Shepherding Note.

Three decisions required genuine trade-offs with non-obvious answers:

1. **How to store panel state inside the TipTap document** — the panel is a structured block with metadata (personId, noteId, noteType) plus rich-text body content. TipTap's content model must hold all of this.
2. **How to sync panel content to Firestore** — the panel body must stay in sync with `people/{personId}/shepherding_notes/{noteId}`.
3. **How to handle the "link existing note" case** — a panel can be linked to a pre-existing Shepherding Note, not just a newly created one.

## Decision

### 1. TipTap Node: `personPanel` (atomic custom node, not a nested editor)

The Person Panel is implemented as a **single custom TipTap node** (`personPanel`) that is marked `atom: true`. Its metadata (personId, noteId, personName, noteType) is stored in the node's `attrs`. Its Note Body content is stored as a separate `contentJson` field in Firestore on the Shepherding Note — it is **not** nested inside the TipTap document JSON.

The panel body is rendered as a **standalone TipTap editor instance** mounted inside the node's DOM representation via a `NodeView`. This means the outer document's `contentJson` stores only the panel's metadata attrs; the actual body content lives exclusively in Firestore.

Alternatives considered:
- **Nested node with content schema**: TipTap supports nodes with content, but the body would then live inside the parent document's `contentJson`. This means the document's auto-save would overwrite the note with whatever was last in the document — making the profile-side edits invisible until the document was reloaded. It also makes moving a note to a different person (re-association) much harder.
- **Separate Alpine component overlay**: Mounting an overlay div over the TipTap canvas breaks cursor navigation, drag/drop, and the document's linear selection model.

**Why atom + separate editor wins**: The body stays in Firestore as the single source of truth. The document's auto-save only writes metadata attrs. The panel's body editor saves independently on its own debounce, decoupled from the outer document.

### 2. Sync model: panel body has its own auto-save debounce (1.5s), independent of the outer document

The outer document auto-saves its `contentJson` (which includes panel metadata attrs) on the existing 1.5s debounce. The panel body editor has its own independent 1.5s debounce that writes directly to `people/{personId}/shepherding_notes/{noteId}.contentJson`.

On load, the panel reads its linked note from Firestore to populate the body editor. No real-time cross-page listener is held — the profile page reads the latest note on load.

Alternative considered: syncing the panel body as part of the outer document's save. Rejected because it requires the outer document to hold a full copy of the note body in its `contentJson`, making re-association (moving the note to a different person) require rewriting both documents simultaneously with no atomic transaction.

### 3. Link-existing-note: panel stores noteId in attrs; body is populated from Firestore on mount

When an elder links an existing Shepherding Note into a panel, the picker sets the panel's `noteId` attr to the existing note's ID. On mount, the panel reads that note's `contentJson` from Firestore and loads it into the body editor. From that point, edits flow through the same independent debounce as new notes.

The existing note gains a `sourceDocumentId` field pointing back to the Elder Document — added on first panel save, not on panel insertion, to avoid a write if the elder cancels immediately.

## Consequences

**Pros**:
- Note body has a single source of truth (Firestore), not split across the document and the note.
- Re-associating a panel to a different person requires only a Firestore move of the note document — the outer document's `contentJson` just updates the `personId` attr.
- Profile-side edits are reflected in the panel on next document load without any real-time plumbing.
- Panel deletion dialog (keep vs. delete note) works cleanly because the note is a fully independent Firestore document at all times.

**Cons**:
- The panel body is not searchable within the outer document's `contentJson` — full-text search across document bodies would miss panel content. Acceptable at this scale.
- Two concurrent editors open (outer doc + panel body) require careful focus management to avoid conflicting keyboard shortcuts.
