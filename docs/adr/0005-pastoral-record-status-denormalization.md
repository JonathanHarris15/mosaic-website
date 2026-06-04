# ADR 0005: Pastoral Record — Denormalized Status Field Alongside Status Change History

## Status
Accepted

## Context
The Shepherding Status is being upgraded from a static field to a tracked history. Every time an Elder changes a Person's Shepherding Status, a Status Change entry must be appended to the Pastoral Record so that the full progression is visible over time.

This raises a data model question: should `shepherdingStatus` remain as a denormalized field on the Person document (always reflecting the current status), or should it be removed in favour of deriving current status from the latest Status Change entry?

## Decision
Keep `shepherdingStatus` as a denormalized field on the Person document. Every status write performs two operations atomically:
1. Updates `people/{id}.shepherdingStatus` with the new value.
2. Appends a Status Change record to `people/{id}/shepherding_activity`.

The People list page and all Filtered Views on the Shepherd Landing Page filter and sort by current status using a single Firestore collection query against `people`. Deriving current status from the sub-collection would require either a collection-group query per person (N+1) or a separate denormalized index — restoring the same redundancy but with more complexity.

## Alternatives Considered

**Derive current status from latest Status Change (event-sourced)**: Remove `shepherdingStatus` from the Person document entirely. Current status = the `newStatus` field of the most recent entry in `people/{id}/shepherding_activity`. Rejected because the People list page queries all people in a single pass and renders each person's current status inline — this query cannot be satisfied without the denormalized field.

## Consequences
- Any code path that sets `shepherdingStatus` must also write a Status Change record. These two writes must always happen together; partial writes leave the history inconsistent.
- A Person with no Status Change history may still have a `shepherdingStatus` field set before this feature launched. That value is treated as the current status; no synthetic Status Change entry is backfilled.
- Clearing the status (setting it to null) is a valid Status Change: `previousStatus` holds the last value, `newStatus` is null.
