# Service Scheduler — GitHub Issues

Feature-level epics for the new **Church Service Scheduler** in the Mosaic Manager website.
Each epic is a single GitHub issue with a sub-task checklist. File them with
`docs/scheduler/create_scheduler_issues.sh` (uses the `gh` CLI) or copy/paste manually.

Suggested milestone: **Service Scheduler v1**

Labels used: `scheduler`, `epic`, `enhancement`, `frontend`, `backend`, `firestore`, `sms`.

---

## Epic 1 — Scheduler data model & Firestore schema

**Labels:** `scheduler`, `epic`, `firestore`, `backend`

Foundational data layer the rest of the scheduler builds on. Define collections, security
rules, and indexes. People are **never deleted** — deactivation only, to preserve serve history.

**Scope / sub-tasks**

- [ ] Add `scheduler_volunteers` collection: `name`, `gender`, `active` (bool), `canTeachKids`, `canAssistKids`, `canSetupTeardown`, `canCoffeeCommunion` (bools), `kidsEligible` (bool), `kidsCoupleGroup` (string/id, nullable), `notes`.
- [ ] Add `scheduler_serve_log` collection: `date`, `volunteerId`, `name` (denormalized), `role`, `notes`. One row per role served (two rows if a person serves two roles on the same Sunday).
- [ ] Add `scheduler_planner` collection: per-Sunday draft assignments keyed by date, `{ role -> volunteerId }`, plus computed status snapshot.
- [ ] Add `scheduler_future_schedule` collection: future assignments that do **not** count as served.
- [ ] Add `scheduler_settings` doc: roles config, per-role counts needed, anchor/today date, month start/end, planner weeks (default 12).
- [ ] Write Firestore security rules for all new collections (admin/authorized-editor write; scoped read).
- [ ] Add composite indexes for serve-log queries by `volunteerId`+`date` and by `date`.
- [ ] Seed default roles config: 1 Kids Teacher, 2 Kids Assistants, ≥1 female in kids room, 2 male Setup/Tear Down, 1 Coffee/Communion.

**Acceptance criteria**

- Collections exist with documented field shapes; rules deployed; indexes build clean.
- Marking a volunteer inactive hides them from planning but retains all serve-log rows.
- Default role config matches the standard Sunday setup and is editable via settings.

---

## Epic 2 — People / Roster management

**Labels:** `scheduler`, `epic`, `frontend`

A roster page to add and maintain volunteers and their eligibility flags. This is a manual
planning tool — no auto-scheduling.

**Scope / sub-tasks**

- [ ] Roster table listing all volunteers with columns for each capability flag and Active status.
- [ ] Add / edit volunteer form: Name, Gender, Active?, Can Teach Kids?, Can Assist Kids?, Can Setup/Tear Down?, Can Coffee/Communion?, Kids Eligible?, Kids Couple Group, Notes.
- [ ] **Deactivate** (not delete) action; ability to reactivate. Confirm no hard-delete path exists in the UI.
- [ ] Kids Couple Group picker to tag married/paired people who should not serve together in kids.
- [ ] Filter/sort roster by capability, gender, and active status.
- [ ] Inline validation (required name, valid gender value).

**Acceptance criteria**

- Can add, edit, deactivate, and reactivate volunteers.
- Deactivated volunteers are excluded from planner suggestions but remain in history and reports.
- Couple Group tags are stored and available to the planner's conflict check.

---

## Epic 3 — Serve Log

**Labels:** `scheduler`, `epic`, `frontend`

Chronological record of every time someone serves, powering all history-based stats.

**Scope / sub-tasks**

- [ ] Serve-log view: Date, Name, Role, Notes; sortable and filterable by person, role, date range.
- [ ] Add / edit / remove log entries manually.
- [ ] Support two separate rows when one person serves two roles on the same Sunday.
- [ ] "Commit planner week to log" action that writes a Sunday's confirmed assignments as log rows.
- [ ] Import existing history from `Master Schedule.csv` (one-time migration script).

**Acceptance criteria**

- Every serve is one row; multi-role Sundays produce multiple rows.
- Editing/removing a row updates dashboard stats correctly.
- Historical CSV imports without duplicating rows.

---

## Epic 4 — Planner with lineup validation

**Labels:** `scheduler`, `epic`, `frontend`

Show upcoming Sundays and let the user manually assign people to roles, then run checks and
surface warnings/recommendations. It does not auto-fill — it validates the human's choices.

**Scope / sub-tasks**

- [ ] Upcoming-Sundays view (count driven by `planner weeks`, default 12) with a slot per role.
- [ ] Manual assignment picker per slot, scoped to active + eligible volunteers, with suggestions.
- [ ] Validation checks per Sunday:
  - [ ] At least 1 female in kids room.
  - [ ] Both Setup/Tear Down people are male.
  - [ ] Teacher is eligible to teach.
  - [ ] Assistants are eligible to assist.
  - [ ] Setup people are eligible for setup.
  - [ ] Coffee/Communion person is eligible.
  - [ ] No Couple Group conflict in kids.
  - [ ] No assignee served the **prior** Sunday.
