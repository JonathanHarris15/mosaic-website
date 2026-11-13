# Roles stress scripts (Nov 2026)

Throwaway harnesses from the Roles stress round. Not part of `npm test`.

- `gen.js` builds a synthetic church (people, Roles with every restriction kind, marriages, house groups, 12 weeks of history, Away).
- `bench-lite.js`: `candidatesFor` and one-date solve timings at several sizes.
- `repro-partial-infeasible.js`: an allowlist of 5 on a 6-slot Role. Solve time grows past 20 s by 800 people.
- `probedraft.js`: a draft with a Role nobody can fill (`unfillable`).
- `sim-picker.js`: what one keystroke in the Roles tab picker costs.
- `adversarial.js`: odd inputs (duplicate ids, removed slots, cross-role rules) and what they do.
- `fuzz-callables.js`, `burst.js`: concurrent answer/take against the Firestore emulator.
  Start it first: `npx firebase emulators:start --only firestore --project demo-mosaic-ms20`,
  then `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/stress-roles/burst.js 20`.
