// Care List Core (MS-435) — the rules the web Care List page, the phone Care
// List screen and the assistant all follow, so none of them can drift.
//
// ⚠ ONE FIELD PER CELL. A Care List used to save by writing its whole cell map
// back at once. Two elders in two different cells therefore overwrote each
// other, a cell the assistant wrote was put back by the next autosave, and the
// web page — which rebuilt the map from the rows on screen — wiped the cells of
// anybody who had dropped out of the list's filter. Each cell now lives at
// `careListData.<person>.<column>` and a save writes only the cells this editor
// was typed into (ADR-0034: save the fields you changed).
//
// ⚠ DIRTY MEANS "THE EDITOR SAID IT WAS EDITED", NEVER "THE JSON DIFFERS". The
// rich-text editor normalises what it is given, so comparing its JSON with the
// stored copy would call untouched cells changed and write them — which is the
// clobber this module exists to end.
//
// ⚠ COLUMNS ARE NOT BOXES. Adding, renaming or removing one is a single change
// applied to the LATEST column list inside a transaction, so two elders'
// column changes both stand (ADR-0039: a list needs a lock or a row identity).
//
// ⚠ THE OLD SHAPE. A Care List from before columns stored a bare rich-text body
// per person. Writing one cell's field into that would plant a column id inside
// somebody's note, so whoever writes first normalises it, once, in a
// transaction.
//
// Pure rules first; the writes at the bottom take the Firestore handle and the
// namespace holding FieldPath / FieldValue (`firebase.firestore` in a browser,
// `admin.firestore` on the server), like ShepherdingCore's commit helpers.
// Mirrored into functions/shared by scripts/sync-shared-to-functions.js.
(function (global) {
    'use strict';

    const COLLECTION = 'elder_documents';
    const CELLS = 'careListData';
    const COLUMNS = 'careListColumns';

    // The one column a Care List has before an elder adds any of their own.
    const DEFAULT_COLUMN = Object.freeze({ id: 'col_default', name: 'Notes' });

    // ── Where things live ─────────────────────────────────────────────────────

    // Segments, never a dotted string built by hand: an id with a dot in it
    // would otherwise split into the wrong path.
    function cellPath(personId, columnId) {
        return [CELLS, String(personId), String(columnId)];
    }

    // A box is the thing one person holds at a time (ADR-0035). One Care List
    // is one scope; each cell and the title is a box in it. The same answer on
    // web, phone and server, so a hold on the phone locks the cell on the web
    // and the assistant's check (MS-433) asks about exactly what a page claimed.
    //
    // A person id is a Firestore document id and cannot hold a '/', and column
    // ids are ours, so 'cell:<person>/<column>' reads back unambiguously.
    const box = {
        cell(documentId, personId, columnId) {
            return { scopeKey: 'document:' + documentId, boxKey: 'cell:' + personId + '/' + columnId };
        },
        title(documentId) {
            return { scopeKey: 'document:' + documentId, boxKey: 'title' };
        },
    };

    // Whoever else holds a cell in this column, among a store's claims (holdKey
    // → entry), or null. Removing a column under them would delete their words.
    function columnHolder(claims, documentId, columnId) {
        const scope = 'document:' + documentId;
        const suffix = '/' + columnId;
        const entries = Object.values(claims || {});
        for (const entry of entries) {
            if (!entry || entry.scopeKey !== scope) continue;
            const key = String(entry.boxKey || '');
            if (key.indexOf('cell:') === 0 && key.slice(-suffix.length) === suffix) return entry;
        }
        return null;
    }

    // ── The stored shape ──────────────────────────────────────────────────────

    function isBareBody(value) {
        return !!(value && typeof value === 'object' && value.type === 'doc');
    }

    function hasColumns(data) {
        return !!(data && Array.isArray(data[COLUMNS]) && data[COLUMNS].length);
    }

    // From before columns: no column list, or a bare body where a person's
    // cells should be.
    function isOldShape(data) {
        if (!data) return false;
        if (!hasColumns(data)) return true;
        const cells = data[CELLS] || {};
        return Object.keys(cells).some(pid => isBareBody(cells[pid]));
    }

    function columnsOf(data) {
        return hasColumns(data)
            ? data[COLUMNS].map(c => ({ id: c.id, name: c.name }))
            : [{ id: DEFAULT_COLUMN.id, name: DEFAULT_COLUMN.name }];
    }

    function cellsOf(data) {
        const stored = (data && data[CELLS]) || {};
        const out = {};
        Object.keys(stored).forEach(pid => {
            const value = stored[pid];
            if (isBareBody(value)) out[pid] = { [DEFAULT_COLUMN.id]: value };
            else if (value && typeof value === 'object') out[pid] = Object.assign({}, value);
        });
        return out;
    }

    // The column shape, with nothing lost.
    function normalise(data) {
        return { careListColumns: columnsOf(data), careListData: cellsOf(data) };
    }

    // Two stored values say the same thing, whatever order their keys came in.
    function stable(value) {
        if (value === undefined) return 'null';
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        return '{' + Object.keys(value).sort()
            .filter(k => value[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    }

    function sameContent(a, b) {
        return stable(a === undefined ? null : a) === stable(b === undefined ? null : b);
    }

    // ── Column changes ────────────────────────────────────────────────────────

    // An id nothing is stored under: not a column now, and not one whose column
    // was removed but whose cells linger — a reused id would inherit them.
    function newColumnId(columns, cells) {
        const used = new Set((columns || []).map(c => c.id));
        Object.values(cells || {}).forEach(row => {
            Object.keys(row || {}).forEach(id => used.add(id));
        });
        let n = (columns || []).length + 1;
        while (used.has('col_' + n)) n += 1;
        return 'col_' + n;
    }

    // One change — { kind: 'add', name } | { kind: 'rename', columnId, name } |
    // { kind: 'remove', columnId } — applied to the LATEST stored list.
    // Returns { columns, column, clearCells, changed }. A rename or removal of
    // a column somebody else already removed changes nothing.
    function applyColumnChange(data, change) {
        const columns = columnsOf(data);
        const cells = cellsOf(data);
        const c = change || {};
        if (c.kind === 'add') {
            const name = String(c.name || '').trim() || 'Untitled';
            const column = { id: newColumnId(columns, cells), name };
            return { columns: columns.concat([column]), column, clearCells: [], changed: true };
        }
        const index = columns.findIndex(col => col.id === c.columnId);
        if (c.kind === 'rename') {
            if (index === -1) return { columns, column: null, clearCells: [], changed: false };
            const name = String(c.name || '').trim() || 'Untitled';
            const next = columns.slice();
            next[index] = { id: columns[index].id, name };
            return { columns: next, column: next[index], clearCells: [], changed: columns[index].name !== name };
        }
        if (c.kind === 'remove') {
            if (index === -1) return { columns, column: null, clearCells: [], changed: false };
            if (columns.length <= 1) throw new Error('Cannot delete the last column.');
            const clearCells = Object.keys(cells)
                .filter(pid => Object.prototype.hasOwnProperty.call(cells[pid], c.columnId))
                .map(pid => ({ personId: pid, columnId: c.columnId }));
            return {
                columns: columns.filter(col => col.id !== c.columnId),
                column: columns[index], clearCells, changed: true,
            };
        }
        throw new Error('No column change is known as ' + c.kind);
    }

    // ── One editor's copy ─────────────────────────────────────────────────────

    function key(personId, columnId) {
        return String(personId) + '/' + String(columnId);
    }

    // What one open Care List editor knows: the copy it last loaded, saved or
    // adopted, and which cells (and whether the title) it has typed into since.
    function createSession(data) {
        let saved = { title: (data && data.title) || '', columns: columnsOf(data), cells: cellsOf(data) };
        // A separate object: `saved` is changed in place as cells save.
        let latest = { title: saved.title, columns: saved.columns, cells: saved.cells };
        let old = isOldShape(data);
        const dirty = new Set();
        let titleDirty = false;

        function storedCell(copy, pid, cid) {
            const row = copy.cells[pid];
            return row && Object.prototype.hasOwnProperty.call(row, cid) ? row[cid] : null;
        }

        function setSaved(pid, cid, value) {
            const row = Object.assign({}, saved.cells[pid] || {});
            if (value === null || value === undefined) delete row[cid];
            else row[cid] = value;
            saved.cells = Object.assign({}, saved.cells, { [pid]: row });
        }

        function columnIds(copy) {
            return new Set(copy.columns.map(c => c.id));
        }

        // Move this copy onto a column list, forgetting the cells (and the
        // unsaved marks) of any column that went.
        function takeColumns(next) {
            if (sameContent(saved.columns, next)) return { changed: false, addedColumns: [], removedColumns: [] };
            const before = columnIds(saved);
            const after = new Set(next.map(c => c.id));
            const addedColumns = next.map(c => c.id).filter(id => !before.has(id));
            const removedColumns = saved.columns.map(c => c.id).filter(id => !after.has(id));
            removedColumns.forEach(cid => {
                Array.from(dirty).forEach(k => { if (k.slice(k.lastIndexOf('/') + 1) === cid) dirty.delete(k); });
                Object.keys(saved.cells).forEach(pid => setSaved(pid, cid, null));
            });
            saved.columns = next.map(c => ({ id: c.id, name: c.name }));
            return { changed: true, addedColumns, removedColumns };
        }

        return {
            title: () => saved.title,
            columns: () => saved.columns.slice(),
            cell: (pid, cid) => storedCell(saved, pid, cid),
            oldShape: () => old,
            // Whoever wrote first has normalised it (saveEdits does, when told).
            normalised() { old = false; },

            edited(pid, cid) { dirty.add(key(pid, cid)); },
            titleEdited() { titleDirty = true; },
            isDirty: (pid, cid) => dirty.has(key(pid, cid)),
            hasUnsaved: () => dirty.size > 0 || titleDirty,

            // What to write now: the dirty cells, read out of their editors,
            // and the title if it was typed into. Taking it moves the saved
            // copy and clears the marks; a failure hands it back.
            takeSave(readCell, readTitle) {
                const live = columnIds(saved);
                const cells = [];
                dirty.forEach(k => {
                    const slash = k.lastIndexOf('/');
                    const personId = k.slice(0, slash);
                    const columnId = k.slice(slash + 1);
                    if (!live.has(columnId)) return;
                    const value = readCell(personId, columnId);
                    cells.push({ personId, columnId, value: value === undefined ? null : value });
                    setSaved(personId, columnId, value);
                });
                dirty.clear();
                let title = null;
                if (titleDirty) {
                    title = String(readTitle() || '');
                    saved.title = title;
                    titleDirty = false;
                }
                return { cells, title };
            },

            // This editor changed the columns itself (changeColumn resolved
            // with them), so a cell typed into a new column before the list
            // arrives back is still saved. Returns { addedColumns,
            // removedColumns }.
            columnsChanged(columns) {
                const moved = takeColumns(columnsOf({ careListColumns: columns }));
                return { addedColumns: moved.addedColumns, removedColumns: moved.removedColumns };
            },

            // Somebody else has this cell now: what this editor typed into it
            // since its last save is not to be written over theirs. Returns
            // the stored copy, for the page to put back on screen.
            discard(pid, cid) {
                dirty.delete(key(pid, cid));
                return storedCell(saved, pid, cid);
            },

            saveFailed(save) {
                ((save && save.cells) || []).forEach(c => dirty.add(key(c.personId, c.columnId)));
                if (save && save.title !== null && save.title !== undefined) titleDirty = true;
            },

            // Somebody else's version of the list. Returns what the page must
            // put on screen: { cells, title, columns, addedColumns,
            // removedColumns }. Never marks anything dirty.
            //
            // `inCell` / `inTitle` say where this editor's cursor is. That box
            // is never rewritten under them; leftCell / leftTitle hand over
            // what arrived once they leave.
            adopt(remote, where) {
                const w = where || {};
                latest = { title: (remote && remote.title) || '', columns: columnsOf(remote), cells: cellsOf(remote) };
                old = isOldShape(remote);

                const moved = takeColumns(latest.columns);
                const columns = moved.changed ? latest.columns.slice() : null;
                const addedColumns = moved.addedColumns;
                const removedColumns = moved.removedColumns;

                const live = columnIds(latest);
                const people = new Set(Object.keys(saved.cells).concat(Object.keys(latest.cells)));
                const cells = [];
                people.forEach(pid => {
                    live.forEach(cid => {
                        if (dirty.has(key(pid, cid))) return;
                        if (w.inCell && w.inCell.personId === pid && w.inCell.columnId === cid) return;
                        const theirs = storedCell(latest, pid, cid);
                        if (sameContent(storedCell(saved, pid, cid), theirs)) return;
                        setSaved(pid, cid, theirs);
                        cells.push({ personId: pid, columnId: cid, value: theirs });
                    });
                });

                let title = null;
                if (!titleDirty && !w.inTitle && saved.title !== latest.title) {
                    saved.title = latest.title;
                    title = latest.title;
                }
                return { cells, title, columns, addedColumns, removedColumns };
            },

            leftCell(pid, cid) {
                if (dirty.has(key(pid, cid))) return null;
                if (!columnIds(latest).has(cid)) return null;
                const theirs = storedCell(latest, pid, cid);
                if (sameContent(storedCell(saved, pid, cid), theirs)) return null;
                setSaved(pid, cid, theirs);
                return { value: theirs };
            },

            leftTitle() {
                if (titleDirty || saved.title === latest.title) return null;
                saved.title = latest.title;
                return latest.title;
            },
        };
    }

    // ── The writes ────────────────────────────────────────────────────────────
    //
    // `fs` is the namespace holding FieldPath and FieldValue. `extra` is any
    // top-level fields a writer stamps as well (the assistant's provenance).

    function refOf(db, documentId) {
        return db.collection(COLLECTION).doc(documentId);
    }

    function stamps(fs, byName, extra) {
        const out = ['updatedAt', fs.FieldValue.serverTimestamp(), 'updatedByName', byName || ''];
        Object.keys(extra || {}).forEach(k => { out.push(k, extra[k]); });
        return out;
    }

    // Normalise an old-shaped list, once, against the latest stored copy.
    // Resolves true if it had to.
    function normaliseStored(db, documentId) {
        const ref = refOf(db, documentId);
        return db.runTransaction(tx => tx.get(ref).then(snap => {
            const data = snap.exists ? snap.data() : null;
            if (!data || !isOldShape(data)) return false;
            tx.update(ref, normalise(data));
            return true;
        }));
    }

    // Write these cells, and the title if given, each to its own field.
    // edits: { cells: [{personId, columnId, value}], title, byName, oldShape, extra }
    function saveEdits(db, fs, documentId, edits) {
        const e = edits || {};
        const cells = e.cells || [];
        const hasTitle = e.title !== null && e.title !== undefined;
        if (!cells.length && !hasTitle) return Promise.resolve(false);
        const first = e.oldShape ? normaliseStored(db, documentId) : Promise.resolve(false);
        return first.then(() => {
            const args = [];
            cells.forEach(c => {
                const path = new fs.FieldPath(...cellPath(c.personId, c.columnId));
                const empty = c.value === null || c.value === undefined;
                args.push(path, empty ? fs.FieldValue.delete() : c.value);
            });
            if (hasTitle) args.push('title', e.title);
            const all = args.concat(stamps(fs, e.byName, e.extra));
            const ref = refOf(db, documentId);
            return ref.update(all[0], all[1], ...all.slice(2)).then(() => true);
        });
    }

    // Apply one column change against the latest stored list, in a
    // transaction. Resolves { columns, column, changed }.
    function changeColumn(db, fs, documentId, change, byName, extra) {
        const ref = refOf(db, documentId);
        return db.runTransaction(tx => tx.get(ref).then(snap => {
            if (!snap.exists) throw new Error('That Care List no longer exists.');
            const data = snap.data();
            const out = applyColumnChange(data, change);
            if (!out.changed) return out;
            const args = ['careListColumns', out.columns];
            if (isOldShape(data)) {
                const cells = cellsOf(data);
                out.clearCells.forEach(c => { if (cells[c.personId]) delete cells[c.personId][c.columnId]; });
                args.push(CELLS, cells);
            } else {
                out.clearCells.forEach(c => {
                    args.push(new fs.FieldPath(...cellPath(c.personId, c.columnId)), fs.FieldValue.delete());
                });
            }
            const all = args.concat(stamps(fs, byName, extra));
            tx.update(ref, all[0], all[1], ...all.slice(2));
            return out;
        }));
    }

    // Follow the stored list while a page has it open. `onData` gets the
    // document's data, or null once it is gone. Our own write, echoing back
    // before the server has confirmed it, is skipped: adopting it would be
    // answering our own question. Returns a function that stops.
    function watch(db, documentId, onData, onError) {
        const ref = refOf(db, documentId);
        const fail = onError || (e => console.warn('Lost the live connection to this Care List:', e));
        const next = snap => {
            if (!snap) return;
            if (!snap.exists) { onData(null); return; }
            if (snap.metadata && snap.metadata.hasPendingWrites) return;
            onData(snap.data());
        };
        const live = (typeof MosaicLiveRead !== 'undefined' && MosaicLiveRead && MosaicLiveRead.watch)
            ? MosaicLiveRead : null;
        if (live) return live.watch(ref, next, { fallbackEveryMs: live.PERSON_EVERY_MS || 3000, onError: fail });
        return ref.onSnapshot(next, fail);
    }

    const CareListCore = {
        COLLECTION,
        DEFAULT_COLUMN,
        cellPath,
        box,
        columnHolder,
        isOldShape,
        columnsOf,
        cellsOf,
        normalise,
        sameContent,
        newColumnId,
        applyColumnChange,
        createSession,
        normaliseStored,
        saveEdits,
        changeColumn,
        watch,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CareListCore;
    }
    if (global) {
        global.CareListCore = CareListCore;
    }
})(typeof window !== 'undefined' ? window : null);
