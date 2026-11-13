# MS-808 — empty prayer-leader slots

The Order of Service used to write `carriedBy.<elementId> = { name: '', id: null }` whenever a prayer allowed someone other than the service leader to pray it, so the picker had an object. A prayer leader is that entry's presence. An empty one is not a leader.

`scripts/strip-empty-prayer-leaders.js` deletes `carriedBy` entries that name nobody. A named person stays `{ id, name }`. An empty box stored for an element the order says somebody carries is removed too. Opening that Sunday gives the picker an object again, and it is not written back until somebody is named.

## Dispatch

From `main`, as soon as this change has merged. Hosting deploys on that push. Until this script commits, a stored empty `carriedBy` entry still counts as an unset prayer leader, so a Sunday the service leader prays can look short again. Run the dry-run, read the log, then commit. An empty leader somebody adds in that window is removed with the old scaffolds; they add it again.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=strip-empty-prayer-leaders.js \
  -f commit=false
```

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=strip-empty-prayer-leaders.js \
  -f commit=true
```

Empty `args`. Agents do not run this from a pull request branch and do not write prod from the VM.
