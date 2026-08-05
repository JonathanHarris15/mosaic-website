/**
 * @fileoverview The Fall 2026 Master Plan, as data.
 *
 * Transcribed from `docs/Mosaic Fall 2026 Master Plan.xlsx` — 154 dated rows on
 * the Calendar tab, plus the detail the other six tabs carry (times, themes,
 * week numbering, reading lists). The reasoning behind every classification is
 * in `docs/plans/fall-2026-calendar-import.md`; this file is only the result.
 *
 * Separate from the importer so the two can be read for different reasons: this
 * one to check the church's plan is right, `import-fall-2026.js` to check the
 * writing is.
 *
 * ── Ids are deterministic and permanent ─────────────────────────────────────
 *
 * Every document here is written under an id chosen by hand, so running the
 * import twice updates rather than duplicates.
 *
 * ⚠ A ONE-OFF'S ID MUST NOT END IN `_YYYY-MM-DD`. `Core.parseOccurrenceId`
 * splits at the LAST underscore and reads a trailing date as "this is one date
 * of the series in front of it" — so an id like `fall2026_splash_2026-08-15`
 * would make a one-off behave as a date of a series called `fall2026_splash`,
 * and it would be refused its own date and its own span. One-off ids here use
 * hyphens only, and carry no underscore at all.
 */

// ── The seven recurring Events ───────────────────────────────────────────────
//
// A pattern the model can actually express: weekly or monthly, one weekday, an
// end date. Nothing here needed a fortnightly rule and nothing needed a count.
//
// Sunday = 0 … Saturday = 6, the same numbering `datesBetween` uses.
const SERIES = [
    {
        id: 'service_review',
        name: 'Service Review',
        description: 'Over breakfast, going back over Sunday.',
        visibility: 'editor',
        colour: 'steel',
        recurrence: { freq: 'weekly', weekday: 1, startDate: '2026-08-03', ends: { kind: 'onDate', date: '2026-12-28' } },
        // The sheet's "No Service Review (Breakfast)" rows. A date of a series is
        // SKIPPED, never deleted — the rule still produces it, and an absent
        // document would draw it straight back.
        skip: [
            { date: '2026-09-07', why: 'Labor Day' },
            { date: '2026-10-12', why: 'CSISD Fall Break' },
            { date: '2026-11-23', why: 'CSISD Thanksgiving Break' },
            { date: '2026-12-21', why: 'Christmas' },
            { date: '2026-12-28', why: 'Christmas' },
        ],
    },
    {
        id: 'app_grid',
        name: 'App Grid',
        description: 'Over breakfast.',
        visibility: 'editor',
        colour: 'steel',
        recurrence: { freq: 'weekly', weekday: 4, startDate: '2026-08-06', ends: { kind: 'onDate', date: '2026-12-31' } },
        skip: [
            { date: '2026-11-26', why: 'Thanksgiving Day' },
            { date: '2026-12-17', why: 'Christmas' },
            { date: '2026-12-24', why: 'Christmas Eve' },
            { date: '2026-12-31', why: 'New Year' },
        ],
    },
    {
        id: 'members_meeting',
        name: "Member's Meeting",
        description: 'The first Sunday of the month.',
        visibility: 'member',
        colour: 'navy',
        // Monthly means "the first Sunday", not "the 2nd of the month" — the nth
        // is taken from the start date.
        recurrence: { freq: 'monthly', weekday: 0, startDate: '2026-08-02', ends: { kind: 'onDate', date: '2026-12-06' } },
        skip: [],
    },
    {
        id: 'core_seminar',
        name: 'Core Seminar',
        description: 'Spiritual Formation.',
        visibility: 'public',
        colour: 'gold',
        recurrence: { freq: 'weekly', weekday: 0, startDate: '2026-08-30', ends: { kind: 'onDate', date: '2026-11-29' } },
        skip: [],
    },
    {
        id: 'inductive_bible_study',
        name: 'Inductive Bible Study / DGroup',
        description: [
            'James.',
            '',
            'Discussion 6:30–7:30 pm, then DGroup 7:30–9:00 pm. Groups of 4–7, guys or girls only.',
            '',
            'Week 0 (introduction) 9 Sep · Week 1 16 Sep · Week 2 23 Sep · Week 3 30 Sep ·',
            'Week 4 7 Oct · Catch-up / fun week 14 Oct · Week 5 21 Oct · Week 6 28 Oct ·',
            'Week 7 4 Nov · Week 8 11 Nov · Week 9 18 Nov · Week 10 2 Dec.',
        ].join('\n'),
        visibility: 'public',
        colour: 'green',
        recurrence: {
            freq: 'weekly', weekday: 3, startDate: '2026-09-09',
            time: '18:30', ends: { kind: 'onDate', date: '2026-12-02' },
        },
        skip: [
            { date: '2026-11-25', why: 'Thanksgiving Break' },
        ],
    },
    {
        id: 'missions_internship',
        name: 'Missions Internship Discussion',
        description: [
            '21 Aug Dever, Gilbert · 28 Aug Jamieson, Roark & Kline, Stiles ·',
            '4 Sep Lawrence, Dever, Ortlund · 11 Sep Helm, Onwuchekwa · 18 Sep worship paper ·',
            '25 Sep no paper · 2 Oct philosophy of ministry · 9 Oct no paper · 16 Oct ordinances ·',
            '23 Oct membership · 30 Oct Baptist ecclesiology · 6 Nov evangelism and missions ·',
            '13 Nov mission of the church · 20 Nov complementarianism · 27 Nov ·',
            '4 Dec church leadership · 11 Dec final ecclesiology.',
        ].join('\n'),
        visibility: 'editor',
        colour: 'plum',
        // The sheet has 9 October on a Thursday, and every other one on a Friday
        // with that Friday blank. Read as a typo — see the plan doc, open
        // question 3. Taking the Friday makes this a clean weekly rule.
        recurrence: { freq: 'weekly', weekday: 5, startDate: '2026-08-21', ends: { kind: 'onDate', date: '2026-12-11' } },
        skip: [],
    },
    {
        id: 'youth_group',
        name: 'Mosaic Youth Group',
        description: 'Led by Stephen Pursley.',
        visibility: 'public',
        colour: 'rose',
        // The fourth Sunday. December's is deliberately NOT this series — the
        // rule would put it on the 27th, and the party is on the 12th, so it is
        // a one-off rather than a move.
        recurrence: { freq: 'monthly', weekday: 0, startDate: '2026-09-27', ends: { kind: 'onDate', date: '2026-11-22' } },
        skip: [],
    },
];

