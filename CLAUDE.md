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
are a promise the thinking is finished. `To Do` additionally promises the next step is
buildable without you; `On Deck` means the next step needs your judgment.

- New idea, however rough → file it in **To Plan**.
- Plan it → `/plan-ticket <KEY>`, or `/plan-ticket ALL` for the whole To Plan column.
- Build it → `/implement <KEY>`.
- Board looking wrong → `/jira-doctor`.
<!-- /jira-config -->
