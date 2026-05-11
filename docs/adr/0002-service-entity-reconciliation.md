# ADR 0002: Service Entity Reconciliation Strategy

## Status
Accepted

## Context
Imported services (from docx) frequently contain misspelled names for people, hymns, and Bible books. Additionally, the original data model stored roles (e.g., `serviceLeader`) as plain strings, which prevents robust historical tracking of individuals as outlined in [ADR 0001](./0001-people-involvement-model.md).

## Decision
We will use a semi-automated CLI tool to reconcile these entities across all existing services.

1.  **People**:
    - The tool fuzzy matches the string name against the `people` collection.
    - If a match is found (or a new person is created), the service document is updated with a `{role}Id` field (e.g., `serviceLeaderId`).
    - An `involvement` record is created in the person's sub-collection for that service date and role.
2.  **Hymns**:
    - The tool fuzzy matches hymn names against the `hymns` collection.
    - If a high-confidence match is found, the service's `liturgy` object is updated with the correct `id` and `name`.
3.  **Passages**:
    - The tool checks the spelling of Bible book names in `keyVerse` and `scriptureReading` fields.
    - It prompts the user for corrections based on a canonical list of 66 books.

## Consequences
- **Pros**:
  - Cleans up historical data inconsistencies.
  - Enables the "Involvement Reports" feature by linking legacy services to the new `people` model.
  - Improves searchability of hymns used in past services.
- **Cons**:
  - Requires a one-time manual effort to review fuzzy matches.
  - Introduces dual fields (`serviceLeader` and `serviceLeaderId`) in services, where the ID field is the new source of truth.
