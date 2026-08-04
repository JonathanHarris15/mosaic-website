# ADR 0022: Pastoral Prayer History Is the Record; the Person Field Is a Cache

## Status
Accepted. Narrows ADR-0019 §5, which deliberately left pastoral prayer's *timing* alone and said nothing about how the two records are kept in step.

## Context

Being prayed for is stored twice:

- `people/{id}/pastoral_prayer_history/{serviceDate}` — one doc per Sunday a person was a subject. The doc ID **is** the date.
- `people/{id}.lastPastoralPrayerDate` — the newest of those dates, denormalised onto the Person so the rotation can rank hundreds of members without opening a subcollection each.

Four surfaces wrote the second one by hand — the Order of Service editor, the Services calendar's inline edit, the schedule shift, and the People merge — and no two of them agreed. The rotation is the only thing that reads it, and the rotation is the whole point of the feature: it is how the church avoids praying for the same six people all year.

Three separate faults, all invisible from the outside because the field always held *a* date:

1. **The editor read the history before committing its own write.** The add or delete of the history doc and the read that was supposed to reflect it sat in the same uncommitted batch, and a Firestore batch is invisible to a read until it lands. So choosing this Sunday's subject wrote back their *previous* date — they stayed at the top of the rotation and got offered again the next week — and removing a subject wrote back the date just removed.

2. **"Never prayed for" had two spellings.** Two paths wrote `null`, two wrote the string `'0000-00-00'`. Every display then guessed: the People list hid the row entirely for `null` but printed "Last: Never" for the sentinel, and Analytics printed `0000-00-00` as though it were a date.

3. **A merge reissued the doc IDs.** The People merge copied history docs to auto-generated IDs, because it shared one routine with Involvement, whose IDs genuinely are arbitrary. The record still counted, but nothing could address it any more: unselecting that Sunday's subject afterwards deleted nothing, and reselecting them wrote a second copy.

Analytics compounded it by reading `lastPastoralPrayerDate` in preference to the history it had already loaded — trusting the cache over the record it caches.

## Decision

### 1. The history is the record; the field is derived and may be rebuilt at any time

Nothing may read `lastPastoralPrayerDate` when it has the history to hand. Analytics loads the whole history already, so it uses it and falls back to the field only for a person whose dates came in from an import with no records behind them.

`scripts/sync-pastoral-prayer-dates.js` rebuilds the field for everyone from the history. It now also **clears** the field for a person whose history is empty — the earlier version only ever wrote dates, so a person whose last record was deleted stayed "recently prayed for" for good.

### 2. Never prayed for is `null`

`'0000-00-00'` is recognised on read and normalised away, so records already carrying it behave, but it is never written again. One label — `PastoralPrayerCore.lastPrayedLabel` — is what every surface renders, so a member with no history reads as "Never prayed for" everywhere instead of as a blank row on the People list.

### 3. The doc ID is the service date, and anything that copies a record carries it

That ID is how a save addresses the exact record it means to remove without a query. A merge or a schedule shift must preserve it. `PastoralPrayerCore.historyDocId` refuses anything that is not a date, so a bad write fails rather than stranding a record under an ID nothing can reach.

### 4. The cache is written in the same batch as the history change

The editor cannot read its own pending write, so it does not try. It reads the stored dates, applies the pending add or remove in memory (`PastoralPrayerCore.nextLastPrayerDate`), and writes the result into the same batch as the history change. The record and its cache land together or not at all.

Surfaces that have already committed — the calendar's inline edit, the schedule shift — re-derive from the stored history instead, which is the same answer by a different route. Both routes live in `public/pastoral-prayer-core.js`, so neither can drift.

### 5. A future Sunday counts as the newest date

A booking six weeks out is already a commitment to pray for that person, so it must stop the rotation offering them from the moment it is made. This is why the field is the newest date and not the newest *past* date, and it is why Analytics splits the question: how **often** someone has been prayed for, and how far apart, counts only Sundays that have happened; **when last** includes the one still ahead.

## Consequences

- **The stored data was already wrong** and code alone does not fix it. `scripts/sync-pastoral-prayer-dates.js` has to run once against live data; `--dry-run` prints what it would change.
- **A merge no longer duplicates prayer history**, and the record it lands stays addressable by later saves.
- **The People list now shows a row for members never prayed for.** It showed nothing before, which read as missing data rather than as the most overdue person in the church.
- **`prayer-suggestions.js` depends on the core** for what a stored date means. It stays pure and node-testable; only the sentinel question moved.
- **Pastoral prayer still writes on save, for future Sundays included.** ADR-0019 §5 stands: this records being prayed *for*, not serving, and fairness never reads it.
