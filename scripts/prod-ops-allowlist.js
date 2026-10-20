/**
 * @fileoverview Scripts the prod-ops GitHub Action may run.
 *
 * Keep `.github/workflows/prod-ops-script.yml` `inputs.script.options` in sync.
 */

/** @type {readonly string[]} */
const ALLOWLIST_SORTED = [
    'set-liturgy-order-flags.js',
    // MS-769: add hymn-sheet migration script here, e.g. 'migrate-hymn-sheets.js',
];

const ALLOWLIST = new Set(ALLOWLIST_SORTED);

module.exports = {ALLOWLIST, ALLOWLIST_SORTED};
