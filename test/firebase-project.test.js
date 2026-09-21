// The church Firebase project is hardcoded in three browser copies and the
// deploy workflow reads `.firebaserc` default. A second Hosting URL that
// still shipped those literals would write the church database (ADR 0067).
// This module is the door: one catalog, one shipped config, and a deploy
// that refuses to proceed when they disagree.

const {test} = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const {
    PROD_PROJECT_ID,
    loadProject,
    webConfig,
    requireProject,
    renderBrowserConfig,
    functionsProject,
    readBrowserProject,
    assertDeploy,
} = require('../scripts/firebase-project');

const CHURCH_APP_ID = '1:55153890298:web:4ca1f526f0169fb7920a43';
const FORM_APP_ID = '1:1004095249066:web:0dcbf3cbbcd0be2ff4bbdd';

test('the catalog knows the church project and keeps the two web apps apart', () => {
    const project = loadProject(ROOT, PROD_PROJECT_ID);
    assert.strictEqual(project.projectId, 'mosaic-hymn-database');
    const church = webConfig(project, 'church');
    const form = webConfig(project, 'form');
    assert.strictEqual(church.appId, CHURCH_APP_ID);
    assert.strictEqual(church.messagingSenderId, '55153890298');
    assert.strictEqual(church.measurementId, 'G-64N3W268V9');
    assert.strictEqual(form.appId, FORM_APP_ID);
    assert.strictEqual(form.messagingSenderId, '1004095249066');
    assert.strictEqual(form.measurementId, undefined);
    assert.strictEqual(church.projectId, form.projectId);
    assert.notStrictEqual(church.appId, form.appId);
    assert.strictEqual(church.apiKey, 'AIzaSyCJLgZP27CWayqFoqYoqg9mVdkhgCWqgbg');
    assert.strictEqual(project.mcpIssuerUrl, 'https://mosaic-hymn-mcp.web.app');
    assert.strictEqual(project.storageBucket, 'mosaic-hymn-database.firebasestorage.app');
    assert.strictEqual(
        project.smsReplyWebhookUrl,
        'https://us-central1-mosaic-hymn-database.cloudfunctions.net/smsInbound');
    assert.strictEqual(project.liveOrigin, 'https://mosaic-hymn-database.web.app');
    assert.strictEqual(project.hosting.church, 'mosaic-hymn-database');
    assert.strictEqual(project.hosting.mcp, 'mosaic-hymn-mcp');
});

test('the ghost uses the one web app that was registered, and does not report Analytics', () => {
    const project = loadProject(ROOT, 'mosaic-manager-ghost');
    const church = webConfig(project, 'church');
    const form = webConfig(project, 'form');
    assert.strictEqual(project.projectId, 'mosaic-manager-ghost');
    assert.strictEqual(church.appId, '1:231269270874:web:ab5b97bc670a7e007c9f63');
    assert.strictEqual(form.appId, church.appId);
    assert.strictEqual(church.measurementId, undefined);
    assert.strictEqual(form.measurementId, undefined);
    assert.strictEqual(project.liveOrigin, 'https://mosaic-manager-ghost.web.app');
    assert.strictEqual(project.mcpIssuerUrl, 'https://mosaic-manager-ghost-mcp.web.app');
    assert.strictEqual(project.hosting.church, 'mosaic-manager-ghost');
    assert.strictEqual(project.hosting.mcp, 'mosaic-manager-ghost-mcp');
    assert.strictEqual(
        requireProject(['node', 'script.js', '--project', 'mosaic-manager-ghost'], {root: ROOT}),
        'mosaic-manager-ghost');
});

test('an unknown project is refused', () => {
    assert.throws(
        () => loadProject(ROOT, 'mosaic-hymn-ghost'),
        /Unknown Firebase project/);
});

test('a script must name --project, and the church project needs the loud flag', () => {
    assert.throws(
        () => requireProject(['node', 'script.js'], {root: ROOT}),
        /--project/);
    assert.throws(
        () => requireProject(
            ['node', 'script.js', '--project', PROD_PROJECT_ID],
            {root: ROOT}),
        /--i-mean-prod/);
    assert.strictEqual(
        requireProject(
            ['node', 'script.js', '--project', PROD_PROJECT_ID, '--i-mean-prod'],
            {root: ROOT}),
        PROD_PROJECT_ID);
    assert.throws(
        () => requireProject(
            ['node', 'script.js', '--project', 'mosaic-hymn-ghost', '--i-mean-prod'],
            {root: ROOT}),
        /Unknown Firebase project/);
});

