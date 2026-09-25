# MS-682 — alternatives considered and rejected

The Push notifications tab reads the MS-189 schema and does not invent a
second log or a second send path.

## Alternatives rejected

**Let the admin dashboard read `users/{uid}/push_tokens` from the client.**
Rejected. ADR-0036 keeps those documents owner-only. An admin reading
another person's token string is exactly the hole that rule exists to
close. Token data reaches the browser only through admin-gated callables,
and only after `maskToken` (last six characters; shorter values are fully
hidden).

**Route the admin test push through `tellPerson`.**
Rejected. `tellPerson` would text the admin if every token were dead, and
it would honour a client-supplied `personId`. The test is "did FCM accept
*my* devices?", so it loads `request.auth.uid`'s tokens, ignores client
`uid` / `token` / `personId`, deletes dead tokens, and never sends a text.

**A "send to everyone" or bulk-send control.**
Rejected. The ticket forbids it. There is no UI and no callable that
accepts a list of recipients.

**A parallel `push_messages` log, or writing a new audit collection.**
Rejected by ADR-0036 already: "did we tell them?" has one home,
`notifications`. This tab reads that collection.

**Composite Firestore indexes per filter (channel + createdAt, …).**
Rejected for v1. The church log is small. The callable reads the newest
400 rows and pages / filters in memory. Indexes can be added later if
the log outgrows that window. `firestore:indexes` stays out of the
standing deploy set.

**Changing `tellPerson` / `notification-core` decisions.**
Rejected. Exporting `DEAD_TOKEN_CODES` is the only core change, so the
flow picture can be derived from the same set `isDeadToken` uses. Route,
window, and fallback behaviour are untouched.

**Running or modifying the MS-253 `sms_messages` copy.**
Rejected. Out of scope (HITL). The sent log shows a read-only note that
older texts may still live there.

**Client-only confirmation on revoke / test-send.**
Rejected. The callables also require `confirm: true`, because a callable
is reachable without the dashboard.
