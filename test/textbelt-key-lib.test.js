const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
    TEXTBELT_SECRET_ID,
    secretAccessUrl,
    decodeSecretPayload,
    resolveTextbeltKey,
} = require('../scripts/textbelt-key-lib');

test('secretAccessUrl targets latest TEXTBELT_KEY version', () => {
    const url = secretAccessUrl('mosaic-hymn-database', TEXTBELT_SECRET_ID);
    assert.match(url, /secrets\/TEXTBELT_KEY\/versions\/latest:access$/);
});

test('decodeSecretPayload reads base64 utf8', () => {
    const value = decodeSecretPayload({
        payload: {data: Buffer.from('tb-key-1', 'utf8').toString('base64')},
    });
    assert.strictEqual(value, 'tb-key-1');
});

test('resolveTextbeltKey prefers env over Secret Manager', async () => {
    const fetchSecret = async () => {
        throw new Error('should not call Secret Manager');
    };
    const fromEnv = await resolveTextbeltKey('mosaic-hymn-database', ' env-key ', fetchSecret);
    assert.deepStrictEqual(fromEnv, {key: 'env-key', source: 'env'});
});

test('resolveTextbeltKey uses Secret Manager when env is empty', async () => {
    const fetchSecret = async (projectId, secretId) => {
        assert.strictEqual(projectId, 'mosaic-hymn-database');
        assert.strictEqual(secretId, TEXTBELT_SECRET_ID);
        return 'sm-key';
    };
    const fromSm = await resolveTextbeltKey('mosaic-hymn-database', '  ', fetchSecret);
    assert.deepStrictEqual(fromSm, {key: 'sm-key', source: 'secret-manager'});
});
