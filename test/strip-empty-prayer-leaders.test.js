const {test} = require('node:test');
const assert = require('node:assert');

const {planEmptyPrayerLeaderDeletion} = require('../public/strip-empty-prayer-leaders-core.js');

test('empty carriedBy entries are deleted and a named prayer leader stays', () => {
    const plan = planEmptyPrayerLeaderDeletion({
        carriedBy: {
            prayerOfPraise: {name: '', id: null},
            prayerOfConfession: {id: 'p1', name: 'Ada Example'},
            blankName: {id: null, name: '   '},
            junk: 'nope',
        },
    });
    assert.deepStrictEqual(plan.deletePaths, [
        'carriedBy.blankName',
        'carriedBy.junk',
        'carriedBy.prayerOfPraise',
    ]);
});

test('a Sunday with no empty carriers is left alone', () => {
    assert.deepStrictEqual(planEmptyPrayerLeaderDeletion({}), {deletePaths: []});
    assert.deepStrictEqual(
        planEmptyPrayerLeaderDeletion({carriedBy: {hymn1: {id: 'p9', name: 'Owen Example'}}}),
        {deletePaths: []}
    );
    assert.deepStrictEqual(planEmptyPrayerLeaderDeletion({carriedBy: null}), {deletePaths: []});
});
