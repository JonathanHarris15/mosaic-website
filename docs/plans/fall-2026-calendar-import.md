# Fall 2026 calendar import — proposal

Source: `docs/Mosaic Fall 2026 Master Plan.xlsx` (tabs: Major Events, Calendar,
Core Seminar, Inductive Bible StudyDGroup, Mosaic Youth, Mosaic Kids, Mosaic
Christmas Party).

The Calendar tab is the spine: 154 dated rows, 2026-08-01 → 2027-01-01. The other
tabs are detail views of things the Calendar tab already lists, plus a few facts
the Calendar tab does not carry (times, themes, leaders).

Everything below maps onto the model already in `CONTEXT.md`: an **Event series**
(`events/{id}`) carries a recurrence rule and computes its dates; a **one-off
Event** is a single occurrence document (`event_occurrences/{autoId}`) with no
series; a date of a series that is not happening is **skipped**, never deleted.

---

## 1. Recurring — 7 Event series

Each of these is a real pattern the model can express (`weekly` / `monthly` +
`weekday` + `startDate` + `ends`). No occurrence documents get written; the
Calendar computes the dates.

| # | Series | Rule | Runs | Dates | Skips | Visibility | Colour |
|---|--------|------|------|-------|-------|-----------|--------|
| 1 | Service Review (Breakfast) | weekly, Mon | 2026-08-03 → 2026-12-28 | 22 | 5 | editor | steel |
| 2 | App Grid (Breakfast) | weekly, Thu | 2026-08-06 → 2026-12-31 | 22 | 4 | editor | steel |
| 3 | Member's Meeting | monthly, 1st Sun | 2026-08-02 → 2026-12-06 | 5 | – | member | navy |
| 4 | Core Seminar — Spiritual Formation | weekly, Sun | 2026-08-30 → 2026-11-29 | 14 | – | public | gold |
| 5 | Inductive Bible Study / DGroup — James | weekly, Wed | 2026-09-09 → 2026-12-02 | 13 | 1 | public | green |
| 6 | Missions Internship Discussion | weekly, Fri | 2026-08-21 → 2026-12-11 | 17 | – | editor | plum |
| 7 | Mosaic Youth Group | monthly, 4th Sun | 2026-09-27 → 2026-11-22 | 3 | – | public | rose |

**Skipped dates** (written as cancelled occurrences, which is how the sheet's
"No …" rows should land):

- Service Review: 2026-09-07 (Labor Day), 2026-10-12 (CSISD Fall Break),
  2026-11-23 (Thanksgiving Break), 2026-12-21, 2026-12-28
- App Grid: 2026-11-26 (Thanksgiving Day), 2026-12-17, 2026-12-24, 2026-12-31
- DIBS: 2026-11-25 (Thanksgiving Break)

**Detail the other tabs add:**

- DIBS runs **Discussion 6:30–7:30 PM, DGroup 7:30–9:00 PM**. The model holds one
  `time` on the rule, so: time `18:30`, description carries both halves.
- DIBS weeks are numbered (Week 0 … Week 10, plus a Catch Up / Fun Week on
  2026-10-14). Week numbers are per-date, and the model has no per-date subject
  field on a series occurrence — see open question 6.
- Missions Internship Discussion has a **different reading each week** (Dever &
  Gilbert; Jamieson, Roark & Kline, Stiles; Worship Paper; Philosophy of
  Ministry; Ordinances; Membership; Baptist Ecclesiology; Evangelism and
  Missions; Mission of the Church; Complementarianism; Church Leadership; Final
  Ecclesiology). Same problem as DIBS week numbers.
- Mosaic Youth leader is **Stephen Pursley**; Guys DGroup Colin Beers (maybe),
  Girls DGroup Anna Bolton (maybe). Leaders belong in Roles, not in the event
  name — I'd leave them out of the import and assign them on the Roles tab.

**Not a pattern, despite looking like one:** Launch Team Lunch falls on
2026-08-16, 08-30, 09-06, 09-20, 10-11, 11-01 — Sundays, but at 14/7/14/21/21-day
gaps. Nothing weekly, fortnightly or monthly produces that, so it goes in as six
one-offs (below). Say the word if there's a rule behind it and I'll make it a
series instead.

---

## 2. One-off church events — 20

| Date | DOW | Event | Visibility |
|------|-----|-------|-----------|
| 2026-08-15 | Sat | Mosaic Kids: Back to School Splash Bash | public |
| 2026-08-16 | Sun | Launch Team Lunch | member |
| 2026-08-22 | Sat | Mosaic Kids and Youth Ministry Training | member |
| 2026-08-26 | Wed | DIBS Leader Training | member |
| 2026-08-27 | Thu | Impact Ministry Fair | public |
| 2026-08-30 | Sun | Launch Team Lunch | member |
| 2026-09-06 | Sun | Launch Team Lunch | member |
| 2026-09-18 | Fri | DIBS Group Leader Follow Up (Dinner) | member |
| 2026-09-20 | Sun | Launch Team Lunch | member |
| 2026-09-26 | Sat | Mosaic Kids: Sandlot Kickball | public |
| 2026-10-11 | Sun | Launch Team Lunch | member |
| 2026-10-18 | Sun | DIBS Leader Follow Up (Lunch) | member |
| 2026-10-24 | Sat | Mosaic Kids: Fall Festival | public |
| 2026-11-01 | Sun | Launch Team Lunch | member |
| 2026-11-21 | Sat | Mosaic Kids: Friendsgiving (Football and Flowers) | public |
| 2026-12-05 | Sat | Mosaic Kids: Christmas Party | public |
| 2026-12-09 | Wed | Mosaic Christmas Party | public |
| 2026-12-12 | Sat | Mosaic Youth Christmas Party | public |
| 2026-12-13 | Sun | DIBS Leader Follow Up 3 (Lunch) | member |
| 2026-12-24 | Thu | Christmas Eve Candlelight Service *(maybe)* | public |

