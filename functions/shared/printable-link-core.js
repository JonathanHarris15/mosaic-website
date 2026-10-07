// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/printable-link-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Printable link fields — values filled where a Printable is linked.
//
// A Printable stores the layout and the wires. Some of those wires are not
// a Sunday, a person, or a hymn: they are blanks the event fills in for
// that date. The author names them in the data drawer (a text, a picture,
// a number, a date, or a list). Each date of an event the Printable is
// linked to holds the values, and the Printable reads them when it is
// opened from that date.
//
// A wire to Sunday booklet text is not a blank. Prayer country, Mosaic Kids,
// and any other church's pamphlet fields are data the printable binds. They
// do not become a form here, and this module does not name groups for them.
// Every printable, on a Sunday or any other event, fills only the blanks its
// author named.
//
// Pure. No Firestore, no DOM. The event page draws the form; the store
// fetches the values; Printable Live reads them.

(function (global) {
    'use strict';

    const KINDS = ['text', 'image', 'number', 'date', 'list'];
    const SCALAR_KINDS = ['text', 'image', 'number', 'date'];
    const MAX_LABEL = 80;

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

    // One form for every Printable linked to the event. Each section is the
    // blanks that printable's author named. A Sunday booklet wire does not
    // add a section, and nothing here invents a group name.
    function formFor(printables) {
        const sections = [];
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
        });
        return {
            sections: sections,
            hasFields: sections.length > 0,
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

    function kindLabel(kind) {
        return KIND_LABELS[kind] || 'Text';
    }

    const PrintableLinkCore = {
        KINDS,
        SCALAR_KINDS,
        normalizeInputs,
        normalizeInput,
        newInput,
        newColumn,
        inputById,
        readsEventInputs,
        formFor,
        blankRow,
        draftFromStored,
        mergePrintableInputs,
        kindLabel,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLinkCore;
    }
    if (global) {
        global.PrintableLinkCore = PrintableLinkCore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
