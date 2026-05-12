# Mosaic Domain Model

## Core Entities

### Person
An individual whose involvement with the church is tracked.
- **Fields**:
  - `name`: Full name.
- **Sub-collections**:
  - `involvement`: Records of participation in services.

### Service
A liturgical event (usually a Sunday service), identified by its date (YYYY-MM-DD).
- **Fields**:
  - `serviceLeader`: Reference to a Person (historically a string).
  - `preacher`: Reference to a Person (historically a string).
  - `musicLeader`: Reference to a Person (historically a string).
  - ... (other liturgy fields)

### Hymn Entry
A hymn selection within a Service's liturgy.
- **States**:
  - **Canonical**: Linked to a document in the `hymns` collection (has a valid `id`). This is the preferred state as it enables music sheet generation.
  - **Literal**: An unlinked name (has a `name` but `id` is null). These typically arise from docx imports where a match wasn't found. They must be resolved (linked to a Canonical hymn) to enable full functionality.

### Involvement
A record of a Person's participation in a Service in a specific Role.
- **Fields**:
  - `serviceDate`: The date of the service (YYYY-MM-DD).
  - `type`: The role type (see Roles).
  - `metadata`: Optional extra data (e.g., prayer type, prayer text).

## Roles
Canonical names for types of involvement.
- `service_leader`: The primary facilitator of the service.
- `preacher`: The person delivering the sermon.
- `worship_leader`: The person leading the musical worship.
- `sermonette`: The person delivering a shorter message. In the calendar view, this is displayed as a badge and is editable inline by admins.
- `baptism`: A liturgical event marked by `hasBaptism: true`. Displayed as a read-only badge in the calendar views.

## User Interface Conventions

### Service Calendar
- **Baptism Indicator**: 
  - **List View**: A blue status badge with a `water_drop` icon.
  - **Table View**: A dedicated "Baptism" column showing the candidate's name or notes.
  - **Editing**: Editable inline as a free-text field (not linked to a Person record). Setting a value automatically sets `hasBaptism: true`; clearing it sets `hasBaptism: false`.
- **Sermonette Indicator**: 
  - **List View**: A purple status badge with a `mic` icon.
  - **Table View**: Displayed within the "Preacher" column as a secondary entry (e.g., "Jane Doe (Sermonette)").
  - **Editing**: Editable inline by admins, linked to a Person record.
- **Editing Summary**: 
  - Sermonette leaders are linked to People and editable from list/table.
  - Baptism is free-text and editable from the table view.
- `prayer`: The person leading a specific prayer.
  - `prayer_type`: 'praise' or 'confession'.
  - `prayer_text`: The content of the prayer.
