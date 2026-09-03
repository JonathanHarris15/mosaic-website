# ADR 0054 — A form remembers its folder; a folder does not remember its forms

**Status:** Accepted
**Date:** 2026-09-03
**Ticket:** MS-361 / MS-375

## Context

MS-361 adds folders to the Forms library. The obvious way to build them is to
copy the Document Library, which the Forms library was already modelled on
(ADR-0053) and which has had folders for a year.

The Document Library stores its folders as **one nested tree in a single
Firestore record** — `elder_document_structure/root`. Each node carries its
children, folders hold ordered lists of document ids, and every change to the
shape rewrites the whole record with `.set()`. `shepherding-documents-core.js`
is the pure engine over that tree, and it is good code: it already knows how to
move a node, guard a move into a descendant, and flatten the tree into folder
options for a "Move to…" dialog.

Reusing it would have been half a day's work instead of two. Two things stopped
it, and neither is about the engine.

**The Forms library is open to editors and above.** The Document Library is
elder-only, and there are a handful of elders. Editors are many, and the whole
point of a Forms library is that several people run sign-ups at once. Two
editors filing two different forms at the same moment both write the whole tree,
and the second write wins silently. Nobody is told, and the lost change is
invisible — it looks exactly like never having dragged the form at all.

**A form's id is a public address.** `/f/<id>` goes in a text message to the
whole church. The Document Library can afford a document that has fallen out of
the tree, because a document that is not in the library is not anywhere. A form
that falls out of the tree is still live: people are still answering it, and the
editor who needs to close it cannot find it. Making the tree the source of the
list makes "listed" and "exists" two different things, and only one of them is
true.

## Decision

**A Form Template carries the folder it is filed in. A Form Folder carries its
name and its parent, and knows nothing about what is inside it.**

- Folders are records in their own collection, `form_folders`, each holding a
  name and a `parentId`. The top level is the absence of a parent.
- A form carries a `folderId`. The absence of one means the top level.
- The library still lists the `forms` collection, exactly as it did before
  folders existed. Filing changes where a form is drawn, never whether it is.
- `form-folders-core.js` is the pure engine: breadcrumbs, direct contents, the
  count beneath a folder, descent, and whether a move is allowed. It walks two
  flat lists rather than a tree.

## Consequences

**What this buys.**

Two editors filing at the same time write two different records and both changes
survive. A form whose folder has been deleted comes back to the top level rather
than disappearing — the engine treats an unknown `folderId` as unfiled, so there
is no state in which a live form is missing from the library. And "search every
form" stays the flat query it always was, rather than becoming a tree walk.

**What it costs.**

Two libraries in one codebase now store folders two different ways, and that is
a real cost — the next person will reasonably assume they match. This ADR is the
answer to that, and `form-folders-core.js` opens with a warning pointing here.

Listing a folder's contents is a filter over the forms list rather than a lookup
in a node. At this scale — a church with a few hundred forms — that is free, and
it is the same list the library already had in memory.

Reading is no longer one document. The library loads folders and forms
separately. Both are small, both are already needed, and neither is ordered by
anything the other decides.

**What is deliberately not decided here.**

Nothing about the Document Library changes. Converging the two is not MS-361's
job, and there is no evidence yet that the Document Library needs this — the
concurrency problem is a consequence of who may write, and only one of the two
libraries is open to editors.
