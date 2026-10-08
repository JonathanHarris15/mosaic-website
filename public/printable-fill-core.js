// Printable fill — the blanks an editor types on the preview.
//
// A blank is a value a person supplies, sitting where the printable already
// put it: a field filled on the event, a column of such a list, or Sunday
// booklet text the page is wired to (prayer-country facts, Mosaic Kids).
// A live Sunday, a hymn, scripture, and announcements are not blanks.
// Announcements have their own tab, and the count of them is derived.
//
// The same blank placed twice is one blank. An empty list that drew no rows
// is one blank until a row exists. Pure: no Firestore, no DOM.

(function (global) {
    'use strict';

    const MULTILINE = { prayerPrompts: true, kidsSummary: true, kidsQuestions: true };
    const SKIP_SUNDAY = { announcements: true, announcementCount: true };

    function linkCore() {
        if (global.PrintableLinkCore) return global.PrintableLinkCore;
        try { return require('./printable-link-core.js'); } catch (e) { return null; }
    }

    function typedCore() {
        if (global.SundayTypedCore) return global.SundayTypedCore;
        try { return require('./sunday-typed-core.js'); } catch (e) { return null; }
    }

    function typedFields() {
        const Typed = typedCore();
        return (Typed && Typed.FIELDS) || [];
    }

    function inputsOf(project) {
        const Link = linkCore();
        if (Link) return Link.normalizeInputs(project && project.inputs);
        return (project && project.inputs) || [];
    }

    function inputById(inputs, id) {
        if (!id) return null;
        return (inputs || []).find(i => i && i.id === id) || null;
    }

    function whenOf(params) {
        const w = (params && params.when) || {};
        return { mode: w.mode || 'this', date: w.date || '' };
    }

    function whenKey(when) {
        const w = when || {};
        if (w.mode === 'date') return 'date:' + (w.date || '');
        return w.mode || 'this';
    }

    function originalId(id) {
        const s = String(id || '');
        const at = s.indexOf('~');
        return at < 0 ? s : s.slice(0, at);
    }

    function rowIndex(id) {
        const s = String(id || '');
        const at = s.lastIndexOf('~');
        if (at < 0) return 0;
        const tail = s.slice(at + 1);
        return /^\d+$/.test(tail) ? Number(tail) : 0;
    }

    function findNode(project, id) {
        let found = null;
        const walk = (nodes) => {
            (nodes || []).forEach(n => {
                if (found || !n) return;
                if (n.id === id) { found = n; return; }
                walk(n.children);
            });
        };
        (project && project.pages || []).forEach(p => walk(p.nodes));
        return found;
    }

    function indexProject(project) {
        const inside = {};
        const walk = (nodes, repeat) => {
            (nodes || []).forEach(node => {
                if (!node) return;
                inside[node.id] = repeat || null;
                walk(node.children, node.repeat || repeat || null);
            });
        };
        (project && project.pages || []).forEach(p => walk(p.nodes, null));
        return { inside: inside, inputs: inputsOf(project), fields: typedFields() };
    }

    function boundProp(node) {
        const bind = node && node.bind;
        if (!bind) return '';
        if (bind.text) return 'text';
        if (bind.src) return 'src';
        return '';
    }

    function sundaySlot(bind, index) {
        if (!bind || bind.source !== 'sunday_typed') return null;
        if (SKIP_SUNDAY[bind.field]) return null;
        const field = (index.fields || []).find(f => f.key === bind.field);
        if (!field) return null;
        const when = whenOf(bind.params);
        const kind = field.kind === 'image' ? 'image' : 'text';
        return {
            id: 'sunday:' + bind.field + ':' + whenKey(when),
            store: 'sunday',
            field: bind.field,
            when: when,
            kind: kind,
            label: field.label,
            multiline: kind === 'text' && !!MULTILINE[bind.field],
        };
    }

    function eventScalarSlot(bind, index) {
        if (!bind || bind.source !== 'event_field' || bind.scope === 'item') return null;
        const input = inputById(index.inputs, bind.field);
        if (!input || input.kind === 'list') return null;
        const kind = input.kind === 'image' ? 'image' : input.kind;
        return {
            id: 'event:' + input.id,
            store: 'event',
            inputId: input.id,
            kind: kind,
            label: input.label,
            multiline: false,
        };
    }

    function itemSlot(node, bind, index) {
        if (!bind || bind.scope !== 'item') return null;
        const repeat = index.inside[originalId(node.id)];
        if (!repeat) return null;
        const row = rowIndex(node.id);
        if (repeat.source === 'event_list') {
            const inputId = repeat.params && repeat.params.inputId;
            const input = inputById(index.inputs, inputId);
            const col = input && (input.fields || []).find(c => c.id === bind.field);
            if (!input || !col) return null;
            return {
                id: 'row:' + input.id + ':' + row + ':' + col.id,
                store: 'event-row',
                inputId: input.id,
                columnId: col.id,
                rowIndex: row,
                kind: col.kind === 'image' ? 'image' : col.kind,
                label: input.label + ', ' + col.label,
                multiline: false,
            };
        }
        if (repeat.source === 'sunday_kids_questions' && bind.field === 'text') {
            const when = whenOf(repeat.params);
            return {
                id: 'kids:' + whenKey(when) + ':' + row,
                store: 'kids',
                rowIndex: row,
                when: when,
                kind: 'text',
                label: 'Question ' + (row + 1),
                multiline: false,
            };
        }
        return null;
    }

    function slotFor(node, index) {
        const prop = boundProp(node);
        if (!prop || !index) return null;
        const bind = node.bind[prop];
        return sundaySlot(bind, index) || eventScalarSlot(bind, index) || itemSlot(node, bind, index);
    }

    function listSpec(project, nodeId) {
        const node = findNode(project, nodeId);
        const repeat = node && node.repeat;
        if (!repeat) return null;
        if (repeat.source === 'event_list') {
            const inputId = repeat.params && repeat.params.inputId;
            if (!inputId) return null;
            const input = inputById(inputsOf(project), inputId);
            if (!input) return null;
            return { list: 'event', inputId: inputId, label: 'Add a row' };
        }
        if (repeat.source === 'sunday_kids_questions') {
            return {
                list: 'kids',
                when: whenOf(repeat.params),
                label: 'Add a question',
            };
        }
        return null;
    }

    function emptyListSlot(project, nodeId) {
        const spec = listSpec(project, nodeId);
        if (!spec) return null;
        if (spec.list === 'event') {
            return {
                id: 'empty:event:' + spec.inputId,
                store: 'empty-list',
                list: 'event',
                inputId: spec.inputId,
                label: 'List',
            };
        }
        return {
            id: 'empty:kids:' + whenKey(spec.when),
            store: 'empty-list',
            list: 'kids',
            when: spec.when,
            label: 'Questions',
        };
    }

    function walk(nodes, fn) {
        (nodes || []).forEach(node => {
            if (!node) return;
            fn(node);
            if (node.children && node.children.length) walk(node.children, fn);
        });
    }

    // `pages` is a list of expanded node arrays (one per drawn page).
    function slotsOn(project, pages) {
        const index = indexProject(project);
        const slots = [];
        (pages || []).forEach(nodes => {
            walk(nodes, node => {
                const listOf = node.attrs && node.attrs['data-list-of'];
                if (listOf && (!node.children || !node.children.length)) {
                    const empty = emptyListSlot(project, listOf);
                    if (empty) slots.push(empty);
                }
                const slot = slotFor(node, index);
                if (slot) slots.push(slot);
            });
        });
        return slots;
    }

    function isBlank(value) {
        return value == null || String(value).trim() === '';
    }

    function tally(slots, valueOf) {
        const seen = {};
        let total = 0;
        (slots || []).forEach(slot => {
            if (!slot || seen[slot.id]) return;
            seen[slot.id] = true;
            total += 1;
        });
        return { total: total, left: remaining(slots, valueOf).length };
    }

    // Blanks still empty, in the order the pages draw them. The same blank
    // placed twice is one blank, the first time it appears.
    function remaining(slots, valueOf) {
        const seen = {};
        const out = [];
        (slots || []).forEach(slot => {
            if (!slot || seen[slot.id]) return;
            seen[slot.id] = true;
            const value = valueOf ? valueOf(slot) : '';
            if (slot.store === 'empty-list' || isBlank(value)) out.push(slot);
        });
        return out;
    }

    function leftToGoText(left) {
        const n = Number(left) || 0;
        if (n === 1) return '1 left to go';
        return n + ' left to go';
    }

    // Walk the blanks still empty. delta +1 is the next one, -1 the previous,
    // wrapping. No current id means we have not landed yet: forward opens the
    // first, back opens the last. A current id that was just filled is gone
    // from the list; fallbackIndex is where it sat, and a forward step lands
    // on whatever slid into that place (or the first, when it was the last).
    function stepBlank(ids, currentId, delta, fallbackIndex) {
        const list = [];
        const seen = {};
        (ids || []).forEach(id => {
            if (!id || seen[id]) return;
            seen[id] = true;
            list.push(id);
        });
        if (!list.length) return '';
        const step = delta < 0 ? -1 : 1;
        let i = currentId ? list.indexOf(currentId) : -1;
        if (i < 0) {
            if (currentId) {
                const raw = fallbackIndex == null ? 0 : fallbackIndex;
                if (raw >= list.length) i = step < 0 ? 0 : -1;
                else i = step < 0 ? raw : raw - 1;
            } else {
                i = step < 0 ? 0 : -1;
            }
        }
        return list[(i + step + list.length) % list.length];
    }

    function eventValue(bag, slot) {
        const box = bag && typeof bag === 'object' ? bag : {};
        if (!slot) return '';
        if (slot.store === 'event') return box[slot.inputId] == null ? '' : box[slot.inputId];
        if (slot.store === 'event-row') {
            const rows = box[slot.inputId];
            const row = rows && rows[slot.rowIndex];
            return row && row[slot.columnId] != null ? row[slot.columnId] : '';
        }
        return '';
    }

    function sundayValue(draft, slot) {
        const d = draft && typeof draft === 'object' ? draft : {};
        if (!slot) return '';
        if (slot.store === 'sunday') return d[slot.field] == null ? '' : d[slot.field];
        if (slot.store === 'kids') {
            const lines = linesOf(d.kidsQuestions);
            return lines[slot.rowIndex] == null ? '' : lines[slot.rowIndex];
        }
        return '';
    }

    function linesOf(text) {
        const s = text == null ? '' : String(text);
        if (!s.trim()) return [];
        return s.split('\n');
    }

    function blankRow(input) {
        const row = {};
        (input && input.fields || []).forEach(col => { row[col.id] = ''; });
        return row;
    }

    function setEventScalar(bag, inputId, value) {
        const next = Object.assign({}, bag || {});
        next[inputId] = value == null ? '' : String(value);
        return next;
    }

    function setEventCell(bag, input, rowIndex, columnId, value) {
        const id = input && input.id;
        const next = Object.assign({}, bag || {});
        if (!id) return next;
        const rows = Array.isArray(next[id]) ? next[id].map(r => Object.assign({}, r)) : [];
        while (rows.length <= rowIndex) rows.push(blankRow(input));
        rows[rowIndex][columnId] = value == null ? '' : String(value);
        next[id] = rows;
        return next;
    }

    function addEventRow(bag, input) {
        const id = input && input.id;
        const next = Object.assign({}, bag || {});
        if (!id) return next;
        const rows = Array.isArray(next[id]) ? next[id].slice() : [];
        rows.push(blankRow(input));
        next[id] = rows;
        return next;
    }

    function setSundayField(draft, field, value) {
        const next = Object.assign({}, draft || {});
        next[field] = value == null ? '' : String(value);
        return next;
    }

    function writeKidsLine(lines, index, value) {
        const next = (lines || []).slice();
        while (next.length <= index) next.push('');
        next[index] = value == null ? '' : String(value);
        return next;
    }

    function addKidsLine(lines) {
        return (lines || []).concat(['']);
    }

    const PrintableFillCore = {
        whenKey,
        whenOf,
        indexProject,
        slotFor,
        slotsOn,
        listSpec,
        emptyListSlot,
        tally,
        remaining,
        leftToGoText,
        stepBlank,
        isBlank,
        eventValue,
        sundayValue,
        linesOf,
        setEventScalar,
        setEventCell,
        addEventRow,
        setSundayField,
        writeKidsLine,
        addKidsLine,
        blankRow,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableFillCore;
    }
    if (global) {
        global.PrintableFillCore = PrintableFillCore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
