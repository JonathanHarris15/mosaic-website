# MS-776 — Account access diff (cutover not shipped)

Read-only audit of `mosaic-hymn-database` on 2026-10-21. Eighteen `users`
documents. The script compares what each live resolver opens today with the
single resolver that reads only `accountLevelId` and `permissions`.

**Ship the cutover: no.** Thirteen accounts would lose a door a resolver
opens today. This change adds the audit and stops. Firestore rules, Storage
rules, the client, and `rankOf` are unchanged.

## Canonical resolver (measured, not shipped)

A saved `permissions` object is the whole answer. `system.super_admin: true`
means every catalog key. Otherwise a builtin `accountLevelId` contributes
that preset. Otherwise no doors (a viewer). `role`, `permissionLevel`, and
`pastoralAssistant` grant nothing. A super admin is checked before kiosk,
because the full map also sets `system.kiosk`.

Current resolvers still read the ladder string (`permissionLevel`, else
`role`) and, in rules and `publicForm`, the `pastoralAssistant` flag. The
diff treats a loss on Firestore, Storage, `rankOf`, or `publicForm` as
blocking. A client key loss is blocking only when the paired Firestore door
is open today. `core.sign_in`, `visibility.rung.public`, and `hymns.view`
are never blocking: the rules already refuse them as account doors.

## Result

| | |
| --- | --- |
| users | 18 |
| unchanged | 3 |
| blocking users | 13 |
| blocking losses | 1007 |
| noted client losses (rules already refuse) | 44 |
| gains | 22 |
| `pastoralAssistant: true` | 0 |

Uid prefixes only. No emails, full uids, or names.

| uid prefix | today → canonical | shape |
| --- | --- | --- |
| `2870mtfu` | loses super_admin → viewer | `role` only |
| `5WtIgv8u` | loses super_admin → viewer | `role` only |
| `WVC9UWb5` | loses super_admin → viewer | `permissionLevel` and `role` |
| `etGV8prm` | loses elder → viewer | `role` only |
| `MFjOICas` | loses elder → viewer | `role` only |
| `36eCd1ZG` | loses editor → viewer | `permissionLevel` and `role` |
| `c86F1Bcs` | loses editor → viewer | `permissionLevel` and `role` |
| `5CAtixLr` | loses editor → viewer | `role` only |
| `5cYwmpOs` | loses editor → viewer | `role` only |
| `jypMquMX` | loses editor → viewer | `role` only |
| `L4GPAP4Y` | loses member → viewer | `permissionLevel` and `role` |
| `lDq2JbCW` | loses member → viewer | `role` only |
| `D36i0WVh` | loses kiosk → viewer | `permissionLevel` and `role` |
| `hJMTobnK` | gains only (member → pastoral_assistant) | member string, `level_pastoral_assistant`, 52-key map |
| `JhiP8bSR` | gains only (member → pastoral_assistant) | member string, `level_pastoral_assistant`, 52-key map |
| `eHIGIuwi` | unchanged | `level_editor`, 24-key map |
| `STGsqGJW` | unchanged | `level_editor`, 24-key map |
| `tLzstpho` | unchanged | `level_editor`, 24-key map |

The three unchanged accounts are the MS-725 saved editors
(`docs/ops/ms-725-editor-calendar-key-backfill.md`).

### What the thirteen lose

None of them have `accountLevelId` or a permissions map, so the canonical
resolver is a viewer. They lose every door the live rung still opens:

- **Super admin** (`2870mtfu`, `5WtIgv8u`, `WVC9UWb5`): admin, elder, editor,
  member, and kiosk-adjacent client keys, including `system.super_admin`,
  every write door, and elder/editor/member/participant visibility.
- **Elder** (`etGV8prm`, `MFjOICas`): elder and editor doors, including
  `writesTheRecord`, `canDecide`, and `countsAsElder`. `isAdmin` stays closed
  (it already requires `admin` or `super_admin`).
- **Editor** (`36eCd1ZG`, `c86F1Bcs`, `5CAtixLr`, `5cYwmpOs`, `jypMquMX`):
  `isEditor`, the editor write keys, and editor/member/participant visibility.
- **Member** (`L4GPAP4Y`, `lDq2JbCW`): `isMember`, `see.member`,
  `directory.view`, `visibility.rung.member`.