// Every date the sheet actually shows for each series, so the import can check
// the rule it is about to write produces exactly this and nothing else. A wrong
// weekday or a wrong nth is otherwise invisible until somebody opens the month.
const EXPECTED = {
    service_review: [
        '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31',
        '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28',
        '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26',
        '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
        '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28',
    ],
    app_grid: [
        '2026-08-06', '2026-08-13', '2026-08-20', '2026-08-27',
        '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24',
        '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29',
        '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26',
        '2026-12-03', '2026-12-10', '2026-12-17', '2026-12-24', '2026-12-31',
    ],
    members_meeting: ['2026-08-02', '2026-09-06', '2026-10-04', '2026-11-01', '2026-12-06'],
    core_seminar: [
        '2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27',
        '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25',
        '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29',
    ],
    inductive_bible_study: [
        '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30',
        '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28',
        '2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02',
    ],
    missions_internship: [
        '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25',
        '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30',
        '2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27',
        '2026-12-04', '2026-12-11',
    ],
    youth_group: ['2026-09-27', '2026-10-25', '2026-11-22'],
};

// ── One-off Events ───────────────────────────────────────────────────────────
//
// Everything with no pattern behind it. `endDate` is the last day of a run,
// inclusive — only ever on a one-off (ADR 0024).

const ONE_OFFS = [
    // ── The church's own gatherings ──────────────────────────────────────────
    { id: 'fall2026-kids-splash-bash', date: '2026-08-15', name: 'Mosaic Kids: Back to School Splash Bash', visibility: 'public', colour: 'amber' },
    { id: 'fall2026-launch-lunch-aug16', date: '2026-08-16', name: 'Launch Team Lunch', visibility: 'member', colour: 'ocean' },
    { id: 'fall2026-kids-youth-training', date: '2026-08-22', name: 'Mosaic Kids and Youth Ministry Training', visibility: 'member', colour: 'amber' },
    { id: 'fall2026-dibs-leader-training', date: '2026-08-26', name: 'DGroup Leader Training', visibility: 'member', colour: 'green' },
    { id: 'fall2026-impact-ministry-fair', date: '2026-08-27', name: 'Impact Ministry Fair', visibility: 'public', colour: 'ocean' },
    { id: 'fall2026-launch-lunch-aug30', date: '2026-08-30', name: 'Launch Team Lunch', visibility: 'member', colour: 'ocean' },
    { id: 'fall2026-launch-lunch-sep06', date: '2026-09-06', name: 'Launch Team Lunch', visibility: 'member', colour: 'ocean' },
    { id: 'fall2026-dibs-follow-up-1', date: '2026-09-18', name: 'DGroup Leader Follow Up', description: 'Over dinner.', visibility: 'member', colour: 'green' },
    { id: 'fall2026-launch-lunch-sep20', date: '2026-09-20', name: 'Launch Team Lunch', visibility: 'member', colour: 'ocean' },
    { id: 'fall2026-kids-sandlot-kickball', date: '2026-09-26', name: 'Mosaic Kids: Sandlot Kickball', visibility: 'public', colour: 'amber' },
    { id: 'fall2026-launch-lunch-oct11', date: '2026-10-11', name: 'Launch Team Lunch', visibility: 'member', colour: 'ocean' },
    { id: 'fall2026-dibs-follow-up-2', date: '2026-10-18', name: 'DGroup Leader Follow Up', description: 'Over lunch.', visibility: 'member', colour: 'green' },
    { id: 'fall2026-kids-fall-festival', date: '2026-10-24', name: 'Mosaic Kids: Fall Festival', visibility: 'public', colour: 'amber' },
    { id: 'fall2026-launch-lunch-nov01', date: '2026-11-01', name: 'Launch Team Lunch', visibility: 'member', colour: 'ocean' },
    { id: 'fall2026-kids-friendsgiving', date: '2026-11-21', name: 'Mosaic Kids: Friendsgiving', description: 'Football and flowers.', visibility: 'public', colour: 'amber' },
    { id: 'fall2026-kids-christmas-party', date: '2026-12-05', name: 'Mosaic Kids: Christmas Party', visibility: 'public', colour: 'amber' },
    { id: 'fall2026-christmas-party', date: '2026-12-09', name: 'Mosaic Christmas Party', description: 'Run by Kirsten.', visibility: 'public', colour: 'rose' },
    { id: 'fall2026-youth-christmas-party', date: '2026-12-12', name: 'Mosaic Youth Christmas Party', visibility: 'public', colour: 'rose' },
    { id: 'fall2026-dibs-follow-up-3', date: '2026-12-13', name: 'DGroup Leader Follow Up', description: 'Over lunch.', visibility: 'member', colour: 'green' },
    {
        id: 'fall2026-christmas-eve-service', date: '2026-12-24',
        name: 'Christmas Eve Candlelight Service',
        // The sheet says "(Maybe)". Imported anyway — an Event that might happen
        // is easier to skip than to remember.
        description: 'Not settled yet.',
        visibility: 'public', colour: 'navy',
    },

    // ── Deadlines ────────────────────────────────────────────────────────────
    //
    // Not gatherings. No time, no Roles — a named day on the calendar is the
    // whole of what they are.
    { id: 'fall2026-dibs-leader-app-deadline', date: '2026-08-05', name: 'DGroup Leader Application Deadline', visibility: 'public', colour: 'green' },
    { id: 'fall2026-dibs-registration-deadline', date: '2026-08-30', name: 'DIBS Registration Deadline', visibility: 'public', colour: 'green' },

    // ── Context ──────────────────────────────────────────────────────────────
    //
    // On the sheet so the staff can plan around it, not because the church is
    // running it. All at `editor` and all in one colour, so it informs the
    // people doing the planning without filling the congregation's calendar.
    { id: 'fall2026-move-in-day', date: '2026-08-17', name: 'Move In Day', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-csisd-first-day', date: '2026-08-19', name: 'CSISD First Day of School', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-tamu-first-day', date: '2026-08-24', name: 'First Day of Class (TAMU / Blinn)', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-labor-day', date: '2026-09-07', name: 'Labor Day', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-halloween', date: '2026-10-31', name: 'Halloween', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-thanksgiving-day', date: '2026-11-26', name: 'Thanksgiving Day', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-christmas-day', date: '2026-12-25', name: 'Christmas Day', visibility: 'editor', colour: 'steel' },

    // Runs of days — the reason ADR 0024 exists. One Event each, not eleven.
    { id: 'fall2026-csisd-fall-break', date: '2026-10-12', endDate: '2026-10-13', name: 'CSISD Fall Break', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-csisd-thanksgiving-break', date: '2026-11-23', endDate: '2026-11-27', name: 'CSISD Thanksgiving Break', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-tamu-finals', date: '2026-12-07', endDate: '2026-12-10', name: 'TAMU Finals', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-camo-cwc', date: '2026-12-18', endDate: '2026-12-22', name: 'CAMO CWC Indianapolis', visibility: 'editor', colour: 'steel' },

    // Aggie home games. They move a Saturday's traffic and a Sunday's morning,
    // which is why the staff track them.
    { id: 'fall2026-game-mo-state', date: '2026-09-05', name: 'MO State @ TAMU', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-game-arizona-state', date: '2026-09-12', name: 'Arizona State @ TAMU', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-game-kentucky', date: '2026-09-19', name: 'Kentucky @ TAMU', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-game-arkansas', date: '2026-10-03', name: 'Arkansas @ TAMU', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-game-citadel', date: '2026-10-17', name: 'Citadel @ TAMU', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-game-tennessee', date: '2026-11-14', name: 'Tennessee @ TAMU', visibility: 'editor', colour: 'steel' },
    { id: 'fall2026-game-texas', date: '2026-11-27', name: 't.u. @ TAMU', visibility: 'editor', colour: 'steel' },
];

module.exports = { SERIES, EXPECTED, ONE_OFFS };
