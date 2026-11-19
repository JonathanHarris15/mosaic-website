/**
 * Who a Role needs, its rules and its rest move onto each Event that runs it
 * (ADR 0085). The pure plan behind scripts/migrate-role-settings-to-events.js.
 *
 * Two phases, run in this order:
 *
 *   1. COPY  — every series gets its own `roleSettings[slug]` for every Servant
 *              Role it runs, from that Role's stored values, in the new rule
 *              shape: per-seat sexes become one line-up rule, person rules one
 *              OR rule, team rules a rule each. A series that already has its
 *              own settings keeps them, converted to the new shape. Its rules
 *              across Roles are converted to the OR shape too.
 *   2. STRIP — the old fields come off each Role Definition. Refused while any
 *              series still runs a Role it has no settings for.
 *
 * Slot ids are kept throughout: an Assignment names its seat by id.
 */

const Roles = require('../public/roles-core.js');
const Events = require('../public/events-core.js');
const RoleRules = require('../public/role-rules-core.js');

const OLD_ROLE_FIELDS = ['slots', 'nextSlotSeq', 'restrictions', 'intensity', 'allowsAnotherRole'];

const isServant = slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The new-shape settings for one Role on one series.
function settingsFor(series, definition) {
    const role = Events.effectiveRole(series, definition);
    return RoleRules.settingsFrom(RoleRules.formFrom(role), role);
}

/**
 * @param {Object} series the stored series (with `id`)
 * @param {Object<string, Object>} definitionsBySlug every stored Role, by slug
 * @return {{ roleSettings: Object, crossRoleRules: Array, changed: boolean,
 *            seeded: string[], converted: string[], missing: string[] }}
 */
function planSeries(series, definitionsBySlug) {
    const s = series || {};
    const before = s.roleSettings || {};
    const roleSettings = {};
    const seeded = [];
    const converted = [];
    const missing = [];

    (s.roleSlugs || []).filter(isServant).forEach(slug => {
        const def = definitionsBySlug[slug];
        if (!def) {
            // A Role the series names but nobody defines: nothing to copy, and
            // its own settings (if any) are kept as they are.
            if (before[slug]) roleSettings[slug] = before[slug];
            missing.push(slug);
            return;
        }
        roleSettings[slug] = settingsFor(s, Object.assign({ slug: slug }, def));
        if (!before[slug]) seeded.push(slug);
        else if (!same(before[slug], roleSettings[slug])) converted.push(slug);
    });

    const crossRoleRules = RoleRules.crossRulesFrom(RoleRules.crossFormsFrom(s.crossRoleRules || []));
    const changed = !same(before, roleSettings) || !same(s.crossRoleRules || [], crossRoleRules);
    return { roleSettings, crossRoleRules, changed, seeded, converted, missing };
}

/**
 * Which old fields a Role Definition still carries.
 * @param {Object} definition a stored Role
 * @return {string[]} the fields to delete
 */
function planRoleStrip(definition) {
    return OLD_ROLE_FIELDS.filter(field => definition && field in definition);
}

/**
 * Stripping is only safe once every series has its own settings for every
 * Servant Role it runs — otherwise that series would read a Role with no seats.
 * @param {Array<Object>} seriesList every stored series
 * @param {Object<string, Object>} definitionsBySlug every stored Role, by slug
 * @return {string[]} "seriesId/slug" for each one still reading the Role
 */
function unmigrated(seriesList, definitionsBySlug) {
    const out = [];
    (seriesList || []).forEach(s => (s.roleSlugs || []).filter(isServant).forEach(slug => {
        if (definitionsBySlug[slug] && !Events.roleSettingsOf(s, slug)) out.push(s.id + '/' + slug);
    }));
    return out;
}

module.exports = { OLD_ROLE_FIELDS, planSeries, planRoleStrip, unmigrated };