- [ ] Overall lineup status indicator (OK / warnings / blocking issues).
- [ ] Recommendation / warning notes surfaced inline per slot and per Sunday.
- [ ] Respect volunteer blackout/unavailable dates from Epic 8 (warn if assigned while unavailable).

**Acceptance criteria**

- Each check runs on assignment change and shows a clear pass/warn state.
- Warnings are non-blocking guidance; the user can still save an imperfect lineup intentionally.
- Prior-Sunday and couple-conflict logic verified with unit tests.

---

## Epic 5 — Dashboard & suggestion / priority scoring

**Labels:** `scheduler`, `epic`, `frontend`, `backend`

Summary stats per volunteer plus the fairness-based suggestion engine that feeds the planner.

**Scope / sub-tasks**

- [ ] Per-volunteer metrics: total serves, serves this month, % of Sundays served this month, last-served date, Sundays since last served, served-last-Sunday flag.
- [ ] Role counts per person: teacher, assistant, setup, coffee.
- [ ] Summary tiles: active volunteers, total serves, serves this month.
- [ ] Overall priority score + role-specific priority scores.
- [ ] Scoring logic favors people who: served less recently, served less often overall, served less this month, and have not served yet this month. Penalize anyone who served last Sunday.
- [ ] Top-options lists per role: Top Teacher, Top Assistant, Top Setup, Top Coffee options.
- [ ] Expose scoring as a shared module the planner imports for its suggestions.

**Acceptance criteria**

- Metrics match the serve log for spot-checked volunteers.
- Someone who served last Sunday drops in ranking versus an equivalent volunteer who did not.
- Top-options lists exclude ineligible and inactive people.

---

## Epic 6 — Future Schedule

**Labels:** `scheduler`, `epic`, `frontend`

A place to paste/type planned future assignments that must **not** count as already served,
so forward planning never distorts past serve counts or fairness scores.

**Scope / sub-tasks**

- [ ] Future-schedule editor (paste/type assignments by date and role).
- [ ] Store separately from the serve log; exclude from all "served" counts and scores.
- [ ] Show future assignments in the planner as pencilled-in (visually distinct from committed).
- [ ] Promote a future entry into the serve log once that Sunday is confirmed.

**Acceptance criteria**

- Future entries never affect dashboard stats or priority scores.
- Promotion writes a proper serve-log row and clears the future entry.

---

## Epic 7 — Settings

**Labels:** `scheduler`, `epic`, `frontend`

Make role needs and date anchors configurable so the tool flexes beyond the default setup.

**Scope / sub-tasks**

- [ ] Editable roles list (add/rename/remove roles).
- [ ] Editable number of people needed per role.
- [ ] Gender/eligibility constraints per role (e.g., ≥1 female in kids, setup must be male) configurable.
- [ ] Date settings: today/anchor date, month start, month end, Sundays this month, next Sunday, most recent logged Sunday.
- [ ] Planner weeks setting (default 12).
- [ ] Changing role config re-renders planner slots without breaking existing history.

**Acceptance criteria**

- Defaults load as the standard Sunday setup on first run.
- Changing role counts/constraints updates the planner and validation immediately.
- Date fields drive planner range and "this month" calculations consistently.

---

## Epic 8 — Volunteer availability requests & SMS accept/reject

**Labels:** `scheduler`, `epic`, `sms`, `backend`, `frontend`

Let volunteers request dates off (out of town, etc.) and respond to serving invitations by text.
Build on the existing **Textbelt** integration in `functions/sms.js` and its inbound webhook.

**Scope / sub-tasks**

- [ ] Volunteer-facing way to submit unavailable/blackout dates (self-service form or admin-entered).
- [ ] Store blackout dates on the volunteer; planner reads them (see Epic 4 warning).
- [ ] Outbound SMS invite: "Can you serve as {role} on {date}? Reply YES or NO."
- [ ] Inbound webhook parsing of YES/NO replies mapped to the pending invite (reuse Textbelt webhook + replay protection).
- [ ] Track invite state per assignment: pending / accepted / declined / no-response.
- [ ] Reflect accept/decline back into the planner slot (decline frees the slot + warns).
- [ ] Opt-in / phone-number capture and consent handling for texting volunteers.
- [ ] Reminder/escalation for no-response after N days (optional, follow-up).

**Acceptance criteria**

- A volunteer can mark dates unavailable and the planner warns if they're assigned then.
- An outbound invite sends via Textbelt; a "YES"/"NO" reply updates the assignment's state.
- Declines visibly free the slot and prompt the planner for a replacement.

---

## Suggested build order

1. Epic 1 (schema) → blocks everything.
2. Epics 2 & 3 (roster + serve log) in parallel.
3. Epic 5 (dashboard/scoring) after serve log exists.
4. Epic 4 (planner) after roster + scoring.
5. Epics 6 & 7 (future schedule + settings).
6. Epic 8 (requests + SMS) last / parallel — depends on roster.
