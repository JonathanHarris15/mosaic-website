#!/usr/bin/env node
// MS-716 — signed-in emulator screenshots and interaction checks.
// Prereqs: hosting + auth + firestore emulators, `node scripts/seed-liturgy-orders-emulator.js`.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs/design/screenshots/ms-716');
const ARTIFACTS = '/opt/cursor/artifacts';
const HOST = process.env.MS716_HOST || 'http://127.0.0.1:5005';
const DESIGN = process.env.MS716_DESIGN_HTML
    || '/home/ubuntu/.cursor/projects/workspace/uploads/liturgy-orders-redesign_0297.html';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ARTIFACTS, { recursive: true });

const log = [];
function note(line) { log.push(line); console.log(line); }

async function openEditor(page) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${HOST}/liturgy-orders.html?emulator=1&emulatorUser=editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lo-tabs', { timeout: 45000 });
    await page.waitForSelector('.lo-row', { timeout: 45000 });
}

async function openViewer(page) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${HOST}/liturgy-orders.html?emulator=1&emulatorUser=viewer`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lo-tabs', { timeout: 45000 });
}

async function selectPastoralPrayer(page) {
    await page.locator('.lo-row', { hasText: 'Pastoral Prayer' }).first().click();
    await page.waitForSelector('.lo-inspector__panel', { timeout: 10000 });
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await openEditor(page);
    await selectPastoralPrayer(page);
    await page.screenshot({ path: path.join(OUT, 'editor-pastoral-prayer-1280.png'), fullPage: true });
    await page.screenshot({ path: path.join(ARTIFACTS, 'ms-716-editor-pastoral-prayer.png'), fullPage: true });
    note('Captured editor + Pastoral Prayer at 1280×800');

    if (fs.existsSync(DESIGN)) {
        const designPage = await context.newPage();
        await designPage.setViewportSize({ width: 1280, height: 800 });
        await designPage.goto(`file://${DESIGN}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await designPage.waitForTimeout(8000);
        await designPage.screenshot({ path: path.join(OUT, 'design-reference-1280.png'), fullPage: true });
        note('Captured design bundle reference at 1280×800');
        await designPage.close();
    }

    const idsBefore = await page.locator('[data-element-id]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-element-id')));
    const pastoralId = idsBefore.find((_, i) => i === 9) || 'pastoralPrayer';

    await selectPastoralPrayer(page);
    await page.locator('.lo-kind-btn', { hasText: 'Other' }).click();
    await page.waitForTimeout(300);
    const idsAfterInsert = await page.locator('[data-element-id]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-element-id')));
    note('Insert-after: count ' + idsBefore.length + ' → ' + idsAfterInsert.length);

    await selectPastoralPrayer(page);
    await page.locator('.lo-inspector__acts button[aria-label*="down"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('.lo-inspector__acts button[aria-label*="up"]').first().click();
    await page.waitForTimeout(300);

    const insertedRow = page.locator('.lo-row', { hasText: 'Other' }).last();
    await insertedRow.click();
    await page.locator('.lo-inspector__acts button[aria-label*="Take"][aria-label*="out of this order"]').click();
    await page.waitForTimeout(300);
    note('Remove: inserted Other row taken out');

    await page.locator('#order-name').fill('Standard Sunday');
    await page.locator('#order-name').blur();
    await page.waitForTimeout(200);

    await selectPastoralPrayer(page);
    const noteToggle = page.locator('.lo-inspector__panel label.m-check').filter({ hasText: 'Takes a note' }).locator('input');
    await noteToggle.click();

    await selectPastoralPrayer(page);
    await page.locator('.lo-inspector .m-seg__opt', { hasText: 'A woman' }).nth(1).click();
    await page.locator('.lo-days__input').fill('7');
    await page.locator('.lo-days button', { hasText: 'Add' }).click();
    await page.locator('.lo-days__list .m-token', { hasText: '7' }).locator('button').click();

    await page.locator('#prayer-message').fill('Hello {name} — {link}');
    await page.locator('#prayer-response').fill('Thank you {name}');
    await page.locator('#liturgy-orders-save').click();
    await page.waitForSelector('.m-toast', { timeout: 15000 });
    await page.waitForTimeout(800);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.lo-tabs', { timeout: 45000 });
    await selectPastoralPrayer(page);
    const msg = await page.locator('#prayer-message').inputValue();
    const resp = await page.locator('#prayer-response').inputValue();
    note('Reload persistence: message=' + JSON.stringify(msg) + ' response=' + JSON.stringify(resp));

    const idsAfter = await page.locator('[data-element-id]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-element-id')));
    const pastoralStill = idsAfter.includes(pastoralId);
    note('Pastoral Prayer id stable after edits: ' + pastoralId + ' present=' + pastoralStill);

    await page.screenshot({ path: path.join(OUT, 'editor-after-flows-1280.png'), fullPage: true });

    await openViewer(page);
    await page.screenshot({ path: path.join(OUT, 'viewer-readonly-1280.png'), fullPage: true });
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
