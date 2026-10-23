'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Plan = require('../public/delete-elder-meetings-core.js');

test('MS-799 — an empty elder_meetings collection is safe to delete', () => {
    const plan = Plan.planElderMeetingsDeletion([], ['doc-a']);
    assert.equal(plan.canDelete, true);
    assert.deepEqual(plan.meetingIds, []);
    assert.deepEqual(plan.missingInElderDocuments, []);
});

test('MS-799 — each meeting id must exist as an elder_document before delete', () => {
    const ok = Plan.planElderMeetingsDeletion(['m1', 'm2'], ['m1', 'm2', 'other']);
    assert.equal(ok.canDelete, true);
    assert.deepEqual(ok.missingInElderDocuments, []);

    const blocked = Plan.planElderMeetingsDeletion(['m1', 'm2'], ['m1']);
    assert.equal(blocked.canDelete, false);
    assert.deepEqual(blocked.missingInElderDocuments, ['m2']);
});
