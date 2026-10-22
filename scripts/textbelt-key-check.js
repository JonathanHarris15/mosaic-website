// @ts-nocheck
const {interpretQuota} = require('../functions/sms');
const {
    resolveTextbeltKey,
    fetchTextbeltKeyFromSecretManager,
} = require('./textbelt-key-lib');
const WHITELISTED_KEY_PREFIX = '146bb8bc';
function textbeltKeyPrefix(key) {
    const k = String(key == null ? '' : key).trim();
    return !k ? '' : (k.length <= 8 ? k : k.slice(0, 8));
}
function isWhitelistedTextbeltKey(key) {
    return textbeltKeyPrefix(key) === WHITELISTED_KEY_PREFIX;
}

async function main() {
    const projectId = require('./firebase-project').requireProject(process.argv);
    const withUrl = process.argv.includes('--with-url');
    const resolved = await resolveTextbeltKey(
        projectId,
        process.env.TEXTBELT_KEY,
        fetchTextbeltKeyFromSecretManager);
    const prefix = textbeltKeyPrefix(resolved.key);
    const whitelisted = isWhitelistedTextbeltKey(resolved.key);
    console.log(`textbelt key source: ${resolved.source}`);
    console.log(`textbelt key prefix: ${prefix}`);
    console.log(`expected whitelist prefix: ${WHITELISTED_KEY_PREFIX}`);
    console.log(`whitelist match: ${whitelisted ? 'yes' : 'NO'}`);
    const resp = await fetch(
        `https://textbelt.com/quota/${encodeURIComponent(resolved.key)}`);
    const quota = interpretQuota(await resp.json(), true);
    console.log('Textbelt quota response (no key echoed):');
    console.log(JSON.stringify({
        configured: quota.configured,
        quotaRemaining: quota.quotaRemaining,
        error: quota.error || null,
    }, null, 2));
    if (!whitelisted) process.exitCode = 1;
    if (withUrl) {
        const {spawnSync} = require('child_process');
        const run = spawnSync(process.execPath, [
            require('path').join(__dirname, 'textbelt-test-send.js'),
            '--project', projectId, '--i-mean-prod', '--with-url',
        ], {stdio: 'inherit', env: process.env});
        if (run.status) process.exitCode = run.status;
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
