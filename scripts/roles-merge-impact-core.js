/**
 * @fileoverview Who the Roles fixes in PR 346 (MS-811, MS-821, the Role
 * shape check) would change, worked out from stored documents alone.
 *
 * Pure: no Firestore. scripts/roles-merge-impact.js feeds it the live users,
 * people and roles documents. Every helper here mirrors a function in
 * firestore.rules by name, so a reader can hold the two side by side.
 *
 *   - MS-821: isEditor() (any one of five edit keys) used to be enough to
 *     delete a Person, change any field on one, and write serving history.
 *     After it, editsPeople() is: a rank of admin, elder, super_admin or
 *     pastoral_assistant, a preset editor with no saved map, or the
 *     directory.edit_identity key. Serving history also stays open to
 *     services.builder.edit and calendar.events.edit.
 *   - MS-811: the Roles callables only count an account as its Person when
 *     the link goes both ways (users.personId and people.userId).
 *   - Role shape: a Role that breaks roleShapeOk() can no longer be saved.
 */

'use strict';

const Levels = require('../public/account-levels-core.js');

/** The keys any one of which makes isEditor() true on a saved map. */
const EDIT_KEYS = Object.freeze([
    'directory.edit_identity',
    'printables.edit',
    'services.builder.edit',
    'roles.manager.edit',
    'hymns.edit',
]);

/** Keys reported beside the edit keys because a door after MS-821 names them. */
const REPORTED_KEYS = Object.freeze(EDIT_KEYS.concat(['calendar.events.edit']));

const ROLE_FIELDS = Object.freeze([
    'name', 'slug', 'family', 'slots', 'nextSlotSeq', 'restrictions',
    'intensity', 'allowsAnotherRole', 'description',
]);

/**
 * @typedef {Record<string, unknown>} Doc
 */

/**
 * @param {unknown} value
 * @returns {value is Doc}
 */
function isMap(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} perms
 * @param {string} key
 * @returns {boolean}
 */
function mapGrants(perms, key) {
    return isMap(perms) && (perms['system.super_admin'] === true || perms[key] === true);
}

/**
 * The preset an accountLevelId names, as the rules' presetGrants() reads it.
 * @param {unknown} levelId
 * @param {string} key
 * @returns {boolean}
 */
function presetGrants(levelId, key) {
    const preset = typeof levelId === 'string' ? Levels.presetKeyFromAccountLevelId(levelId) : null;
    if (!preset) return false;
    return Levels.buildPresetPermissions(preset)[key] === true;
}

/**
 * @param {unknown} perms
 * @returns {string}
 */
function rankFromMap(perms) {
    if (mapGrants(perms, 'system.super_admin')) return 'super_admin';
    if (mapGrants(perms, 'system.kiosk')) return 'kiosk';
    if (mapGrants(perms, 'shep.count_as_elder')) return 'elder';
    if (mapGrants(perms, 'visibility.lift_hidden_tags')) return 'pastoral_assistant';
    if (mapGrants(perms, 'admin.dashboard.access')) return 'admin';
    if (mapGrants(perms, 'directory.edit_identity') || mapGrants(perms, 'services.builder.edit')
        || mapGrants(perms, 'printables.edit')) return 'editor';
    if (mapGrants(perms, 'directory.view')) return 'member';
    return 'viewer';
}

/** @type {Record<string, string>} */
const RANK_FROM_LEVEL_ID = {
    level_super_admin: 'super_admin',
    level_kiosk: 'kiosk',
    level_elder: 'elder',
    level_pastoral_assistant: 'pastoral_assistant',
    level_admin: 'admin',
    level_editor: 'editor',
    level_member: 'member',
};

/**
 * @param {unknown} id
 * @returns {string}
 */
function rankFromLevelId(id) {
    return (typeof id === 'string' && RANK_FROM_LEVEL_ID[id]) || 'viewer';
}

/**
 * @param {Doc} user
 * @returns {string}
 */
