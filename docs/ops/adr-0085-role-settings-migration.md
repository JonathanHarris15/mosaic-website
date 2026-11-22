# ADR 0085 — moving Role settings onto events

Who a Role needs, its rules, its rest and "another role that day" belong to
each Event that runs it ([ADR 0085](../adr/0085-a-roles-needs-and-rules-belong-to-the-event.md)).
This note records how what was stored got moved.

**Done, 2026-11-21.** Every step below ran on production. The script
(`scripts/migrate-role-settings-to-events.js`, with its plan
`scripts/role-settings-migration-core.js` and test) was then deleted and taken
off the Prod ops allowlist; git history has it if it is ever needed again.

## What ran, in order

| Step | What | Result |
| --- | --- | --- |
| 1 | Deployed #365: pages read each event's settings, falling back to the Role's old values. | — |
| 2–3 | Copy onto every series, dry run then for real. | 2 series written: Sunday Service (coffee, sound, kids_ministry_teach, kids_ministry_helper, melon, and its one rule across Roles) and Members Meeting (sermonette). A second dry run found nothing left. |
| 4 | Look at a Sunday's Roles & rules tab. | Left to an editor's eye; not recorded here. |
| 5 | Deployed #366: the fallback, every reader of the old rule shapes and the per-seat "a man / a woman" removed; the copy phase retired. | — |
| 6–7 | Strip the old fields off every Role, dry run then for real. | `slots`, `nextSlotSeq`, `restrictions`, `intensity`, `allowsAnotherRole` removed from all 6 Roles. A second dry run found nothing left. |

## What the copy changed in shape

- Per-seat "a man / a woman" became one **line-up** rule (unordered). Slot ids were kept, so every Assignment kept its seat.
- Person rules (tags, named people) became one **who can do it** OR rule; team rules (same/not-same group, cannot serve together) became a team rule each, all **Must**.
- Old pair rules across Roles became OR rules with one option.

The plan was tested to judge people exactly as the old Role did before it ran.