- **Kiosk** (`D36i0WVh`): Firestore `isKiosk`, client `isKiosk`,
  `system.kiosk`.

### What the two pastoral-assistant accounts gain

`hJMTobnK` and `JhiP8bSR` are identical. The stored string is `member`. The
saved map is the pastoral-assistant preset (52 keys), so write keys already
follow the map. Visibility and `isEditor()` still follow the member string.
The canonical resolver would open these eleven doors and close none:

`firestore isEditor`, `firestore isPastoralAssistant`, `storage see.editor`,
`storage see.elder`, `storage see.participant`, and the same three visibility
doors on `rankOf` and on `publicForm` (`formRank`).

That widening is a product choice (ADR 0082: a saved map is the whole
answer) against the stored member string. It is not a reason this audit
stopped. The losses are.

## Open decision

Do not guess a backfill in this change, and do not write one here.

A later prod-ops backfill would copy the live ladder (`permissionLevel` when
present, otherwise `role`) onto a builtin `accountLevelId` plus that preset's
permissions map for the thirteen ladder-only accounts. It must not overwrite
the two pastoral-assistant maps with the member preset. Re-run this diff
after that write. The cutover is safe only when blocking users is 0.

Shipping the resolver change before that backfill would lock those thirteen
people out. Hosting and Functions deploy on push to `main`. The data move is
a separate workflow dispatch. The window between them is the outage.

## How to re-run

`access-diff.js` never writes. `--commit` is ignored. The workflow runs only
from `main`. Do not dispatch it from a pull-request branch. Do not pass
`commit=true`.

After this audit is on `main`:

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=access-diff.js \
  -f commit=false
```

Empty `args`. The job log is the public record: uid prefixes only.

Local equivalent, with `GOOGLE_APPLICATION_CREDENTIALS` (or the service
account file the script already resolves) pointing at the church project
`mosaic-hymn-database`, never the ghost project:

```bash
node scripts/access-diff.js --project mosaic-hymn-database --i-mean-prod
```

Exit 0 means the audit ran. The line `ship the cutover: NO` is the stop.
`YES` means blocking users is 0.

## Full dry-run log

```text
MS-776 access diff (read-only)
canonical resolver: accountLevelId + permissions; role, permissionLevel, and pastoralAssistant grant nothing
users: 18
unchanged: 3
blocking users: 13
blocking losses: 1007
noted client losses (rules already refuse): 44
gains: 22
ship the cutover: NO — at least one account would lose a door a resolver opens today

Roster
uid:2870mtfu  LOSES super_admin → viewer  permissionLevel=(absent) role=super_admin accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:36eCd1ZG  LOSES editor → viewer  permissionLevel=editor role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:5CAtixLr  LOSES editor → viewer  permissionLevel=(absent) role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:5cYwmpOs  LOSES editor → viewer  permissionLevel=(absent) role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:5WtIgv8u  LOSES super_admin → viewer  permissionLevel=(absent) role=super_admin accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:c86F1Bcs  LOSES editor → viewer  permissionLevel=editor role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:D36i0WVh  LOSES kiosk → viewer  permissionLevel=kiosk role=kiosk accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:eHIGIuwi  unchanged  permissionLevel=editor role=editor accountLevelId=level_editor pastoralAssistant=false map=true trueKeys=24
uid:etGV8prm  LOSES elder → viewer  permissionLevel=(absent) role=elder accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:hJMTobnK  GAINS only (member → pastoral_assistant)  permissionLevel=member role=member accountLevelId=level_pastoral_assistant pastoralAssistant=false map=true trueKeys=52
uid:JhiP8bSR  GAINS only (member → pastoral_assistant)  permissionLevel=member role=member accountLevelId=level_pastoral_assistant pastoralAssistant=false map=true trueKeys=52
uid:jypMquMX  LOSES editor → viewer  permissionLevel=(absent) role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:L4GPAP4Y  LOSES member → viewer  permissionLevel=member role=member accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:lDq2JbCW  LOSES member → viewer  permissionLevel=(absent) role=member accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:MFjOICas  LOSES elder → viewer  permissionLevel=(absent) role=elder accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
uid:STGsqGJW  unchanged  permissionLevel=editor role=editor accountLevelId=level_editor pastoralAssistant=false map=true trueKeys=24
uid:tLzstpho  unchanged  permissionLevel=editor role=editor accountLevelId=level_editor pastoralAssistant=false map=true trueKeys=24
uid:WVC9UWb5  LOSES super_admin → viewer  permissionLevel=super_admin role=super_admin accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0

