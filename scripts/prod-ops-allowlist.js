/**
 * @fileoverview Scripts the prod-ops GitHub Action may run.
 *
 * Keep `.github/workflows/prod-ops-script.yml` `inputs.script.options` in sync.
 */

/** @type {readonly string[]} */
const ALLOWLIST_SORTED = [
    'access-diff.js',
    'backfill-occurrence-visibility.js',
    'delete-legacy-person-picker-fields.js',
    'delete-shepherding-reminders.js',
    'diagnose-storage-fill-in-upload.js',
    'merge-duplicate-person.js',
    'migrate-hymn-sheets-prefix.js',
    'migrate-meeting-mentions.js',
    'migrate-reminders-to-tasks.js',
    'ms-776-backfill-account-levels.js',
    'reset-prayer-send-attempt.js',
    'set-liturgy-order-flags.js',
    'sync-pastoral-prayer-dates.js',
    'textbelt-test-send.js',
];

const ALLOWLIST = new Set(ALLOWLIST_SORTED);

module.exports = {ALLOWLIST, ALLOWLIST_SORTED};
