# MS-775 — Phantom person-picker fields

Form person pickers used to read `people.isMember`, `people.membershipStage`, and `people.tagIds`. A Person stores `membership.stage`, `membership.inactive`, and `tags`. The readers are gone. This script deletes the three phantom fields when they are still on a Person document.

It does not copy a phantom value onto the stored shape. A `membershipStage` that is not already `membership.stage`, or a `tagIds` entry that is not already in `tags`, blocks the run and nothing is written. `isMember` is always safe to delete: membership is asked of `membership`, not of that boolean.

## Dispatch

From `main`, after this change has merged. Hosting and Functions deploy on that push. The data move is a separate dispatch, so there is a window where the new code is live and any leftover phantom fields are still stored. The new code does not read them.

Dry-run first (empty `args`, `commit=false`). Read the log. If `blockedPeople` is not 0, do not commit — the log names each person id and why. If it is 0, dispatch again with `commit=true`.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=delete-legacy-person-picker-fields.js \
  -f commit=false
```

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=delete-legacy-person-picker-fields.js \
  -f commit=true
```

Agents do not run this from a pull request branch and do not write prod from the VM.
