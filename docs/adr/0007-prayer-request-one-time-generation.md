# ADR 0007: Prayer Request — One-Time Generation into a Shepherding Note

## Status
Accepted

## Context
A Prayer Request (what a pastoral-prayer subject asks the church to pray about for a given Sunday) needs to be visible in two places:

1. **In the order of service** — elders reviewing that Sunday want the request in the context of the service it belongs to, keyed by service date.
2. **On the subject's Shepherding Profile** — as part of the durable pastoral record for that person, as a Shepherding Note of Note Type "Prayer Request".

The request can arrive two ways — typed by an elder in the Service Builder, or supplied by the subject replying to an automated text (handled server-side in `smsInbound`). Either way it must end up in both places. How should the two homes relate?

**Privacy constraint:** the existing `pastoral_prayer_history/{serviceDate}` sub-collection is world-readable (`allow read: if true`, including a public collection-group read) because the public "was prayed for" fact and `lastPastoralPrayerDate` drive non-elder views (analytics, calendar, suggestions). Firestore has no field-level read rules, so the Prayer Request **text cannot live there** without leaking sensitive content that the automated text explicitly promises is "private and only shared with Elders."

## Decision
**One-time generation, into an elder-only record.** When a Prayer Request is captured — by either path — two writes happen:

1. The request text and its send-state are written to a new **elder-only** sub-collection `people/{id}/prayer_requests/{serviceDate}` (Firestore rule `allow read, write: if isElder()`). It is keyed by service date, so it still lines up with the order of service, but the sensitive content is never exposed by the world-readable `pastoral_prayer_history`. That history record keeps only the public "was prayed for" fact.
2. A Shepherding Note of type "Prayer Request" is generated **once** on the person, guarded by a `noteGenerated` flag (elder path) / the existing "already filled" check (reply path) so a second save or a duplicate reply cannot create a second note.

After generation the two are **independent**: the Shepherding Note is an ordinary note that any elder may freely edit or delete, and the order-of-service entry is that Sunday's snapshot. Neither is bound to the other.

## Alternatives Considered

**Continuous two-way sync** between the order-of-service entry and the Shepherding Note. Rejected: it fights the established rule that any elder can freely edit or delete any Shepherding Note, and it introduces sync machinery and conflict handling for no pastoral benefit.

**Single home — Shepherding Note only**, with the order-of-service view querying the note. Rejected: the per-Sunday record (`pastoral_prayer_history/{date}`) already exists and is the right key for the order-of-service view; deriving it from notes would need a query per subject and lose the natural per-date record.

**Single home — history record only**, with no note. Rejected: the Shepherding Profile is where elders do pastoral work, and the request belongs in the durable pastoral record there.

## Consequences
- Two writes happen together when a request is captured; both the elder path (`service-builder.js`) and the reply path (`smsInbound` in `index.js`) must perform them.
- The note and the order-of-service entry can diverge if edited later. This is acceptable and intended: the note is the durable pastoral record; the order-of-service entry is that Sunday's snapshot.
- Duplicate-note prevention relies on the `noteGenerated` flag / "already filled" guard. Any future capture path must honour the same guard.
- This mirrors the denormalization trade-off in ADR 0005 (a denormalized field kept alongside a richer record) — chosen for the same reason: the list/contextual view needs its own record rather than deriving from the history.
