// Role Editor Core — one open Role, saving itself (MS-721, ADR 0081).
//
// The pure half of the Roles Manager's editor: what a draft is, what it costs
// to store, what is wrong with it, whether a new name may be created, and the
// SESSION that saves one Role as it is changed. No DOM, no Firestore. The
// page hands in a store (`update(id, patch)`) and pipes its listener into
// `remote()`; everything that decides what reaches /roles lives here.
//
// ⚠ A SESSION BELONGS TO ONE ROLE, AND READS NOTHING ELSE. It keeps its own
// values and its own stored copy, and its save and its check are computed
// from those alone. The editor this replaced bound the autosave to a Role id
// but built every write from the PAGE's draft — so opening Role B, which
// swapped the page's draft before Role A's session was stopped, flushed A's
// session with B's name, slots and rules and wrote them over A. Creating a
// Role did the same thing to whichever Role was open. A session cannot do
// that: nothing it writes comes from outside it, and `edit` refuses values
// handed in for any other Role.
//
// Lifecycle, and the only one:
//
//     open ──edit/revert/remote/flush──▶ open ──close()──▶ closed
//                                           └──discard()──▶ closed
//
// `close` sends what is waiting first (a change is never dropped by moving
// on); `discard` drops it (the Role is being deleted, and a save after the
// delete would fail on a document that is gone). A closed session ignores
// everything and says nothing.
//
// Loaded as a classic <script> (window.RoleEditorCore) and exported for Node.