test('a script that is still baked to one project refuses a different --project', () => {
    assert.throws(
        () => requireProject(
            ['node', 'script.js', '--project', PROD_PROJECT_ID, '--i-mean-prod'],
            {root: ROOT, hardcoded: 'some-other-project'}),
        /some-other-project/);
});

test('the browser file and the functions file are the catalog, not a second copy', () => {
    const project = loadProject(ROOT, PROD_PROJECT_ID);
    const browser = readBrowserProject(renderBrowserConfig(project));
    assert.deepStrictEqual(browser.church, webConfig(project, 'church'));
    assert.deepStrictEqual(browser.form, webConfig(project, 'form'));
    assert.strictEqual(browser.projectId, PROD_PROJECT_ID);
    assert.strictEqual(browser.liveOrigin, project.liveOrigin);

    const fn = functionsProject(project);
    assert.strictEqual(fn.projectId, PROD_PROJECT_ID);
    assert.strictEqual(fn.mcpWeb.projectId, PROD_PROJECT_ID);
    assert.strictEqual(fn.mcpWeb.apiKey, webConfig(project, 'church').apiKey);
    assert.strictEqual(fn.storageBucket, project.storageBucket);
    assert.strictEqual(fn.smsReplyWebhookUrl, project.smsReplyWebhookUrl);
    assert.strictEqual(fn.mcpIssuerUrl, project.mcpIssuerUrl);
});

test('a deploy fails when the shipped projectId is not the project being deployed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-project-'));
    const project = loadProject(ROOT, PROD_PROJECT_ID);
    writeFixture(dir, project, {browserProjectId: 'mosaic-hymn-ghost'});
    assert.throws(
        () => assertDeploy({root: dir, projectId: PROD_PROJECT_ID, iMeanProd: true}),
        /firebase-config\.js/);
});

test('a deploy of the church project fails without the loud flag', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-project-'));
    writeFixture(dir, loadProject(ROOT, PROD_PROJECT_ID));
    assert.throws(
        () => assertDeploy({root: dir, projectId: PROD_PROJECT_ID, iMeanProd: false}),
        /--i-mean-prod/);
});

test('a ghost deploy ignores the church App Check origin and still needs its own issuer', () => {
    const ghost = loadProject(ROOT, 'mosaic-manager-ghost');
    const missingEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-project-'));
    writeFixture(missingEnv, ghost, {
        appCheckLiveOrigin: 'https://mosaic-hymn-database.web.app',
    });
    assert.throws(
        () => assertDeploy({root: missingEnv, projectId: ghost.projectId, iMeanProd: false}),
        /MCP_ISSUER_URL/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-project-'));
    writeFixture(dir, ghost, {
        appCheckLiveOrigin: 'https://mosaic-hymn-database.web.app',
        dotenv: 'PUBLIC_FORM_APP_CHECK_MODE=off\n' +
            'MCP_ISSUER_URL=https://mosaic-manager-ghost-mcp.web.app\n',
    });
    assert.doesNotThrow(() => assertDeploy({
        root: dir,
        projectId: ghost.projectId,
        iMeanProd: false,
    }));
});

test('a church deploy still requires the church App Check origin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-project-'));
    writeFixture(dir, loadProject(ROOT, PROD_PROJECT_ID), {
        appCheckLiveOrigin: 'https://mosaic-manager-ghost.web.app',
    });
    assert.throws(
        () => assertDeploy({root: dir, projectId: PROD_PROJECT_ID, iMeanProd: true}),
        /App Check liveOrigin/);
});

test('the repo itself passes the church-project deploy check', () => {
    assert.doesNotThrow(() => assertDeploy({
        root: ROOT,
        projectId: PROD_PROJECT_ID,
        iMeanProd: true,
    }));
});

test('every page that boots Firebase loads the shared config first', () => {
    const pages = fs.readdirSync(path.join(ROOT, 'public'))
        .filter(name => name.endsWith('.html'));
    const consumers = ['auth.js', 'mobile/data.js', 'form-answer.js'];
    const misses = [];
    for (const name of pages) {
        const html = fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
        const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
        srcs.forEach((src, index) => {
            const consumer = consumers.find(file => src === file || src.endsWith('/' + file));
            if (!consumer) return;
            const configAt = srcs.findIndex(s => s === 'firebase-config.js' || s.endsWith('/firebase-config.js'));
            if (configAt < 0 || configAt > index) {
                misses.push(`${name} loads ${consumer} without firebase-config.js first`);
            }
        });
    }
    assert.deepStrictEqual(misses, []);
});

