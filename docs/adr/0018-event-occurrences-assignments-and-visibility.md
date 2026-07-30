# ADR 0018: Event Occurrences Are Sparse, an Assignment Is Not an Involvement, and Visibility Is a Five-Rung Ladder

## Status
Accepted. Successor to ADR-0016, which framed the Calendar as downstream of the Scheduler epic and left occurrences undefined.

## Context

ADR-0016 built serving as **Roles on Events** and MS-13 built the **series** layer — "the Sunday Service" as a recurring thing that owns Roles. It deliberately stopped short of occurrences: `EventsCore.occurrenceRef` resolves a Sunday to the date-keyed `services/{date}` document that already exists and returns `null` for anything else.

So the only dated thing in the system is a Sunday. Nothing else can be scheduled or assigned, because there is nothing to hang it on. Every remaining Feature in MS-22 — fairness over a date range, auto-assign, member self-service — needs occurrences that do not exist. MS-99 builds them, and in doing so has to answer three questions ADR-0016 left open.

## Decision

### 1. An Assignment is the plan; an Involvement is the fact

Today, putting someone in a role writes an **Involvement** record immediately — including for a Sunday six weeks away — and nothing distinguishes future from past. The serve log therefore already counts serving that has not happened. ADR-0016 §6 committed to the opposite ("drafted picks do not count as served until accepted"), and MS-99 adds a **Declined** state, which under the old shape would mean an Involvement record meaning *they did not serve*.

So the two are separated:

- An **Assignment** lives on an Event occurrence: this Person, this Role, this slot, in one of three states, with who set it and when. It is the plan and it is mutable.
- An **Involvement** record is the fact that someone served. It is written only once the date has passed.

**Only a Confirmed assignment converts automatically.** A **Declined** one never converts. A **Pending** one — nobody heard either way — does not convert either, but is not discarded: it surfaces on the past Event as an open question ("4 people were never confirmed — did they serve?") which an editor resolves, writing the Involvement then. An unresolved question stays unresolved forever and never counts as serving.

Silence is never counted as a yes, and never silently lost. The distinction matters because a fairness engine reading a serve log with gaps *looks like it is working* — everybody reads as equally fresh, and auto-assign hands the most overworked people another round.

Conversion runs in a scheduled Cloud Function, and mistakes are corrected on the Person's record using the manual Involvement add/delete that the People's Directory already has.

### 2. Liturgical Roles keep their existing plumbing; only Servant and one-off Roles get Assignments

A Sunday occurrence *is* `services/{date}`, whose liturgical roles are denormalised fields (`preacherId`, `preacher`) that the printed Service Guide reads. Giving those roles Assignments too would put two sources of truth for who is preaching on one document, and the loser is the booklet on a Sunday morning.

Assignments are therefore added *alongside* the liturgical fields, never over them. On a midweek Event there are no liturgical Roles, so every Role there is an Assignment and the model looks uniform. Reconciling the two into one "who is serving on Sunday" surface is **MS-16**, which already exists for exactly that purpose.

This extends ADR-0016 §1 (Option A) rather than revisiting it: the same trade, two code paths for Sunday roles, for the same reason.

### 3. Occurrences are sparse

A recurring series carries a **recurrence rule**. The Calendar computes the dates from the rule and merges in whatever occurrence documents exist; a document is written the first time something lands on it — an assignment, a cancellation, a changed time. A one-off Event is not a series and is always a real document.

This is what the Service Calendar already does: it generates every Sunday from July 2023 to two years out in the browser, and a `services/{date}` document exists only for Sundays somebody has touched.

Materialising up front would mean choosing a horizon, writing hundreds of empty documents, and owning a background job to extend it — machinery this app does not otherwise need.

Occurrence ids are deterministic (`{seriesId}_{date}`) so two editors cannot create the same occurrence twice.

**Changing a recurrence rule does not silently migrate data.** Occurrences that already carry assignments and no longer match the rule are shown to the editor, who chooses to move or delete them. Rare enough to deserve the friction, and the alternative is guessing about real rosters.

### 4. A one-off Role counts as serving, but is never a Role to balance

A one-off Role is a label and some people, created for a single Event: no definition, no reuse, no slots, no restrictions, no eligibility checking. Forcing every ad-hoc job through the Roles Manager would make the Roles Manager a junk drawer.

Its Involvement is written under **one reserved slug**, `one_off`, with the label in `metadata`. Not an invented slug per job: `RolesCore.roleBySlug` is the only way to turn a slug into a human name, and it only knows liturgical Roles and stored Role Definitions, so an invented slug would resolve to `null` on every surface showing serve history.

The person who quietly unlocks the hall every week therefore reads as someone who serves — which matters for a tool whose purpose is not overworking the same few people — while fairness skips the `one_off` bucket entirely rather than trying to rotate a job that happens once.

### 5. Visibility is a five-rung ladder, stamped on every occurrence

`public` → `member` → `participant` → `editor` → `elder`.

**`participant`** means members who hold a Role on that Event, plus everyone above. It cannot be checked by rank alone, so each occurrence carries a denormalised `participantIds` list and the Calendar runs two queries merged client-side — one by rank, one `array-contains` me — because Firestore cannot express that as a single filter.

Visibility is **copied down onto every occurrence** rather than read from the series. This follows MS-130: a security rule cannot afford a `get()` per document without hitting the rules engine's lookup limits on any real list query. Changing a series' visibility restamps all of its occurrences, **including past ones**.

Two rules about people:

- **Removed by an editor → visibility is lost instantly.**
- **Declined by the person → visibility is kept until someone else takes the slot.** They can see the thing they turned down and change their mind. A slot holds one current assignment, so assigning a replacement overwrites it: the flag clears and the decliner leaves `participantIds` in the same write, with no bookkeeping.

A consequence worth naming: **there is no record of who declined** once a slot is refilled. A decline never becomes Involvement, so fairness is unaffected, but "who keeps saying no" is not answerable.

**The Sunday Service is permanently `public`** and not editable in the UI — its occurrences are `services/{date}`, which the congregant-facing guide reads.

Whether a participant sees the Event's full roster is **an editor's choice per Event**. Firestore cannot hide a field from a reader, so the roster lives in a subcollection under the occurrence with its own rule; your own assignment is always readable, everyone else's is gated.

## Consequences

- **`participantIds` leaks the roster as ids.** The rule needs the list on the document the participant is allowed to read, so an editor who hides the roster hides it in the interface, not in the data — anyone opening devtools can resolve the ids against `people`, which is world-readable. Accepted **for this ticket only**, on the grounds that the entire directory (names, emails, phone numbers, addresses) is already world-readable, so this discloses very little that is not already out. That is an argument that the app's read posture is loose, not that this feature should be — the directory question is filed separately and is much larger than this one.
- The `events` series collection stops being world-readable. Today every series is the Sunday Service so it is harmless; the moment "Elders' Meeting" can be a series, its name is public.
- **`injectServiceAtDate`** — the "shift everything forward a week" tool — currently moves `services`, `involvement`, and `pastoral_prayer_history`. It must move occurrences and assignments too, or a shifted week silently loses its roster.
- The Calendar must constrain its own queries by visibility. An unconstrained query does not return fewer rows — it errors outright, and the error looks exactly like "this church has no events." The same trap is already documented in `firestore.rules` for the relationship collections.
- The existing **Service Calendar** is renamed **Services**; **Calendar** is the new view. Function unchanged.
- Two-way calendar sync and calendar subscription (publishing a feed a phone can subscribe to) are **not** being built. Considered and dropped from MS-99 outright — not deferred.
