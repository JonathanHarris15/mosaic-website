# ADR 0067 — An Answer link is a personal, expiring door

**Status:** Accepted (Jonathan approved 2026-09-24).
**Date:** 2026-09-19
**Follows:** [ADR 0007](0007-prayer-request-one-time-generation.md),
[ADR 0031](0031-the-directory-asks-for-an-account.md),
[ADR 0051](0051-a-public-form-is-served-and-answered-through-one-closed-door.md)
**Ticket:** MS-247 (this decision is MS-509)

## Context

Five days before a Sunday, each pastoral-prayer subject is texted and
asked what the church should pray. Today the only way they can answer
is to reply to that text. An Elder can type a request in; the subject
cannot, even when they have an account, because the request is
elder-only by design
([ADR 0007](0007-prayer-request-one-time-generation.md)).

Most subjects have no Mosaic account. A page behind sign-in would
reach only a slice of the people the text already reaches.

MS-247 wants every prayer text to carry a link. Tapping it opens a
small page, with no sign-in, where that person can say what they
would like prayed about — and come back and change it until the
Sunday has passed.

That is a signed-out write. The epic has already rejected a public
endpoint once, for the calendar feed: a feed the internet can walk is
a directory by another name. ADR-0031 then closed the directory
itself, and ADR-0051 refused to reopen Firestore for a public form —
one `onCall` door, rules stay shut, because a rules read is
permission to read the collection.

The same two mistakes are available here. Opening
`people/{id}/prayer_requests` to a signed-out visitor would leak
elder-only text the automated message promises is private. Marking
`answer_links` `allow read: if true` would make every live link
enumerable. Anonymous sign-in is still enabled; `request.auth !=
null` is still not an account.

So the question is not whether a signed-out person may answer. It is
how narrow the door is.

## Decision

**An Answer link is a personal, single-purpose, expiring token that
lets somebody with no account answer one thing through one closed
server door. It is not a calendar feed, and it is not a Firestore
rule opened to signed-out users.**

The mechanism is owned by MS-247 and reused by later callers.
MS-249 (`trade_invitation`) is the second purpose and is out of
scope to implement here. This ticket's purpose is `prayer_request`.

### 1. The token, the URL, and the store

The URL is `/a/<token>`. The token is 128 bits of randomness written
in base58 — the same strength and alphabet as a public form's link
(ADR-0051 refinement). Only the server mints one, at the moment it
sends a text that needs an answer. Each text gets a fresh link; an
earlier link for the same person and thing stays good until it
expires.

One document per link lives in a server-only collection
`answer_links`, keyed by a SHA-256 hash of the token. The raw token
is never stored: reading the database does not give you a working
link. Fields: purpose, Person id, the thing it points at (a service
date here; a Trade id in MS-249), expiry time, created time, and a
small save counter for rate limiting. `firestore.rules` denies every
client read and write on it.

### 2. Expiry is per purpose, with a 21-day hard cap

Each purpose supplies its own expiry at minting. For
`prayer_request` that is the end of the service date in church-local
time (`America/Chicago`). Whatever the purpose says, a link never
lives more than 21 days from minting. That bounds the damage of an
old text found on an old phone.

### 3. A link has no state beyond its expiry

Whether it can still do anything is read, every call, from the thing
it points at: is this person still a subject for that Sunday; is the
Trade still waiting on them. There is no revoke switch. Reuse needs
no special rule: a link can be opened many times and can only ever
do what its thing still allows.

### 4. Person and thing come off the link, never the caller

The server takes the Person id and the thing from the link document.
The caller sends a token, an operation, and — for a save — the
answer text. Nothing else is read from the request. A forwarded
link therefore hands over only what that one link can do, and
nothing else: one person, one purpose, one thing.

### 5. One callable door, the same shape as public forms

A single `onCall` function (v2), `answerLink`, answers two
operations:

- `read` — what should this page show
- `answer` — save this

It dispatches by purpose to a per-purpose handler. An unauthenticated
caller arrives with no `request.auth`, the same as `publicForm`. A
signed-in Linked User can call it with no token for their own open
items — one door for everybody, as ADR-0051 requires for forms.

No rule in `firestore.rules` is loosened. The public path is not a
hole in the wall; it is a door with somebody standing in it.

### 6. Rate limits hold the door, not App Check

App Check is off on the public-form door (MS-508) and may stay off.
This door does not rely on it. Instead:

- A token that is not the right shape is refused before any
  database read.
- An unknown or expired token gets the same "this link has closed"
  answer, so the door does not confirm which tokens ever existed.
- Each link allows at most 10 saves per rolling hour.
- Each caller address (hashed, never stored raw) gets at most 30
  unknown-token lookups per hour; past that the door refuses
  without reading.

## Alternatives considered

**A public calendar-style feed, or a Firestore rule opened to
signed-out visitors.** Rejected: that is the endpoint the epic
already refused, and the exact shape ADR-0031 and ADR-0051 exist to
prevent. A rules read is a collection read; anonymous sign-in still
mints a token with the public API key.

**A sign-in wall.** Rejected: most subjects have no Linked User, and
asking them to make an account to tell the church what to pray is
the problem this Feature exists to remove.

**App Check as the safety.** Rejected: it is off on public forms
(MS-508). Rate limits and an unguessable, hashed, expiring token
are the safety that works either way. App Check may be added later;
nothing here depends on it.

**A revoke flag on the link.** Rejected: liveness already lives on
the thing the link points at. A second switch is a second place for
"is this still open" to disagree.

## Consequences

**Jonathan approved this ADR on 2026-09-24; MS-510–517 may proceed.**
The mechanism above is the MS-247 PRD as written. Product past that
PRD is out of scope for this decision.

**`firestore.rules` gains a closed collection, not an open one.**
`answer_links` is denied to every client. Reviewers looking for
where signed-out access was granted will not find it in the rules
file.

**ADR-0007's once-only note guard stands.** A subject's own change
before the Sunday may update the generated Shepherding Note only
while that note still holds exactly the text it was generated with.
Elder edits always win. There is never a second generated note.
That refinement lives on ADR-0007.

**MS-249 does not invent a second public door.** It adds a
`trade_invitation` purpose on this one. That work is not this
ticket.

**A leak is one request.** Somebody who forwards their prayer text
forwards the ability to read and change that one request, and
nothing else. Accepted in the PRD: it is their request, and an
Elder's words are never shown.
