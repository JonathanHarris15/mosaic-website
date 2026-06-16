# ADR 0006: Baptism Candidates as Person References

## Status
Accepted

## Context
Baptism on a Service was originally a free-text liturgy value (`liturgy.baptism`) plus a `hasBaptism` flag, deliberately *not* linked to a Person record — it was treated as a label printed on the Service Guide and shown in the calendar.

We now want each baptized person to carry their baptism date on their People profile and Shepherding Profile, and we want the Order of Service Builder to capture baptism candidates as real people (creating a Person when one is typed who doesn't yet exist). This requires linking baptism to Person records and migrating years of historical free-text values.

## Decision
A Service's baptism is a list of **Baptism Candidates** — Person references stored in `liturgy.baptism` (the field is reused, its type changed from `string` to `[{name, id}]`). `hasBaptism` remains the explicit "Include Baptism?" toggle that restructures the liturgy/guide layout.

A baptism is recorded on the Person as a single denormalized `baptismDate` field (not an `involvement` record). On save, the Builder diffs the previous Baptism Candidate set against the current one (the same person-set diff used for Music Helpers): added people get `baptismDate` = the Service date; removed people have it cleared **only if** it currently equals that Service's date.

Historical free-text values are converted by a one-off, dry-run-first migration script (`scripts/migrate-baptism.cjs`) that parses names, links to existing People or creates new ones, and flags anything ambiguous for manual resolution rather than guessing.

## Alternatives Considered

**Record baptism as a `baptism` involvement** (like `worship_helper`): rejected because an involvement models recurring participation in a service role, whereas baptism is a once-in-a-lifetime sacrament. A single dated field is the truthful shape and is trivial to display as "Baptized: [date]".

**Introduce a new field instead of reusing `liturgy.baptism`**: rejected to avoid leaving a dead `liturgy.baptism` string alongside a new field; reuse keeps one location, at the cost of every reader needing to handle both the array and any not-yet-migrated string (readers were made defensive).

**Auto-resolve ambiguous names in the migration** (e.g. infer shared surnames in "John and Jane Smith"): rejected. The migration only auto-applies confident "First Last" parses and flags the rest for a human, to avoid silently creating mis-named or duplicate Person records.

## Consequences
- `liturgy.baptism` is polymorphic during the transition: an array post-migration, possibly a legacy string until the migration runs. Readers (calendar, Service Guide, Builder PDF) and the Builder's load path coerce a legacy string to a single literal candidate so nothing is lost or rendered as `[object Object]`.
- Baptism is now read-only in the calendar; candidates are edited in the Order of Service Builder, where the Person picker lives.
- Toggling "Include Baptism?" off clears the `baptismDate` those candidates received from this Service (the effective candidate set is empty when the toggle is off).
- Irregular services still treat baptism via `CANONICAL_MAPPING` as a text element; baptism-candidate editing is a regular-service feature and is not wired into the irregular-element editor.
