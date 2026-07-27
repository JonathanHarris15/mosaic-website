/**
 * @fileoverview Repair the Mosaic Print Style Preset's bulleted-list rule, in the
 * Style Preset document AND in the snapshots already frozen onto weeks.
 *
 * The bug: the designed booklet's review-question list (`ul.m-qlist`) prints a
 * black disc AND the tan hexagon. The hexagon is a ::before ornament, so the
 * list's own marker has to be switched off — but the Style Preset said
 *
 *     .m-qlist{ list-style:none; ... }                                  (0,1,0)
 *
 * which loses to the generator's hardcoded global (service-guide-editor.html):
 *
 *     .preview-page ul, .preview-page ol { list-style-type: disc !important; }
 *
 * guide-seed.js was already corrected to `.preview-page ul.m-qlist, ul.m-qlist
 * { list-style:none !important; … }` — enough specificity plus !important to win
 * — but that correction only ever existed in code: the Style Preset document in
 * Firestore was never re-seeded, so every snapshot built since kept the losing
 * rule. Because a Service Guide Template is FROZEN onto each week at snapshot
 * time (ADR-0008 §3.5), fixing the Preset alone would leave existing weeks
 * broken; hence the second pass over `services/{date}.guide.snapshot`.
 *
 * Scope is deliberately narrow. It rewrites ONLY frozen CSS that is recognisably
 * the Mosaic Print preset and still missing the fix, and it is idempotent. At the
 * time of writing, the fix is the sole difference between the frozen copies and
 * the seed, so re-stamping carries no other drift onto past weeks — verify that
 * still holds (the script prints a diff) before applying after later design work.
 *
 * Usage:
 *   node scripts/backfill-mosaic-print-css.js          # dry run — reports only
 *   node scripts/backfill-mosaic-print-css.js --apply  # write
 */

const admin = require('firebase-admin');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-e5b20d0279.json';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';

const GuideSeed = require(path.join(ROOT, 'public/guide-seed.js'));
const GuideStore = require(path.join(ROOT, 'public/guide-store.js'));

admin.initializeApp({
    credential: admin.credential.cert(require(path.join(ROOT, SERVICE_ACCOUNT_FILE))),
    projectId: FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const PRESET_ID = 'seed_mosaic_print';
const TARGET_CSS = GuideSeed.MOSAIC_CSS.trim();

// A brand token unique to the Mosaic Print preset — identifies its CSS wherever
// it was frozen (snapshot pages keep only the resolved CSS, not the preset id).
const MOSAIC_MARKER = '--navy-900:#0E1C36';
// The corrected rule; its presence means a copy is already fixed.
const HAS_FIX = /\.preview-page ul\.m-qlist/;

const isMosaicCss = (css) => typeof css === 'string' && css.includes(MOSAIC_MARKER);
const needsFix = (css) => isMosaicCss(css) && !HAS_FIX.test(css);

// Report the line-level difference so an applier can confirm the re-stamp carries
// nothing but the intended fix.
function reportDrift(oldCss) {
    const oldLines = oldCss.trim().split('\n').map(s => s.trim()).filter(Boolean);
    const newLines = TARGET_CSS.split('\n').map(s => s.trim()).filter(Boolean);
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const removed = oldLines.filter(l => !newSet.has(l));
    const added = newLines.filter(l => !oldSet.has(l));
    console.log('\nDrift the re-stamp would introduce (frozen -> seed):');
    for (const l of removed) console.log('   - ' + l.slice(0, 110));
    for (const l of added) console.log('   + ' + l.slice(0, 110));
    const onlyTheFix = removed.every(l => l.includes('m-qlist')) && added.every(l => l.includes('m-qlist') || l.startsWith('/*') || l.startsWith('so the'));
    console.log(onlyTheFix
        ? '   => only the m-qlist fix. Safe to apply.'
        : '   => WARNING: unrelated changes present. Review before applying.');
}

async function run() {
    console.log(APPLY ? 'APPLYING changes\n' : 'DRY RUN — no writes (pass --apply to write)\n');

    // 1. The Style Preset every future snapshot is built from.
    const presetRef = db.collection(GuideStore.COLLECTIONS.stylePresets).doc(PRESET_ID);
    const presetDoc = await presetRef.get();
    if (!presetDoc.exists) {
        console.log(`style_presets/${PRESET_ID}: MISSING — run the Manager's re-seed first.`);
    } else {
        const css = presetDoc.data().css || '';
        if (css.trim() === TARGET_CSS) {
            console.log(`style_presets/${PRESET_ID}: already current`);
        } else {
            reportDrift(css);
            console.log(`\nstyle_presets/${PRESET_ID}: WOULD UPDATE (${css.length} -> ${TARGET_CSS.length} chars)`);
            if (APPLY) {
                await presetRef.update({ css: TARGET_CSS, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                console.log(`style_presets/${PRESET_ID}: updated`);
            }
        }
    }

    // 2. Snapshots already frozen onto weeks.
    console.log('\nFrozen weeks:');
    const snap = await db.collection('services').get();
    let changed = 0;

    for (const doc of snap.docs) {
        const raw = doc.data() || {};
        const guide = raw.guide;
        if (!GuideStore.isV2Guide(guide)) continue;

        const pages = (guide.snapshot && guide.snapshot.pages) || [];
        const hits = pages.filter(p => needsFix(p.resolvedStylePresetCss));
        if (!hits.length) continue;

        console.log(`   ${doc.id}: ${hits.length} page(s) carrying the old rule`);
        changed++;
        if (!APPLY) continue;

        for (const p of pages) {
            if (needsFix(p.resolvedStylePresetCss)) p.resolvedStylePresetCss = TARGET_CSS;
        }
        // Replace the frozen snapshot map wholesale — the week's `values` and the
        // rest of the guide record are untouched.
        await doc.ref.update({ 'guide.snapshot': guide.snapshot });
        console.log(`   ${doc.id}: updated`);
    }

    console.log(changed
        ? `\n${APPLY ? 'Updated' : 'Would update'} ${changed} week(s).`
        : '\nNo frozen weeks need the fix.');
    if (!APPLY && changed) console.log('Re-run with --apply to write.');
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
