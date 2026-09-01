# ADR 0049 — Four documents, one shape; the differences live in the path and the rules

**Status:** Accepted
**Date:** 2026-09-01

## Context

A Shepherding Note, Meeting Minutes, an Elder Document and now an Event Document
are four different things to a person. Different places, different readers,
different reasons to exist. The ask was that the last of them should not be a
fifth implementation of rich text — that documents on an Event's Files tab and
documents in the shepherding system should share the same backend.

They already almost do. Every one of them is a title and a body of TipTap JSON.
What is genuinely different between them is two things and no more: **where the
record hangs**, and **who may read it**.

## Decision

**One shape, and the differences expressed only as a path and a rule.**

`document-body-core.js` owns what must not differ — the record shape, what an
empty document looks like, whether a body is empty, and the line a list shows
under a document's name. It is pure, requires nothing, and knows nothing about
Firestore.

Where a document hangs is a Firestore path. Who may read it is
`firestore.rules`. Both of those are already the right home for those questions,
and neither belongs in a shared module.

So an Event Document is stored at
`event_occurrences/{occurrenceId}/documents/{documentId}`, and its rule is the
Attachments rule restated: anyone who can see the occurrence may read it, only
an editor may write it. Restated, because these rules have no way to name a
condition once and use it twice — and because a restated rule is one somebody
tightens on one tab and forgets on the other,
`test/firestore-event-visibility-rules.test.js` asserts the two blocks are
identical character for character.

### The Note Module is shared; its extension set is not

This is the part that is not free, and it is worth being explicit about.

The Note Module's `@`-mention Cross-Reference picker points at a Person, a
Shepherding Note, an Elder Document or a Folder. **Every one of those is
elder-only.** An Event Document is readable by whoever may see the Event, which
for most Events is any member and for a `public` Event is anybody at all.

Mounting the Note Module wholesale on an Event Document would therefore put a
picker onto elder-only records in front of readers who may not see them — a
member typing `@` and being offered a list of the congregation's pastoral notes.
The picker does not fetch the note bodies, but the *names* in that list are
themselves the disclosure.

So: the editor is shared, and **which extensions it is built with is decided per
surface.** The Cross-Reference picker is on where the surrounding document is
elder-only and off where it is not.

## Consequences

**"Shared backend" turned out to mean less code, not more.** There is no
document service, no abstraction over Firestore paths, no registry of document
kinds. There is a shape module, and four call sites that use it against four
paths. Anything more would be inventing a layer to express a difference that
Firestore already expresses.

**Two rule blocks say the same thing, and a test keeps them saying it.** That
duplication is forced by the rules language and is the same trade ADR-0046
already accepted when `storage.rules` restated the permission ladder.

**A per-surface extension set is a new thing to get wrong.** Nothing today stops
somebody adding the Mention extension to an Event Document editor. The guard is
this ADR and the note in `CONTEXT.md`; if a third surface appears, that guard
should become a test.

**`CONTEXT.md` widened rather than gained a new abstraction.** Note Body is now
the content of anything the Note Module writes, and Event Document is named
beside Event Attachment where a person meets it. No umbrella term was invented,
because nothing in the code needs to refer to all four at once.
