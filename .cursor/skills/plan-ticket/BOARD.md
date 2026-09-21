# Shared board language

This is the **shared** skills-config board (`plan-ticket/BOARD.md`). Mosaic’s `CLAUDE.md` overrides it. **If the two disagree, `CLAUDE.md` wins.**

## Columns (shared)

The board carries **level-0 tickets only**. Epics group them (never a board card). Subtasks live inside a card (never their own card).

Typical shared reading of the columns:

| Column | Shared meaning |
| --- | --- |
| To Plan | Idea is filed; thinking is not finished; no PRD yet |
| To Do | Specced; waiting |
| On Deck | Shared meaning: ready, but the next step in it needs you (a decision, a review, a human) |
| In Progress | One ticket is being built |
| In Review | Built; waiting Maintain / human |
| Done | Done |

**Mosaic override (`CLAUDE.md`):** `On Deck` is **not** a parking space for a decision. It is the front of the queue — the one or two tickets coming off `To Do` next. A ticket that needs a decision stays in `To Do` with the decision named on a subtask.

Mosaic’s Jira workflow today has statuses `To Plan` → `To Do` → `In Progress` → `In Review` → `Done` only. Keep `On Deck` and `Night Work` as **queue language** (comments, Phase 6 notes). Do not invent a Jira status.

## Integrity

- A ticket may not sit right of `To Plan` without a PRD.
- `/plan-ticket` will not land a ticket right of `To Plan` without a PRD.
- `/implement` will not build a ticket that has no PRD.
- Nothing sweeps the board. Fix a wrong column by hand.

## Night Work (queue language)

Night Work means the next step can run unattended on a Cursor Cloud Agent (PRD done, no crucial product decision open). It is not a Jira status. Comment it; leave the ticket in `To Do` until Build starts, then `In Progress`.
