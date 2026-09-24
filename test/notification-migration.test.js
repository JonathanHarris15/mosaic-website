const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mig = require('../functions/notification-migration.js');

test('a source row becomes a text, and an existing channel is kept', () => {
    const row = mig.rowWithChannel({
        textId: 'tb_1', purpose: 'prayer_request', personId: 'p1',
    });
    assert.strictEqual(row.channel, 'text');
    assert.strictEqual(row.textId, 'tb_1');
    assert.strictEqual(mig.rowWithChannel({channel: 'push', textId: 'x'}).channel, 'push');
});

test('a second run copies nothing that is already at the destination', () => {
    const source = [
        {id: 'a', data: {textId: '1', purpose: 'test'}},
        {id: 'b', data: {textId: '2', purpose: 'prayer_request'}},
    ];
    const first = mig.planMigration(source, []);
    assert.deepStrictEqual(first.copies.map((c) => c.id), ['a', 'b']);
    assert.deepStrictEqual(first.skips, []);
    assert.strictEqual(first.copies[0].data.channel, 'text');

    const second = mig.planMigration(source, ['a', 'b']);
    assert.deepStrictEqual(second.copies, []);
    assert.deepStrictEqual(second.skips, ['a', 'b']);
});

test('document ids are preserved so a reply still finds its text', () => {
    const plan = mig.planMigration(
        [{id: 'elder_digest_2026-06-28', data: {purpose: 'elder_digest'}}],
        []);
    assert.strictEqual(plan.copies[0].id, 'elder_digest_2026-06-28');
    assert.strictEqual(plan.copies[0].data.purpose, 'elder_digest');
});

test('the script is a dry run unless --commit is passed', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'migrate-sms-messages-to-notifications.js'),
        'utf8');
    assert.match(src, /--commit/);
    assert.match(src, /process\.argv\.includes\("--commit"\)/);
    assert.match(src, /Dry run/);
});

test('code, rules, and tests no longer name the old collection except the migration', () => {
    const root = path.join(__dirname, '..');
    const offenders = [];
    const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
            if (name === 'node_modules' || name === 'shared' || name === '.git') continue;
            const full = path.join(dir, name);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.(js|rules)$/.test(name)) continue;
            if (full.endsWith('functions/notification-migration.js')) continue;
            if (full.endsWith('scripts/migrate-sms-messages-to-notifications.js')) continue;
            if (full.endsWith('test/notification-migration.test.js')) continue;
            const text = fs.readFileSync(full, 'utf8');
            if (text.includes('sms_messages')) offenders.push(path.relative(root, full));
        }
    };
    walk(path.join(root, 'functions'));
    walk(path.join(root, 'test'));
    walk(path.join(root, 'public'));
    const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
    assert.ok(!rules.includes('sms_messages'), 'firestore.rules still names sms_messages');
    assert.deepStrictEqual(offenders, []);
});

test('the renamed rules match the old ones: admins read, nobody writes', () => {
    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
    const m = rules.match(/match \/notifications\/\{messageId\}\s*\{([\s\S]*?)\n {4}\}/);
    assert.ok(m, 'notifications rule is missing');
    assert.match(m[1], /allow read: if isAdmin\(\);/);
    assert.doesNotMatch(m[1], /allow (write|create|update|delete)/);
});
