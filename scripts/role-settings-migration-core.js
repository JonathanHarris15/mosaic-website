/**
 * Who a Role needs, its rules and its rest moved onto each Event that runs it
 * (ADR 0085). The pure plan behind scripts/migrate-role-settings-to-events.js.
 *
 * The COPY onto every series ran on production on 2026-11-21 and was retired
 * once the app stopped reading the Role's own copies; git history has it.
 * What is left is the STRIP: the old fields come off each Role Definition,
 * refused while any series still runs a Role it has no settings for.
 */

const Roles = require('../public/roles-core.js');
const Events = require('../public/events-core.js');

const OLD_ROLE_FIELDS = ['slots', 'nextSlotSeq', 'restrictions', 'intensity', 'allowsAnotherRole'];

/** @param {*} slug */
const isServant = slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1;

/**
 * Which old fields a Role Definition still carries.
 * @param {Record<string, *>} definition a stored Role
 * @return {string[]} the fields to delete
 */
function planRoleStrip(definition) {
    return OLD_ROLE_FIELDS.filter((/** @type {*} */ field) => definition && field in definition);
}

/**
 * Stripping is only safe once every series has its own settings for every
 * Servant Role it runs — otherwise that series would read a Role with no seats.
 * @param {Array<Record<string, *>>} seriesList every stored series
 * @param {Record<string, Record<string, *>>} definitionsBySlug every stored Role, by slug
 * @return {string[]} "seriesId/slug" for each one still reading the Role
 */
function unmigrated(seriesList, definitionsBySlug) {
    /** @type {string[]} */
    const out = [];
    (seriesList || []).forEach((/** @type {*} */ s) => (s.roleSlugs || []).filter(isServant).forEach((/** @type {*} */ slug) => {
        if (definitionsBySlug[slug] && !Events.roleSettingsOf(s, slug)) out.push(s.id + '/' + slug);
    }));
    return out;
}

module.exports = { OLD_ROLE_FIELDS, planRoleStrip, unmigrated };
