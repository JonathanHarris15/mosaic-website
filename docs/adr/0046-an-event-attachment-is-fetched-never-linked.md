# ADR 0046 — An Event Attachment is fetched, never linked, so its visibility is asked on every read

**Status:** Accepted
**Date:** 2026-08-31
**Ticket:** MS-287

## Context

MS-287 gave an [[Event occurrence]] a Files tab, and made one promise about it:
**whoever may see the Event may see what is attached to it.** The Firestore rule
on `event_occurrences/{id}/attachments` kept that promise for the *record* — the
name, the size, who uploaded it. It did not keep it for the *file*.

Two separate things were wrong, and either one on its own is enough to break the
sentence.

### 1. The Storage rule did not know what an Event is

`storage.rules` said `allow read: if request.auth != null`. It was copied from
the Directory Photo pattern (ADR-0029), where it is defensible: a Directory
Photo has no restrictive rung to under-deliver on, and the rules cannot read
Firestore, so the boundary lives in what may be *attached* to a Person rather
than in what may be *fetched*.

An Event does have a rung. The elders' meeting is `elder`, and its floor plan
sat behind "does this account exist" — one guessable path away from any member
who can read a URL. The rung had become decoration.

### 2. `getDownloadURL()` mints a key that outlives every rule

Even with a perfect rule, the upload called `getDownloadURL()` and stored what
came back in the record's `url` field. That URL carries a
`firebaseStorageDownloadTokens` value, and a Storage token is **not** an
authenticated request: it serves the file to anyone holding the link, signed
out, from any browser, forever, without Rules being consulted at all. It cannot
be expired and it cannot be recalled once forwarded.

So the rule would have been asked once, at upload, by an editor — and never
again by anyone.

## Decision

**An Event Attachment is fetched with the reader's own credentials. It is never
represented as a URL.**

Three parts, and all three are load-bearing:

1. **`storage.rules` reads the occurrence.** Cross-service Rules let a Storage
   rule call `firestore.get()`. The read gate is now
   `canSeeOccurrence(occurrenceId)`, which fetches the occurrence's stamped
   `visibility` and answers the same question `rankCanSee()` answers in
   `firestore.rules`, participant rung included. Writing needs an editor, which
   these rules can now also tell.

2. **The record carries a path, not a link.** `EventAttachmentsCore` has no
   `url` field. Nothing on the attachment path calls `getDownloadURL()`.

3. **The browser downloads over an authenticated request.**
   `calendar-event.js openAttachment` fetches
   `firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media` with the
   reader's ID token in an `Authorization: Firebase …` header, and hands the
   resulting blob to the browser to save. Rules are evaluated on **every**
   fetch, so access lost is access lost — not access lost from here on, for
   people who never had the link.

`sealEventAttachment` strips the download token Storage mints on its own at
upload, so there is nothing to leak even for a file dropped in from the Firebase
console.

## Consequences

**The budget is two Firestore documents per evaluation.** Cross-service Rules
allow no more, so the read spends exactly two — the asker's `users` document and
the occurrence — and never the same one twice. A third condition needing a third
document cannot be added; it would have to be denormalised onto one of the two.

**Every download costs two Firestore reads** and the latency of them. For a
handful of flyers on an Event page this is not worth optimising, and it buys the
only thing that makes the rung real.

**The ladder is now written in two languages.** `storage.rules` restates
`permissionLevel()`, `isSignedIn()` and `rankCanSee()` because the two engines
cannot share code. `test/storage-event-attachment-rules.test.js` reads both
files and fails when they name different permission levels, which is the drift
that would actually happen.

**Files download rather than open in a tab.** A blob cannot be handed to a new
tab as reliably as a URL can, so a PDF saves instead of previewing. That is the
price of not having a URL, and for a flyer or a sign-up sheet it is a fair one.

**A Directory Photo still works the old way.** This ADR does not change
ADR-0029. A photo of a member is visible to signed-in members by design; there
is no rung being under-delivered on, so there is nothing to fix. If that ever
changes, this is the pattern to follow.
