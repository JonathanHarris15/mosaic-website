---
name: review
description: "Alias for code-review. Standards, Spec, and the pre-merge adversarial review (PASS/FAIL comment)."
---

This skill is an **alias** for [`code-review`](../code-review/SKILL.md). Use `/code-review` (or this alias) after implementation.

Mosaic: `implement` calls this at Phase 5. The adversarial review is a new subagent and posts `Adversarial review: PASS` or `Adversarial review: FAIL` ([code-review](../code-review/SKILL.md)). Domain language lives in `CONTEXT.md` (not `GLOSSARY.md`). See [MOSAIC-CONVENTIONS.md](../MOSAIC-CONVENTIONS.md).