--- uid:2870mtfu BLOCKING ---
permissionLevel=(absent) role=super_admin accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=super_admin storage=super_admin client=super_admin rankOf=super_admin formRank=super_admin canonical=viewer
loses: firestore admin.dashboard.access, firestore canDecide, firestore countsAsElder, firestore isAdmin, firestore isEditor, firestore isElder, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore readsAsElder, firestore see.editor, firestore see.elder, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, firestore writesTheRecord, storage canDecide, storage isEditor, storage isElder, storage isMember, storage readsAsEditor, storage readsAsElder, storage see.editor, storage see.elder, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.elder, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.member, formRank see.participant, client admin.dashboard.access, client canDecide, client countsAsElder, client isAdmin, client isEditor, client isElder, client isMember, client key.admin.accounts.assign_level, client key.admin.accounts.provision, client key.admin.accounts.view, client key.admin.dashboard.access, client key.admin.levels.manage, client key.admin.mcp.view, client key.admin.push.manage, client key.admin.sms.manage, client key.analytics.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.edit_identity.assistant, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.services.week_shift, client key.shep.care_lists.view, client key.shep.care_lists.write, client key.shep.count_as_elder, client key.shep.dashboard.view, client key.shep.documents.view, client key.shep.documents.write, client key.shep.elder_assignment.be_assignee, client key.shep.elder_assignment.set, client key.shep.explain_changes, client key.shep.forms.lock_elder, client key.shep.forms.view, client key.shep.forms.write, client key.shep.guidance.lock, client key.shep.membership_stage.set, client key.shep.notes.view, client key.shep.notes.write, client key.shep.panels.write, client key.shep.prayer.send, client key.shep.presence.view, client key.shep.profile.view, client key.shep.relationships.manage, client key.shep.relationships.view, client key.shep.status.manage, client key.shep.tags.manage, client key.shep.tasks.view, client key.shep.tasks.write, client key.shep.views.manage, client key.system.super_admin, client key.visibility.lift_hidden_tags, client key.visibility.rung.editor, client key.visibility.rung.elder, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client readsAsElder, client see.editor, client see.elder, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit, client writesTheRecord
noted: client key.core.sign_in, client key.hymns.view, client key.system.kiosk, client key.visibility.rung.public

--- uid:36eCd1ZG BLOCKING ---
permissionLevel=editor role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=editor storage=editor client=editor rankOf=editor formRank=editor canonical=viewer
loses: firestore isEditor, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore see.editor, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, storage isEditor, storage isMember, storage readsAsEditor, storage see.editor, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.member, formRank see.participant, client isEditor, client isMember, client key.admin.mcp.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.visibility.rung.editor, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client see.editor, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit
noted: client key.core.sign_in, client key.hymns.view, client key.shep.forms.view, client key.visibility.rung.public

--- uid:5CAtixLr BLOCKING ---
permissionLevel=(absent) role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=editor storage=editor client=editor rankOf=editor formRank=editor canonical=viewer
loses: firestore isEditor, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore see.editor, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, storage isEditor, storage isMember, storage readsAsEditor, storage see.editor, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.member, formRank see.participant, client isEditor, client isMember, client key.admin.mcp.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.visibility.rung.editor, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client see.editor, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit
noted: client key.core.sign_in, client key.hymns.view, client key.shep.forms.view, client key.visibility.rung.public

--- uid:5cYwmpOs BLOCKING ---
permissionLevel=(absent) role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=editor storage=editor client=editor rankOf=editor formRank=editor canonical=viewer
loses: firestore isEditor, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore see.editor, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, storage isEditor, storage isMember, storage readsAsEditor, storage see.editor, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.member, formRank see.participant, client isEditor, client isMember, client key.admin.mcp.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.visibility.rung.editor, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client see.editor, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit
noted: client key.core.sign_in, client key.hymns.view, client key.shep.forms.view, client key.visibility.rung.public

