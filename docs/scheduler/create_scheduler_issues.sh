#!/usr/bin/env bash
#
# Create the Service Scheduler epics as GitHub issues.
#
# Prereqs:
#   - GitHub CLI installed and authenticated:  gh auth login
#   - Run from anywhere; repo is set explicitly below.
#
# Usage:
#   ./create_scheduler_issues.sh            # create labels, milestone, and 8 issues
#   DRY_RUN=1 ./create_scheduler_issues.sh  # print what would run, create nothing
#
set -euo pipefail

REPO="JonathanHarris15/mosaic-website"
MILESTONE="Service Scheduler v1"

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    printf 'DRY_RUN: %s\n' "$*"
  else
    "$@"
  fi
}

echo "==> Ensuring labels exist"
ensure_label() {
  local name="$1" color="$2" desc="$3"
  run gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" 2>/dev/null \
    || run gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" 2>/dev/null \
    || true
}
ensure_label "scheduler"   "5319e7" "Church service scheduler feature"
ensure_label "epic"        "b60205" "Large feature tracked as a checklist"
ensure_label "enhancement" "a2eeef" "New feature or request"
ensure_label "frontend"    "1d76db" "UI / client work"
ensure_label "backend"     "0e8a16" "Server / functions work"
ensure_label "firestore"   "fbca04" "Firestore schema, rules, indexes"
ensure_label "sms"         "d93f0b" "Textbelt SMS integration"

echo "==> Ensuring milestone exists: $MILESTONE"
# gh has no first-class milestone create; use the API. Ignore error if it already exists.
run gh api "repos/$REPO/milestones" -f title="$MILESTONE" \
  -f description="First release of the church service scheduler" >/dev/null 2>&1 || true

create_issue() {
  local title="$1"; shift
  local labels="$1"; shift
  local body="$1"; shift
  echo "==> Creating: $title"
  run gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --label "$labels" \
    --milestone "$MILESTONE" \
    --body "$body"
}

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 1 — Data model & Firestore schema" \
"scheduler,epic,firestore,backend" \
'Foundational data layer for the church service scheduler. People are **never deleted** — deactivation only, to preserve serve history.

### Sub-tasks
- [ ] `scheduler_volunteers`: name, gender, active, canTeachKids, canAssistKids, canSetupTeardown, canCoffeeCommunion, kidsEligible, kidsCoupleGroup, notes
- [ ] `scheduler_serve_log`: date, volunteerId, name, role, notes (one row per role served)
- [ ] `scheduler_planner`: per-Sunday draft assignments { role -> volunteerId } + status snapshot
- [ ] `scheduler_future_schedule`: future assignments that do NOT count as served
- [ ] `scheduler_settings`: roles config, per-role counts, anchor date, month start/end, planner weeks (default 12)
- [ ] Firestore security rules for all new collections
- [ ] Composite indexes for serve-log queries (volunteerId+date, date)
- [ ] Seed default roles: 1 Kids Teacher, 2 Kids Assistants, >=1 female in kids, 2 male Setup/Tear Down, 1 Coffee/Communion

### Acceptance criteria
- Collections exist with documented shapes; rules deployed; indexes build clean.
- Marking a volunteer inactive hides them from planning but retains serve-log rows.
- Default role config matches the standard Sunday setup and is editable via settings.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 2 — People / Roster management" \
"scheduler,epic,frontend" \
'Roster page to add and maintain volunteers and eligibility flags. Manual planning tool — no auto-scheduling.

### Sub-tasks
- [ ] Roster table with capability flags and Active status
- [ ] Add/edit form: Name, Gender, Active?, Can Teach Kids?, Can Assist Kids?, Can Setup/Tear Down?, Can Coffee/Communion?, Kids Eligible?, Kids Couple Group, Notes
- [ ] Deactivate (not delete) + reactivate; no hard-delete path in UI
- [ ] Kids Couple Group picker for people who should not serve together in kids
- [ ] Filter/sort by capability, gender, active status
- [ ] Inline validation (required name, valid gender)

### Acceptance criteria
- Can add, edit, deactivate, and reactivate volunteers.
- Deactivated volunteers are excluded from suggestions but remain in history.
- Couple Group tags are available to the planner conflict check.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 3 — Serve Log" \
"scheduler,epic,frontend" \
'Chronological record of every serve, powering all history-based stats.

### Sub-tasks
- [ ] Serve-log view: Date, Name, Role, Notes; sortable/filterable by person, role, date range
- [ ] Add/edit/remove entries manually
- [ ] Two separate rows when one person serves two roles on the same Sunday
- [ ] "Commit planner week to log" action
- [ ] One-time import of existing history from Master Schedule.csv

