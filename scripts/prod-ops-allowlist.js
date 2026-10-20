/**
 * @fileoverview Scripts the prod-ops GitHub Action may run.
 *
 * Keep `.github/workflows/prod-ops-script.yml` `inputs.script.options` in sync.
 */

/** @type {readonly string[]} */
const ALLOWLIST_SORTED = [
    'set-liturgy-order-flags.js',
    'migrate-hymn-sheets-prefix.js',
];

const ALLOWLIST = new Set(ALLOWLIST_SORTED);

module.exports = {ALLOWLIST, ALLOWLIST_SORTED};
