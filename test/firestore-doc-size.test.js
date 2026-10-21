const { test } = require('node:test');
const assert = require('node:assert');
const Size = require('../scripts/firestore-doc-size.js');

test('the documented tasks example is 147 bytes', () => {
    const bytes = Size.documentSize(
        ['users', 'jeff', 'tasks', 'my_task_id'],
        {
            type: 'Personal',
            done: false,
            priority: 1,
            description: 'Learn Cloud Firestore',
        }
    );
    assert.equal(bytes, 147);
});

test('a map adds 32 bytes and an array does not', () => {
    const bare = Size.documentSize(['tasks', 'a'], {});
    const withMap = Size.documentSize(['tasks', 'a'], { meta: { a: true } });
    // field name "meta" (5) + map 32 + field name "a" (2) + boolean 1
    assert.equal(withMap - bare, 5 + 32 + 2 + 1);
    const withArray = Size.documentSize(['tasks', 'a'], { tags: ['a'] });
    // field name "tags" (5) + string "a" (2)
    assert.equal(withArray - bare, 5 + 2);
});
