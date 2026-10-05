# Domain docs (Mosaic)

How engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the ubiquitous language (this repo's glossary). There is no root `GLOSSARY.md`.
- **`docs/adr/`** — architecture decisions; read ADRs that touch the area you are changing.
- **`docs/design/design-language.md`** — UI conventions and `m-*` components when work touches `public/`.

If a file is missing, proceed silently unless the skill requires it.

## File structure (single-context)

```
/
├── CONTEXT.md
├── docs/adr/
├── docs/design/design-language.md
└── public/          # hosted UI
```

## Vocabulary

When naming domain concepts in issues, specs, tests, or PRs, use terms from **`CONTEXT.md`**. Avoid synonyms the glossary marks as _Avoid_.

Gaps discovered during grilling → note for `/domain-modeling` (via `/grill-with-docs`) and update `CONTEXT.md` when the decision lands.

## ADR conflicts

If work contradicts an ADR, surface it explicitly:

> _Contradicts ADR-00NN (…), but worth reopening because…_

Do not silently override.

## Lazy creation

`/domain-modeling` creates glossary entries and ADRs when decisions are made — not upfront. See [domain-modeling/SKILL.md](../../.cursor/skills/domain-modeling/SKILL.md); formats in `GLOSSARY-FORMAT.md` / `ADR-FORMAT.md` apply to **`CONTEXT.md`** sections and `docs/adr/`.
