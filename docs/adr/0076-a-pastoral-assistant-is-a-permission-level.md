# ADR 0076 — A Pastoral Assistant is a Permission Level

**Status:** Accepted
**Date:** 2026-10-01
**Supersedes:** [ADR 0065](0065-a-pastoral-assistant-is-a-grant-on-the-account.md)

A Pastoral Assistant is a Permission Level, chosen in the same list as editor, elder, admin, and super admin. It is not a checkbox on the account.

They have an elder's access: the same pages, the same editorial writes, and the same shepherding decisions. They are not counted as an elder. The Elder Tag still projects only from the `elder` level, so they are absent from elder pickers, the Elder Digest, Task assignees, and the Relations Viewer elder nodes.

The old `users.pastoralAssistant` flag still opens those doors, so an account granted that way does not lose them until an admin sets the role. Setting a Permission Level clears the flag.

## Why not keep the grant

ADR 0065 stacked a boolean on whatever level the account already held, so a secretary would not lose editor rights and would not be counted as an elder. The checkbox is the wrong shape: Pastoral Assistant is a role a person has, the way elder is. Putting it on the ladder gives the editorial permissions an elder already has, because an elder is an editor. Counting them as an elder is a separate question, and the answer is still no — the tag, the pickers, and the graph stay on the `elder` level alone.
