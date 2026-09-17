# MS-523 — Grant Stephen Persley and Ian Riley in production (HITL)

Do **not** grant anyone in this agent environment, staging copies of
production data, or any Firebase project this agent can reach. The grant is
a live production switch on real accounts. This file is the paste-ready
remainder after MS-426 merges and hosting + rules + functions are deployed.

Automated work on this Feature stops at the doors. Rules shape is pinned in
`test/firestore-pastoral-assistant-rules.test.js`. The access core is pinned
in `test/access-core.test.js`. MCP gates are pinned in `test/mcp-actor.test.js`
and `test/mcp-server.test.js`. Live enforcement of rules, and the two named
accounts, are a person's job.

## 0. Before you start

- Deploy Firestore rules, Storage rules, Cloud Functions, and hosting from
  the MS-426 PR.
- You will need a super admin (or admin) signed in on the live site.
- Stephen's and Ian's Permission Levels stay whatever they are today. Do
  not raise them to elder or super admin.

## 1. Prove the doors on a throwaway member account

1. In production, create or pick a **member** test account that is not
   Stephen or Ian.
2. Open **Profile → Admin account list** (web). Confirm the Pastoral
   Assistant switch is next to Permission Level. Toggle it **on**. Confirm
   the Permission Level shown does not change. Confirm the **Pastoral
   Assistant** badge appears.
3. Sign in as that test account on **web**:
   - Shepherd Dashboard opens. Create Meeting Minutes, a Folder, a Person
     Panel note, and a Task. Edit a Care List cell's text.
   - Forms / Printables / Roles Manager / MCP Manager open. Create / edit /
     delete controls are hidden (or refuse).
   - Status matrix, tag chips, Elder Assignment, Explanation, Filtered View
     create, relationship edits, Prayer Request send: shown read-only or
     they do nothing.
   - From the browser console, try a status write, a tag write, and an
     Elder Assignment write. All must fail (`permission-denied`).
4. Same walk on the **phone** (native app or `?shell=mobile`): open a
   profile, write minutes with a Person Panel, create a Task. Status / tag
   / Elder Assignment controls are read-only.
5. Toggle the grant **off**. Reload. Shepherd Dashboard must refuse /
   redirect. Directory elder lifts (hidden people / hidden tags) must drop.

## 2. Leave Stephen's and Ian's Permission Levels alone

Look up both accounts on the live Admin list. Write down the Permission
Level you see (member, editor, …). You will check it again after the grant.

## 3. Switch Pastoral Assistant on

On the live account panel, for each of:

- **Stephen Persley**
- **Ian Riley**

toggle **Pastoral Assistant** on. Confirm:

- Permission Level is unchanged from step 2.
- Neither carries the Elder Tag in the directory.
- Neither appears in the Elder Assignment picker or the Task Assignee
  picker.

## 4. After the next elders' meeting

Have one of them take the minutes on his own account. Ask Sam whether
anything they needed was refused — especially Shepherding Status, which
this Feature kept with the elders.

Write Sam's feedback as a comment on **MS-426**. Anything that should
move becomes a **new ticket in To Plan**, not a change on this Feature.

## Paste-ready report (onto MS-523 / MS-426)

```
Test account (member + grant)
- Web: dashboard / minutes / folder / Person Panel / Task / Care List cell: 
- Web decision writes (page + console status / tag / assignment): 
- Web workrooms read-only: 
- Phone: profile / minutes+panel / Task: 
- Phone decision controls read-only: 
- Grant removed → dashboard closed: 

Stephen Persley
- Permission Level before / after:  / 
- Grant on: 
- Elder Tag absent: 
- Not in Elder Assignment / Task Assignee pickers: 

Ian Riley
- Permission Level before / after:  / 
- Grant on: 
- Elder Tag absent: 
- Not in Elder Assignment / Task Assignee pickers: 

Meeting minutes taken by a Pastoral Assistant (date / who): 
Sam's feedback (paste onto MS-426): 
Follow-up tickets filed in To Plan: 
```