(function (global) {
    'use strict';

    const inNode = typeof require === 'function' && typeof module !== 'undefined' && module.exports;
    /** @type {*} */
    const g = global || {};
    const RolesCore = inNode ? require('./roles-core.js') : g.RolesCore;
    const LiveFields = inNode ? require('./live-fields-core.js') : g.LiveFields;

    // What an editor can change on a Role: its name and what it involves.
    // Who it needs, its rules and its rest are each Event's (ADR 0085), set on
    // that Event's Roles & rules tab and never written here.
    const FIELDS = Object.freeze(['name', 'description']);

    /** @param {*} v */
    const clone = v => (v == null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));
    /** @param {*} v */
    const norm = v => (typeof v === 'string' ? v.trim() : JSON.stringify(v == null ? null : v));
    /** @param {*} a @param {*} b */
    const same = (a, b) => norm(a) === norm(b);

    /** @param {*} def @returns {string} */
    const slugOf = def => (def && def.slug) || RolesCore.slugify(def && def.name);

    // ── Reading the stored list ──────────────────────────────────────────────

    // Stored definitions that would take a liturgical slug cannot be listed —
    // allRoles rightly refuses to mix two Roles' serve history — but /roles is
    // editor-writable, so one can arrive by hand. They are held aside and
    // reported. `clashesWith` is the NAME of the built-in Role, never its slug:
    // this is the one screen that must never show an id.
    /**
     * @param {Array<Record<string, *>>} all Stored definitions, as `{ id, ...doc }`.
     * @returns {{ definitions: Array<Record<string, *>>, conflicting: Array<Record<string, *>>, sharedSlugs: Array<{ slug: string, names: string[] }> }}
     */
    function partition(all) {
        /** @type {Array<Record<string, *>>} */
        const definitions = [];
        /** @type {Array<Record<string, *>>} */
        const conflicting = [];
        (all || []).forEach(def => {
            const slug = slugOf(def);
            if (RolesCore.LITURGICAL_SLUGS.indexOf(slug) === -1) {
                definitions.push(def);
                return;
            }
            const builtIn = RolesCore.LITURGICAL_ROLES.find((/** @type {*} */ role) => role.slug === slug);
            conflicting.push(Object.assign({}, def, { slug, clashesWith: (builtIn && builtIn.name) || slug }));
        });
        // Two stored Roles that read as one slug. They stay in the list —
        // deleting one is the only fix, and a Role you cannot see you cannot
        // delete — but every reader of a slug now refuses to guess between
        // them (RolesCore.registry), so the page has to say why both have
        // stopped being takeable.
        /** @type {Record<string, string[]>} */
        const names = {};
        definitions.forEach(def => { (names[slugOf(def)] = names[slugOf(def)] || []).push(String(def.name || '')); });
        const sharedSlugs = Object.keys(names).filter(slug => names[slug].length > 1).sort()
            .map(slug => ({ slug, names: names[slug].slice().sort() }));
        return { definitions: sortByName(definitions), conflicting, sharedSlugs };
    }

    /** @param {Array<Record<string, *>>} defs */
    function sortByName(defs) {
        return defs.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }

    // The list with one stored definition changed — always by id, never by
    // position, and always re-sorted, so a rename moves the row and nothing
    // else.
    /**
     * @param {Array<Record<string, *>>} defs
     * @param {string} id
     * @param {Record<string, *>} fields
     */
    function withStored(defs, id, fields) {
        return sortByName(defs.map(def => (def.id === id ? Object.assign({}, def, fields, { id }) : def)));
    }

    // ── Creating ─────────────────────────────────────────────────────────────

    // Whether `name` may become a new Role, and the definition it would be.
    // The slug is fixed at creation and Involvement is written under it, so a
    // collision is refused before the write rather than discovered later as
    // two Roles sharing one serve history. An existing definition is compared
    // by the slug it actually reads as — one stored without a slug reads as
    // its name slugified, everywhere, so that is what it would collide on.
    /**
     * @param {*} name
     * @param {Array<Record<string, *>>} existing
     * @returns {{ ok: true, definition: Record<string, *> } | { ok: false, error: string }}
     */
    function proposeNew(name, existing) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return { ok: false, error: 'A Role needs a name' };
        const definition = RolesCore.newDefinition(trimmed);
        if (RolesCore.LITURGICAL_SLUGS.indexOf(definition.slug) !== -1) {
            return {
                ok: false,
                error: `"${trimmed}" is a liturgical Role. Those are built in and cannot be recreated here — pick another name.`,
            };
        }
        const clash = (existing || []).find(def => slugOf(def) === definition.slug);
        if (clash) {
            return {
                ok: false,
                error: clash.name && clash.name.trim() !== trimmed
                    ? `"${trimmed}" is too close to the existing Role "${clash.name}" — pick another name`
                    : `A Role called "${trimmed}" already exists`,
            };
        }
        const check = RolesCore.validateDefinition(definition);
        if (!check.valid) return { ok: false, error: check.errors.join(' ') };
        return { ok: true, definition };
    }

    // ── A draft ──────────────────────────────────────────────────────────────

    // The working copy a Role opens as: a deep copy, so nothing the editor
    // does touches the stored one, with the defaults filled in rather than
    // left absent — the form shows what a Role nobody has configured actually
    // does (exclusive, one week's rest) instead of two empty controls.
    //
    // ⚠ The slug is fixed HERE, from the Role as stored. A definition stored
    // without one already reads as its stored name slugified, everywhere — so
    // that is the slug it keeps. Deriving it later from whatever is typed in
    // the name box would move the Role's whole serve history onto a new slug
    // (and could land it on a neighbour's, or a liturgical one).
    /** @param {Record<string, *>} role */
    function draftFrom(role) {
        return Object.assign(clone(role), { slug: slugOf(role) });
    }

    // Every problem at once, so the editor fixes them together.
    /**
     * @param {Record<string, *> | null} draft
     * @returns {string[]}
     */
    function errorsFor(draft) {
        if (!draft) return [];
        // Only what this editor writes is judged: a rule stored on the Role
        // before ADR 0085 is not this page's to fix, and must not stop a rename.
        return RolesCore.validateDefinition({
            name: draft.name, slug: draft.slug, family: draft.family, description: draft.description,
        }).errors.slice();
    }

    // The document a Role is. ⚠ EVERY FIELD A ROLE HAS MUST BE LISTED HERE:
    // a field missing from this object reads back blank for ever. The slug is
    // carried across, never recomputed — renaming must never move a Role's
    // serve history; only a definition that stored none falls back to the one
    // every read path already derives for it. `newDefinition` is the list;
    // the paired test walks it.
    /** @param {Record<string, *>} draft */
    function definitionFrom(draft) {
        return {
            name: String(draft.name || '').trim(),
            slug: draft.slug || RolesCore.slugify(draft.name),
            family: RolesCore.FAMILIES.SERVANT,
            description: String(draft.description || '').trim(),
        };
    }

    // The update() that stores `fields` of `draft` over `stored`: only those
    // fields, plus the slot counter whenever the slots move (so a removed
    // slot's id is never handed out again), plus a slug only when the stored
    // Role has none (the rules refuse changing one that is set).
    /**
     * @param {Record<string, *>} stored
     * @param {Record<string, *>} draft
     * @param {string[]} fields
     */
    function writeFor(stored, draft, fields) {
        const definition = /** @type {Record<string, *>} */ (definitionFrom(draft));
        /** @type {Record<string, *>} */
        const out = {};
        fields.forEach(f => { out[f] = definition[f]; });
        if (!stored || !stored.slug) out.slug = definition.slug;
        return out;
    }

    // ── The session ──────────────────────────────────────────────────────────

    // In Node a pending debounce must not hold the process open.
    /** @param {() => void} fn @param {number} ms */
    function defaultSetTimeout(fn, ms) {
        const t = setTimeout(fn, ms);
        if (t && typeof t === 'object' && typeof t.unref === 'function') t.unref();
        return t;
    }

    /**
     * @typedef {{
     *   id: string,
     *   status: string,
     *   error: string,
     *   dirty: string[],
     *   showProblems: boolean,
     *   values: Record<string, *>,
     * }} SessionState
     */

    /**
     * @param {{
     *   role: Record<string, *>,
     *   store: { update: (id: string, patch: Record<string, *>) => Promise<*> },
     *   onState?: (state: SessionState) => void,
     *   onSaved?: (id: string, write: Record<string, *>) => void,
     *   onFailed?: (id: string, error: *) => void,
     *   debounceMs?: number,
     *   setTimeout?: (fn: () => void, ms: number) => *,
     *   clearTimeout?: (id: *) => void,
     * }} opts
     */
    function openSession(opts) {
        const role = opts.role;
        if (!role || !role.id) throw new Error('A session needs a stored Role with an id');
        if (RolesCore.isLocked(role)) throw new Error('Liturgical Roles are built in and cannot be edited');
        const id = String(role.id);
        const store = opts.store;
        const onState = opts.onState || (() => {});
        const onSaved = opts.onSaved || (() => {});
        const onFailed = opts.onFailed || (() => {});

        // The Role as this session last knew it stored.
        let stored = clone(role);
        const opened = draftFrom(role);
        // Fixed for the life of the session — see draftFrom.
        const slug = opened.slug;
        let closed = false;
        let batching = false;

        /** @param {Record<string, *>} values */
        const fullDraft = values => Object.assign({}, stored, values, { slug });

        /** @type {Record<string, *>} */
        const initial = {};
        FIELDS.forEach(f => { initial[f] = clone(opened[f]); });

        const live = LiveFields.create({
            fields: FIELDS.slice(),
            initial,
            same,
            debounceMs: opts.debounceMs,
            setTimeout: opts.setTimeout || defaultSetTimeout,
            clearTimeout: opts.clearTimeout,
            validate: (/** @type {Record<string, *>} */ values) => {
                const errors = errorsFor(fullDraft(values));
                return errors.length ? { role: errors.join(' ') } : null;
            },
            save: async (/** @type {Record<string, *>} */ patch) => {
                const write = writeFor(stored, fullDraft(Object.assign({}, live.state.draft, patch)), Object.keys(patch));
                try {
                    await store.update(id, write);
                } catch (e) {
                    onFailed(id, e);
                    throw e;
                }
                stored = Object.assign({}, stored, write);
                onSaved(id, write);
                return write;
            },
            onChange: () => { if (!batching) emit(); },
        });

        /** @returns {SessionState} */
        function state() {
            const st = live.state;
            return {
                id,
                status: st.status,
                error: st.error,
                dirty: st.dirty,
                // The problems are shown once a change has been refused for
                // them — not the moment a Role opens.
                showProblems: Object.keys(st.invalid).length > 0 && st.dirty.length > 0,
                values: clone(st.draft),
            };
        }

        function emit() { if (!closed) onState(state()); }

        return {
            id,

            get state() { return state(); },
            get closed() { return closed; },

            // The page's whole draft, handed over after any change. Refused
            // for another Role: this is the wire the old editor crossed.
            /** @param {string} forId @param {Record<string, *>} values */
            edit(forId, values) {
                if (closed || String(forId) !== id || !values) return false;
                batching = true;
                try {
                    FIELDS.forEach(f => live.edit(f, clone(values[f])));
                } finally {
                    batching = false;
                }
                emit();
                return true;
            },

            flush() { return closed ? Promise.resolve(false) : live.flush(); },

            /** @param {string} field */
            revert(field) { if (!closed) live.revert(field); },

            // Another editor's write, from the listener. Our own echo is
            // ignored; theirs lands in any field this editor is not changing.
            /** @param {Record<string, *>} data @param {{ pendingWrites?: boolean }} [meta] */
            remote(data, meta) {
                if (closed || !data) return;
                if (meta && meta.pendingWrites) return;
                stored = Object.assign({ id }, stored, data);
                live.remote(data);
            },

            // Leaving the Role. What is waiting is sent first, from this
            // session's own values; the returned promise settles when it lands.
            //
            // ⚠ Not disposed until it has landed. A save already in flight
            // returns from flush() without the change made meanwhile, so
            // disposing at once would drop that change; this keeps sending
            // until nothing is waiting or a save is refused.
            close() {
                if (closed) return Promise.resolve(true);
                closed = true;
                return (async () => {
                    let ok = true;
                    try {
                        while (ok && live.dirtyFields().length) ok = await live.flush();
                    } finally {
                        live.dispose();
                    }
                    return ok;
                })();
            },

            // Leaving the Role and dropping what was waiting.
            discard() {
                closed = true;
                live.dispose();
            },
        };
    }

    const RoleEditorCore = {
        FIELDS,
        partition,
        withStored,
        proposeNew,
        draftFrom,
                errorsFor,
        definitionFrom,
        writeFor,
        openSession,
    };

    if (inNode) module.exports = RoleEditorCore;
    if (global) global.RoleEditorCore = RoleEditorCore;
})(typeof window !== 'undefined' ? window : null);
