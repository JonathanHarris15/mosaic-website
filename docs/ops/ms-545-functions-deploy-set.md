# MS-545 — Standing Firebase deploy set

Locked **option B** (Jonathan via Helm): widen the standing Actions
target first, then ship through that path. No one-off
`firebase deploy --only functions:…` that leaves
`.github/workflows/firebase-deploy.yml` behind.

## Standing `--only` targets

```
hosting,functions:publicForm,functions:onAttendanceCreated
```

| Target | Why it is in the set |
| --- | --- |
| `hosting` | Church site (`mosaic-hymn-database`). App Check collection lives here. |
| `functions:publicForm` | Public form door (ADR-0051). |
| `functions:onAttendanceCreated` | Attendance rule (MS-425 / ADR-0066). Export name in `functions/index.js`. Create on `event_occurrences/{occurrenceId}/attendance/{personId}`. Without this target the Visitor → Regular Attender promotion never installs. |

The CLI filter uses the **export name** (`onAttendanceCreated`), not a
renamed Cloud Console label. The functions codebase is `default`;
`functions:<export>` is enough.

## App Check stays monitor

This workflow writes `PUBLIC_FORM_APP_CHECK_MODE=monitor` on every run
and never writes `enforce`. Enforce is an Atlas-escalated param flip:
`docs/ops/ms-508-app-check-break-glass.md`.

## Do not one-off around this list

Agents must not `firebase deploy` from a cloud box (AGENTS.md). Adding
another function to prod means adding it here (and to the agreement
test), not a laptop CLI that skips the workflow.
