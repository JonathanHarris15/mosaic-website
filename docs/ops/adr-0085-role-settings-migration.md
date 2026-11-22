# ADR 0085 — moving Role settings onto events

Who a Role needs, its rules, its rest and "another role that day" now belong to
each Event that runs it ([ADR 0085](../adr/0085-a-roles-needs-and-rules-belong-to-the-event.md)).
`scripts/migrate-role-settings-to-events.js` moves what is stored. It runs
through the **Prod ops script** workflow ([how](./prod-ops-script.md)).

**Where it stands:** steps 1–3 done on 2026-11-21 (copy wrote 2 series; a
second dry run found nothing left). Step 5 retired the copy phase from the
script, so it now runs only with `--strip`.

## Order — do not reorder

| Step | What | How |
| --- | --- | --- |
| 1 | Deploy the branch: hosting, functions, **and firestore rules** (the new `serving_settings` rule). | Usual deploy. Every page still reads each Role's old values through the fallback, so nothing changes for anyone yet. |
| 2 | Copy — dry run. Read the rows: `seeded` per series, `missing` (a Role the series names but nobody defines). | `script=migrate-role-settings-to-events.js`, `args` empty, `commit=false` |
| 3 | Copy — for real. Safe to run again; a second run writes nothing. | same, `commit=true` |
| 4 | Look at a Sunday's Roles & rules tab and Auto-assign one date. The line-ups and rules should read as before. | by hand |
| 5 | Deploy the follow-up change that takes out the fallback (`EventsCore.effectiveRole` reading the Role's old values) and the readers of the old rule shapes. Safe only now: every series has its own settings in the new shape. | Usual deploy |
| 6 | Strip — dry run. Refused, by name, if any series still runs a Role it has no settings for. | `args=--strip`, `commit=false` |
| 7 | Strip — for real. Removes `slots`, `nextSlotSeq`, `restrictions`, `intensity`, `allowsAnotherRole` from every Role. | `args=--strip`, `commit=true` |

Until step 7 the old fields are harmless: the security rules let no write add
or change them, and every page reads the event's own settings first.

## What the copy changes in shape

- Per-seat "a man / a woman" becomes one **line-up** rule (unordered). Slot ids are kept, so every Assignment keeps its seat.
- Person rules (tags, named people) become one **who can do it** OR rule; team rules (same/not-same group, cannot serve together) become a team rule each, all **Must**.
- Old pair rules across Roles become OR rules with one option.

The plan is tested to judge people exactly as the old Role did (`test/role-settings-migration-core.test.js`).
