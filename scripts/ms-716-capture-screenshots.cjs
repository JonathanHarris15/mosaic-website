#!/usr/bin/env node
// MS-716 — signed-in emulator screenshots and interaction checks.
// Prereqs: hosting + auth + firestore emulators, `node scripts/seed-liturgy-orders-emulator.js`.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs/design/screenshots/ms-716');
const ARTIFACTS = '/opt/cursor/artifacts';
const HOST = process.env.MS716_HOST || 'http://127.0.0.1:5005';
const DESIGN = process.env.MS716_DESIGN_HTML
    || '/home/ubuntu/.cursor/projects/workspace/uploads/liturgy-orders-redesign_0297.html';
const VIEWPORT = { width: 1280, height: 900 };

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ARTIFACTS, { recursive: true });

const log = [];
function note(line) { log.push(line); console.log(line); }

function inspectorScroll(page) {
    return page.locator('.lo-inspector__scroll');
}

async function scrollInspectorToBottom(page) {
    const sc = inspectorScroll(page);
    await sc.waitFor({ state: 'visible', timeout: 10000 });
    const before = await sc.evaluate((el) => ({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
    }));
    assert.ok(before.scrollHeight > before.clientHeight + 8,
        'Inspector content should overflow (scrollHeight > clientHeight): ' + JSON.stringify(before));
    await sc.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(150);
    const after = await sc.evaluate((el) => el.scrollTop);
    assert.ok(after > 20, 'Inspector scrollTop should move: ' + after);
    return after;
}

async function openEditor(page) {
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${HOST}/liturgy-orders.html?emulator=1&emulatorUser=editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lo-tabs', { timeout: 45000 });
    await page.waitForSelector('.lo-row', { timeout: 45000 });
}

async function openViewer(page) {
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${HOST}/liturgy-orders.html?emulator=1&emulatorUser=viewer`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lo-tabs', { timeout: 45000 });
}

async function selectPastoralPrayer(page) {
    await page.locator('[data-element-id="pastoralPrayer"]').click();
    await page.waitForSelector('.lo-inspector__panel', { timeout: 10000 });
}

async function ensurePrayerRequests(page) {
    const days = page.locator('.lo-days__input');
    if (await days.count()) return;
    const box = page.locator('.lo-prayer label.m-check', { hasText: 'Send prayer requests' }).locator('input');
    await box.check();
    await page.waitForSelector('.lo-days__input', { timeout: 10000 });
}

async function dayChipTexts(page) {
    return page.locator('.lo-days__list .m-token > span').evaluateAll(nodes =>
        nodes.map(n => n.textContent.trim()).filter(Boolean));
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await openEditor(page);
    await selectPastoralPrayer(page);
    await ensurePrayerRequests(page);
    await page.screenshot({ path: path.join(OUT, 'editor-pastoral-prayer-1280.png') });
    await page.screenshot({ path: path.join(ARTIFACTS, 'ms-716-editor-pastoral-prayer.png') });
    note('Captured editor + Pastoral Prayer at 1280×900');

    const idsBefore = await page.locator('[data-element-id]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-element-id')));
    const pastoralId = idsBefore.find((id) => id === 'pastoralPrayer') || 'pastoralPrayer';

    await page.locator('.lo-kind-btn', { hasText: 'Other' }).click();
    await page.waitForTimeout(300);
    const idsAfterInsert = await page.locator('[data-element-id]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-element-id')));
    note('Insert-after: count ' + idsBefore.length + ' → ' + idsAfterInsert.length);

    await selectPastoralPrayer(page);
    await page.locator('.lo-inspector__acts button[aria-label*="down"]').first().click();
    await page.waitForTimeout(200);
    await page.locator('.lo-inspector__acts button[aria-label*="up"]').first().click();
    await page.waitForTimeout(200);

    const insertedRow = page.locator('.lo-row', { hasText: 'Other' }).last();
    await insertedRow.click();
    await page.locator('.lo-inspector__acts button[aria-label*="Take"][aria-label*="out of this order"]').click();
    await page.waitForTimeout(200);
    note('Remove: inserted Other row taken out');

    await page.locator('#order-name').fill('Standard Sunday');
    await page.locator('#order-name').blur();
    await page.waitForTimeout(150);

    await selectPastoralPrayer(page);
    await ensurePrayerRequests(page);
    await scrollInspectorToBottom(page);
    await page.locator('.lo-inspector .m-seg__opt', { hasText: 'A woman' }).nth(1).click();
    await page.locator('.lo-days__input').fill('7');
    await page.locator('.lo-days__list button.m-btn', { hasText: 'Add' }).click();
    await page.getByRole('button', { name: /Take day 1 off/ }).click();
    await page.waitForTimeout(150);

    const daysBeforeSave = await dayChipTexts(page);
    assert.deepStrictEqual(daysBeforeSave.sort((a, b) => Number(b) - Number(a)), ['7', '5', '3'],
        'day chips before save');

    const testMessage = 'Hello {name} — {link}';
    await page.locator('#prayer-message').fill(testMessage);
    await page.locator('#prayer-response').fill('Thank you {name}');
    await page.locator('#liturgy-orders-save').click();
    await page.waitForSelector('.m-toast', { timeout: 15000 });
    await page.waitForTimeout(600);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lo-tabs', { timeout: 45000 });
    await selectPastoralPrayer(page);
    await ensurePrayerRequests(page);
    await scrollInspectorToBottom(page);

    const msg = await page.locator('#prayer-message').inputValue();
    assert.strictEqual(msg, testMessage, 'message after reload');
    const daysAfter = await dayChipTexts(page);
    assert.deepStrictEqual(daysAfter.sort((a, b) => Number(b) - Number(a)), ['7', '5', '3'],
        'notice days after reload');
    note('Reload persistence: days=' + JSON.stringify(daysAfter) + ' message saved');

    const idsAfter = await page.locator('[data-element-id]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-element-id')));
    assert.ok(idsAfter.includes(pastoralId), 'Pastoral Prayer id stable: ' + pastoralId);
    note('Pastoral Prayer id stable after edits');

    await page.screenshot({ path: path.join(OUT, 'inspector-bottom-1280.png') });
    note('Captured inspector bottom at 1280×900 (days, message, response visible)');

    if (fs.existsSync(DESIGN)) {
        const designPage = await context.newPage();
        await designPage.setViewportSize(VIEWPORT);
        await designPage.goto(`file://${DESIGN}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await designPage.waitForTimeout(8000);
        await designPage.screenshot({ path: path.join(OUT, 'design-reference-1280.png'), fullPage: true });
        note('Captured design bundle reference at 1280×900');
        await designPage.close();
    }

    await page.screenshot({ path: path.join(OUT, 'editor-after-flows-1280.png') });

    await openViewer(page);
    await page.screenshot({ path: path.join(OUT, 'viewer-readonly-1280.png') });
    note('Captured viewer read-only state');

    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${HOST}/liturgy-orders.html?emulator=1&emulatorUser=editor&shell=mobile`, { waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('.lo-tabs', { timeout: 45000 });
    await mobile.screenshot({ path: path.join(OUT, 'editor-mobile-390.png'), fullPage: true });
    note('Captured mobile shell at 390×844');

    fs.writeFileSync(path.join(OUT, 'flow-log.txt'), log.join('\n') + '\n');
    await browser.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
