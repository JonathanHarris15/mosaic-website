/**
 * docx-importer.js
 * Handles client-side parsing of Word .docx orders of service and imports them to Firestore.
 */

window.initDocxImporter = function(onSuccess) {
    const importBtn = document.getElementById('import-docx-btn');
    const fileInput = document.getElementById('docx-file-input');
    let hymnRegistry = [];
    let fuse = null;

    // Load hymn registry for matching
    const loadHymnRegistry = async () => {
        try {
            const getHymnIndex = firebase.app().functions('us-central1').httpsCallable('getHymnIndex');
            const result = await getHymnIndex();
            hymnRegistry = result.data;
            fuse = new Fuse(hymnRegistry, {
                keys: ['hymn_name'],
                threshold: 0.3,
                distance: 100
            });
        } catch (error) {
            console.error("Error loading hymn registry for importer:", error);
        }
    };

    loadHymnRegistry();

    importBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        importBtn.disabled = true;
        importBtn.classList.add('opacity-100', 'bg-secondary');
        importBtn.innerHTML = `<span class="material-symbols-outlined animate-spin">sync</span> Parsing...`;

        const results = [];

        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                const text = result.value;
                const status = await parseAndSaveService(text);
                results.push({ name: file.name, ...status });
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                results.push({ name: file.name, success: false, error: error.message || 'Unknown error' });
            }
        }

        importBtn.disabled = false;
        importBtn.classList.remove('opacity-100', 'bg-secondary');
        importBtn.innerHTML = `<span class="material-symbols-outlined">upload_file</span><span class="font-label-md text-sm hidden md:inline">Import from docx</span>`;
        fileInput.value = '';

        const failures = results.filter(r => !r.success);
        const successes = results.filter(r => r.success);

        if (failures.length > 0) {
            let message = `Import complete with errors.\n\n✅ Success: ${successes.length}\n❌ Failed: ${failures.length}\n\nFailures:\n`;
            failures.forEach(f => {
                message += `- ${f.name}: ${f.error}\n`;
            });
            alert(message);
        } else if (successes.length > 0) {
            alert(`Successfully imported ${successes.length} services.`);
        }

        if (onSuccess) onSuccess();
    });

    const dateIdFrom = (dateStr) => {
        if (!dateStr) return null;
        // Remove ordinal suffixes (1st, 2nd, 3rd, 4th, etc.) and caret symbols
        const cleanDateStr = String(dateStr).replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/\^/g, '');
        const dateObj = new Date(cleanDateStr);
        if (isNaN(dateObj)) return null;
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // The same translator that switches a Sunday from one order to another.
    // A labeled bulletin resolves in code. Anything else is Jev's to place,
    // and a line that fits nowhere is stored as a leftover on the Sunday.
    const parseAndSaveService = async (text) => {
        const parsed = LiturgyTranslateCore.fragmentsFromText(text);
        let catalog = LiturgyOrderCore.standardCatalog();
        try {
            catalog = await LiturgyOrderStore.loadCatalog(firebase.firestore());
        } catch (err) {
            console.warn('Liturgy orders could not be read; importing into Standard.', err);
        }

        const labeledDate = parsed.fragments.find((item) => item.header === 'date');
        let dateId = dateIdFrom(labeledDate && labeledDate.valueText);
        let order = LiturgyOrderCore.orderFor({}, catalog);
        const db = firebase.firestore();

        if (dateId) {
            const existing = await db.collection('services').doc(dateId).get();
            const orderId = existing.exists ? existing.data().liturgyOrderId : '';
            order = LiturgyOrderCore.orderFor({ liturgyOrderId: orderId || '' }, catalog);
        }

        const planInto = async (target) => {
            const plan = await LiturgyTranslate.translate(
                parsed.fragments,
                LiturgyTranslateCore.targetsFromOrder(target, { headers: true }),
                'document',
                { sourceOrder: 'Bulletin', targetOrder: target.name }
            );
            return LiturgyTranslateCore.importPatch(plan, target);
        };

        let patch = await planInto(order);
        if (!dateId) dateId = dateIdFrom(patch.dateText);
        if (!dateId) {
            return { success: false, error: 'Could not find or parse "Date" field.' };
        }

        const firstSunday = ServiceDatesCore.FIRST_SUNDAY;
        if (dateId < firstSunday) {
            return { success: false, error: `Date (${dateId}) is before the project start date of ${DateUtils.formatDateLong(firstSunday)}.` };
        }

        const docRef = db.collection('services').doc(dateId);
        const existingDoc = await docRef.get();
        const exists = existingDoc.exists;
        const orderId = exists ? existingDoc.data().liturgyOrderId : '';
        const savedOrder = LiturgyOrderCore.orderFor({ liturgyOrderId: orderId || '' }, catalog);
        if (savedOrder.id !== order.id) {
            order = savedOrder;
            patch = await planInto(order);
        }

        const hymnIds = {};
        (order.elements || []).forEach((el) => { if (el.kind === 'hymn') hymnIds[el.id] = true; });
        Object.keys(patch.liturgy).forEach((key) => {
            if (!hymnIds[key]) return;
            const value = patch.liturgy[key];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                patch.liturgy[key] = matchHymn(value.name || '');
            }
        });

        try {
            if (exists) {
                const updates = {
                    liturgyOrderId: patch.liturgyOrderId,
                    liturgyLeftovers: patch.liturgyLeftovers,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                ['theme', 'keyVerse', 'serviceLeader', 'musicLeader', 'preacher'].forEach((key) => {
                    if (patch[key]) updates[key] = patch[key];
                });
                if (Object.prototype.hasOwnProperty.call(patch.liturgy, 'baptism')) {
                    updates.hasBaptism = patch.hasBaptism;
                }
                for (const [key, value] of Object.entries(patch.liturgy)) {
                    updates[`liturgy.${key}`] = value;
                }
                for (const [key, value] of Object.entries(patch.notes)) {
                    updates[`notes.${key}`] = value;
                }
                await docRef.update(updates);
            } else {
                const service = {
                    theme: patch.theme || '',
                    keyVerse: patch.keyVerse || '',
                    serviceLeader: patch.serviceLeader || '',
                    musicLeader: patch.musicLeader || '',
                    preacher: patch.preacher || '',
                    hasBaptism: patch.hasBaptism,
                    liturgyOrderId: patch.liturgyOrderId,
                    liturgyLeftovers: patch.liturgyLeftovers,
                    notes: patch.notes,
                    liturgy: patch.liturgy,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await docRef.set(service);
            }
            return { success: true, dateId, isUpdate: exists };
        } catch (error) {
            return { success: false, error: `Firestore error: ${error.message}` };
        }
    };

    const matchHymn = (name) => {
        if (!name) return { id: null, name: '' };
        if (!fuse) return { id: null, name: name };
        
        // Exact match check first
        const exact = hymnRegistry.find(h => h.hymn_name.toLowerCase() === name.toLowerCase());
        if (exact) return { id: exact.id, name: exact.hymn_name };

        // Fuzzy match
        const results = fuse.search(name);
        if (results.length > 0 && results[0].score < 0.4) {
            return { id: results[0].item.id, name: results[0].item.hymn_name };
        }
        return { id: null, name: name };
    };
};