--- uid:5WtIgv8u BLOCKING ---
permissionLevel=(absent) role=super_admin accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=super_admin storage=super_admin client=super_admin rankOf=super_admin formRank=super_admin canonical=viewer
loses: firestore admin.dashboard.access, firestore canDecide, firestore countsAsElder, firestore isAdmin, firestore isEditor, firestore isElder, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore readsAsElder, firestore see.editor, firestore see.elder, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, firestore writesTheRecord, storage canDecide, storage isEditor, storage isElder, storage isMember, storage readsAsEditor, storage readsAsElder, storage see.editor, storage see.elder, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.elder, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.member, formRank see.participant, client admin.dashboard.access, client canDecide, client countsAsElder, client isAdmin, client isEditor, client isElder, client isMember, client key.admin.accounts.assign_level, client key.admin.accounts.provision, client key.admin.accounts.view, client key.admin.dashboard.access, client key.admin.levels.manage, client key.admin.mcp.view, client key.admin.push.manage, client key.admin.sms.manage, client key.analytics.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.edit_identity.assistant, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.services.week_shift, client key.shep.care_lists.view, client key.shep.care_lists.write, client key.shep.count_as_elder, client key.shep.dashboard.view, client key.shep.documents.view, client key.shep.documents.write, client key.shep.elder_assignment.be_assignee, client key.shep.elder_assignment.set, client key.shep.explain_changes, client key.shep.forms.lock_elder, client key.shep.forms.view, client key.shep.forms.write, client key.shep.guidance.lock, client key.shep.membership_stage.set, client key.shep.notes.view, client key.shep.notes.write, client key.shep.panels.write, client key.shep.prayer.send, client key.shep.presence.view, client key.shep.profile.view, client key.shep.relationships.manage, client key.shep.relationships.view, client key.shep.status.manage, client key.shep.tags.manage, client key.shep.tasks.view, client key.shep.tasks.write, client key.shep.views.manage, client key.system.super_admin, client key.visibility.lift_hidden_tags, client key.visibility.rung.editor, client key.visibility.rung.elder, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client readsAsElder, client see.editor, client see.elder, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit, client writesTheRecord
noted: client key.core.sign_in, client key.hymns.view, client key.system.kiosk, client key.visibility.rung.public

--- uid:c86F1Bcs BLOCKING ---
permissionLevel=editor role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=editor storage=editor client=editor rankOf=editor formRank=editor canonical=viewer
loses: firestore isEditor, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore see.editor, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, storage isEditor, storage isMember, storage readsAsEditor, storage see.editor, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.member, formRank see.participant, client isEditor, client isMember, client key.admin.mcp.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.visibility.rung.editor, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client see.editor, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit
noted: client key.core.sign_in, client key.hymns.view, client key.shep.forms.view, client key.visibility.rung.public

--- uid:D36i0WVh BLOCKING ---
permissionLevel=kiosk role=kiosk accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=kiosk storage=kiosk client=kiosk rankOf=kiosk formRank=kiosk canonical=viewer
loses: firestore isKiosk, client isKiosk, client key.system.kiosk
noted: client key.core.sign_in, client key.visibility.rung.public

--- uid:etGV8prm BLOCKING ---
permissionLevel=(absent) role=elder accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=elder storage=elder client=elder rankOf=elder formRank=elder canonical=viewer
loses: firestore canDecide, firestore countsAsElder, firestore isEditor, firestore isElder, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore readsAsElder, firestore see.editor, firestore see.elder, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, firestore writesTheRecord, storage canDecide, storage isEditor, storage isElder, storage isMember, storage readsAsEditor, storage readsAsElder, storage see.editor, storage see.elder, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.elder, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.member, formRank see.participant, client canDecide, client countsAsElder, client isEditor, client isElder, client isMember, client key.admin.mcp.view, client key.analytics.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.services.week_shift, client key.shep.care_lists.view, client key.shep.care_lists.write, client key.shep.count_as_elder, client key.shep.dashboard.view, client key.shep.documents.view, client key.shep.documents.write, client key.shep.elder_assignment.be_assignee, client key.shep.elder_assignment.set, client key.shep.explain_changes, client key.shep.forms.lock_elder, client key.shep.forms.view, client key.shep.forms.write, client key.shep.guidance.lock, client key.shep.membership_stage.set, client key.shep.notes.view, client key.shep.notes.write, client key.shep.panels.write, client key.shep.prayer.send, client key.shep.presence.view, client key.shep.profile.view, client key.shep.relationships.manage, client key.shep.relationships.view, client key.shep.status.manage, client key.shep.tags.manage, client key.shep.tasks.view, client key.shep.tasks.write, client key.shep.views.manage, client key.visibility.lift_hidden_tags, client key.visibility.rung.editor, client key.visibility.rung.elder, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client readsAsElder, client see.editor, client see.elder, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit, client writesTheRecord
noted: client key.core.sign_in, client key.hymns.view, client key.visibility.rung.public

