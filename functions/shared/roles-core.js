// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/roles-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Roles Core — the pure model for Roles (ADR-0016, MS-13).
//
// All serving participation is a Role, recorded as Involvement. Roles come in
// two families:
//
//   • liturgical — preacher, service leader, worship leader… Code-defined and
//                  LOCKED: undeletable, uneditable, and still wired into the
//                  Service entity and the Service Guide. They have no editable
//                  definition. (The registry lands in MS-25.)
//   • servant    — kids, setup/teardown, coffee, sound… Authored by an editor
//                  in the Roles Manager as a Role Definition.
//
// A Role Definition is name + ordered slots + restriction rules (MS-24). Each
// slot requires male, female, or either; needing three people means three
// slots. The slot — not a count beside a sex rule — is the unit of assignment,
// so a specific person can be pinned to a specific slot.
//
// Slot ids are stable and never re-issued. An assignment points at a slot id,
// so recycling one would silently inherit the previous slot's person.
//
// Loaded as a classic <script> (window.RolesCore) and exported for Node tests.

(function (global) {
    'use strict';

    // ── The two families ──────────────────────────────────────────────────────

    const FAMILIES = Object.freeze({
        LITURGICAL: 'liturgical',
        SERVANT: 'servant',
    });

    // ── The locked, code-defined liturgical Roles ─────────────────────────────
    //
    // These five are the `type` values the app already writes as Involvement.
    // They stay locked (ADR-0016 §1, Option A): unifying the CONCEPT of a Role
    // costs nothing, but making these editable data would mean rebuilding the
    // Service entity and the Service Guide component system — destabilising the
    // artefact that has to print correctly every Sunday.
    //
    // The names are user-facing strings the guide and calendar already render.
    // Changing one here silently changes the printed booklet.
    const LITURGICAL_ROLES = Object.freeze([
        { slug: 'service_leader', name: 'Service Leader' },
        { slug: 'preacher', name: 'Preacher' },
        { slug: 'worship_leader', name: 'Music Leader' },
        { slug: 'worship_helper', name: 'Music Helper' },
        { slug: 'prayer', name: 'Prayer' },
    ].map(role => Object.freeze(Object.assign({}, role, {
        family: FAMILIES.LITURGICAL,
        locked: true,
    }))));

    const LITURGICAL_SLUGS = Object.freeze(LITURGICAL_ROLES.map(r => r.slug));

    // A Role is locked when it is one of the code-defined liturgical ones. Locked
    // Roles have no editable definition — no slots, no restrictions — because
    // they are assigned through the Service entity, as they always have been.
    function isLocked(role) {
        return !!role && (role.locked === true || role.family === FAMILIES.LITURGICAL);
    }

    function assertEditable(role) {
        if (isLocked(role)) {
            throw new Error(
                'Role "' + ((role && role.name) || '?') + '" is locked: liturgical Roles are ' +
                'code-defined and cannot be edited.'
            );
        }
    }

    function assertDeletable(role) {
        if (isLocked(role)) {
            throw new Error(
                'Role "' + ((role && role.name) || '?') + '" is locked: liturgical Roles are ' +
                'always present and cannot be deleted.'
            );
        }
    }

    // Involvement records a Role by slug, so a Servant Role needs one too. It is
    // derived from the name ONCE, at creation, and then stored — renaming the
    // Role afterwards must not change the slug, or every Involvement record
    // already written under the old one would be orphaned.
    // ⚠ A SLUG IS NEVER EMPTY (MS-822). It used to keep a-z and 0-9 and drop
    // everything else, so "Música" became "m_sica", "Café" collided with
    // "Caf", and a Role named in another script got no slug at all: every
    // callable then refused it. Accents are now folded ("musica", "cafe"), and
    // a name with no Latin letters left gets a short, stable id built from the
    // name itself, so the same name always gives the same slug and two
    // different ones do not meet. ASCII names slug exactly as before.
    function slugify(name) {
        const raw = String(name || '').trim();
        const folded = raw.normalize ? raw.normalize('NFD') : raw;
        const slug = folded
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        if (slug || !raw) return slug;
        return 'role_' + nameHash(raw);
    }

    // FNV-1a over the name's UTF-16 units, in base 36. Not for security: only
    // so a fallback slug is short, ASCII, and the same every time.
    /**
     * @param {string} text
     * @returns {string}
     */
    function nameHash(text) {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(36);
    }

    const slugOf = def => (def && def.slug) || slugify(def && def.name);

    // Every Role that exists, both families, liturgical first. This is the single
    // list the Roles Manager and the Roles tab render — the whole point of
    // Option A is that the user sees one roles list, not two.
    function allRoles(servantDefinitions) {
        const servant = (servantDefinitions || []).map(def => {
            const slug = slugOf(def);
            if (LITURGICAL_SLUGS.indexOf(slug) !== -1) {
                throw new Error(
                    'Servant Role "' + def.name + '" would take the liturgical slug "' + slug +
                    '", which would mix its Involvement history with the liturgical Role\'s.'
                );
            }
            return Object.assign({}, def, { slug: slug, family: FAMILIES.SERVANT, locked: false });
        });
        return LITURGICAL_ROLES.concat(servant);
    }

    function roleBySlug(slug, servantDefinitions) {
        return allRoles(servantDefinitions).find(role => role.slug === slug) || null;
    }

    // The stored Role Definitions, resolved the ONE way every reader must
    // agree on — the browser and the functions alike. A slug is what an
    // Assignment, a cover entry, a Trade and a serve record name a Role by, so
    // two readers that turn a document into a slug differently are two readers
    // that disagree about which Role a place is in.
    //
    //   • A definition stored without a slug reads as its name slugified
    //     (`slugOf`) — the server used to need a stored one and found nothing.
    //   • Two definitions that read as one slug are AMBIGUOUS, and resolve to
    //     nothing rather than to whichever came back first: judging a take
    //     against another Role's slots and rules is worse than refusing it.
    //   • One that takes a liturgical slug is quarantined, never served as the
    //     liturgical Role and never thrown about (allRoles throws, on purpose,
    //     for the page that renders the list; a reader just needs an answer).
    /**
     * @param {Array<Record<string, *>>} docs Stored definitions, as `{ id, ...doc }`.
     */
    function registry(docs) {
        /** @type {Record<string, Array<Record<string, *>>>} */
        const bySlug = {};
        /** @type {Array<Record<string, *>>} */
        const quarantined = [];
        (docs || []).forEach(def => {
            if (!def) return;
            const slug = slugOf(def);
            if (!slug) return;
            if (LITURGICAL_SLUGS.indexOf(slug) !== -1) {
                quarantined.push(Object.assign({}, def, { slug: slug }));
                return;
            }
            (bySlug[slug] = bySlug[slug] || []).push(Object.assign({}, def, {
                slug: slug, family: FAMILIES.SERVANT, locked: false,
            }));
        });
        const duplicates = Object.keys(bySlug).filter(slug => bySlug[slug].length > 1).sort();
        /** @param {string} slug */
        const find = slug => {
            const found = bySlug[slug];
            return found && found.length === 1 ? found[0] : null;
        };
        return {
            duplicates: duplicates,
            quarantined: quarantined,
            /** @param {string} slug */
            isAmbiguous: slug => duplicates.indexOf(slug) !== -1,
            // The servant definition a slug names, or null — gone, or
            // ambiguous.
            find: find,
            // The human name for any slug: liturgical, servant, or null.
            /** @param {string} slug */
            nameOf: slug => {
                const liturgical = LITURGICAL_ROLES.find((/** @type {*} */ r) => r.slug === slug);
                if (liturgical) return liturgical.name;
                const def = find(slug);
                return (def && def.name) || null;
            },
        };
    }

    // ── Slot identity ─────────────────────────────────────────────────────────

    // ── Reading a definition ──────────────────────────────────────────────────

    const slotsOf = def => (def && Array.isArray(def.slots) ? def.slots : []);

    // How many people this Role needs: one per slot.
    function slotCount(def) {
        return slotsOf(def).length;
    }

    // ── Building a definition ─────────────────────────────────────────────────

    // A fresh Servant Role Definition: named, with a single either-slot so it is
    // valid the moment it is created and the editor can narrow it from there.
    function newDefinition(name) {
        return {
            name: name,
            slug: slugify(name),
            family: FAMILIES.SERVANT,
            // Who it needs, its rules and its rest are each Event's (ADR 0085):
            // an Event that adds this Role gives it its own settings then.
            description: '',
        };
    }

    // ── What the job actually is (MS-222) ────────────────────────────────────
    //
    // A Role's name is a label — "Setup", "Kids Helper" — and a label is not an
    // answer to "what am I meant to do?". The description is that answer, in
    // the editor's own words, written once on the Role and read wherever
    // somebody is looking at a place they hold.
    //
    // Deliberately ONE field of plain prose, not a checklist or a set of
    // instructions with their own model. The moment it has structure it needs a
    // screen of its own, and the thing worth having is the sentence a Role's
    // organiser would say if you asked them in the corridor.
    //
    // Absent and empty read the same — there is nothing to show — so no surface
    // has to tell the two apart.
    const MAX_DESCRIPTION = 600;

    function descriptionOf(role) {
        const text = role && typeof role.description === 'string'
            ? role.description.trim() : '';
        return text || null;
    }

    // ── Restrictions: who may fill a slot ─────────────────────────────────────
    //
    // Rules are written against data that already exists — Shepherding Tags and
    // the Relationship graph — so a church configures serving with the same
    // vocabulary it already uses for everything else.

    const RESTRICTIONS = Object.freeze({
        REQUIRE_TAG: 'requireTag',          // only people carrying the Tag
        EXCLUDE_TAG: 'excludeTag',          // nobody carrying the Tag
        NOT_TOGETHER: 'notTogether',        // no two people joined by a Relationship Type
        NOT_SAME_GROUP: 'notSameGroup',     // no two people from one Relationship Group
        SAME_GROUP: 'sameGroup',            // everyone from ONE Relationship Group
        ALLOWLIST: 'allowlist',             // only these named people
        // Rules that can say OR. An `anyOf` is a set of OPTIONS — any one will
        // do — each a list of conditions that must all hold. The conditions are
        // the kinds above, plus two that only make sense inside one:
        ANY_OF: 'anyOf',                    // { options: [{ conditions: [cond, …] }, …] }
        SEX: 'sex',                         // { sex: 'male' | 'female' } — this person
        LINEUP: 'lineup',                   // { sexes: [...], roleSlug? } — the team, unordered
        AT_LEAST_TAGGED: 'atLeastTagged',   // { tagId, atLeast } — the team has at least n tagged
    });

    // The marks a line-up is written in. "either" takes anybody.
    const LINEUP_MARKS = ['male', 'female', 'either'];

    // ── Must, or Try to ──────────────────────────────────────────────────────
    //
    // A rule is MUST unless it says otherwise: nobody is offered a place it
    // refuses, the solve never breaks it, and an editor who breaks it by hand
    // is warned. A TRY rule is a preference — it refuses nobody and warns
    // nobody, and the solve breaks it rather than leave a place empty. What it
    // does do is count: every eligible candidate says how many Try rules they
    // would break (`misses`), and the solve fills with the fewest.
    const STRENGTHS = Object.freeze({ MUST: 'must', TRY: 'try' });
    /** @param {Record<string, *>} rule */
    const isTry = rule => !!rule && rule.strength === STRENGTHS.TRY;

    // ── The two Group Types the Membership Directory answers ─────────────────
    //
    // "No two people from the same Family" is not an arbitrary grouping somebody
    // has to invent in Manage Tags and Relationships — it is the household
    // record an editor already keeps. So these two ids are RESERVED, always
    // available, and never need sharing.
    //
    // ⚠ The membership behind them is projected by `FamilyCore.servingGroups`,
    // which stamps these same ids. Two modules, one pair of strings, held
    // together by a test — the same arrangement as `inGroup` and `belongsTo`.
    const DIRECTORY_GROUP_TYPES = Object.freeze([
        Object.freeze({ id: 'family', name: 'Family', kind: 'group', sharedWithEditors: true }),
        Object.freeze({ id: 'marriage', name: 'Marriage', kind: 'group', sharedWithEditors: true }),
    ]);

    // Why somebody was passed over. The Roles tab and auto-assign both have to
    // explain themselves, so ineligibility is always a reason, never a silent
    // omission from the list.
    const REASONS = Object.freeze({
        INACTIVE: 'inactive',
        // The one reason a PERSON authored rather than the church (MS-188). It
        // behaves like any other here — shown, and the editor may place them
        // anyway — but it is worded as their own words wherever it is drawn,
        // because overruling a rule is judgement and overruling "Sarah said
        // she's away" is disbelief.
        //
        // The asymmetry that matters falls out of putting it here: FAIRNESS AND
        // AUTO-ASSIGN ONLY EVER SEAT `eligible` PEOPLE, so a solve treats this
        // as an absolute no while a human keeps the final word. A program
        // placing somebody who said they would not be there is indefensible in
        // a way a person knowingly doing it is not.
        AWAY: 'away',
        ALREADY_ASSIGNED: 'alreadyAssigned',
        SERVING_ELSEWHERE: 'servingElsewhere',          // holding another Role at this Event
        SEX_MISMATCH: 'sexMismatch',
        SEX_UNKNOWN: 'sexUnknown',
        MISSING_REQUIRED_TAG: 'missingRequiredTag',
        EXCLUDED_BY_TAG: 'excludedByTag',
        NOT_ON_ALLOWLIST: 'notOnAllowlist',             // this Role is kept to a named few
        RELATIONSHIP_CONFLICT: 'relationshipConflict',
        SAME_GROUP_CONFLICT: 'sameGroupConflict',       // already someone here from their group
        // The two cross-Role reasons (MS-221). Named apart from the two above
        // because the conflict is with somebody in a DIFFERENT Role, and a
        // message that does not say which Role sends the editor hunting across
        // a rota for the person they have never been told about.
        PAIRED_ROLE_CONFLICT: 'pairedRoleConflict',     // shares a group with whoever holds the paired Role
        NOT_IN_PAIRED_GROUP: 'notInPairedGroup',        // must share one with them, and does not
        NOT_IN_REQUIRED_GROUP: 'notInRequiredGroup',    // not in the group this Role is drawn from
        // The team would no longer fit any line-up the rules allow.
        LINEUP_MISMATCH: 'lineupMismatch',
        // An OR rule with several options, and this person fits none of them.
        NO_OPTION_FITS: 'noOptionFits',
        // The team could no longer reach "at least n tagged X".
        TOO_FEW_TAGGED: 'tooFewTagged',
        // Only a whole-roster answer can produce these two: nobody can be
        // offered a Role or a place that has since stopped existing, but a
        // roster written last month can certainly still name one.
        UNKNOWN_ROLE: 'unknownRole',
        UNKNOWN_SLOT: 'unknownSlot',
    });

    // ── How much rest a Role owes the person who does it ─────────────────────
    //
    // Measured in WEEKS (ADR-0020). Sound is 1 — every week is fine. Setup is 4
    // — a month before asking again. Coffee is 1.25: nearly every week, with the
    // occasional break. Fairness sums these over its window, which is why load
    // comes out in the same unit as the window and "spent" needs no constant.
    //
    // 0 is a real value, not an absent one: the job is free. It still counts as
    // serving and still moves the person's recency — it just never makes them
    // look busy.
    //
    // Only a Servant Role keeps its intensity here. A liturgical Role has no
    // stored definition and must never have one, and a one-off Role has no
    // definition at all — both are resolved by EventsCore, which can see the
    // series and the Event.
    const DEFAULT_INTENSITY = 1;

    // A stored value that is not a usable number reads as the default. A single
    // bad field must not poison every load calculation in the church.
    function isUsableIntensity(raw) {
        return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
    }

    function intensityOf(def) {
        const raw = def && def.intensity;
        return isUsableIntensity(raw) ? raw : DEFAULT_INTENSITY;
    }

    // ── Whether doing a Role uses up your morning ────────────────────────────
    //
    // EXCLUSIVE IS THE DEFAULT AND THE ASSUMPTION. An absent flag means the Role
    // occupies you, because the Role nobody has thought about must not quietly
    // double-book people.
    //
    // Distinct from intensity, and the two are easy to confuse: intensity says
    // this job TIRES you, exclusivity says this job OCCUPIES you. Sound is
    // plausibly intensity 1 and exclusive — easy work, but you are stuck at the
    // desk all morning.
    function allowsAnotherRole(role) {
        return !!role && role.allowsAnotherRole === true;
    }

    // The most Roles one person may hold at one Event, and only when every one
    // of them permits it.
    const MAX_ROLES_PER_PERSON = 2;

    // An Inactive Person carries no Membership Stage and is off the Track, so
    // they are never proposed — while every Involvement record they already have
    // stays exactly as it was. Reads the current flag and the status value it
    // replaced, so eligibility is right before every record is migrated.
    function isInactive(person) {
        const m = (person && person.membership) || {};
        return m.inactive === true;
    }

    // Somebody the church does not put on a rota: a small child, somebody very
    // frail, somebody in a season of not serving. It says nothing about who they
    // are and nothing about whether anyone may see them — only that no Role is
    // ever offered to them.
    //
    // ⚠ A FACT ABOUT THE PERSON, NOT ABOUT A ROLE, which is what makes it a
    // field on the record rather than a list on a Role Definition. A Role's
    // allowlist answers "who may do THIS"; this answers "who does none of it",
    // and copying that answer onto every Role is how the two go out of step.
    function doesNotServe(person) {
        return !!(person && person.doesNotServe);
    }

    // ── Doesn't serve, for a whole tag or group (ADR 0086) ───────────────────
    //
    // Stored once for the church in serving_settings/church. Everybody carrying
    // one of the tags, or leading or in one of the groups, is a Non-server —
    // now and whenever they join later. Like a Person's own mark it hides
    // nobody and applies to every viewer: it is not a privacy rule.
    const NON_SERVING_DOC = Object.freeze({ collection: 'serving_settings', id: 'church' });

    /** @param {?Record<string, *>} stored @returns {{ tagIds: string[], groupIds: string[] }} */
    function nonServingSetting(stored) {
        const s = stored || {};
        const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []);
        return { tagIds: list(s.doesNotServeTagIds), groupIds: list(s.doesNotServeGroupIds) };
    }

    // The ids of everyone a setting takes out. A group this account cannot read
    // is simply not in `groups`, so it takes nobody out rather than everybody.
    /** @param {Array<Record<string, *>>} people @param {{ tagIds?: string[], groupIds?: string[] } | null | undefined} setting @param {Array<Record<string, *>> | undefined} groups @returns {Set<string>} */
    function nonServingIds(people, setting, groups) {
        const tagIds = (setting && setting.tagIds) || [];
        const groupIds = (setting && setting.groupIds) || [];
        const out = new Set();
        if (!tagIds.length && !groupIds.length) return out;
        (people || []).forEach(p => {
            if (p && ((p.tags) || []).some(t => tagIds.indexOf(t) !== -1)) out.add(p.id);
        });
        (groups || []).filter(g => g && groupIds.indexOf(g.id) !== -1).forEach(g => {
            if (g.leaderId) out.add(g.leaderId);
            (g.memberIds || []).forEach(id => out.add(id));
        });
        return out;
    }

    // Who one tag or group covers, for the page to count and name.
    /** @param {Array<Record<string, *>>} people @param {{ kind: string, id: string }} entry @param {Array<Record<string, *>> | undefined} groups @returns {Array<Record<string, *>>} */
    function coveredByNonServing(people, entry, groups) {
        const setting = entry && entry.kind === 'group'
            ? { tagIds: [], groupIds: [entry.id] }
            : { tagIds: [entry && entry.id], groupIds: [] };
        const ids = nonServingIds(people, setting, groups);
        return (people || []).filter(p => p && ids.has(p.id));
    }

    // ── Who may even be offered ──────────────────────────────────────────────
    //
    // DISTINCT FROM ELIGIBILITY, and the difference is the whole design of the
    // picker. An ineligible Person is SHOWN, blocked, with a reason — seeing who
    // was passed over is the point. These three are not that:
    //
    //   • Somebody no longer active has left. They are not a candidate who lost,
    //     they are not a candidate, and a blocked row for them is an answer to a
    //     question nobody asked.
    //   • Somebody who does not serve is the same: there is no Role they might
    //     have had, so there is nothing for a reason to explain.
    //   • Somebody hidden by a tag must not appear AT ALL. A blocked row saying
    //     why they cannot serve still prints the name the tag exists to hide,
    //     which is the tag failing at the one job it has.
    //
    // `hidingTags` are the tag ids whose `people_tags` document carries
    // `hidePeople: true`. Elders and super admins are who those tags hide people
    // FROM everyone else for, so they still see them. A Pastoral Assistant
    // reads as an elder, so they see them too (MS-426).
    function access() {
        if (typeof AccessCore !== 'undefined') return AccessCore;
        if (typeof require === 'function') return require('./access-core.js');
        return null;
    }

    function seesHidden(rank) {
        const Access = access();
        if (!Access) return false;
        return Access.liftsHidden(rank);
    }

    // The tags themselves can be hidden, separately from the people they carry.
    // `hiddenFromOthers` is an elder saying the TAG is theirs — its name is the
    // private thing, so a picker that offers "Under Church Discipline" as a
    // serving rule has already told the editor it exists, whoever ends up
    // tagged. Same bypass as above: elders and super admins are who it is kept
    // from everyone else FOR.
    function visibleTags(tags, rank) {
        if (seesHidden(rank)) return (tags || []).slice();
        return (tags || []).filter(tag => !(tag && tag.hiddenFromOthers));
    }

    function assignablePeople(people, options) {
        const opts = options || {};
        const hiding = opts.hidingTags || [];
        const seesHiddenPeople = seesHidden(opts.account || opts.rank);
        const notServing = nonServingIds(people, opts.nonServing, opts.groups);

        return (people || []).filter(person => {
            if (isInactive(person)) return false;
            // The whole-tag and whole-group Non-servers, for the same reason as
            // the Person's own mark below and on the same side of the bypass.
            if (person && notServing.has(person.id)) return false;
            // ⚠ ABOVE THE ELDER BYPASS. That bypass exists because those tags
            // hide people FROM everyone else for elders — a privacy rule. This
            // is not one. A four-year-old is not offered for coffee to an elder
            // either.
            if (doesNotServe(person)) return false;
            if (seesHiddenPeople) return true;
            if (person && person.shepherdingHidden) return false;
            return !((person && person.tags) || []).some(tag => hiding.indexOf(tag) !== -1);
        });
    }

    function carriesTag(person, tagId) {
        return ((person && person.tags) || []).indexOf(tagId) !== -1;
    }

    // Is there an edge of this Relationship Type between the two? Edges are
    // stored one way round (`fromId` is the priority holder), but "may not serve
    // together" is symmetric, so both orientations count.
    /**
     * @typedef {{typeId: string, fromId: string, toId: string}} RelEdge
     *   One stored Relationship edge.
     * @typedef {{id: string, typeId: string, name?: string, leaderId?: ?string, memberIds?: string[]}} RelGroup
     *   One Relationship Group.
     */
    /**
     * @param {?RelEdge[] | undefined} relationships
     * @param {string} typeId
     * @param {string} a
     * @param {string} b
     * @param {Set<string>} [index] `edgeIndex(relationships)`.
     * @returns {boolean}
     */
    function joinedBy(relationships, typeId, a, b, index) {
        // `index`, when given, is `edgeIndex(relationships)` (MS-814).
        if (index) return index.has(typeId + '\u0000' + a + '\u0000' + b);
        return (relationships || []).some(edge => (
            edge.typeId === typeId && (
                (edge.fromId === a && edge.toId === b) ||
                (edge.fromId === b && edge.toId === a)
            )
        ));
    }

    // Every edge, both ways round, keyed for a constant-time lookup. Built
    // once per judging call (MS-814): a large church has thousands of edges
    // and each candidate was checked against all of them for every seat.
    //
    // Cached on the list itself, since the solve hands the same church's list
    // to every call. The length is checked so a list grown in place is rebuilt.
    const EDGE_INDEX = new WeakMap();
    /**
     * @param {RelEdge[]} relationships
     * @returns {Set<string>}
     */
    function edgeIndex(relationships) {
        const cached = EDGE_INDEX.get(relationships);
        if (cached && cached.length === relationships.length) return cached.index;
        const index = new Set();
        (relationships || []).forEach(edge => {
            if (!edge) return;
            index.add(edge.typeId + '\u0000' + edge.fromId + '\u0000' + edge.toId);
            index.add(edge.typeId + '\u0000' + edge.toId + '\u0000' + edge.fromId);
        });
        EDGE_INDEX.set(relationships, { length: relationships.length, index: index });
        return index;
    }

    // ── Relationship Group membership (MS-141) ────────────────────────────────
    //
    // A Relationship Group is a roster: { id, typeId, name, leaderId, memberIds }.
    //
    // The LEADER IS NOT IN `memberIds` — deliberately, since the Relations Viewer
    // draws them outside the bubble with a line to it (ADR-0014 §5). So the
    // obvious memberIds check silently misses every group leader, and for serving
    // that is the worst way to be wrong: the house-group leader would read as
    // being in no group, and a same-group rule would exclude the very person most
    // likely to be organising the Role.
    //
    // RelationshipGroupCore.belongsTo answers this already, but the *-core modules
    // here are deliberately independent of one another, so the rule is restated.
    // A test asserts the two agree, precisely because a duplicated domain rule is
    // a rule that can drift.
    function inGroup(group, personId) {
        if (!group || !personId) return false;
        if (group.leaderId === personId) return true;
        const members = group.memberIds || [];
        // A Set per member list, built once (MS-814). The judge asks this for
        // every candidate against every group, so a scan of the list each time
        // made a large church quadratic. Keyed on the list itself, so a group
        // whose members change gets a new list and a new Set.
        // The length is checked too, so a list pushed to in place is rebuilt.
        let cached = MEMBER_SETS.get(members);
        if (!cached || cached.length !== members.length) {
            cached = { length: members.length, set: new Set(members) };
            MEMBER_SETS.set(members, cached);
        }
        return cached.set.has(personId);
    }
    const MEMBER_SETS = new WeakMap();

    // Every group each Person is in (MS-814). Built once per judging call and
    // carried on the context, so a large church is not scanned group by group
    // for every candidate. Built walking the groups in order, so each person's
    // list keeps the groups' own order.
    //
    // Cached on the list the same way; the stamp counts members too, so a
    // group gaining somebody in place is picked up.
    const GROUP_INDEX = new WeakMap();
    /**
     * @param {RelGroup[]} groups
     * @returns {Map<string, RelGroup[]>}
     */
    function groupIndex(groups) {
        let members = 0;
        groups.forEach(g => { members += (g && g.memberIds) ? g.memberIds.length : 0; });
        const stamp = groups.length + ':' + members;
        const cached = GROUP_INDEX.get(groups);
        if (cached && cached.stamp === stamp) return cached.index;
        /** @type {Map<string, RelGroup[]>} */
        const index = new Map();
        const add = (/** @type {?string | undefined} */ personId, /** @type {RelGroup} */ group) => {
            if (!personId) return;
            const list = index.get(personId);
            if (!list) index.set(personId, [group]);
            else if (list[list.length - 1] !== group) list.push(group);
        };
        (groups || []).forEach(g => {
            if (!g) return;
            add(g.leaderId, g);
            (g.memberIds || []).forEach(id => add(id, g));
        });
        GROUP_INDEX.set(groups, { stamp: stamp, index: index });
        return index;
    }

    // The groups of one Type that a Person belongs to. `index`, when given,
    // is `groupIndex(groups)`.
    /**
     * @param {?RelGroup[] | undefined} groups
     * @param {string} typeId
     * @param {string} personId
     * @param {Map<string, RelGroup[]>} [index] `groupIndex(groups)`.
     * @returns {RelGroup[]}
     */
    function groupsFor(groups, typeId, personId, index) {
        if (index) return (index.get(personId) || []).filter(g => g.typeId === typeId);
        return (groups || []).filter(g => g && g.typeId === typeId && inGroup(g, personId));
    }

    // The groups of one Type that two People both belong to.
    /**
     * @param {?RelGroup[] | undefined} groups
     * @param {string} typeId
     * @param {string} a
     * @param {string} b
     * @param {Map<string, RelGroup[]>} [index] `groupIndex(groups)`.
     * @returns {RelGroup[]}
     */
    function sharedGroups(groups, typeId, a, b, index) {
        return groupsFor(groups, typeId, a, index).filter(g => inGroup(g, b));
    }

    const restrictionsOf = def => (def && Array.isArray(def.restrictions) ? def.restrictions : []);

    // ── Already busy in another Role at this Event ───────────────────────────
    //
    // `assignedElsewhere` is who holds a DIFFERENT Role at this occurrence, each
    // carrying whether that Role leaves them free: [{ personId, roleSlug,
    // allowsAnotherRole }]. Deliberately separate from `assigned`, which is this
    // Role's own seats — the relationship rules stay scoped to one Role, because
    // "no married couple in Kids" says nothing about Coffee.
    //
    // A person may hold a set of Roles only when EVERY Role in it permits a
    // second, and never more than two. Holding one exclusive Role therefore
    // means holding nothing else, because that Role itself says so.
    function servingElsewhere(def, held) {
        if (!held || held.length === 0) return null;

        const blocked = (
            held.length >= MAX_ROLES_PER_PERSON ||
            !allowsAnotherRole(def) ||
            held.some(a => !allowsAnotherRole(a))
        );

        // Name the Role that has them. A bare "unavailable" makes the editor go
        // hunting for which one, on a screen that already knows the answer.
        return blocked
            ? { reason: REASONS.SERVING_ELSEWHERE, roleSlug: held[0].roleSlug || null }
            : null;
    }

    // ── Cross-Role rules (MS-221) ────────────────────────────────────────────
    //
    // Every rule above is a rule a Role makes about ITSELF: "no two people from
    // one household on Kids". Some rules are not about one Role at all. The
    // Children's Ministry Leader and the Children's Ministry Helper are two
    // Roles, and a married couple must not hold one each — neither Role can
    // state that, because neither is the thing being constrained. The PAIR is.
    //
    // So a Cross-Role Rule belongs to the Event that runs both Roles, not to
    // either Role: it is stored on the series (`crossRoleRules`) and authored on
    // the recurring events page, where the Roles of an Event are already chosen.
    //
    // Each is an `anyOf` (see judgeOptions) whose conditions name the Roles
    // they are about. A pair condition is { kind, typeId, roleSlugs: [a, b] }:
    // `kind` is the same NOT_SAME_GROUP / SAME_GROUP vocabulary a Role already
    // uses, and `typeId` the same Relationship Group Type — Family, Marriage, a
    // house group. Deliberately the same words: an editor who has written "no
    // two people from the same" once should not have to learn a second phrasing
    // to say it across two Roles.
    //
    // ⚠ It is evaluated HERE, inside the one function that decides whether a
    // person may fill a slot, rather than beside each surface that asks. The
    // picker, the roster judge, auto-assign, Cover and Trade all reach this
    // function, and a rule any one of them did not know would be a rule you
    // could walk round — the picker refusing what Cover then hands out.
    //
    //   holders — everyone in a DIFFERENT Role at this Event, as
    //             [{ personId, roleSlug }]. The same list `busy` is built from,
    //             unnarrowed: this asks about OTHER PEOPLE, not this candidate.
    //   seated  — everyone already in THIS Role (its other seats), which a
    //             line-up across Roles counts as part of this Role's team.
    //
    // Options say OR: "(the Helpers are a woman and a man AND the Leader is a
    // man) OR (the Helpers are two men AND the Leader is a woman)". Its
    // conditions name the Role they are about —
    // a line-up by `roleSlug`, a group rule by its `roleSlugs` pair — and it
    // is this Role's business only if one of them names it.
    /** @param {Record<string, *>} def @param {Record<string, *>} candidate @param {Record<string, *>} context @param {Array<Record<string, *>>} holders @param {Array<Record<string, *>>} [seated] @returns {?Record<string, *>} */
    function crossRoleIneligibility(def, candidate, context, holders, seated) {
        const rules = (context && context.crossRoleRules) || [];
        if (!rules.length) return null;

        const slug = slugOf(def);
        if (!slug) return null;
        const others = holders || [];
        const own = seated || [];

        for (const rule of rules) {
            if (isTry(rule)) continue;
            const blocked = crossRuleBlocks(rule, slug, candidate, context, others, own);
            if (blocked) return blocked;
        }

        return null;
    }

    // One rule across Roles, for a candidate to `slug`: why it refuses them,
    // or null — including when the rule is not this Role's business at all.
    /** @param {Record<string, *>} rule @param {string} slug @param {Record<string, *>} candidate @param {Record<string, *>} context @param {Array<Record<string, *>>} others @param {Array<Record<string, *>>} own @returns {?Record<string, *>} */
    function crossRuleBlocks(rule, slug, candidate, context, others, own) {
        if (rule && rule.kind === RESTRICTIONS.ANY_OF) {
            const names = (rule.options || []).some(option => conditionsOf(option).some(
                cond => cond && (cond.roleSlug === slug || ((cond.roleSlugs || []).indexOf(slug) !== -1))
            ));
            if (!names) return null;
            return judgeOptions(rule.options,
                cond => judgeCrossCondition(cond, slug, candidate, context, others, own));
        }
        return null;
    }

    // How many Try rules this candidate would break by taking the place —
    // the Role's own and the Event's rules across Roles alike.
    /** @param {Record<string, *>} def @param {Record<string, *>} candidate @param {Record<string, *>} context @param {Array<Record<string, *>>} seated */
    function preferenceMisses(def, candidate, context, seated) {
        let misses = 0;
        restrictionsOf(def).forEach(rule => {
            if (isTry(rule) && judgeOwnRule(rule, def, candidate, context, seated)) misses++;
        });
        const slug = slugOf(def);
        const holders = (context && context.assignedElsewhere) || [];
        ((context && context.crossRoleRules) || []).forEach(rule => {
            if (isTry(rule) && crossRuleBlocks(rule, slug, candidate, context, holders, seated)) misses++;
        });
        return misses;
    }

    // One condition of a rule across Roles, judged for a candidate to `slug`.
    /** @param {Record<string, *>} cond @param {string} slug @param {Record<string, *>} candidate @param {Record<string, *>} context @param {Array<Record<string, *>>} holders @param {Array<Record<string, *>>} seated @returns {?Record<string, *>} */
    function judgeCrossCondition(cond, slug, candidate, context, holders, seated) {
        if (!cond) return null;

        if (cond.kind === RESTRICTIONS.LINEUP) {
            // This Role's own team, with the candidate in it; any other Role's
            // team as it stands. Either can close an option off.
            const team = cond.roleSlug === slug
                ? teamSexes(context, seated.map(a => a.personId)).concat([candidate.sex || null])
                : teamSexes(context, holders
                    .filter(h => h && h.roleSlug === cond.roleSlug && h.personId !== candidate.id)
                    .map(h => h.personId));
            return lineupFits(cond.sexes, team)
                ? null
                : { reason: REASONS.LINEUP_MISMATCH, pairedRoleSlug: cond.roleSlug === slug ? null : cond.roleSlug };
        }

        const pair = cond.roleSlugs || [];
        // A pair is two DIFFERENT Roles. One naming the same Role twice is
        // the Role's own NOT_SAME_GROUP rule written in the wrong place, and
        // honouring it here would judge a Role against itself twice over.
        if (pair.length !== 2 || pair[0] === pair[1]) return null;

        // A pair this candidate is not in can still decide which option of an
        // OR is live, so it is judged between the people already holding it.
        if (pair.indexOf(slug) === -1) {
            const a = holders.filter(h => h && h.roleSlug === pair[0]).map(h => h.personId);
            const b = holders.filter(h => h && h.roleSlug === pair[1]).map(h => h.personId);
            if (!a.length || !b.length) return null;
            if (cond.kind === RESTRICTIONS.NOT_SAME_GROUP) {
                const clash = a.some(x => b.some(y => sharedGroups(context.groups, cond.typeId, x, y, context.groupIndex).length));
                return clash ? { reason: REASONS.PAIRED_ROLE_CONFLICT, typeId: cond.typeId, pairedRoleSlug: pair[0] } : null;
            }
            if (cond.kind === RESTRICTIONS.SAME_GROUP) {
                const all = a.concat(b);
                const works = groupsFor(context.groups, cond.typeId, all[0], context.groupIndex)
                    .some(group => all.every(id => inGroup(group, id)));
                return works ? null : { reason: REASONS.NOT_IN_PAIRED_GROUP, typeId: cond.typeId, pairedRoleSlug: pair[0] };
            }
            return null;
        }

        const otherSlug = pair[0] === slug ? pair[1] : pair[0];
        const opposite = holders.filter(
            h => h && h.roleSlug === otherSlug && h.personId && h.personId !== candidate.id
        );
        // Nobody in the paired Role yet, so there is nothing to be judged
        // against — the same way the first person into a SAME_GROUP Role is
        // unconstrained. The rule bites when the second seat is taken.
        if (!opposite.length) return null;

        if (cond.kind === RESTRICTIONS.NOT_SAME_GROUP) {
            for (const holder of opposite) {
                const shared = sharedGroups(
                    context.groups, cond.typeId, candidate.id, holder.personId,
                    context.groupIndex
                );
                if (shared.length) {
                    return {
                        reason: REASONS.PAIRED_ROLE_CONFLICT,
                        typeId: cond.typeId,
                        groupId: shared[0].id,
                        groupName: shared[0].name,
                        conflictsWith: holder.personId,
                        pairedRoleSlug: otherSlug,
                    };
                }
            }
        }

        if (cond.kind === RESTRICTIONS.SAME_GROUP) {
            const own = groupsFor(context.groups, cond.typeId, candidate.id, context.groupIndex);
            // No group is ever committed to, for the same reason the
            // within-Role version doesn't: one group must satisfy EVERY
            // holder of the paired Role, but which one is not decided here.
            const works = own.some(
                group => opposite.every(h => inGroup(group, h.personId))
            );
            if (!works) {
                return {
                    reason: REASONS.NOT_IN_PAIRED_GROUP,
                    typeId: cond.typeId,
                    conflictsWith: opposite[0].personId,
                    pairedRoleSlug: otherSlug,
                };
            }
        }

        // An unknown kind is skipped, not treated as a blanket refusal —
        // the same forgiveness the within-Role loop gives a typo.
        return null;
    }

    // ── One rule, judged against one candidate ───────────────────────────────
    //
    // `seated` is everyone already in THIS Role at this Event (other seats).
    // Returns null when the rule lets them in, or why it does not. An `anyOf`
    // is judged through its options, each condition by this same function, so
    // a condition inside an option means exactly what it means on its own.
    /** @param {Record<string, *>} rule @param {Record<string, *>} def @param {Record<string, *>} candidate @param {Record<string, *>} context @param {Array<Record<string, *>>} seated @returns {?Record<string, *>} */
    function judgeOwnRule(rule, def, candidate, context, seated) {
        if (!rule) return null;
        if (rule.kind === RESTRICTIONS.REQUIRE_TAG && !carriesTag(candidate, rule.tagId)) {
            return { reason: REASONS.MISSING_REQUIRED_TAG, tagId: rule.tagId };
        }
        if (rule.kind === RESTRICTIONS.EXCLUDE_TAG && carriesTag(candidate, rule.tagId)) {
            return { reason: REASONS.EXCLUDED_BY_TAG, tagId: rule.tagId };
        }
        // The named few who serve communion or run coffee. A rule that is
        // ABSENT means everyone; an EMPTY one means nobody, which is why
        // validation refuses it rather than letting it empty a rota.
        if (rule.kind === RESTRICTIONS.ALLOWLIST) {
            const allowed = (rule.personIds || []).indexOf(candidate.id) !== -1;
            if (!allowed) return { reason: REASONS.NOT_ON_ALLOWLIST };
        }
        if (rule.kind === RESTRICTIONS.NOT_TOGETHER) {
            const clash = seated.find(a => joinedBy(
                context.relationships, rule.typeId, candidate.id, a.personId,
                context.edgeIndex
            ));
            if (clash) {
                return {
                    reason: REASONS.RELATIONSHIP_CONFLICT,
                    typeId: rule.typeId,
                    conflictsWith: clash.personId,
                };
            }
        }
        // Spread the Role: nobody may sit with someone from their own group.
        if (rule.kind === RESTRICTIONS.NOT_SAME_GROUP) {
            for (const seat of seated) {
                const shared = sharedGroups(
                    context.groups, rule.typeId, candidate.id, seat.personId,
                    context.groupIndex
                );
                if (shared.length) {
                    return {
                        reason: REASONS.SAME_GROUP_CONFLICT,
                        typeId: rule.typeId,
                        groupId: shared[0].id,
                        groupName: shared[0].name,
                        conflictsWith: seat.personId,
                    };
                }
            }
        }

        // Staff the Role from ONE group. The only cohesive rule in the model:
        // the first person seated is unconstrained, and everyone after them
        // must share a group with EVERY seat already taken.
        //
        // No single group is ever committed to. A candidate passes if any one
        // group satisfies every seat, so the Role can't get pinned to whichever
        // group happened to match first and then wrongly exclude the rest.
        if (rule.kind === RESTRICTIONS.SAME_GROUP) {
            const own = groupsFor(context.groups, rule.typeId, candidate.id, context.groupIndex);
            if (own.length === 0) {
                return { reason: REASONS.NOT_IN_REQUIRED_GROUP, typeId: rule.typeId };
            }
            const worksForEverySeat = own.some(
                group => seated.every(seat => inGroup(group, seat.personId))
            );
            if (!worksForEverySeat) {
                return { reason: REASONS.NOT_IN_REQUIRED_GROUP, typeId: rule.typeId };
            }
        }

        if (rule.kind === RESTRICTIONS.SEX) {
            if (!candidate.sex) return { reason: REASONS.SEX_UNKNOWN };
            if (candidate.sex !== rule.sex) return { reason: REASONS.SEX_MISMATCH, wantsSex: rule.sex };
        }

        if (rule.kind === RESTRICTIONS.LINEUP) {
            const team = teamSexes(context, seated.map(a => a.personId)).concat([candidate.sex || null]);
            if (!lineupFits(rule.sexes, team)) return { reason: REASONS.LINEUP_MISMATCH };
        }

        // "At least one first-aider on Welcome." Judged as still-reachable,
        // like a line-up: the seats left after this one could all go to people
        // carrying the tag, so it only refuses once that is no longer true.
        if (rule.kind === RESTRICTIONS.AT_LEAST_TAGGED) {
            const need = Number(rule.atLeast) || 0;
            const tagged = seated
                .map(a => knownPerson(context, a.personId))
                .filter(p => p && carriesTag(p, rule.tagId)).length
                + (carriesTag(candidate, rule.tagId) ? 1 : 0);
            const left = Math.max(0, slotsOf(def).length - seated.length - 1);
            if (tagged + left < need) {
                return { reason: REASONS.TOO_FEW_TAGGED, tagId: rule.tagId, atLeast: need };
            }
        }

        if (rule.kind === RESTRICTIONS.ANY_OF) {
            return judgeOptions(rule.options,
                cond => judgeOwnRule(cond, def, candidate, context, seated));
        }

        // A rule kind we don't know is skipped rather than treated as a
        // blanket exclusion — a typo in the config must not empty the list.
        return null;
    }

    // ── Options: any one will do ─────────────────────────────────────────────
    //
    // An option passes when every one of its conditions does; the rule passes
    // when any option does. Refused, it says why as plainly as it can: with one
    // option, that option's own reason ("must be tagged Member"); when every
    // option failed on its line-up, that it is the line-up; otherwise that
    // they fit none of the options.
    /** @param {Record<string, *>} option @returns {Array<Record<string, *>>} */
    const conditionsOf = option => (option && Array.isArray(option.conditions) ? option.conditions : []);

    /** @param {Array<Record<string, *>> | undefined} options @param {(cond: Record<string, *>) => ?Record<string, *>} judge @returns {?Record<string, *>} */
    function judgeOptions(options, judge) {
        const list = Array.isArray(options) ? options : [];
        if (!list.length) return null;
        const failures = [];
        for (const option of list) {
            let failed = null;
            for (const cond of conditionsOf(option)) {
                failed = judge(cond);
                if (failed) break;
            }
            if (!failed) return null;
            failures.push(failed);
        }
        if (failures.length === 1) return failures[0];
        if (failures.every(f => f.reason === REASONS.LINEUP_MISMATCH)) {
            return { reason: REASONS.LINEUP_MISMATCH };
        }
        return { reason: REASONS.NO_OPTION_FITS, failures: failures };
    }

    // ── Line-ups ─────────────────────────────────────────────────────────────
    //
    // A line-up is UNORDERED — how many men, how many women, how many of
    // either — so it is judged on counts, never on which seat is which. The
    // question asked of a part-filled team is "can this still become one of
    // the line-ups?", which lets the first seat go to anybody the line-up has
    // room for and closes the options off as the seats fill.
    //
    // `team` is the sex of each person on it; null for somebody whose sex was
    // never recorded, who can only take an "either" mark.
    /** @param {string[] | undefined} sexes @param {Array<?string>} team */
    function lineupFits(sexes, team) {
        const marks = Array.isArray(sexes) ? sexes : [];
        if (team.length > marks.length) return false;
        const men = marks.filter((/** @type {string} */ m) => m === 'male').length;
        const women = marks.filter((/** @type {string} */ m) => m === 'female').length;
        const either = marks.length - men - women;
        let m = 0; let f = 0; let unknown = 0;
        team.forEach((/** @type {?string} */ sex) => {
            if (sex === 'male') m++;
            else if (sex === 'female') f++;
            else unknown++;
        });
        return Math.max(0, m - men) + Math.max(0, f - women) + unknown <= either;
    }

    // Who the people already in a team are, by id. Somebody this context does
    // not know at all is left out rather than guessed at: a rule should not
    // refuse on the strength of a person it cannot see.
    //
    // `knownPeople` is for callers that judge one candidate at a time (Cover,
    // Trade, a member's own take): they narrow `people` to the one person, so
    // the people already on the team have to be handed in separately.
    /** @type {WeakMap<object, Map<string, Record<string, *>>>} */
    const personIndexes = new WeakMap();
    /** @param {Array<Record<string, *>> | undefined} people @returns {?Map<string, Record<string, *>>} */
    function indexOf(people) {
        if (!Array.isArray(people)) return null;
        let index = personIndexes.get(people);
        if (!index) {
            index = new Map(people.map(p => [p && p.id, p]));
            personIndexes.set(people, index);
        }
        return index;
    }

    /** @param {Record<string, *>} context @param {string} id @returns {?Record<string, *>} */
    function knownPerson(context, id) {
        const own = indexOf(context && context.people);
        if (own && own.has(id)) return own.get(id);
        const known = indexOf(context && context.knownPeople);
        return known && known.has(id) ? known.get(id) : null;
    }

    /** @param {Record<string, *>} context @param {string[]} personIds @returns {Array<?string>} */
    function teamSexes(context, personIds) {
        return personIds
            .map(id => knownPerson(context, id))
            .filter(Boolean)
            .map(p => p.sex || null);
    }

    // Does any of these rules judge a line-up? A caller that would otherwise
    // load only the one person being judged needs to load the team as well.
    /** @param {Array<Record<string, *>>} rules */
    function judgesLineups(rules) {
        return kindsIn(rules).indexOf(RESTRICTIONS.LINEUP) !== -1;
    }

    // Every kind of condition a set of rules uses — inside an OR rule's options
    // as well as at the top. A caller that loads data only for the rules that
    // need it (the server's take loads groups only for a group rule) must ask
    // here: once rules are stored as OR rules, the top level alone says "anyOf"
    // and nothing else.
    /** @param {Array<Record<string, *>> | undefined} rules @returns {string[]} */
    function kindsIn(rules) {
        /** @type {string[]} */
        const out = [];
        /** @param {Record<string, *>} rule */
        const visit = rule => {
            if (!rule) return;
            if (rule.kind && out.indexOf(rule.kind) === -1) out.push(rule.kind);
            if (rule.kind === RESTRICTIONS.ANY_OF) {
                (rule.options || []).forEach((/** @type {Record<string, *>} */ option) => conditionsOf(option).forEach(visit));
            }
        };
        (rules || []).forEach(visit);
        return out;
    }

    // Judge one Person against one slot. Returns `null` when they may fill it,
    // or the reason they may not. Ordered most-fundamental first, so the user is
    // told the real cause — being Inactive explains everything else about them.
    // `seated` and `busy` are passed in already narrowed rather than derived
    // per candidate: both are the same for every person judged against one slot,
    // and the solver calls this tens of thousands of times.
    function ineligibilityFor(def, slot, candidate, context, seated, busy) {
        if (isInactive(candidate)) return { reason: REASONS.INACTIVE };

        // Second only to having left the church, and above every rule about the
        // roster: somebody who is not going to be there cannot be judged on
        // whether this place wants a man or whether their spouse is on it. The
        // date is resolved by the caller — `awayPersonIds` is who is Away on
        // THIS date, because being away on the 16th says nothing about the 23rd.
        if (context && (context.awaySet
            ? context.awaySet.has(candidate.id)
            : (context.awayPersonIds && context.awayPersonIds.indexOf(candidate.id) !== -1))) {
            return { reason: REASONS.AWAY };
        }

        if (seated.some(a => a.personId === candidate.id)) {
            return { reason: REASONS.ALREADY_ASSIGNED };
        }

        const clash = servingElsewhere(def, busy[candidate.id]);
        if (clash) return clash;

        for (const rule of restrictionsOf(def)) {
            if (isTry(rule)) continue;
            const blocked = judgeOwnRule(rule, def, candidate, context, seated);
            if (blocked) return blocked;
        }

        // Last, because it is the only rule this Role did not write. Its own
        // rules explain themselves; "your wife is leading" needs the editor to
        // already know why the other reasons did not apply.
        return crossRoleIneligibility(def, candidate, context, (context && context.assignedElsewhere) || [], seated);
    }

    // Judge every candidate for one slot of one Role on one Event.
    //
    //   people        — the candidates, in the order to show them
    //   relationships — the pairwise edges (for NOT_TOGETHER)
    //   assigned      — [{ slotId, personId }] already seated in THIS Role on
    //                   THIS Event. Scoped that way on purpose, but ONLY for the
    //                   relationship rules: "no married couple in Kids" says
    //                   nothing about who is on Coffee.
    //   assignedElsewhere
    //                 — [{ personId, roleSlug, allowsAnotherRole }] holding a
    //                   different Role at this Event. Serving another Role the
    //                   same morning IS this Role's business now (ADR-0020):
    //                   exclusive is the default, so by default it blocks.
    //
    // Everybody comes back, eligible or not, so the UI can grey people out with
    // a reason rather than quietly dropping them.
    function candidatesFor(def, slot, context) {
        // Indexed once for the whole slot (MS-814): every candidate is judged
        // against the same groups and the same Away list.
        const ctx = Object.assign({}, context || {});
        if (!ctx.groupIndex && Array.isArray(ctx.groups) && ctx.groups.length) {
            ctx.groupIndex = groupIndex(ctx.groups);
        }
        if (Array.isArray(ctx.awayPersonIds) && !ctx.awaySet) {
            ctx.awaySet = new Set(ctx.awayPersonIds);
        }
        if (!ctx.edgeIndex && Array.isArray(ctx.relationships) && ctx.relationships.length) {
            ctx.edgeIndex = edgeIndex(ctx.relationships);
        }

        // Narrowed once for the whole slot, not once per candidate.
        const seated = (ctx.assigned || []).filter(a => a.slotId !== slot.id);
        const busy = {};
        (ctx.assignedElsewhere || []).forEach(a => {
            if (!a || !a.personId) return;
            (busy[a.personId] || (busy[a.personId] = [])).push(a);
        });

        // Only worth asking when there is a Try rule to ask about.
        const anyTry = restrictionsOf(def).some(isTry) || (ctx.crossRoleRules || []).some(isTry);

        return (ctx.people || []).map(candidate => {
            const blocked = ineligibilityFor(def, slot, candidate, ctx, seated, busy);
            const misses = !blocked && anyTry ? preferenceMisses(def, candidate, ctx, seated) : 0;
            return Object.assign(
                { personId: candidate.id, eligible: !blocked, reason: null, misses: misses },
                blocked || {}
            );
        });
    }

    // ── Judging a roster that is already seated ───────────────────────────────
    //
    // The other half of eligibility (ADR-0021). `candidatesFor` asks "may I seat
    // this person NEXT?" and its answer is thrown away the moment they are
    // placed. This asks "is this roster, AS IT STANDS, legal?" and returns a
    // WARNING for every seat that breaks one of the editor's own rules.
    //
    // ⚠ THE TWO ARE DIFFERENT QUESTIONS, and that is the whole reason this
    // exists rather than being folded into the other. A roster can be perfectly
    // legal on the day it is drafted and break later — somebody marries, a tag
    // is removed, a Role gains a restriction. Nothing was overridden and there
    // is still a problem, which is also why the model calls this a Warning and
    // not an override.
    //
    // A warning never REFUSES. Eligibility advises; the editor is the final word,
    // because a tool that will not record the rota the church is actually going
    // to run is a tool the rota leaves. What the app owes them is to say so.
    //
    // Nothing here is stored. Warnings are derived on every read, never stamped
    // on the roster, never acknowledged, never dismissed — one you can wave away
    // is one nobody reads by the third week.
    //
    //   roster            — [{ roleSlug, slotId, personId }] every seat on ONE
    //                       occurrence, across every Role.
    //   roles             — the Role definitions those slugs refer to.
    //   liturgicalHolders — [{ personId, roleSlug }] whoever is preaching or
    //                       leading. Liturgy is fields on the Service rather
    //                       than Assignments, so it cannot arrive in the roster
    //                       and has to be handed in beside it.
    //
    // Empty places produce nothing: leaving one unfilled is a legitimate answer.
    function warningsFor(roster, context) {
        const ctx = Object.assign({}, context || {});
        if (!ctx.groupIndex && Array.isArray(ctx.groups) && ctx.groups.length) {
            ctx.groupIndex = groupIndex(ctx.groups);
        }
        if (!ctx.edgeIndex && Array.isArray(ctx.relationships) && ctx.relationships.length) {
            ctx.edgeIndex = edgeIndex(ctx.relationships);
        }
        const seats = (roster || []).filter(s => s && s.personId && s.roleSlug);

        const defBySlug = {};
        (ctx.roles || []).forEach(def => { if (def && def.slug) defBySlug[def.slug] = def; });
        const personById = {};
        (ctx.people || []).forEach(p => { if (p && p.id) personById[p.id] = p; });

        // Liturgy always occupies the whole morning, so it joins the busy list
        // as an exclusive holding. Reusing `servingElsewhere` rather than
        // writing a second liturgical rule is what keeps the picker's answer and
        // this one identical (ADR-0020 §7).
        const liturgical = (ctx.liturgicalHolders || [])
            .filter(h => h && h.personId)
            .map(h => ({
                personId: h.personId,
                roleSlug: h.roleSlug || null,
                allowsAnotherRole: false,
            }));

        const warnings = [];

        seats.forEach(seat => {
            const def = defBySlug[seat.roleSlug];
            if (!def) {
                warnings.push({
                    personId: seat.personId,
                    roleSlug: seat.roleSlug,
                    slotId: seat.slotId,
                    reason: REASONS.UNKNOWN_ROLE,
                });
                return;
            }

            const slot = slotsOf(def).filter(s => s.id === seat.slotId)[0];
            if (!slot) {
                warnings.push({
                    personId: seat.personId,
                    roleSlug: seat.roleSlug,
                    slotId: seat.slotId,
                    reason: REASONS.UNKNOWN_SLOT,
                });
                return;
            }

            const candidate = personById[seat.personId] || { id: seat.personId };

            // Judge this seat AS THOUGH IT WERE BEING PLACED LAST: everyone else
            // is already sitting there, and the rules see them. Asking the same
            // question `candidatesFor` asks, with the same narrowed inputs, is
            // what stops the two drifting — the paired test pins it.
            const seated = seats.filter(s => (
                s !== seat && s.roleSlug === seat.roleSlug && s.slotId !== seat.slotId
            ));
            // Everyone holding a DIFFERENT Role here, this seat's own occupant
            // aside. `busy` narrows this to the one person, for the exclusivity
            // rule; a Cross-Role Rule asks about the OTHER people, so it needs
            // the list unnarrowed (MS-221). Liturgy is in it for the same reason
            // it is in `busy`: a Role paired with Preacher must see the preacher.
            const elsewhere = seats
                .filter(s => s !== seat && s.roleSlug !== seat.roleSlug)
                .map(s => ({
                    personId: s.personId,
                    roleSlug: s.roleSlug,
                    allowsAnotherRole: allowsAnotherRole(defBySlug[s.roleSlug]),
                }))
                .concat(liturgical);

            const busy = {};
            busy[seat.personId] = elsewhere
                .filter(h => h.personId === seat.personId);

            const seatContext = Object.assign({}, ctx, { assignedElsewhere: elsewhere });
            const blocked = ineligibilityFor(def, slot, candidate, seatContext, seated, busy);
            if (!blocked) return;

            warnings.push(Object.assign({
                personId: seat.personId,
                roleSlug: seat.roleSlug,
                slotId: seat.slotId,
            }, blocked, {
                // `roleSlug` on a SERVING_ELSEWHERE names the Role that has them
                // already, which would otherwise overwrite the Role this warning
                // is about. Both matter, so both are kept and named apart.
                heldRoleSlug: blocked.roleSlug || null,
                roleSlug: seat.roleSlug,
            }));
        });

        return warnings;
    }

    // ── Validating a restriction against the Types on offer ───────────────────
    //
    // A relationship rule may only name a Relationship Type an elder has marked
    // Shared with Editors (MS-128, ADR-0017).
    //
    // The security rules already stop a non-elder READING an unshared Type's
    // edges and rosters. But if the model let such a rule be built anyway,
    // evaluation would be handed an empty list and quietly conclude "nobody
    // qualifies" — a Role that can never be filled, with no clue why. Refusing
    // up front is the kinder failure.

    const TAG_RULES = [RESTRICTIONS.REQUIRE_TAG, RESTRICTIONS.EXCLUDE_TAG];
    const GROUP_RULES = [RESTRICTIONS.SAME_GROUP, RESTRICTIONS.NOT_SAME_GROUP];
    const PAIRWISE_RULES = [RESTRICTIONS.NOT_TOGETHER];

    //
    // `options.count`, when given, is how many people the Role needs on this
    // Event: a line-up naming a different number can never be met.
    function validateRestriction(rule, availableTypes, options) {
        const errors = [];
        const kind = rule && rule.kind;
        const opts = options || {};

        // OR: at least one option, each with at least one condition, each
        // condition a rule in its own right. One level only — an option inside
        // an option is brackets inside brackets, which nobody reading a rota
        // rule should have to parse.
        if (kind === RESTRICTIONS.ANY_OF) {
            const list = Array.isArray(rule.options) ? rule.options : [];
            if (!list.length) errors.push('This rule needs at least one option.');
            list.forEach(option => {
                const conds = conditionsOf(option);
                if (!conds.length) errors.push('Each option needs at least one condition.');
                conds.forEach(cond => {
                    if (cond && cond.kind === RESTRICTIONS.ANY_OF) {
                        errors.push('An option cannot hold another set of options.');
                        return;
                    }
                    validateRestriction(cond, availableTypes, opts).errors
                        .forEach(e => { if (errors.indexOf(e) === -1) errors.push(e); });
                });
            });
            return { valid: errors.length === 0, errors: errors };
        }

        if (kind === RESTRICTIONS.AT_LEAST_TAGGED) {
            if (!rule.tagId) errors.push('This rule needs a Tag.');
            if (!(Number(rule.atLeast) >= 1)) errors.push('Say how many — at least one.');
            if (typeof opts.count === 'number' && Number(rule.atLeast) > opts.count) {
                errors.push('This asks for ' + rule.atLeast + ' tagged people, but the Role only needs ' + opts.count + '.');
            }
            return { valid: errors.length === 0, errors: errors };
        }

        if (kind === RESTRICTIONS.SEX) {
            if (rule.sex !== 'male' && rule.sex !== 'female') errors.push('Say whether this is a man or a woman.');
            return { valid: errors.length === 0, errors: errors };
        }

        if (kind === RESTRICTIONS.LINEUP) {
            const marks = Array.isArray(rule.sexes) ? rule.sexes : [];
            if (!marks.length) errors.push('A line-up needs at least one person.');
            if (marks.some(m => LINEUP_MARKS.indexOf(m) === -1)) {
                errors.push('Each place in a line-up is a man, a woman or either.');
            }
            if (typeof opts.count === 'number' && marks.length && marks.length !== opts.count) {
                errors.push('This line-up names ' + marks.length + ' people, but the Role needs ' + opts.count + '.');
            }
            return { valid: errors.length === 0, errors: errors };
        }

        if (TAG_RULES.indexOf(kind) !== -1) {
            if (!rule.tagId) errors.push('This rule needs a Tag.');
            return { valid: errors.length === 0, errors: errors };
        }

        // Absent is not empty. No allowlist rule means the Role is open to
        // everyone; an allowlist naming nobody is a Role that can never be
        // filled, and it must be refused here rather than discovered six weeks
        // later as an empty slot on a rota.
        if (kind === RESTRICTIONS.ALLOWLIST) {
            if (!(rule.personIds || []).length) {
                errors.push('An allowlist needs at least one person, or the Role can never be filled.');
            }
            return { valid: errors.length === 0, errors: errors };
        }

        const wantsGroup = GROUP_RULES.indexOf(kind) !== -1;
        const wantsPairwise = PAIRWISE_RULES.indexOf(kind) !== -1;
        if (!wantsGroup && !wantsPairwise) {
            return { valid: false, errors: ['Unknown restriction: ' + kind] };
        }

        // Only Types this user can actually see are offered. An unknown Type is
        // treated as unavailable rather than assumed shared — EXCEPT the two the
        // Membership Directory answers, which are always available and need no
        // elder to share them.
        const type = DIRECTORY_GROUP_TYPES.find(t => t.id === rule.typeId)
            || (availableTypes || []).find(t => t && t.id === rule.typeId);
        if (!type) {
            errors.push(
                'That relationship type is not available. An elder has to share it ' +
                'with editors before a serving rule can use it.'
            );
            return { valid: false, errors: errors };
        }

        if (type.sharedWithEditors !== true) {
            errors.push(
                'The relationship type "' + type.name + '" is not shared with editors. ' +
                'An elder has to share it before a serving rule can use it.'
            );
        }

        // A group rule against a pairwise Type would silently match nothing, and
        // vice versa — so the mismatch is an error, not a no-op.
        if (wantsGroup && type.kind !== 'group') {
            errors.push('"' + type.name + '" connects two people, so it cannot be used as a group rule.');
        }
        if (wantsPairwise && type.kind !== 'pairwise') {
            errors.push('"' + type.name + '" is a group, so it cannot be used as a pair rule.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ── Validation ────────────────────────────────────────────────────────────

    // Returns every problem at once rather than the first — the Roles Manager
    // shows them together instead of making the editor fix one, save, repeat.
    function validateDefinition(def) {
        const errors = [];

        const name = def && typeof def.name === 'string' ? def.name.trim() : '';
        if (!name) errors.push('A Role needs a name.');
        // A stored slug that is not a usable one (MS-822). Every place, cover
        // entry and Trade names a Role by its slug, so an empty one is a Role
        // nothing can point at.
        if (def && def.slug !== undefined && def.slug !== null &&
            !(typeof def.slug === 'string' && /^[a-z0-9_]+$/.test(def.slug))) {
            errors.push('A Role needs a usable short name (letters, digits and _).');
        }

        // Only liturgical Roles carry the locked family, and they are defined in
        // code — a stored definition claiming it would forge an undeletable Role.
        if (def && def.family !== FAMILIES.SERVANT) {
            errors.push('A Role Definition must belong to the servant family; liturgical Roles are code-defined.');
        }

        // Intensity is optional — absent reads as 1 — but a stored value that is
        // not a usable number is a mistake worth naming, not silently ignoring.
        // Same predicate `intensityOf` reads by, so what validation rejects can
        // never be something reading quietly accepts.
        if (def && def.intensity !== undefined && def.intensity !== null &&
            !isUsableIntensity(def.intensity)) {
            errors.push('Intensity must be a number of weeks, and cannot be negative.');
        }

        // A description is optional, and there is nothing to get wrong about
        // prose — except its length. The cap is here rather than left to the
        // textarea, because a Role is editable through /roles by hand and a
        // wall of text would run down every Commitments row that shows it.
        if (def && typeof def.description === 'string' &&
            def.description.trim().length > MAX_DESCRIPTION) {
            errors.push(
                'A description is at most ' + MAX_DESCRIPTION + ' characters — ' +
                'it is what the job is, not the notes for it.'
            );
        }

        // The allowlist is the one restriction that needs no Relationship Type,
        // so it can be judged here without the list of shared Types — and asking
        // validateRestriction keeps one wording for one rule.
        restrictionsOf(def).forEach(rule => {
            if (rule && rule.kind === RESTRICTIONS.ALLOWLIST) {
                validateRestriction(rule, []).errors.forEach(e => errors.push(e));
            }
        });

        return { valid: errors.length === 0, errors: errors };
    }

    const RolesCore = {
        // vocabulary
        FAMILIES,
        RESTRICTIONS,
        LINEUP_MARKS,
        STRENGTHS,
        DIRECTORY_GROUP_TYPES,
        REASONS,
        LITURGICAL_ROLES,
        LITURGICAL_SLUGS,
        DEFAULT_INTENSITY,
        MAX_ROLES_PER_PERSON,
        assignablePeople,
        seesHidden,
        visibleTags,
        // fairness fields (MS-17, ADR-0020)
        intensityOf,
        allowsAnotherRole,
        // the registry: both families, one list
        allRoles,
        roleBySlug,
        registry,
        isLocked,
        assertEditable,
        assertDeletable,
        slugify,
        // eligibility
        isInactive,
        doesNotServe,
        candidatesFor,
        NON_SERVING_DOC,
        nonServingSetting,
        nonServingIds,
        coveredByNonServing,
        lineupFits,
        judgesLineups,
        kindsIn,
        warningsFor,
        // relationship group membership (MS-141)
        inGroup,
        groupsFor,
        sharedGroups,
        groupIndex,
        edgeIndex,
        // what the job is (MS-222)
        MAX_DESCRIPTION,
        descriptionOf,
        // reading
        slotCount,
        // building
        newDefinition,
        // validation
        validateDefinition,
        validateRestriction,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RolesCore;
    }
    if (global) {
        global.RolesCore = RolesCore;
    }
})(typeof window !== 'undefined' ? window : null);
