# MS-99 — Calendar & Events: design brief

**For:** Claude Design, against the **Mosaic Website Design** system (`mosaic-church-design`).
**Deliverable:** a new UI kit at `ui_kits/calendar/`, following the pattern of `ui_kits/hymn_directory/` and `ui_kits/public_directory/` — an `index.html` entry point, JSX screens, and a `README.md` naming the screens and the components used.
**Read first:** `readme.md`, `styles.css`, `guidelines/`, and the existing `ui_kits/` to lift layout patterns from. Reuse `Button`, `IconButton`, `Input`, `Select`, `Checkbox`, `Badge`, `Card`, `Avatar`, `SectionLabel` rather than inventing new primitives — flag it if a screen genuinely needs one that doesn't exist.

---

## What this is

Mosaic Church currently has one dated thing in its system: Sunday. The **Services** page lists Sundays and who is leading, preaching, and playing.

This adds a general **Calendar** — every church event, not just Sundays. A midweek gathering, an elders' meeting, a church picnic, a workday. Each event says what **Roles** it needs filling ("Kids Ministry", "Setup"), and an editor puts people into those roles and tracks whether they've actually agreed to do it.

The people using this are church volunteers and staff, not software users. The tone is the design system's: warm, grounded, unhurried. Nothing here should feel like a project-management tool.

---

## Screens to design

### 1. Calendar — the main view

The new front door. Shows every event the signed-in person is allowed to see, Sundays included.

- Most people are looking for **what's coming up and am I in it**. Design for that, not for administration.
- Needs to work when the church has three events a month and when it has three a week.
- A person's own commitments should be findable at a glance — someone should be able to answer "what am I doing this month?" without hunting.
- Sundays appear here alongside everything else, but Sunday is edited on the **Services** page, not here. A Sunday in the Calendar links across rather than opening an editor.
- Consider whether month-grid, list, or both. The existing Services page is a scrolling list with a table alternative — there's precedent for offering two views, and a reason not to invent a third pattern.

### 2. Event detail

One event, everything about it. Two audiences with very different needs, and the same screen serves both:

- **An editor** sees and changes everything — details, roles, who's in them, visibility.
- **A member** may be seeing this only because they're serving at it. They might see the full roster, or only their own slot — that's a per-event setting (see §5). Design both states.

Carries: name, date, time, location, description, whether it repeats, and its visibility.

### 3. Roles and assignment — the heart of it

An event lists the Roles it needs. **Two kinds, and they must not look the same**, because they aren't:

- **Managed Roles** come from the Roles Manager. They have an ordered set of **slots** — one slot per person needed — and each slot may require a man, a woman, or either. They carry rules ("no married couple in this role"). These are the ones the system will later fill automatically.
- **One-off Roles** are created on the spot for this event only: *"someone to unlock the hall."* A label and some people. No slots, no requirements, no rules. **Deliberately cheap** — adding one should take seconds and feel lighter than reaching for a managed Role. If a one-off Role looks as heavyweight as a managed one, the design has failed.

**Assigning a person to a slot.** The picker shows *everyone*, including people who can't fill it — greyed out **with the reason** ("already serving here", "this slot needs a woman", "married to someone already in this role", "not in the required group"). Never a silent omission: the point is that an editor can see who was passed over and why.

### 4. The three assignment states

Every assignment is in exactly one state, and the editor sets it by hand:

| State | Meaning |
| --- | --- |
| **Pending** | Assigned, not yet heard from. The default — most assignments sit here. |
| **Confirmed** | They said yes. |
| **Declined** | They said no. |

**Declined is the one that matters visually.** A declined slot is *flagged for reassignment* — it must read as **needing attention**, not as an empty slot and not as a quiet failure. Someone glancing at next Wednesday should immediately see "this needs sorting". The person's name is still attached (they still hold the slot until someone replaces them), so it's not empty — it's occupied by a no.

Pending is the resting state and should be calm — if every unconfirmed assignment shouts, nothing does.

### 5. Visibility

An editor chooses who can see each event. **Five levels**, and the editor has to understand the difference instantly — a mistake here shows the wrong people an elders' meeting:

| Level | Who sees it |
| --- | --- |
| **Public** | Anyone, signed in or not |
| **Members** | Members and above |
| **Participants** | Only people given a role on *this* event, plus editors and elders |
| **Editors** | Editors and above |
| **Elders** | Elders and super admins |

Plus a separate toggle: **can participants see the full roster?** ("Everyone serving can see who else is serving" vs "people only see their own part"). Only meaningful at the Participants level and above.

Note: **Sundays are always public and can't be changed.** The Sunday view should show its visibility as settled rather than as a disabled control begging to be clicked.

### 6. Recurring events

An event can repeat ("every Wednesday, 7pm"). Needs a way to express that without becoming a full calendar-app recurrence editor — this is a church, the patterns are weekly, fortnightly, monthly.

**One screen that needs real care:** when an editor changes an existing pattern — moves the Wednesday gathering to Thursdays — some already-scheduled dates will have people assigned to them who no longer fit the new pattern. **We deliberately don't guess.** The editor is shown those orphaned dates, with who's on them, and chooses: move them, or delete them. This should feel like a careful question, not an error.

### 7. "Did they serve?"

After an event has passed, anyone still marked **Pending** — never confirmed, never declined — is an open question. Silence is never counted as having served, but it isn't thrown away either.

So a past event with unconfirmed people surfaces a gentle prompt: *"Wednesday 12th — 4 people were never confirmed. Did they serve?"* Tick the ones who did, individually or all at once. Whatever's left stays unanswered, permanently, and doesn't count.

This should feel like tidying up, not like a nag or an error state. It's also temporary scaffolding — once people can confirm for themselves, this pile mostly disappears — so it shouldn't dominate the design.

---

## Constraints

- **Not a dark-mode design.** Warm cream/parchment surfaces, deep-navy ink, ocean/steel-blue accents. Sand and gold as hairlines only. No gradients.
- **Depth via 1px warm hairlines and tonal layers, not shadows.** Cards flat by default.
- **Fonts:** Cinzel for titles, Libre Franklin for all UI chrome. EB Garamond is for hymns and reading — unlikely to appear here.
- **Icons: Material Symbols (outlined), not Lucide.** This deliberately contradicts the design system's current `readme.md` and `SKILL.md`, both of which name Lucide as a non-negotiable. That rule does not describe the product: all 23 pages of the app use Material Symbols, including the Roles Manager, which was rebuilt to the design-system layout as recently as MS-120. A kit drawn in Lucide would need every icon translated on the way into production, or would leave the Calendar as the only page in the app using a different icon set. **Correct the design system's `readme.md` and `SKILL.md` in the same pass** so the documented rule matches reality — the intent behind the rule (one consistent icon set, ~1.75px stroke, `currentColor`, no emoji) is right and stands; only the library name is wrong.
- **Mobile matters.** People check "what am I serving at" on a phone. The Calendar and Event detail need to work small; the heavier editing screens can assume a desktop.
- **No emoji, ever.**

## Explicitly not in this kit

- Subscribing to the calendar from a phone's own calendar app — dropped from scope.
- Automatic assignment, fairness ranking, or "propose a lineup" — later tickets. Don't design controls for them, but don't design a layout that couldn't accommodate a suggested name appearing in a slot later.
- Members confirming or declining their own assignments — later ticket. In this kit only an editor ever changes a state.
- Any redesign of the Services page beyond its rename.