function accessRank(user) {
    if (!('permissions' in user)) return rankFromLevelId(user.accountLevelId);
    return isMap(user.permissions) ? rankFromMap(user.permissions) : 'viewer';
}

/**
 * @param {Doc} user
 * @param {string} key
 * @returns {boolean}
 */
function keyOn(user, key) {
    return ('permissions' in user)
        ? mapGrants(user.permissions, key)
        : presetGrants(user.accountLevelId, key);
}

/**
 * @param {Doc} user
 * @param {string} key
 * @returns {boolean}
 */
function mapHas(user, key) {
    return ('permissions' in user) && mapGrants(user.permissions, key);
}

/**
 * @param {Doc} user
 * @returns {boolean}
 */
function isEditor(user) {
    return ['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'].includes(accessRank(user))
        || EDIT_KEYS.some((key) => mapHas(user, key));
}

/**
 * @param {Doc} user
 * @returns {boolean}
 */
function editsPeople(user) {
    const rank = accessRank(user);
    return ['admin', 'elder', 'super_admin', 'pastoral_assistant'].includes(rank)
        || (rank === 'editor' && !('permissions' in user))
        || keyOn(user, 'directory.edit_identity');
}

/**
 * The editor-wide doors on People an account loses with MS-821.
 * @param {Doc} user
 * @returns {string[]}
 */
function peopleLosses(user) {
    if (!isEditor(user)) return [];
    const losses = [];
    if (!editsPeople(user)) {
        losses.push('delete a Person');
        losses.push('edit any field on a Person (the serve counter and "Doesn\'t serve" stay)');
    }
    const keepsHistory = editsPeople(user) || keyOn(user, 'services.builder.edit')
        || keyOn(user, 'calendar.events.edit');
    if (!keepsHistory) {
        losses.push(keyOn(user, 'roles.manager.edit')
            ? 'write serving history (keeps only its own auto-assign seeds)'
            : 'write serving history');
    }
    return losses;
}

/**
 * @param {Doc} user
 * @returns {string[]}
 */
function reportedKeys(user) {
    return REPORTED_KEYS.filter((key) => keyOn(user, key));
}

/**
 * Why an account's link to its Person no longer counts (MS-811), or null.
 * @param {string} uid
 * @param {Doc} user
 * @param {Map<string, Doc>} people id -> people doc
 * @returns {?string}
 */
function linkProblem(uid, user, people) {
    const personId = user.personId;
    if (typeof personId !== 'string' || !personId) return null;
    const person = people.get(personId);
    if (!person) return 'points at a Person that does not exist';
    if (person.userId === uid) return null;
    if (typeof person.userId !== 'string' || !person.userId) {
        return 'its Person does not point back at any account';
    }
    return 'its Person points back at a different account';
}

/**
 * Why a stored Role fails roleShapeOk(), as a list of reasons.
 * @param {Doc} role
 * @returns {string[]}
 */
function roleShapeProblems(role) {
    const out = [];
    const name = role.name;
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) out.push('name missing or over 200 characters');
    if (role.family !== 'servant') out.push('family is not servant');
    const slots = role.slots;
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > 100) out.push('needs 1 to 100 slots');
    if ('slug' in role) {
        const slug = role.slug;
        if (typeof slug !== 'string' || slug.length > 120 || !/^[a-z0-9_]+$/.test(slug)) out.push('slug is not usable');
    }
    if ('nextSlotSeq' in role && !(Number.isInteger(role.nextSlotSeq) && Number(role.nextSlotSeq) >= 1)) {
        out.push('nextSlotSeq is not a whole number of at least 1');
    }
    if ('restrictions' in role && !(Array.isArray(role.restrictions) && role.restrictions.length <= 100)) {
        out.push('restrictions is not a list of at most 100');
    }
    if ('intensity' in role && role.intensity !== null
        && !(typeof role.intensity === 'number' && Number.isFinite(role.intensity) && role.intensity >= 0)) {
        out.push('intensity is not a number of at least 0');
    }
    if ('allowsAnotherRole' in role && typeof role.allowsAnotherRole !== 'boolean') {
        out.push('allowsAnotherRole is not true or false');
    }
    if ('description' in role && role.description !== null
        && !(typeof role.description === 'string' && role.description.length <= 600)) {
        out.push('description is over 600 characters');
    }
    return out;
}

