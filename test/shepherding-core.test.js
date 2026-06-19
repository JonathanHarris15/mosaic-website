const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-core.js');

// The Shepherding Status value model used to be copied into five page scripts,
// and the labels had drifted into inconsistent text. It now lives once in
// shepherding-core.js; these tests pin the level order, the three label variants
// each surface uses, and the matrix scoring/colour so a future edit can't let
// them drift apart again.

test('urgency and importance levels are ordered most- to least-pressing', () => {
    assert.deepStrictEqual(Core.URGENCY_LEVELS, ['urgent', 'somewhat_urgent', 'not_urgent']);
    assert.deepStrictEqual(Core.IMPORTANCE_LEVELS, ['important', 'somewhat_important', 'not_important']);
});

test('every level has a label in all three variants', () => {
    for (const u of Core.URGENCY_LEVELS) {
        assert.ok(Core.URGENCY_LABEL[u], `full label for ${u}`);
        assert.ok(Core.URGENCY_LABEL_SHORT[u], `short label for ${u}`);
        assert.ok(Core.URGENCY_LABEL_TINY[u], `tiny label for ${u}`);
    }
    for (const i of Core.IMPORTANCE_LEVELS) {
        assert.ok(Core.IMPORTANCE_LABEL[i], `full label for ${i}`);
        assert.ok(Core.IMPORTANCE_LABEL_SHORT[i], `short label for ${i}`);
        assert.ok(Core.IMPORTANCE_LABEL_TINY[i], `tiny label for ${i}`);
    }
});

test('label variants preserve each surface\'s exact prior wording', () => {
    // Shepherding Profile (full)
    assert.strictEqual(Core.URGENCY_LABEL.somewhat_urgent, 'Somewhat Urgent');
    assert.strictEqual(Core.IMPORTANCE_LABEL.not_important, 'Not Important');
    // People list / Person Panel (short)
    assert.strictEqual(Core.URGENCY_LABEL_SHORT.somewhat_urgent, 'Somewhat');
    assert.strictEqual(Core.IMPORTANCE_LABEL_SHORT.not_important, 'Not Imp.');
    // Inline `$$` matrix (tiny)
    assert.strictEqual(Core.URGENCY_LABEL_TINY.urgent, 'Urg');
    assert.strictEqual(Core.IMPORTANCE_LABEL_TINY.somewhat_important, 'Swt');
});

test('statusZoneKey joins urgency and importance with a stable separator', () => {
    assert.strictEqual(Core.statusZoneKey('urgent', 'important'), 'urgent__important');
});

test('statusScore runs 0 (urgent+important) to 4 (not_urgent+not_important)', () => {
    assert.strictEqual(Core.statusScore('urgent', 'important'), 0);
    assert.strictEqual(Core.statusScore('not_urgent', 'not_important'), 4);
    assert.strictEqual(Core.statusScore('somewhat_urgent', 'somewhat_important'), 2);
});

test('statusCellColor bands by score: error / secondary / neutral', () => {
    assert.match(Core.statusCellColor('urgent', 'important'), /border-error/);        // score 0
    assert.match(Core.statusCellColor('urgent', 'somewhat_important'), /border-error/); // score 1
    assert.match(Core.statusCellColor('somewhat_urgent', 'somewhat_important'), /border-secondary/); // score 2
    assert.match(Core.statusCellColor('not_urgent', 'not_important'), /border-outline-variant/); // score 4
});

// The Pastoral Record dual-write (ADR-0005) was hand-built at eight call sites.
// buildStatusChange / buildTagChange now produce the activity record once. They
// are pure (no timestamp — commitPastoralChange stamps createdAt at write time)
// so the exact shape can be asserted here.

test('buildStatusChange produces the canonical status_change record', () => {
    const rec = Core.buildStatusChange({
        previousStatus: { urgency: 'urgent', importance: 'important' },
        newStatus: null,
        authorUid: 'u1',
        authorName: 'Jane Elder',
        source: 'profile',
        sourceDocumentId: null,
    });
    assert.deepStrictEqual(rec, {
        kind: 'status_change',
        previousStatus: { urgency: 'urgent', importance: 'important' },
        newStatus: null,
        authorUid: 'u1',
        authorName: 'Jane Elder',
        source: 'profile',
        sourceDocumentId: null,
        explanation: '',
    });
    assert.ok(!('createdAt' in rec), 'builder stays pure — no timestamp');
});

test('buildStatusChange carries the source document id when set (document source)', () => {
    const rec = Core.buildStatusChange({
        previousStatus: null,
        newStatus: { urgency: 'somewhat_urgent', importance: 'important' },
        authorUid: 'u2',
        authorName: 'Bob',
        source: 'document',
        sourceDocumentId: 'doc99',
    });
    assert.strictEqual(rec.source, 'document');
    assert.strictEqual(rec.sourceDocumentId, 'doc99');
    assert.deepStrictEqual(rec.newStatus, { urgency: 'somewhat_urgent', importance: 'important' });
});

test('buildTagChange produces the canonical tag_change record', () => {
    const rec = Core.buildTagChange({
        tagId: 'red-flag',
        tagName: 'Red Flag',
        action: 'added',
        authorUid: 'u3',
        authorName: 'Carol',
        source: 'people_list',
        sourceDocumentId: null,
    });
    assert.deepStrictEqual(rec, {
        kind: 'tag_change',
        tagId: 'red-flag',
        tagName: 'Red Flag',
        action: 'added',
        authorUid: 'u3',
        authorName: 'Carol',
        source: 'people_list',
        sourceDocumentId: null,
        explanation: '',
    });
});

test('builders normalise missing author/source-doc to null, never undefined', () => {
    const s = Core.buildStatusChange({ previousStatus: null, newStatus: null, source: 'profile' });
    assert.strictEqual(s.authorUid, null);
    assert.strictEqual(s.authorName, '');
    assert.strictEqual(s.sourceDocumentId, null);
    const t = Core.buildTagChange({ tagId: 't', tagName: 'T', action: 'removed', source: 'document' });
    assert.strictEqual(t.authorUid, null);
    assert.strictEqual(t.sourceDocumentId, null);
});

// commitPastoralChange is the atomic writer (ADR-0005). It is browser-only, but
// its batching contract can be verified with a tiny fake Firestore: one batch,
// one person update, one activity set, committed exactly once.

test('commitPastoralChange writes both halves in a single committed batch', () => {
    const calls = { update: [], set: [], commit: 0 };
    const batch = {
        update: (ref, data) => calls.update.push({ ref, data }),
        set: (ref, data) => calls.set.push({ ref, data }),
        commit: () => { calls.commit++; return Promise.resolve(); },
    };
    const fakeDb = {
        batch: () => batch,
        collection: () => ({
            doc: () => ({
                collection: () => ({ doc: () => ({ __activity: true }) }),
                __person: true,
            }),
        }),
    };
    // Stand in for the browser firebase global the writer references.
    global.firebase = { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } };
    try {
        Core.commitPastoralChange(fakeDb, 'p1',
            { shepherdingStatus: null, updatedAt: '__ts__' },
            Core.buildStatusChange({ previousStatus: null, newStatus: null, source: 'profile' }));
    } finally {
        delete global.firebase;
    }
    assert.strictEqual(calls.update.length, 1, 'one person update');
    assert.strictEqual(calls.set.length, 1, 'one activity set');
    assert.strictEqual(calls.commit, 1, 'committed exactly once');
    assert.strictEqual(calls.set[0].data.createdAt, '__ts__', 'activity is stamped at write time');
    assert.strictEqual(calls.set[0].data.kind, 'status_change');
});
