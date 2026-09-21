# ADR 0068 — The phone directory keeps Edit Mode

**Status:** Accepted
**Date:** 2026-09-21

The computer Membership Directory turns into a people manager when an editor
switches on Edit Mode. The phone directory is a separate screen that only lets
that same editor change email, phone, address, and birthday. The obvious fix,
used for the Calendar, the Roles Manager, Forms, and Tasks, is to open the
computer page inside the phone. That was rejected.

**Edit Mode on the phone is the same toggle, on the phone's own directory.**
An editor does not get the computer page squeezed into a WebView, and the
phone does not grow a second people manager beside the directory. Every write
— the Membership Track, tags, Family, a Directory Photo, a Directory Request,
unlinking an account, deleting a person, merging two records — goes through
the same planners and callables the computer page already uses. The phone
screen is only the controls.

Opening the computer page would have kept one set of buttons, and it would
have hidden half of them: delete, the photo overlay, and removing an
involvement record appear only while a mouse is hovering. A member's browse
of the directory, which the phone screen was built for, would also have been
replaced by a desktop layout. A second copy of the write rules was the other
way to lose, so the buttons are new and the rules are not.