/**
 * Fields on a stored Role that the shape check does not name. They may stay,
 * but no save may change them.
 * @param {Doc} role
 * @returns {string[]}
 */
function extraRoleFields(role) {
    return Object.keys(role).filter((key) => !ROLE_FIELDS.includes(key)).sort();
}

/**
 * @typedef {Object} ImpactReport
 * @property {number} users
 * @property {number} roles
 * @property {Array<{uid: string, level: string, rank: string, keys: string[], losses: string[]}>} people
 * @property {Array<{uid: string, problem: string}>} links
 * @property {Array<{id: string, slug: string, problems: string[]}>} badRoles
 * @property {Array<{id: string, slug: string, fields: string[]}>} extraFields
 */

/**
 * @param {Array<{id: string, data: Doc}>} users
 * @param {Array<{id: string, data: Doc}>} people
 * @param {Array<{id: string, data: Doc}>} roles
 * @returns {ImpactReport}
 */
function report(users, people, roles) {
    /** @type {Map<string, Doc>} */
    const peopleById = new Map(people.map((p) => [p.id, p.data]));
    /** @type {ImpactReport} */
    const out = {users: users.length, roles: roles.length, people: [], links: [], badRoles: [], extraFields: []};
    for (const {id, data} of users) {
        const losses = peopleLosses(data);
        if (losses.length) {
            out.people.push({
                uid: id.slice(0, 8),
                level: typeof data.accountLevelId === 'string' ? data.accountLevelId : '(none)',
                rank: accessRank(data),
                keys: reportedKeys(data),
                losses,
            });
        }
        const problem = linkProblem(id, data, peopleById);
        if (problem) out.links.push({uid: id.slice(0, 8), problem});
    }
    for (const {id, data} of roles) {
        const slug = typeof data.slug === 'string' ? data.slug : '(none)';
        const problems = roleShapeProblems(data);
        if (problems.length) out.badRoles.push({id, slug, problems});
        const fields = extraRoleFields(data);
        if (fields.length) out.extraFields.push({id, slug, fields});
    }
    out.people.sort((a, b) => a.uid.localeCompare(b.uid));
    out.links.sort((a, b) => a.uid.localeCompare(b.uid));
    return out;
}

/**
 * @param {ImpactReport} r
 * @returns {string}
 */
function formatText(r) {
    const lines = ['Roles fixes (PR 346) impact, read-only', 'users: ' + r.users + '  roles: ' + r.roles, ''];
    lines.push('MS-821: accounts that lose an editor door on People: ' + r.people.length);
    for (const row of r.people) {
        lines.push('  uid:' + row.uid + '  level=' + row.level + '  rank=' + row.rank
            + '  keys=' + (row.keys.join(',') || '(none)'));
        lines.push('    loses: ' + row.losses.join('; '));
    }
    lines.push('');
    lines.push('MS-811: accounts whose Person link no longer counts: ' + r.links.length);
    for (const row of r.links) lines.push('  uid:' + row.uid + '  ' + row.problem);
    lines.push('');
    lines.push('Role shape: stored Roles that could no longer be saved: ' + r.badRoles.length);
    for (const row of r.badRoles) lines.push('  ' + row.id + ' (' + row.slug + '): ' + row.problems.join('; '));
    lines.push('Role shape: stored Roles with fields a save may not change: ' + r.extraFields.length);
    for (const row of r.extraFields) lines.push('  ' + row.id + ' (' + row.slug + '): ' + row.fields.join(', '));
    lines.push('');
    return lines.join('\n');
}

module.exports = {
    EDIT_KEYS,
    ROLE_FIELDS,
    accessRank,
    keyOn,
    isEditor,
    editsPeople,
    peopleLosses,
    linkProblem,
    roleShapeProblems,
    extraRoleFields,
    report,
    formatText,
};
