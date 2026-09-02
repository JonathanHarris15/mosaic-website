# ADR 0052 — A secret ballot keeps two lists that cannot be joined

**Status:** Accepted
**Date:** 2026-09-02
**Ticket:** MS-360

## Context

A Form Template carries two settings that look independent and are not:

- **Attribution** — whether a Response records who gave it.
- **One Response Each** — whether a person may answer more than once. Only
  available on a `member` rung or above, because a public form has no account
  to key on and cannot enforce it honestly.

Turn both on and you have a secret ballot: every member votes once, nobody can
see who voted which way. The church will want it — a vote where nobody can
check whether you voted is worse than none, because it is how you end up asking
everybody twice.

But the two settings pull against each other. To refuse a second answer, the
system must remember **that you answered**. That is a record with your name on
it, sitting next to a set of answers that were supposed to be anonymous.

The obvious implementation destroys the promise. Put `answeredBy` on the
Response and the ballot is not secret — it is a spreadsheet with a column
somebody will read. Nothing about that field looks wrong in a diff; it looks
like ordinary bookkeeping, which is exactly why it needs pinning.

## Decision

**Two lists, and nothing may join them.**

- The **answers** hold what was said and carry no person. On an attributed form
  they carry the Person; on an anonymous one the field does not exist, rather
  than existing and being null.
- The **ledger** holds who has answered and carries no answers. One entry per
  person per form, holding a person id and nothing else — no timestamp fine
  enough to correlate against, no ordering that reconstructs one.

A second submission is refused by asking the ledger. Reading the tally never
touches it. No query, view, export or Responses tab may return a row drawn from
both.

**The form says so in words, on the form.** "We record that you answered. We do
not record what you said." The promise the church hears is the one the storage
actually makes, and a person deciding whether to be honest on a ballot is
entitled to know which it is.

## Consequences

**Timestamps are a leak and are treated as one.** Written to the millisecond,
the ledger and the answers can be lined up by sort order and the ballot is
undone without either list gaining a field. Ledger entries are therefore
recorded at a coarse granularity, and answers are not stored in submission
order.

**Anonymous means the field is absent, not null.** A null `personId` alongside a
populated one on the next form is a shape somebody will later "fix" by
backfilling. Absent is unambiguous.

**This is the constraint most likely to be broken by a tidy-up.** Merging the
two into one collection with an optional field is a smaller, cleaner-looking
schema, and it is wrong. That is the whole reason this is an ADR and not a
comment.

**It only applies to Responses.** A Form Document is filled in by a named person
as their own record — there is no ballot and no ledger, and the same template
is deliberately used many times by the same person.
