/**
 * @fileoverview Scripts the prod-ops GitHub Action may run.
 *
 * Keep `.github/workflows/prod-ops-script.yml` `inputs.script.options` in sync.
 */

/** @type {readonly string[]} */
const ALLOWLIST_SORTED = [
    'access-diff.js',
    'backfill-involvement-series.js',
    'backfill-name-parts.js',
    'backfill-occurrence-visibility.js',
    'backfill-relationship-types.js',
    'delete-legacy-households.js',
    'delete-legacy-membership-status.js',
    'delete-legacy-person-picker-fields.js',
    'delete-occurrence-role-slugs.js',
    'delete-shepherding-reminders.js',
    'diagnose-storage-fill-in-upload.js',
    'merge-duplicate-person.js',
    'migrate-booklet-text-to-occurrences.js',
    'migrate-baptism.js',
    'migrate-hymn-sheets-prefix.js',
    'migrate-inline-liturgy-elements.js',
    'migrate-meeting-mentions.js',
    'migrate-reminders-to-tasks.js',
    'migrate-service-dotted-keys.js',
    'ms-776-backfill-account-levels.js',
    'normalise-care-list-documents.js',
    'prayer-request-send-preview.js',
    'prayer-text-notifications-audit.js',
    'reset-prayer-send-attempt.js',
    'set-liturgy-order-flags.js',
    'sync-pastoral-prayer-dates.js',
    'textbelt-key-check.js',
    'textbelt-test-send.js',
];

const ALLOWLIST = new Set(ALLOWLIST_SORTED);

module.exports = {ALLOWLIST, ALLOWLIST_SORTED};
