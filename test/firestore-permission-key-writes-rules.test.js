const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MS-722 (ADR 0081): the static half of the rules change. The emulator
// suite (test/emulator/permission-key-writes.test.js) proves who the doors
// let through; this pins the shape so a later edit cannot quietly drop a
// key, swap one, or reach a read path.

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const KEYS = {
    hymns: 'hymns.edit',
    roles: 'roles.manager.edit',
    events: 'calendar.events.edit',
    event_occurrences: 'calendar.events.edit',
    services: 'services.builder.edit',
    liturgy_elements: 'services.builder.edit',
    liturgy_orders: 'services.builder.edit',
    presence: 'services.builder.edit',
    away: 'calendar.away.edit',
    printables: 'printables.edit',
    printable_folders: 'printables.edit',
    printable_templates: 'printables.edit',
};

test('editsWith keeps the level names as an OR', () => {
    assert.match(rules,
        /function editsWith\(key\) \{\s*return isEditor\(\) \|\| hasPermission\(key\);\s*\}/);
});

test('every editsWith key is a real MS-695 permission key', () => {
    const { PERMISSION_KEYS } = require('../public/permission-catalog.js');
    const used = [...rules.matchAll(/editsWith\('([^']+)'\)/g)].map(m => m[1]);
    assert.ok(used.length >= 19, 'expected the 19 write doors');
    for (const k of used) assert.ok(PERMISSION_KEYS.includes(k), k);
});

test('each touched collection writes with its own key', () => {
    for (const [coll, key] of Object.entries(KEYS)) {
        const at = rules.indexOf(`match /${coll}/{`);
        assert.ok(at >= 0, coll);
        const firstWrite = rules.slice(at).match(/allow (?:create|write)[^;]*;/)[0];
        assert.ok(firstWrite.includes(`editsWith('${key}')`), `${coll}: ${firstWrite}`);
    }
});

test('reads never use editsWith (write paths only)', () => {
    for (const line of rules.split('\n')) {
        if (/allow\s+(read|get|list)\b/.test(line)) {
            assert.ok(!line.includes('editsWith'), line.trim());
        }
    }
});