--- uid:hJMTobnK ---
permissionLevel=member role=member accountLevelId=level_pastoral_assistant pastoralAssistant=false map=true trueKeys=52
ranks: firestore=member storage=pastoral_assistant client=pastoral_assistant rankOf=member formRank=member canonical=pastoral_assistant
gains: firestore isEditor, firestore isPastoralAssistant, storage see.editor, storage see.elder, storage see.participant, rankOf see.editor, rankOf see.elder, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.participant

--- uid:JhiP8bSR ---
permissionLevel=member role=member accountLevelId=level_pastoral_assistant pastoralAssistant=false map=true trueKeys=52
ranks: firestore=member storage=pastoral_assistant client=pastoral_assistant rankOf=member formRank=member canonical=pastoral_assistant
gains: firestore isEditor, firestore isPastoralAssistant, storage see.editor, storage see.elder, storage see.participant, rankOf see.editor, rankOf see.elder, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.participant

--- uid:jypMquMX BLOCKING ---
permissionLevel=(absent) role=editor accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=editor storage=editor client=editor rankOf=editor formRank=editor canonical=viewer
loses: firestore isEditor, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore see.editor, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, storage isEditor, storage isMember, storage readsAsEditor, storage see.editor, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.member, formRank see.participant, client isEditor, client isMember, client key.admin.mcp.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.visibility.rung.editor, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client see.editor, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit
noted: client key.core.sign_in, client key.hymns.view, client key.shep.forms.view, client key.visibility.rung.public

--- uid:L4GPAP4Y BLOCKING ---
permissionLevel=member role=member accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=member storage=member client=member rankOf=member formRank=member canonical=viewer
loses: firestore isMember, firestore see.member, storage isMember, storage see.member, rankOf see.member, formRank see.member, client isMember, client key.directory.view, client key.visibility.rung.member, client see.member
noted: client key.core.sign_in, client key.visibility.rung.public

--- uid:lDq2JbCW BLOCKING ---
permissionLevel=(absent) role=member accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=member storage=member client=member rankOf=member formRank=member canonical=viewer
loses: firestore isMember, firestore see.member, storage isMember, storage see.member, rankOf see.member, formRank see.member, client isMember, client key.directory.view, client key.visibility.rung.member, client see.member
noted: client key.core.sign_in, client key.visibility.rung.public

--- uid:MFjOICas BLOCKING ---
permissionLevel=(absent) role=elder accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=elder storage=elder client=elder rankOf=elder formRank=elder canonical=viewer
loses: firestore canDecide, firestore countsAsElder, firestore isEditor, firestore isElder, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore readsAsElder, firestore see.editor, firestore see.elder, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, firestore writesTheRecord, storage canDecide, storage isEditor, storage isElder, storage isMember, storage readsAsEditor, storage readsAsElder, storage see.editor, storage see.elder, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.elder, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.member, formRank see.participant, client canDecide, client countsAsElder, client isEditor, client isElder, client isMember, client key.admin.mcp.view, client key.analytics.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.services.week_shift, client key.shep.care_lists.view, client key.shep.care_lists.write, client key.shep.count_as_elder, client key.shep.dashboard.view, client key.shep.documents.view, client key.shep.documents.write, client key.shep.elder_assignment.be_assignee, client key.shep.elder_assignment.set, client key.shep.explain_changes, client key.shep.forms.lock_elder, client key.shep.forms.view, client key.shep.forms.write, client key.shep.guidance.lock, client key.shep.membership_stage.set, client key.shep.notes.view, client key.shep.notes.write, client key.shep.panels.write, client key.shep.prayer.send, client key.shep.presence.view, client key.shep.profile.view, client key.shep.relationships.manage, client key.shep.relationships.view, client key.shep.status.manage, client key.shep.tags.manage, client key.shep.tasks.view, client key.shep.tasks.write, client key.shep.views.manage, client key.visibility.lift_hidden_tags, client key.visibility.rung.editor, client key.visibility.rung.elder, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client readsAsElder, client see.editor, client see.elder, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit, client writesTheRecord
noted: client key.core.sign_in, client key.hymns.view, client key.visibility.rung.public