### Acceptance criteria
- Every serve is one row; multi-role Sundays produce multiple rows.
- Editing/removing a row updates dashboard stats correctly.
- Historical CSV imports without duplicating rows.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 4 — Planner with lineup validation" \
"scheduler,epic,frontend" \
'Show upcoming Sundays, let the user manually assign people, then validate and surface warnings. Does not auto-fill.

### Sub-tasks
- [ ] Upcoming-Sundays view (driven by planner weeks, default 12) with a slot per role
- [ ] Manual assignment picker per slot (active + eligible), with suggestions
- [ ] Validation checks per Sunday:
  - [ ] >=1 female in kids room
  - [ ] Both Setup/Tear Down are male
  - [ ] Teacher eligible to teach
  - [ ] Assistants eligible to assist
  - [ ] Setup people eligible for setup
  - [ ] Coffee/Communion person eligible
  - [ ] No Couple Group conflict in kids
  - [ ] No assignee served the prior Sunday
- [ ] Overall lineup status indicator (OK / warnings / blocking)
- [ ] Recommendation / warning notes inline per slot and per Sunday
- [ ] Respect volunteer blackout dates from Epic 8 (warn if assigned while unavailable)

### Acceptance criteria
- Each check runs on assignment change with a clear pass/warn state.
- Warnings are non-blocking; user can save an imperfect lineup intentionally.
- Prior-Sunday and couple-conflict logic covered by unit tests.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 5 — Dashboard & suggestion/priority scoring" \
"scheduler,epic,frontend,backend" \
'Per-volunteer summary stats plus the fairness-based suggestion engine feeding the planner.

### Sub-tasks
- [ ] Per-volunteer metrics: total serves, serves this month, % of Sundays this month, last-served date, Sundays since last served, served-last-Sunday flag
- [ ] Role counts per person: teacher, assistant, setup, coffee
- [ ] Summary tiles: active volunteers, total serves, serves this month
- [ ] Overall priority score + role-specific priority scores
- [ ] Scoring favors: served less recently, less often overall, less this month, not yet this month; penalize served-last-Sunday
- [ ] Top-options lists per role: teacher, assistant, setup, coffee
- [ ] Expose scoring as a shared module the planner imports

### Acceptance criteria
- Metrics match the serve log for spot-checked volunteers.
- Someone who served last Sunday ranks below an equivalent who did not.
- Top-options lists exclude ineligible and inactive people.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 6 — Future Schedule" \
"scheduler,epic,frontend" \
'Paste/type planned future assignments that must NOT count as served, so planning never distorts past counts.

### Sub-tasks
- [ ] Future-schedule editor (paste/type by date and role)
- [ ] Store separately from serve log; exclude from all "served" counts and scores
- [ ] Show in planner as pencilled-in (visually distinct from committed)
- [ ] Promote a future entry into the serve log once the Sunday is confirmed

### Acceptance criteria
- Future entries never affect dashboard stats or priority scores.
- Promotion writes a proper serve-log row and clears the future entry.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 7 — Settings" \
"scheduler,epic,frontend" \
'Make role needs and date anchors configurable so the tool flexes beyond the default setup.

### Sub-tasks
- [ ] Editable roles list (add/rename/remove)
- [ ] Editable number of people needed per role
- [ ] Gender/eligibility constraints per role (>=1 female in kids, setup must be male) configurable
- [ ] Date settings: today/anchor, month start, month end, Sundays this month, next Sunday, most recent logged Sunday
- [ ] Planner weeks setting (default 12)
- [ ] Changing role config re-renders planner slots without breaking history

### Acceptance criteria
- Defaults load as the standard Sunday setup on first run.
- Changing role counts/constraints updates the planner and validation immediately.
- Date fields drive planner range and this-month calculations consistently.'

# ---------------------------------------------------------------------------
create_issue \
"[Scheduler] Epic 8 — Volunteer availability requests & SMS accept/reject" \
"scheduler,epic,sms,backend,frontend" \
'Let volunteers request dates off and respond to serving invites by text. Build on the existing Textbelt integration in functions/sms.js and its inbound webhook.

### Sub-tasks
- [ ] Volunteer-facing submission of unavailable/blackout dates (self-service or admin-entered)
- [ ] Store blackout dates on the volunteer; planner reads them
- [ ] Outbound SMS invite: "Can you serve as {role} on {date}? Reply YES or NO."
- [ ] Inbound webhook parsing of YES/NO replies mapped to the pending invite (reuse Textbelt webhook + replay protection)
- [ ] Invite state per assignment: pending / accepted / declined / no-response
- [ ] Reflect accept/decline into the planner slot (decline frees slot + warns)
- [ ] Opt-in / phone capture and consent handling
- [ ] Reminder/escalation for no-response after N days (optional follow-up)

### Acceptance criteria
- A volunteer can mark dates unavailable and the planner warns if assigned then.
- An outbound invite sends via Textbelt; a YES/NO reply updates the assignment state.
- Declines visibly free the slot and prompt for a replacement.'

echo "==> Done."
