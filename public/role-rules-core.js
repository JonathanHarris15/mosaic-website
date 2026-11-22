// Role Rules Core — the model behind an Event's Roles & rules table.
//
// Who a Role needs, who may fill it and how much rest it owes belong to the
// Event that runs it (EventsCore.effectiveRole). On the Event's Roles & rules
// tab each Role is a row that opens into:
//
//   Who can do it — each person on their own. One or more OPTIONS, any one of
//                   which will do; each a list of conditions that must all
//                   hold ("tagged Member", or "tagged Special help AND a woman").
//   The team      — the people on it together. A list of rules that all hold,
//                   each with options of its own: a line-up ("a man and a
//                   woman, or two men"), at least n tagged, no two from one
//                   family… Each rule is MUST or TRY TO.
//   What this allows — worked out here, never typed: which line-ups can
//                   actually happen once every Must rule has had its say.
//
// Rules across Roles are the same shape, with each condition naming the Role
// it is about.
//
// This module translates between that form and what is stored, and does the
// working-out. RolesCore judges people against the stored rules; nothing here
// decides who may serve. Pure and self-contained, like every other *-core.
//
// Loaded as a classic <script> (window.RoleRulesCore) and exported for Node.

(function (global) {
    'use strict';

    /**
     * @typedef {Record<string, *> & { id?: string, kind: string }} Condition
     * @typedef {{ id?: string, conditions: Condition[] }} Option
     * @typedef {{ id?: string, strength?: string, scope?: string, kind?: string, options: Option[] }} Rule
     * @typedef {{ count: number, intensity: number, allowsAnotherRole: boolean, who: Rule, team: Rule[] }} Form
     * @typedef {{ men: number, women: number }} Makeup
     * @typedef {{ tag?: (id: string) => *, role?: (slug: string) => *, type?: (id: string) => *, person?: (id: string) => * }} Names
     */

    let seq = 0;
    /** @param {string} prefix */
    const newId = prefix => prefix + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
    /** @param {*} value @returns {*} */
    const copy = value => JSON.parse(JSON.stringify(value === undefined ? null : value));

    // ── Conditions, options, rules ─────────────────────────────────────────
    //
    // Screen-only ids (`id`) let Alpine key the lists; they are stripped before
    // anything is stored.

    /** @param {string} scope @param {number} [count] @param {?string} [roleSlug] @returns {Condition} */
    function newCondition(scope, count, roleSlug) {
        if (scope === 'who') return { id: newId('c'), kind: 'requireTag', tagId: '' };
        /** @type {Condition} */
        const c = { id: newId('c'), kind: 'lineup', sexes: Array(Math.max(1, count || 1)).fill('either') };
        if (scope === 'across') c.roleSlug = roleSlug || '';
        return c;
    }

    /** @param {string} scope @param {number} [count] @param {?string} [roleSlug] @returns {Option} */
    function newOption(scope, count, roleSlug) {
        return { id: newId('o'), conditions: [newCondition(scope, count, roleSlug)] };
    }

    /** @param {string} scope @param {number} [count] @param {?string} [roleSlug] @returns {Rule} */
    function newRule(scope, count, roleSlug) {
        return { id: newId('r'), strength: 'must', options: [newOption(scope, count, roleSlug)] };
    }

    /** @param {Option[] | undefined} options @returns {Option[]} */
    const withIds = options => (options || []).map((/** @type {Option} */ option) => ({
        id: newId('o'),
        conditions: ((option && option.conditions) || []).map((/** @type {Condition} */ c) => Object.assign({ id: newId('c') }, copy(c))),
    }));

    /** @param {Option[] | undefined} options @returns {Option[]} */
    const stripIds = options => (options || [])
        .map((/** @type {Option} */ option) => ({
            conditions: (option.conditions || []).map((/** @type {Condition} */ c) => {
                const out = copy(c);
                delete out.id;
                return out;
            }),
        }))
        .filter((/** @type {Option} */ option) => option.conditions.length);

    // ── Stored settings → the form ─────────────────────────────────────────

    /** @param {Record<string, *>} role @returns {Form} */
    function formFrom(role) {
        const r = role || {};
        const slots = Array.isArray(r.slots) ? r.slots : [];
        /** @type {Form} */
        const form = {
            count: Math.max(1, slots.length),
            intensity: typeof r.intensity === 'number' ? r.intensity : 1,
            allowsAnotherRole: r.allowsAnotherRole === true,
            who: { id: newId('r'), options: [] },
            team: [],
        };

        // Every stored rule is an OR rule (ADR 0085): the one about each
        // person is "who can do it", every other is a rule about the team.
        (r.restrictions || []).forEach((/** @type {Rule} */ rule) => {
            if (!rule || rule.kind !== 'anyOf') return;
            if (rule.scope === 'person') form.who.options = form.who.options.concat(withIds(rule.options));
            else form.team.push({ id: newId('r'), strength: rule.strength === 'try' ? 'try' : 'must', options: withIds(rule.options) });
        });
        return form;
    }

    // ── The form → stored settings ─────────────────────────────────────────
    //
    // Slot ids are kept: an Assignment names its seat by id. Fewer people drops
    // the last seats; more adds new ids after the highest ever used, so an id
    // is never handed to a different seat than it once meant.
    /** @param {Form} form @param {Record<string, *>} [previous] */
    function settingsFrom(form, previous) {
        const f = form || /** @type {Form} */ ({});
        const prev = previous || {};
        /** @type {Array<{ id: string }>} */
        const prevSlots = Array.isArray(prev.slots) ? prev.slots : [];
        const highest = prevSlots.reduce((/** @type {number} */ max, s) => {
            const n = Number(String((s && s.id) || '').replace(/^s/, ''));
            return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        let next = Math.max(typeof prev.nextSlotSeq === 'number' ? prev.nextSlotSeq : 1, highest + 1);
        const count = Math.max(1, Math.floor(Number(f.count) || 1));
        const slots = [];
        for (let i = 0; i < count; i++) {
            const id = prevSlots[i] && prevSlots[i].id ? prevSlots[i].id : 's' + (next++);
            slots.push({ id: id });
        }

        /** @type {Rule[]} */
        const restrictions = [];
        const who = stripIds(f.who && f.who.options);
        if (who.length) restrictions.push({ kind: 'anyOf', scope: 'person', options: who });
        (f.team || []).forEach((/** @type {Rule} */ rule) => {
            const options = stripIds(rule.options);
            if (options.length) {
                restrictions.push({ kind: 'anyOf', scope: 'team', strength: rule.strength === 'try' ? 'try' : 'must', options: options });
            }
        });

        const intensity = Number(f.intensity);
        return {
            slots: slots,
            nextSlotSeq: next,
            restrictions: restrictions,
            intensity: Number.isFinite(intensity) && intensity >= 0 ? intensity : 1,
            allowsAnotherRole: f.allowsAnotherRole === true,
        };
    }

    // ── Rules across Roles ─────────────────────────────────────────────────

    /** @param {Rule[]} rules @returns {Rule[]} */
    function crossFormsFrom(rules) {
        return (rules || []).filter(rule => rule && rule.kind === 'anyOf')
            .map(rule => ({ id: newId('r'), strength: rule.strength === 'try' ? 'try' : 'must', options: withIds(rule.options) }));
    }

    /** @param {Rule[]} forms @returns {Rule[]} */
    function crossRulesFrom(forms) {
        return (forms || [])
            .map((/** @type {Rule} */ rule) => ({ kind: 'anyOf', strength: rule.strength === 'try' ? 'try' : 'must', options: stripIds(rule.options) }))
            .filter((/** @type {Rule} */ rule) => rule.options.length);
    }

    // ── What this allows ────────────────────────────────────────────────────
    //
    // A team is judged only on its make-up — how many men, how many women —
    // because a line-up is unordered. Only Must rules narrow it: a Try rule is
    // a preference and allows everything.
    /** @param {Condition} c @returns {string[]} */
    const lineupMarks = c => (c && Array.isArray(c.sexes) ? c.sexes : []);

    /** @param {string[]} marks @param {Makeup} makeup */
    function fits(marks, makeup) {
        if (marks.length !== makeup.men + makeup.women) return false;
        const men = marks.filter((/** @type {string} */ m) => m === 'male').length;
        const women = marks.filter((/** @type {string} */ m) => m === 'female').length;
        return makeup.men >= men && makeup.women >= women;
    }

    /** @param {Option} option @returns {Condition[]} */
    const conditionsOf = option => (option && Array.isArray(option.conditions) ? option.conditions : []);
    /** @param {Rule} rule */
    const isMust = rule => !rule || rule.strength !== 'try';

    // Which make-ups `people` (those who can do it) and the team's Must rules
    // allow, most men first.
    /** @param {number} count @param {Array<{ sex?: string }>} people @param {Rule[]} teamRules @returns {Makeup[]} */
    function makeups(count, people, teamRules) {
        const men = (people || []).filter((/** @type {*} */ p) => p && p.sex === 'male').length;
        const women = (people || []).filter((/** @type {*} */ p) => p && p.sex === 'female').length;
        /** @type {Makeup[]} */
        const out = [];
        for (let m = count; m >= 0; m--) {
            const w = count - m;
            if (m <= men && w <= women) out.push({ men: m, women: w });
        }
        return out.filter(makeup => (teamRules || []).filter(isMust).every((/** @type {Rule} */ rule) => (rule.options || []).some(
            (/** @type {Option} */ option) => conditionsOf(option).every(c => c.kind !== 'lineup' || fits(lineupMarks(c), makeup))
        )));
    }

    // Which Roles a set of rules across Roles ties together by line-up.
    /** @param {Rule[]} rules @param {string[]} slugs @returns {string[]} */
    function linkedSlugs(rules, slugs) {
        /** @type {string[]} */
        const out = [];
        (rules || []).filter(isMust).forEach((/** @type {Rule} */ rule) => (rule.options || []).forEach((/** @type {Option} */ option) => conditionsOf(option).forEach(c => {
            if (c.kind === 'lineup' && slugs.indexOf(c.roleSlug) !== -1 && out.indexOf(c.roleSlug) === -1) out.push(c.roleSlug);
        })));
        return out;
    }

    // Every combination of make-ups across the linked Roles that meets every
    // Must rule. `roles` is [{ slug, makeups }].
    /** @param {Array<{ slug: string, makeups: Makeup[] }>} roles @param {Rule[]} crossRules @returns {Array<Record<string, Makeup>>} */
    function combos(roles, crossRules) {
        /** @type {Record<string, { slug: string, makeups: Makeup[] }>} */
        const bySlug = {};
        (roles || []).forEach(r => { bySlug[r.slug] = r; });
        const linked = linkedSlugs(crossRules, Object.keys(bySlug));
        if (!linked.length) return [];
        /** @type {Array<Record<string, Makeup>>} */
        let acc = [{}];
        linked.forEach(slug => {
            acc = acc.flatMap(partial => bySlug[slug].makeups.map(m => Object.assign({}, partial, { [slug]: m })));
        });
        return acc.filter(combo => (crossRules || []).filter(isMust).every((/** @type {Rule} */ rule) => (rule.options || []).some(
            (/** @type {Option} */ option) => conditionsOf(option).every(c => c.kind !== 'lineup' || !combo[c.roleSlug] || fits(lineupMarks(c), combo[c.roleSlug]))
        )));
    }

    // ── Reading a rule aloud ────────────────────────────────────────────────
    //
    // `names` turns ids into words: { tag, role, type, person }.
    /** @param {number} k @param {string} one @param {string} many */
    const n = (k, one, many) => (k === 1 ? one : k + ' ' + many);

    /** @param {string[]} marks */
    function lineupWords(marks) {
        const m = marks.filter((/** @type {string} */ x) => x === 'male').length;
        const w = marks.filter((/** @type {string} */ x) => x === 'female').length;
        const a = marks.length - m - w;
        if (!m && !w) return a === 1 ? 'anyone' : a + ' people';
        const parts = [];
        if (m) parts.push(n(m, 'a man', 'men'));
        if (w) parts.push(n(w, 'a woman', 'women'));
        if (a) parts.push(n(a, 'one more of either', 'more of either'));
        return parts.join(' and ');
    }

    /** @param {Makeup} makeup */
    function makeupWords(makeup) {
        return lineupWords(Array(makeup.men).fill('male').concat(Array(makeup.women).fill('female')));
    }

    /** @param {Condition} c @param {string} scope @param {Names} [names] */
    function conditionWords(c, scope, names) {
        /** @type {Names} */
        const nm = names || {};
        /** @param {((v: string) => *) | undefined} fn @param {string} v */
        const call = (fn, v) => (typeof fn === 'function' ? fn(v) : v) || '…';
        const whose = scope === 'across' && c.roleSlug ? call(nm.role, c.roleSlug) + ' ' : '';
        switch (c.kind) {
            case 'requireTag': return 'tagged ' + call(nm.tag, c.tagId);
            case 'excludeTag': return 'not tagged ' + call(nm.tag, c.tagId);
            case 'sex': return c.sex === 'female' ? 'a woman' : 'a man';
            case 'allowlist': return 'one of ' + ((c.personIds || []).map((/** @type {string} */ id) => call(nm.person, id)).join(', ') || '…');
            case 'lineup': return whose + (whose ? 'is ' : '') + lineupWords(lineupMarks(c));
            case 'atLeastTagged': return whose + (whose ? 'has ' : '') + 'at least ' + (c.atLeast || 1) + ' tagged ' + call(nm.tag, c.tagId);
            case 'notSameGroup': return (c.roleSlugs ? c.roleSlugs.map((/** @type {string} */ s) => call(nm.role, s)).join(' and ') + ' not' : 'no two') + ' from the same ' + call(nm.type, c.typeId);
            case 'sameGroup': return (c.roleSlugs ? c.roleSlugs.map((/** @type {string} */ s) => call(nm.role, s)).join(' and ') : 'everyone') + ' from the same ' + call(nm.type, c.typeId);
            case 'notTogether': return 'no two joined by ' + call(nm.type, c.typeId);
        }
        return '…';
    }

    /** @param {Rule} rule @param {string} scope @param {Names} [names] */
    function sentence(rule, scope, names) {
        const options = (rule && rule.options) || [];
        if (scope === 'who' && !options.length) return 'Anyone can do it.';
        const many = options.length > 1;
        const body = options.map((/** @type {Option} */ option) => {
            const words = conditionsOf(option).map(c => conditionWords(c, scope, names)).join(' and ') || '…';
            return many && conditionsOf(option).length > 1 ? '(' + words + ')' : words;
        }).join(', or ');
        if (scope === 'who') return 'Each person is ' + body + '.';
        return body.charAt(0).toUpperCase() + body.slice(1) + '.';
    }

    const RoleRulesCore = {
        newCondition,
        newOption,
        newRule,
        formFrom,
        settingsFrom,
        crossFormsFrom,
        crossRulesFrom,
        makeups,
        combos,
        linkedSlugs,
        lineupWords,
        makeupWords,
        conditionWords,
        sentence,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RoleRulesCore;
    }
    if (global) {
        global.RoleRulesCore = RoleRulesCore;
    }
})(typeof window !== 'undefined' ? window : null);
