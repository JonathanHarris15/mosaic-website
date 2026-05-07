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
- `sermonette`: The person delivering a shorter message.
- `prayer`: The person leading a specific prayer.
  - `prayer_type`: 'praise' or 'confession'.
  - `prayer_text`: The content of the prayer.
