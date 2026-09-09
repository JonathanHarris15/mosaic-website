const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Tasks tab on a Shepherding Profile is the Tasks & Reminders component
// mounted inside another page (ADR-0061), and the thing that makes it a TAB
// rather than a second copy of the page is one argument:
//
//     <div x-data="shepherdingTasks({ aboutPersonId: personId, embedded: true })">
//
// ⚠ THE FAILURE THIS GUARDS. Drop `aboutPersonId` and nothing throws, nothing
// looks broken, and every elder's tasks — the whole church's — draw on one
// man's profile as though the elders owed them all to him. Drop `embedded` and
// the tab redirects the page it is sitting in when it does not like the answer
// about who you are.
//
// There is no DOM harness in this suite, so this reads the source the way
// document-library-identity-wiring.test.js does for the Documents tab. It cannot
// prove the tab works; it can prove the two shapes that would break it are gone.

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// Every `x-data="shepherdingTasks…"` mount in the app, with its page. Both
// forms count: the page mounts it bare, a profile tab calls it with a scope.
function mounts() {
    const found = [];
    fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).forEach((file) => {
        const html = read(file);
        const rx = /x-data="(shepherdingTasks[^"]*)"/g;
        let m;
        while ((m = rx.exec(html)) !== null) found.push({ file, expression: m[1] });
    });
    return found;
}

test('the Tasks & Reminders page mounts the component bare', () => {
    const page = mounts().filter(m => m.file === 'shepherding-tasks.html');
    assert.strictEqual(page.length, 1);
    assert.strictEqual(page[0].expression, 'shepherdingTasks',
        'the page is every elder\'s tasks; a scope here would hide most of them');
});

test('a profile mount is scoped to that person, and knows it is a tab', () => {
    const tabs = mounts().filter(m => m.expression.includes('('));
    assert.ok(tabs.length, 'the Shepherding Profile mounts the component with a scope');
    tabs.forEach(({ file, expression }) => {
        assert.match(expression, /aboutPersonId:\s*personId/,
            `${file} mounts the tasks component without scoping it to a person`);
        assert.match(expression, /embedded:\s*true/,
            `${file} mounts the tasks component without telling it it is a tab`);
    });
});

test('the component reads its scope from the argument it is given', () => {
    const source = read('shepherding-tasks.js');
    assert.match(source, /Alpine\.data\('shepherdingTasks',\s*\(config = \{\}\)/,
        'it has to be a factory taking a config, or a tab can never scope it');
    assert.match(source, /aboutPersonId:\s*config\.aboutPersonId/);
    assert.match(source, /embedded:\s*!!config\.embedded/);
});

test('a scoped list is cut by the Subject, never by the assignee', () => {
    const source = read('shepherding-tasks.js');
    assert.match(source, /TasksCore\.forPerson\(list, this\.aboutPersonId\)/,
        'the slice belongs to the model; a filter written here would be a second answer');
});
