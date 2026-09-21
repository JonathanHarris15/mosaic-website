---
name: grill-with-docs
description: Grill an unset Mosaic product decision against CONTEXT.md, ADRs, and the code before writing a PRD. Use when a ticket needs design decisions, a grill-with-docs session, or when plan-ticket finds an open lock.
---

# Grill with docs

Use this **before** `/plan-ticket` lands a PRD, or when Plan finds a hole.

## Read, do not invent

1. The ticket (Atlassian `getJiraIssue`, markdown).
2. `CONTEXT.md` — the words the product already uses.
3. `docs/adr/` for any decision the idea touches. **Do not re-litigate an ADR in a feature PR.**
4. The code paths the ticket names. Where a design note and the code disagree, the code wins — and say so, because that disagreement is a bug in one of them.

## Output

A short list of **settled** vs **open** decisions. Each settled line cites the doc or code path. Each open line is a question Grok Bot can answer routinely, or a **crucial** question to escalate to Jonathan.

Do not write new product behavior into the ticket. Carry settled lines into the PRD’s **Locked decisions** when `/plan-ticket` runs. Optional: a new ADR only when the decision is hard to reverse — that is a subtask, not a side effect of grilling.
