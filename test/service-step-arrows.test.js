// The arrows themselves, not just the save-then-move rule underneath them.
//
// service-step.test.js pins `stepToService`, which is pure. But the pressed
// arrow goes through `stepService` on the page object, and that is where the
// `stepping` flag lives — the flag that stops a slow save being double-clicked
// into two navigations. A flag raised on the way in and never lowered is worse
// than no flag: both arrows go dead and only a reload brings them back.
//
// So these tests are about what happens when the save does NOT simply work.

const { test } = require('node:test');
const assert = require('node:assert');

const DateUtils = require('../public/date-utils.js');
const ServiceDatesCore = require('../public/service-dates-core.js');

// The page reads both through `window`, because in the browser that is where
// they are. Node has no window, so it gets one.
global.window = { ServiceDatesCore: ServiceDatesCore, location: { replace() {} } };
global.DateUtils = DateUtils;
global.ServiceDatesCore = ServiceDatesCore;

const { serviceForm } = require('../public/service-builder.js');

// A page sitting on a Sunday with somewhere to go in both directions.
function pageOn(date, overrides) {
    const page = serviceForm();
    page.date = date;
    page.canEdit = true;
    page.isDirty = true;
    return Object.assign(page, overrides);
}

test('a save that throws still gives the arrows back', async () => {
    const page = pageOn('2026-08-30', {
        save: async () => { throw new Error('Firestore fell over'); },
    });

    await assert.rejects(() => page.stepService(1));
    assert.strictEqual(page.stepping, false,
        'the flag was raised on the press and never lowered — both arrows are now dead');
});

test('a save that fails leaves the page where it was, arrows live', async () => {
    let went = false;
    global.window.location.replace = () => { went = true; };
    const page = pageOn('2026-08-30', { save: async () => false });

    assert.strictEqual(await page.stepService(1), false);
    assert.strictEqual(went, false, 'the work is still only in this tab');
    assert.strictEqual(page.stepping, false, 'you must be able to try again');
});

test('a second press while the first is still saving is ignored', async () => {
    let saves = 0;
    let releaseSave;
    const page = pageOn('2026-08-30', {
        save: () => { saves++; return new Promise(r => { releaseSave = r; }); },
    });

    const first = page.stepService(1);
    assert.strictEqual(await page.stepService(1), false, 'the second press does nothing');
    assert.strictEqual(saves, 1, 'and it certainly does not start a second write');

    releaseSave(true);
    await first;
});

test('there is nowhere to step from before the first Sunday', async () => {
    const page = pageOn(ServiceDatesCore.FIRST_SUNDAY, { save: async () => true });

    assert.strictEqual(await page.stepService(-1), false);
    assert.strictEqual(page.stepping, false);
});
