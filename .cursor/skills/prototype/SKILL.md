---
name: prototype
description: Build a light HTML specimen for a Mosaic ticket so a PRD can point at it. Use when a ticket or plan asks for a throwaway prototype or light HTML.
---

# Prototype

A prototype is a **specimen**, not the product. It does not ship, does not use production Firebase, and does not change secrets or rules.

## Do

1. Read the ticket and `CONTEXT.md`. Use the product’s words on the specimen.
2. Prefer the design-system classes in `build/design-system/` when the specimen is a UI. Do not invent a second visual language.
3. Write static HTML under a ticket-local folder (e.g. `ms-123-prototype/` in the workspace). Do not commit secrets. Commit the specimen only when the PRD or ticket says the repo should keep it.
4. Put the path on the ticket under **Prototype**.

## Do not

- Wire the specimen to the church database.
- Treat the prototype as acceptance — AC is still the product, tested with `npm test` / lint / a real page.
