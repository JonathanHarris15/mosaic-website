/**
 * @fileoverview Scripts the prod-ops GitHub Action may run.
 *
 * Keep `.github/workflows/prod-ops-script.yml` `inputs.script.options` in sync.
 */

/** @type {readonly string[]} */
const ALLOWLIST_SORTED = [
    'set-liturgy-order-flags.js',
    'migrate-hymn-sheets-prefix.js',
    'textbelt-test-send.js',
    'reset-prayer-send-attempt.js',
  'migrate-legacy-oos-prayer-carriers.js',
  'delete-legacy-oos-prayer-fields.js',
  'merge-duplicate-person.js',
  'diagnose-storage-fill-in-upload.js',
  'migrate-booklet-text-to-occurrences.js',
];

const ALLOWLIST = new Set(ALLOWLIST_SORTED);

module.exports = {ALLOWLIST, ALLOWLIST_SORTED};
