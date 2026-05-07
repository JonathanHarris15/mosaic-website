# ADR 0001: Data Model for People and Service Involvement

## Status
Proposed

## Context
The church needs to track the involvement of individuals in various service roles (e.g., Preacher, Service Leader, Prayer Leader) to monitor participation and maintain a historical record. Historically, names were stored as plain strings in the `services` collection, which prevents easy querying of an individual's history and is prone to spelling inconsistencies.

## Decision
We will implement a dedicated `people` collection in Firestore.

1. **People Collection**: Each document represents a person.
   - Root document fields: `name`.
2. **Involvement Sub-collection**: To ensure scalability and efficient querying, each person document will have an `involvement` sub-collection.
   - Fields: `serviceDate` (YYYY-MM-DD), `type` (role identifier), and `metadata` (for role-specific data like prayer text).
3. **Role Identifiers**: Standardized slugs will be used for roles:
   - `service_leader`
   - `preacher`
   - `worship_leader`
   - `sermonette`
   - `prayer`
4. **Linking**: Future service documents will store `personId` references instead of (or in addition to) name strings.

## Consequences
- **Pros**:
  - Robust historical tracking for individuals.
  - Reduced data redundancy and improved integrity.
  - Ability to generate "Involvement Reports" easily.
- **Cons**:
  - Existing `services` data will eventually need migration to map name strings to `people` IDs.
  - UI will need a "Person Picker" instead of a simple text input.