test('admin scripts cannot initialize the church project without naming it', () => {
    const dir = path.join(ROOT, 'scripts');
    const misses = [];
    const files = walkJs(dir);
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        if (!src.includes('initializeApp')) continue;
        if (!src.includes('mosaic-hymn-database') && !src.includes('service-account')) continue;
        if (src.includes('requireProject') || src.includes('service-account')) continue;
        misses.push(path.relative(ROOT, file));
    }
    assert.deepStrictEqual(misses, []);
});

test('seed-events follows --project instead of a baked-in church id', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-events.js'), 'utf8');
    assert.match(src, /requireProject\(process\.argv\)/);
    assert.match(src, /projectId,/);
    assert.doesNotMatch(src, /FIREBASE_PROJECT_ID\s*=\s*'mosaic-hymn-database'/);
});

test('the ghost deploy workflow pins mosaic-manager-ghost and never the church key', () => {
    const wfPath = path.join(ROOT, '.github', 'workflows', 'firebase-deploy-ghost.yml');
    const wf = fs.readFileSync(wfPath, 'utf8');
    assert.match(wf, /workflow_dispatch/);
    assert.doesNotMatch(wf, /^\s+push:\s*$/m);
    assert.match(wf, /concurrency:\s*\n\s+group:\s+firebase-deploy-mosaic-manager-ghost/);
    assert.match(wf, /--project mosaic-manager-ghost/);
    assert.match(wf, /apply-firebase-project\.js --project mosaic-manager-ghost/);
    assert.match(wf, /check-firebase-deploy\.js --project mosaic-manager-ghost/);
    assert.doesNotMatch(wf, /--i-mean-prod/);
    assert.match(wf, /PUBLIC_FORM_APP_CHECK_MODE=off/);
    assert.doesNotMatch(wf, /PUBLIC_FORM_APP_CHECK_MODE=enforce/);
    assert.doesNotMatch(wf, /PUBLIC_FORM_APP_CHECK_MODE=monitor/);
    assert.match(wf, /MCP_ISSUER_URL=https:\/\/mosaic-manager-ghost-mcp\.web\.app/);
    assert.match(
        wf,
        /--only hosting,functions,firestore:rules,firestore:indexes,storage/);
    assert.match(wf, /--dry-run/);
    assert.match(wf, /--force/);
    const secrets = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1]);
    assert.deepStrictEqual([...new Set(secrets)], ['FIREBASE_SERVICE_ACCOUNT_GHOST']);
    assert.match(wf, /mosaic-hymn-database/);
});

function writeFixture(dir, project, opts = {}) {
    const browserProjectId = opts.browserProjectId || project.projectId;
    fs.mkdirSync(path.join(dir, 'public'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'functions'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'config'), {recursive: true});
    fs.copyFileSync(
        path.join(ROOT, 'config', 'firebase-projects.json'),
        path.join(dir, 'config', 'firebase-projects.json'));
    const rendered = renderBrowserConfig(project)
        .replace(
            `"projectId": "${project.projectId}"`,
            `"projectId": "${browserProjectId}"`);
    fs.writeFileSync(path.join(dir, 'public', 'firebase-config.js'), rendered);
    fs.writeFileSync(
        path.join(dir, 'functions', 'firebase-project.json'),
        JSON.stringify(functionsProject(project), null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
        hosting: [
            {target: 'church', public: 'public'},
            {target: 'mcp', public: 'mcp-site'},
        ],
    }));
    fs.writeFileSync(path.join(dir, '.firebaserc'), JSON.stringify({
        projects: {default: project.projectId},
        targets: {
            [project.projectId]: {
                hosting: {
                    church: [project.hosting.church],
                    mcp: [project.hosting.mcp],
                },
            },
        },
    }));
    fs.writeFileSync(path.join(dir, 'functions', 'index.js'),
        'defineString(\n  "MCP_ISSUER_URL", {\n' +
        `  default: "${project.mcpIssuerUrl}",\n` +
        '});\n');
    if (opts.appCheckLiveOrigin) {
        fs.writeFileSync(
            path.join(dir, 'public', 'app-check-config.js'),
            `liveOrigin: '${opts.appCheckLiveOrigin}',\n`);
    }
    if (opts.dotenv != null) {
        fs.writeFileSync(
            path.join(dir, 'functions', `.env.${project.projectId}`),
            opts.dotenv);
    }
}

function walkJs(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) out.push(...walkJs(full));
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}