--- uid:WVC9UWb5 BLOCKING ---
permissionLevel=super_admin role=super_admin accountLevelId=(absent) pastoralAssistant=false map=false trueKeys=0
ranks: firestore=super_admin storage=super_admin client=super_admin rankOf=super_admin formRank=super_admin canonical=viewer
loses: firestore admin.dashboard.access, firestore canDecide, firestore countsAsElder, firestore isAdmin, firestore isEditor, firestore isElder, firestore isMember, firestore presenceRead, firestore readsAsEditor, firestore readsAsElder, firestore see.editor, firestore see.elder, firestore see.member, firestore see.participant, firestore write.calendar.away.edit, firestore write.calendar.events.edit, firestore write.directory.edit_identity, firestore write.hymns.edit, firestore write.printables.edit, firestore write.resources.edit, firestore write.roles.manager.edit, firestore write.services.builder.edit, firestore writesTheRecord, storage canDecide, storage isEditor, storage isElder, storage isMember, storage readsAsEditor, storage readsAsElder, storage see.editor, storage see.elder, storage see.member, storage see.participant, storage write.calendar.away.edit, storage write.calendar.events.edit, storage write.directory.edit_identity, storage write.hymns.edit, storage write.printables.edit, storage write.resources.edit, storage write.roles.manager.edit, storage write.services.builder.edit, rankOf see.editor, rankOf see.elder, rankOf see.member, rankOf see.participant, formRank see.editor, formRank see.elder, formRank see.member, formRank see.participant, client admin.dashboard.access, client canDecide, client countsAsElder, client isAdmin, client isEditor, client isElder, client isMember, client key.admin.accounts.assign_level, client key.admin.accounts.provision, client key.admin.accounts.view, client key.admin.dashboard.access, client key.admin.levels.manage, client key.admin.mcp.view, client key.admin.push.manage, client key.admin.sms.manage, client key.analytics.view, client key.calendar.away.edit, client key.calendar.away.view, client key.calendar.events.edit, client key.calendar.view, client key.directory.edit_identity, client key.directory.edit_identity.assistant, client key.directory.resolve_requests, client key.directory.view, client key.hymns.edit, client key.printables.edit, client key.printables.view, client key.resources.edit, client key.roles.manager.edit, client key.roles.manager.view, client key.services.builder.edit, client key.services.builder.view, client key.services.guidance.view, client key.services.week_shift, client key.shep.care_lists.view, client key.shep.care_lists.write, client key.shep.count_as_elder, client key.shep.dashboard.view, client key.shep.documents.view, client key.shep.documents.write, client key.shep.elder_assignment.be_assignee, client key.shep.elder_assignment.set, client key.shep.explain_changes, client key.shep.forms.lock_elder, client key.shep.forms.view, client key.shep.forms.write, client key.shep.guidance.lock, client key.shep.membership_stage.set, client key.shep.notes.view, client key.shep.notes.write, client key.shep.panels.write, client key.shep.prayer.send, client key.shep.presence.view, client key.shep.profile.view, client key.shep.relationships.manage, client key.shep.relationships.view, client key.shep.status.manage, client key.shep.tags.manage, client key.shep.tasks.view, client key.shep.tasks.write, client key.shep.views.manage, client key.system.super_admin, client key.visibility.lift_hidden_tags, client key.visibility.rung.editor, client key.visibility.rung.elder, client key.visibility.rung.member, client key.visibility.rung.participant, client presenceRead, client readsAsEditor, client readsAsElder, client see.editor, client see.elder, client see.member, client see.participant, client write.calendar.away.edit, client write.calendar.events.edit, client write.directory.edit_identity, client write.hymns.edit, client write.printables.edit, client write.resources.edit, client write.roles.manager.edit, client write.services.builder.edit, client writesTheRecord
noted: client key.core.sign_in, client key.hymns.view, client key.system.kiosk, client key.visibility.rung.public
```
