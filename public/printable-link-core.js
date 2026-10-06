// Printable link fields — values filled where a Printable is linked.
//
// A Printable stores the layout and the wires. Some of those wires are not
// a Sunday, a person, or a hymn: they are blanks the event fills in for
// that date. The author names them in the data drawer (a text, a picture,
// a number, a date, or a list). Each date of an event the Printable is
// linked to holds the values, and the Printable reads them when it is
// opened from that date.
//
// The Sunday service guide already wires Mosaic Kids and the prayer-country
// facts through sunday_typed. Those are the same kind of blank — typed once
// for the week, read by the guide — so a linked guide asks the Sunday for
// whichever of those fields it actually uses. Announcements stay on the
// Sunday's Announcements tab; this module never offers them.
//
// Pure. No Firestore, no DOM. The event page draws the form; the store
// fetches the values; Printable Live reads them.

(function (global) {
    'use strict';

    const KINDS = ['text', 'image', 'number', 'date', 'list'];
    const SCALAR_KINDS = ['text', 'image', 'number', 'date'];
    const MAX_LABEL = 80;

    // Booklet text a guide may already bind. Order is the order the form
    // shows. Announcements are absent on purpose.
    const SUNDAY_FILL = [
        { key: 'prayerNation', label: 'Prayer country', kind: 'text', group: 'Prayer' },
        { key: 'prayerContinent', label: 'Continent', kind: 'text', group: 'Prayer' },
        { key: 'prayerCapital', label: 'Capital', kind: 'text', group: 'Prayer' },
        { key: 'prayerPopulation', label: 'Population', kind: 'text', group: 'Prayer' },
        { key: 'prayerLanguage', label: 'Official language', kind: 'text', group: 'Prayer' },
        { key: 'prayerTotalLanguages', label: 'Total languages', kind: 'text', group: 'Prayer' },
        { key: 'prayerLiteracy', label: 'Literacy', kind: 'text', group: 'Prayer' },
        { key: 'prayerChristian', label: 'Christian', kind: 'text', group: 'Prayer' },
        { key: 'prayerEvangelical', label: 'Evangelical', kind: 'text', group: 'Prayer' },
        { key: 'prayerUnevangelized', label: 'Un-evangelized', kind: 'text', group: 'Prayer' },
        { key: 'prayerPrompts', label: 'Prayer prompts', kind: 'text', group: 'Prayer', multiline: true },
        { key: 'prayerCountryImage', label: 'Country map', kind: 'image', group: 'Prayer' },
        { key: 'kidsLessonTitle', label: 'Mosaic Kids lesson', kind: 'text', group: 'Mosaic Kids' },
        { key: 'kidsLessonVerse', label: 'Mosaic Kids verse', kind: 'text', group: 'Mosaic Kids' },
        { key: 'kidsSummary', label: 'Mosaic Kids summary', kind: 'text', group: 'Mosaic Kids', multiline: true },
        { key: 'kidsQuestions', label: 'Mosaic Kids questions', kind: 'text', group: 'Mosaic Kids', multiline: true },
    ];

    const KIND_LABELS = {
        text: 'Text', image: 'Image', number: 'Number', date: 'Date', list: 'List',
    };

    function cleanLabel(label, fallback) {
        const s = String(label == null ? '' : label).trim().slice(0, MAX_LABEL);
        return s || fallback;
    }

    function normalizeColumn(col, index) {
        if (!col || !col.id) return null;
        const kind = SCALAR_KINDS.indexOf(col.kind) === -1 ? 'text' : col.kind;
        return {
            id: String(col.id),
            label: cleanLabel(col.label, 'Column ' + (index + 1)),
            kind: kind,
        };
    }

    function normalizeInput(input, index) {
        if (!input || !input.id) return null;
        const kind = KINDS.indexOf(input.kind) === -1 ? 'text' : input.kind;
        const out = {
            id: String(input.id),
            label: cleanLabel(input.label, 'Field ' + (index + 1)),
            kind: kind,
        };
        if (kind === 'list') {
            const fields = [];
            const seen = {};
            (input.fields || []).forEach((col, i) => {
                const c = normalizeColumn(col, i);
                if (!c || seen[c.id]) return;
                seen[c.id] = true;
                fields.push(c);
            });
            out.fields = fields;
        }
        return out;
    }

    function normalizeInputs(list) {
        const out = [];
        const seen = {};
        (list || []).forEach(input => {
            const n = normalizeInput(input, out.length);
            if (!n || seen[n.id]) return;
            seen[n.id] = true;
            out.push(n);
        });
        return out;
    }

    function newInput(kind, label, id) {
        const k = KINDS.indexOf(kind) === -1 ? 'text' : kind;
        const input = {
            id: String(id || ''),
            label: label,
            kind: k,
            fields: k === 'list' ? [] : undefined,
        };
        return normalizeInput(input, 0);
    }

    function newColumn(kind, label, id) {
        return normalizeColumn({ id: id, label: label, kind: kind }, 0);
    }

    function inputById(project, id) {
        if (!id) return null;
        return normalizeInputs(project && project.inputs).find(i => i.id === id) || null;
    }

    function walkNodes(nodes, fn, parentRepeat) {
        (nodes || []).forEach(node => {
            fn(node, parentRepeat || null);
            if (node.children && node.children.length) {
                walkNodes(node.children, fn, node.repeat || parentRepeat || null);
            }
        });
    }

    function eachNode(project, fn) {
        (project && project.pages || []).forEach(page => walkNodes(page.nodes, fn, null));
    }

    // True when the project asks the event for values: an author-defined
    // field, or a wire to one.
    function readsEventInputs(project) {
        if (normalizeInputs(project && project.inputs).length) return true;
        let found = false;
        eachNode(project, node => {
            if (found) return;
            if (node.repeat && node.repeat.source === 'event_list') found = true;
            Object.keys(node.bind || {}).forEach(prop => {
                const b = node.bind[prop];
                if (b && b.source === 'event_field') found = true;
            });
        });
        return found;
    }

    // sunday_typed wires, plus the kids-question list, minus announcements.
    function sundayFieldsUsed(project) {
        const used = {};
        eachNode(project, (node, parentRepeat) => {
            if (node.repeat && node.repeat.source === 'sunday_kids_questions') used.kidsQuestions = true;
            Object.keys(node.bind || {}).forEach(prop => {
                const b = node.bind[prop];
                if (!b) return;
                if (b.scope === 'global' && b.source === 'sunday_typed' && b.field) used[b.field] = true;
                if (b.scope === 'item' && parentRepeat && parentRepeat.source === 'sunday_kids_questions') {
                    used.kidsQuestions = true;
                }
            });
        });
        return SUNDAY_FILL.filter(f => used[f.key]);
    }

    // One form for every Printable linked to the event. Author fields stay
    // with their Printable. Sunday booklet fields are one shared set — every
    // guide reads the same Sunday record.
    function formFor(printables) {
        const sections = [];
        const seen = {};
        const sundayFields = [];
        (printables || []).forEach(p => {
            if (!p) return;
            const inputs = normalizeInputs(p.inputs);
            if (inputs.length && p.id) {
                sections.push({
                    printableId: String(p.id),
                    name: String(p.name || 'Printable'),
                    inputs: inputs,
                });
            }
            sundayFieldsUsed(p).forEach(f => {
                if (seen[f.key]) return;
                seen[f.key] = true;
                sundayFields.push(f);
            });
        });
        const sundayGroups = [];
        ['Prayer', 'Mosaic Kids'].forEach(name => {
            const fields = sundayFields.filter(f => f.group === name);
            if (fields.length) sundayGroups.push({ name: name, fields: fields });
        });
        return {
            sections: sections,
            sundayFields: sundayFields,
            sundayGroups: sundayGroups,
            hasFields: sections.length > 0 || sundayFields.length > 0,
        };
    }

    function blankRow(input) {
        const row = {};
        (input.fields || []).forEach(col => { row[col.id] = ''; });
        return row;
    }

    function draftFromStored(inputs, stored) {
        const bag = stored && typeof stored === 'object' ? stored : {};
        const draft = {};
        normalizeInputs(inputs).forEach(input => {
            const v = bag[input.id];
            if (input.kind === 'list') {
                const rows = Array.isArray(v) ? v : [];
                draft[input.id] = rows.map(row => {
                    const out = blankRow(input);
                    (input.fields || []).forEach(col => {
                        out[col.id] = row && row[col.id] != null ? String(row[col.id]) : '';
                    });
                    return out;
                });
            } else {
                draft[input.id] = v == null ? '' : String(v);
            }
        });
        return draft;
    }

    // Replace this Printable's values. Other Printables on the same date
    // stay as they were.
    function mergePrintableInputs(existing, printableId, values) {
        const base = existing && typeof existing === 'object' && !Array.isArray(existing)
            ? Object.assign({}, existing) : {};
        if (!printableId) return base;
        base[String(printableId)] = values && typeof values === 'object' ? values : {};
        return base;
    }

    // Overlay the fields the form showed onto the Sunday's booklet text.
    // Announcements are never in `keys`, and a key that is not in the patch
    // is left as it was stored.
    function mergeSundayContent(typed, service, patch, keys) {
        if (!typed) return null;
        const draft = typed.toDraft(typed.fromService(service));
        (keys || []).forEach(key => {
            if (key === 'announcements' || key === 'announcementCount') return;
            if (patch && Object.prototype.hasOwnProperty.call(patch, key)) draft[key] = patch[key];
        });
        return typed.normalise(typed.fromDraft(draft));
    }

    function kindLabel(kind) {
        return KIND_LABELS[kind] || 'Text';
    }

    const PrintableLinkCore = {
        KINDS,
        SCALAR_KINDS,
        SUNDAY_FILL,
        normalizeInputs,
        normalizeInput,
        newInput,
        newColumn,
        inputById,
        readsEventInputs,
        sundayFieldsUsed,
        formFor,
        blankRow,
        draftFromStored,
        mergePrintableInputs,
        mergeSundayContent,
        kindLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLinkCore;
    }
    if (global) {
        global.PrintableLinkCore = PrintableLinkCore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
