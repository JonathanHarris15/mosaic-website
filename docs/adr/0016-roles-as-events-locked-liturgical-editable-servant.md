# ADR 0016: Serving Is Modelled as Roles on Events — Liturgical Roles Locked, Servant Roles Editable, Built on Involvement

## Status
Accepted

## Context
The Scheduler epic (MS-22) originally specced a self-contained scheduling system with its own `scheduler_*` collections — a separate volunteer table, its own serve log, its own settings. That plan predates and duplicates the domain model the church app already has:

1. **"Volunteers" already exist as `people`.** A parallel volunteer record splits each person in two and lets the copies drift.
2. **A serve log already exists as Involvement.** Every serving assignment is written as `people/{id}/involvement` = `{ serviceDate, type }`, and the model was deliberately kept **role-open** (any `type` slug accepted, no schema change — see the Servant Role glossary entry and MS-81) precisely so this feature could plug in.
3. **Relationship restrictions already exist.** `relationships`, `relationship_groups`, `families`, and Shepherding Tags already model "married couple", group membership, and arbitrary labels — the raw material for role eligibility and "don't serve together" rules.

Two further shifts reshaped the epic: the tool moves from **manual-only** ("the user decides") to **propose-then-approve** (the system drafts a lineup, the human accepts), and roles are abstracted onto a new **Event** type so a Sunday Service becomes one instance of a general "event with roles" — the foundation a full Calendar (MS-99) will later sit on.

The unifying question: if all serving (liturgical *and* servant) becomes "roles", do the **liturgical** roles — preacher, service leader, worship leader — also become editable data? Those roles are not just labels today: they are hardwired fields on every Service entity and hardwired into the printed Service Guide (e.g. the `<preacher-name>` Builder Component pulls the preacher onto the booklet). Making them editable data would force a rebuild of the Service entity and the guide component system — destabilising the artefact that must print correctly every Sunday.

## Decision

**1. One "Role" concept, two families.** All serving participation is a **Role** recorded as Involvement. Roles come in two families:
- **Liturgical Roles** (preacher, service leader, worship leader, prayer…) are **locked**: code-defined, undeletable, and keep their existing wiring into the Service entity and the Service Guide component system. They have no editable definition.
- **Servant Roles** (kids, setup/teardown, coffee, sound…) are **editable Role Definitions** authored in the Roles Manager.

This is **Option A**: unify the *concept and the UX* (one roles list, one Roles tab, one serve log) without ripping liturgical roles out of the plumbing that prints the weekly booklet. Option B (everything editable data) was rejected for the cost and risk to the printed guide.

**2. Build on the existing model, not a parallel one.** No `scheduler_*` collections. Serving stays as **Involvement**; eligibility and restrictions read **Shepherding Tags** and the **Relationship**/**Family** graph; people are **`people`**. New storage is limited to what genuinely doesn't exist: a `roles` collection of Servant Role Definitions and an `events` type.

**3. A Role Definition is name + slots + restrictions.** Each Servant Role Definition carries a name, an ordered set of **slots** (each requiring **male**, **female**, or **either**), and **restriction rules** expressed against existing Tags and Relationships (e.g. "no married couple in this role", "exclude tag X").

**4. Roles hang off Events; a Sunday Service is a locked recurring Event.** The Sunday Service is always present and its liturgical Roles are undeletable. Arbitrary Events (introduced with the Calendar, MS-99) can carry Servant Roles too.

**5. Fairness is scoped per Event series.** A Person's serving history for a Role is counted within that recurring Event, not globally — someone can be overdue for Sunday setup and fresh for a Wednesday role at the same time. Involvement carries the Event/series it belonged to so history can be filtered per series.

**6. Assignment is propose-then-approve.** A shared per-series scoring module ranks candidates; a batch flow drafts a fair, rule-valid lineup across a date range that the user reviews and accepts. Drafted picks do **not** count as served until accepted (a proposed vs committed distinction), which subsumes the old "Future Schedule" idea.

**7. "Permission level" replaces the User "role".** To free the word "role" for serving, the User access tier (viewer → super_admin) is renamed **Permission Level** across UI, code, the stored field, and the security rules. This is the epic's first Feature; the tier values are unchanged.

## Consequences
- The old MS-22 sub-features are superseded: the parallel data model, a standalone roster, a standalone serve-log, and a Settings feature all dissolve into "reuse what exists" or fold into the reshaped Features.
- The liturgical/servant split means two code paths for roles indefinitely; the seam is the Role family flag. Accepted as the price of not destabilising the Service Guide.
- The Calendar (MS-99) depends on the Event foundation defined here but is out of scope for this epic.
