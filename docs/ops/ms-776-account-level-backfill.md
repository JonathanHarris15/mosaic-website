# MS-776 — Additive account-level backfill

Helm approved this write. The cutover that stops reading `role`,
`permissionLevel`, and `pastoralAssistant` stays on hold.

`ms-776-backfill-account-levels.js` fills the canonical fields on accounts
that still have neither. It does not change who can open a door today,
because the live resolvers still read the ladder.

## Who it touches

A user is a write only when both are true:

- `accountLevelId` is missing or empty
- the `permissions` field is absent

Anyone with an `accountLevelId` or a `permissions` field is skipped. That
includes the two pastoral-assistant accounts (`hJMTobnK`, `JhiP8bSR`: member
string, `level_pastoral_assistant`, 52-key map) and the three saved editors
(`eHIGIuwi`, `STGsqGJW`, `tLzstpho`). A map that is empty, or a value that is
not a map, still counts as the field being present.

## What it writes

Two fields, and nothing else:

- `accountLevelId` — the builtin id for the rung (`level_kiosk` for kiosk)
- `permissions` — that preset's map, from `buildPresetPermissions`

The rung is `permissionLevel` when that field is present, otherwise `role`.
An empty `permissionLevel` does not fall through to `role`. An unknown rung
is skipped, not written as viewer. The `pastoralAssistant` flag does not
choose the preset.

`role`, `permissionLevel`, and `pastoralAssistant` are not in the write.
A second run finds the new fields and writes nothing.

## Dry run

Read-only against `mosaic-hymn-database` on 2026-10-21. Thirteen writes, five
skips. No `--commit`. Confirm again from `main` before `commit=true`, in case
an account changed after this log.

| uid prefix | from | accountLevelId |
| --- | --- | --- |
| `2870mtfu` | `role` super_admin | `level_super_admin` |
| `5WtIgv8u` | `role` super_admin | `level_super_admin` |
| `WVC9UWb5` | `permissionLevel` super_admin | `level_super_admin` |
| `etGV8prm` | `role` elder | `level_elder` |
| `MFjOICas` | `role` elder | `level_elder` |
| `36eCd1ZG` | `permissionLevel` editor | `level_editor` |
| `c86F1Bcs` | `permissionLevel` editor | `level_editor` |
| `5CAtixLr` | `role` editor | `level_editor` |
| `5cYwmpOs` | `role` editor | `level_editor` |
| `jypMquMX` | `role` editor | `level_editor` |
| `L4GPAP4Y` | `permissionLevel` member | `level_member` |
| `lDq2JbCW` | `role` member | `level_member` |
| `D36i0WVh` | `permissionLevel` kiosk | `level_kiosk` |

Skipped: `hJMTobnK`, `JhiP8bSR`, `eHIGIuwi`, `STGsqGJW`, `tLzstpho`.

```text
MS-776 account-level backfill
mode=dry-run
writes=13
skips=5

uid:2870mtfu  from=role:super_admin  accountLevelId=level_super_admin  permissions=super_admin preset (64 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:36eCd1ZG  from=permissionLevel:editor  accountLevelId=level_editor  permissions=editor preset (24 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:5CAtixLr  from=role:editor  accountLevelId=level_editor  permissions=editor preset (24 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:5WtIgv8u  from=role:super_admin  accountLevelId=level_super_admin  permissions=super_admin preset (64 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:5cYwmpOs  from=role:editor  accountLevelId=level_editor  permissions=editor preset (24 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:D36i0WVh  from=permissionLevel:kiosk  accountLevelId=level_kiosk  permissions=kiosk preset (3 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:JhiP8bSR  skip  has accountLevelId and permissions
uid:L4GPAP4Y  from=permissionLevel:member  accountLevelId=level_member  permissions=member preset (4 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:MFjOICas  from=role:elder  accountLevelId=level_elder  permissions=elder preset (54 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:STGsqGJW  skip  has accountLevelId and permissions
uid:WVC9UWb5  from=permissionLevel:super_admin  accountLevelId=level_super_admin  permissions=super_admin preset (64 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:c86F1Bcs  from=permissionLevel:editor  accountLevelId=level_editor  permissions=editor preset (24 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:eHIGIuwi  skip  has accountLevelId and permissions
uid:etGV8prm  from=role:elder  accountLevelId=level_elder  permissions=elder preset (54 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:hJMTobnK  skip  has accountLevelId and permissions
uid:jypMquMX  from=role:editor  accountLevelId=level_editor  permissions=editor preset (24 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:lDq2JbCW  from=role:member  accountLevelId=level_member  permissions=member preset (4 true keys)  untouched=role,permissionLevel,pastoralAssistant
uid:tLzstpho  skip  has accountLevelId and permissions
No writes. Re-run with --i-mean-prod --commit to apply.
```

## How to run

The workflow runs only from `main`. Do not dispatch it from a pull-request
branch. Dry-run first. Read the log. Dispatch `commit=true` only when the
thirteen lines match this table and the five assigned accounts are skips.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=ms-776-backfill-account-levels.js \
  -f commit=false
```

Then, after that log matches:

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=ms-776-backfill-account-levels.js \
  -f commit=true
```

Empty `args`. After the write, re-run `access-diff.js` (`commit=false`).
The cutover is still a separate change. It waits until that diff reports
blocking users is 0. These two pastoral-assistant accounts can still gain
`isEditor()` and editor/elder visibility under that cutover, because their
saved map is already the pastoral-assistant preset and their stored string
is member.

This script does not delete the fields it adds. The ladder fields are still
on the document, so a bad write does not by itself remove today's access.
