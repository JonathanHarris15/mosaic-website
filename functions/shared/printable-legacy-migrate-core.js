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

    function valuesFromTyped(contentOrRow) {
        const Typed = typedCore();
        let row = contentOrRow || {};
        if (Typed && row.pastoralPrayer) {
            row = Typed.toRow(Typed.normalise(row), '');
        } else if (Typed && row.prayerNation === undefined && (row.mosaicKids || row.announcements)) {
            row = Typed.toRow(Typed.normalise(row), '');
        }
        const bag = {};
        FILL_KEYS.forEach(key => {
            const v = row[key];
            if (v == null || v === '') return;
            bag[fillId(key)] = String(v);
        });
        return bag;
    }

    function mergeEventWithTyped(eventBag, typedContent) {
        const base = eventBag && typeof eventBag === 'object' ? Object.assign({}, eventBag) : {};
        const fromTyped = valuesFromTyped(typedContent);
        Object.keys(fromTyped).forEach(id => {
            const cur = base[id];
            if (cur == null || cur === '') base[id] = fromTyped[id];
        });
        return base;
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
        mergeEventWithTyped,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLegacyMigrate;
    }
    global.PrintableLegacyMigrate = PrintableLegacyMigrate;
}(typeof window !== 'undefined' ? window : global));
