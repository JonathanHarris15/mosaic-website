<!-- jira-config -->
## Jira

This project's work is tracked in Jira, and the board is the spine of it. Read this
before any planning or ticket work.

- **Site:** `methodllc.atlassian.net`
- **Cloud ID:** `68876fc2-c674-4750-9610-e4c9bb834d8d`
- **Project:** `MS` — Mosaic Services
- **Epic type:** `Epic` · **Ticket types:** `Feature`, `Task`, `Bug` · **Sub-task type:** `Subtask`
- **Board:** To Plan → To Do → On Deck → In Progress → In Review → Done

**The board carries level-0 tickets only.** Epics group them (never on the board);
sub-tasks live inside a card (never their own card).

**A ticket may not sit right of `To Plan` without a PRD on it.** `To Do` and `On Deck`
are a promise the thinking is finished.

**`On Deck` is the front of the queue, not a parking space.** It holds the one or two
tickets coming off `To Do` next — what gets built after the thing in `In Progress`. It
is further along than `To Do`, not to one side of it. So the columns read straight
through: everything specced waits in `To Do`, the next one or two move to `On Deck`, and
one at a time they go `In Progress`.

⚠ The shared `BOARD.md` in the skills config defines `On Deck` the other way — "ready,
but the next step needs your judgment." **This project does not use it that way**, and
where the two disagree, this file wins. A ticket here is never parked in `On Deck`
because it needs a decision; a ticket needing a decision stays in `To Do` with the
decision named in the sub-task that carries it.

- New idea, however rough → file it in **To Plan**.
- Plan it → `/plan-ticket <KEY>`, or `/plan-ticket ALL` for the whole To Plan column.
- Build it → `/implement <KEY>`.
- Board looking wrong → `/jira-doctor`.
<!-- /jira-config -->
