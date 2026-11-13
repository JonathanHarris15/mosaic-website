// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/printable-legacy-migrate-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Printable legacy migrate — Sunday booklet typed wires → event fill-ins.
//
// Prayer-country facts and Mosaic Kids scalars used to be `sunday_typed`
// blanks on `services/{date}.typedContent`. They are fill-ins on the linked
// event now: names on the Printable (`project.inputs`), values on the
// occurrence (`printableInputs`). Announcements and kids questions as rows
// already live in the query builder (`sunday_announcements`,
// `sunday_kids_questions`); a joined-text wire to those fields becomes a
// text fill-in so the page still has somewhere to put the words.
//
// Pure: no Firestore, no DOM.

(function (global) {
    'use strict';

    function typedCore() {
        if (global.SundayTypedCore) return global.SundayTypedCore;
        try { return require('./sunday-typed-core.js'); } catch (e) { return null; }
    }

    function linkCore() {
        if (global.PrintableLinkCore) return global.PrintableLinkCore;
        try { return require('./printable-link-core.js'); } catch (e) { return null; }
    }

    const PREFIX = 'legacy_';

    // Every sunday_typed field that becomes one text/image/number fill-in.
    // announcementCount is derived — dropped on migrate.
    const FILL_KEYS = [
        'prayerNation', 'prayerContinent', 'prayerCapital', 'prayerPopulation',
        'prayerLanguage', 'prayerTotalLanguages', 'prayerLiteracy',
        'prayerChristian', 'prayerEvangelical', 'prayerUnevangelized',
        'prayerPrompts', 'prayerCountryImage',
        'kidsLessonTitle', 'kidsLessonVerse', 'kidsSummary', 'kidsQuestions',
        'announcements',
    ];

    function fillId(typedKey) {
        return PREFIX + String(typedKey || '');
    }

    function typedKeyOf(id) {
        const s = String(id || '');
        if (s.indexOf(PREFIX) === 0) return s.slice(PREFIX.length);
        return FILL_KEYS.indexOf(s) !== -1 ? s : '';
    }

    function isLegacyFillId(id) {
        return !!typedKeyOf(id);
    }

    function fieldMeta(typedKey) {
        const Typed = typedCore();
        const fields = (Typed && Typed.FIELDS) || [];
        return fields.find(f => f.key === typedKey) || null;
    }

    function inputDefFor(typedKey) {
        const meta = fieldMeta(typedKey) || { key: typedKey, label: typedKey, kind: 'text' };
        let kind = 'text';
        if (meta.kind === 'image') kind = 'image';
        else if (meta.kind === 'number') kind = 'number';
        return {
            id: fillId(typedKey),
            label: meta.label || typedKey,
            kind: kind,
        };
    }

    function ensureInput(inputs, def) {
        const Link = linkCore();
        const list = inputs || [];
        if (list.some(i => i && i.id === def.id)) return list;
        const made = Link
            ? Link.newInput(def.kind, def.label, def.id)
            : { id: def.id, label: def.label, kind: def.kind };
        return list.concat([made]);
    }

    function inputDefsNeeded() {
        return FILL_KEYS.map(inputDefFor);
    }

    function rewriteBind(bind) {
        if (!bind || bind.source !== 'sunday_typed') return { bind: bind, changed: false, typedKey: '' };
        const key = bind.field;
        if (!key || key === 'announcementCount') {
            return { bind: null, changed: true, typedKey: '', drop: true };
        }
        if (FILL_KEYS.indexOf(key) === -1) return { bind: bind, changed: false, typedKey: '' };
        return {
            bind: {
                scope: 'global',
                source: 'event_field',
                field: fillId(key),
                params: {},
            },
            changed: true,
            typedKey: key,
        };
    }

    function walkNodes(nodes, fn) {
        (nodes || []).forEach(node => {
            if (!node) return;
            fn(node);
            walkNodes(node.children, fn);
        });
    }

    // Rewrite sunday_typed wires to event fill-ins and ensure those fill-ins
    // exist on the printable. Idempotent.
    function migrateProject(project) {
        const p = project && typeof project === 'object' ? project : null;
        if (!p) return { project: p, changed: false };
        let changed = false;
        let anyLegacy = false;
        (p.pages || []).forEach(page => {
            walkNodes(page && page.nodes, node => {
                if (!node || !node.bind) return;
                ['text', 'src'].forEach(prop => {
                    const b = node.bind[prop];
                    if (!b || b.source !== 'sunday_typed') return;
                    anyLegacy = true;
                    const out = rewriteBind(b);
                    if (!out.changed) return;
                    if (out.drop) {
                        delete node.bind[prop];
                        if (!node.bind.text && !node.bind.src) node.bind = null;
                    } else {
                        node.bind[prop] = out.bind;
                    }
                    changed = true;
                });
            });
        });
        let inputs = (linkCore() ? linkCore().normalizeInputs(p.inputs) : (p.inputs || [])).slice();
        const before = inputs.length;
        if (anyLegacy || changed) {
            inputDefsNeeded().forEach(def => { inputs = ensureInput(inputs, def); });
        }
        if (inputs.length !== before) changed = true;
        if (!changed) return { project: p, changed: false };
        return {
            project: Object.assign({}, p, { inputs: inputs }),
            changed: true,
        };
    }

    /** @param {any} contentOrRow @return {Record<string, any>} */
    function rowOf(contentOrRow) {
        const Typed = typedCore();
        let row = contentOrRow || {};
        if (Typed && row.pastoralPrayer) {
            row = Typed.toRow(Typed.normalise(row), '');
        } else if (Typed && row.prayerNation === undefined && (row.mosaicKids || row.announcements)) {
            row = Typed.toRow(Typed.normalise(row), '');
        }
        return row;
    }

    /**
     * @param {any} contentOrRow
     * @param {boolean} includeBlank
     * @return {Record<string, any>}
     */
    function bagFromContent(contentOrRow, includeBlank) {
        const row = rowOf(contentOrRow);
        /** @type {Record<string, any>} */
        const bag = {};
        FILL_KEYS.forEach(key => {
            const v = row[key];
            if (!includeBlank && (v == null || v === '')) return;
            bag[fillId(key)] = v == null ? '' : String(v);
        });
        return bag;
    }

    /** @param {any} contentOrRow @return {Record<string, any>} */
    function valuesFromTyped(contentOrRow) {
        return bagFromContent(contentOrRow, false);
    }

    // An editor save writes a blank only when that key is already on the
    // occurrence, so a clear sticks and a field nobody has opened yet can
    // still be copied.
    /**
     * @param {any} content
     * @param {any} existingBag
     * @return {Record<string, any>}
     */
    function patchFromContent(content, existingBag) {
        const full = bagFromContent(content, true);
        const bag = existingBag && typeof existingBag === 'object' ? existingBag : {};
        /** @type {Record<string, any>} */
        const patch = {};
        Object.keys(full).forEach(id => {
            if (full[id] !== '' || Object.prototype.hasOwnProperty.call(bag, id)) patch[id] = full[id];
        });
        return patch;
    }

    /** @param {any} bag */
    function draftFromBag(bag) {
        const Typed = typedCore();
        if (!Typed) return {};
        const box = bag && typeof bag === 'object' ? bag : {};
        /** @type {Record<string, any>} */
        const row = {};
        FILL_KEYS.forEach(key => {
            const id = fillId(key);
            if (Object.prototype.hasOwnProperty.call(box, id)) row[key] = box[id];
        });
        if (Object.prototype.hasOwnProperty.call(box, fillId('announcements'))) {
            row.announcements = Typed.asAnnouncements(box[fillId('announcements')]);
        }
        return Typed.toDraft(Typed.fromDraft(row));
    }

    const PrintableLegacyMigrate = {
        PREFIX,
        FILL_KEYS,
        fillId,
        typedKeyOf,
        isLegacyFillId,
        inputDefsNeeded,
        migrateProject,
        valuesFromTyped,
        patchFromContent,
        draftFromBag,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLegacyMigrate;
    }
    global.PrintableLegacyMigrate = PrintableLegacyMigrate;
}(typeof window !== 'undefined' ? window : global));