Mosaic Kids themes come from the Kids tab and go in the event **name**, since
"Mosaic Kids" is not itself a series with a rule the model can express (three
different weeks-of-month across five dates).

The Youth Christmas Party (12/12) is deliberately a one-off rather than the
December date of the Youth Group series: the series' rule would produce 12/27,
and moving it is more machinery than a party is worth.

---

## 3. Deadlines — 2

Not gatherings. No time, no roles — a one-off occurrence with a name is enough,
and they'll draw on the calendar as a chip like anything else.

| Date | Event |
|------|-------|
| 2026-08-05 | DIBS / DGroup Leader Application Deadline |
| 2026-08-30 | DIBS Registration Deadline *(see open question 1)* |

"Core Seminar Start" on 2026-08-30 is just the first date of series #4 and gets
dropped rather than imported as its own event.

---

## 4. Context — not church events

These are on the sheet so the staff can plan around them, not because the church
is running them. **My recommendation: import them, but at `editor` visibility and
in one quiet colour**, so they inform planning without cluttering what the
congregation sees. Alternative is to leave them out entirely — your call.

**Single days (6):** Move In Day 8/17 · CSISD First Day of School 8/19 · First
Day of Class TAMU/Blinn 8/24 · Labor Day 9/7 · Halloween 10/31 · Thanksgiving Day
11/26 · Christmas Day 12/25

**Aggie home games (7):** 9/5 MO State · 9/12 Arizona State · 9/19 Kentucky ·
10/3 Arkansas · 10/17 Citadel · 11/14 Tennessee · 11/27 t.u.

**Multi-day runs (4)** — and these have no home in the model, see open question 5:

| Range | Days | What |
|-------|------|------|
| 2026-10-12 → 10-13 | 2 | CSISD Fall Break |
| 2026-11-23 → 11-27 | 5 | CSISD Thanksgiving Break |
| 2026-12-07 → 12-10 | 4 | TAMU Finals |
| 2026-12-18 → 12-22 | 5 | CAMO CWC Indianapolis |

---

## 5. Already in the app — nothing to import

- **Sunday Service.** The sheet never lists Sundays as events, because they are
  assumed. The locked `sunday_service` series already covers every one of them.
- **Preaching Schedule** ("After Galatians, Psalms 25–41"). That is the sermon
  series, and it belongs in the order of service, not on the calendar.
- **Thanksgiving Sunday** (11/29). A note about that Sunday's service, not a
  separate event. Belongs on `services/2026-11-29`.

---

## Open questions

These do not block the import. Where I've had to pick, I've picked and said so.

1. **DIBS Registration Deadline — 8/30 or 9/1?** The Calendar tab puts it on
   2026-08-30; the DIBS tab says 2026-09-01. *Taking 8/30* (the Calendar tab is
   the spine).
2. **Mosaic Kids Christmas Party — 12/5 or 12/6?** Calendar tab says Sat 12/5;
   the Kids tab says Sun 12/6. *Taking 12/5.*
3. **Missions Internship on Thu 10/8.** Every other one is a Friday, and Fri 10/9
   is empty. Looks like a typo. *Taking Fri 10/9*, which also makes the series a
   clean weekly rule with no exceptions.
4. **Core Seminar on 11/29** is flagged "Thanksgiving" on its tab. Does it run?
   *Assuming it does*; say so and I'll add it as a skip.
5. **Multi-day events have no home.** An occurrence is one date — there is no
   `endDate` anywhere in the model. Three ways out: (a) import each break as N
   separate one-day events, (b) import only the first day with the range in the
   description, (c) leave them off. *Taking (b)* — it is one chip instead of five
   and reads honestly.
6. **Per-date subjects have no home either.** DIBS week numbers and the Missions
   Internship readings are per-date facts on a recurring series, and the model
   only has a description on the series. *Putting the full list in the series
   description* for now. If you want them per date, that's a feature, not an
   import — tell me and I'll spec it.
7. **Elder Meetings are listed as a major event with no dates anywhere** in the
   workbook. Nothing to import. Send dates and I'll add them (`elder` visibility).
8. **Membership Matters** is "As Needed" — no dates, nothing to import.
9. **Christmas Eve Candlelight Service** is marked "(Maybe)". *Importing it*, since
   an event that might happen is easier to skip than to remember.
10. **DIBS group size got eaten by Excel.** The cell reads `2026-04-07`, which is
    what Excel does to `4-7`. So group size is 4–7 — worth fixing in the sheet.
11. The **Mosaic Christmas Party tab** contains only the word "Kirsten". Assuming
    she's running it; nothing else to take from it.

---

## Totals

| Bucket | Count |
|--------|-------|
| Event series | 7 |
| Cancelled dates on those series | 10 |
| One-off church events | 20 |
| Deadlines | 2 |
| Context — single days | 7 |
| Context — Aggie home games | 7 |
| Context — multi-day runs | 4 |
| **Documents written** | **7 series + 50 occurrences** |
