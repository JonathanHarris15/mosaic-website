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

    const parseAndSaveService = async (text) => {
        const paragraphs = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        const findValue = (label) => {
            const lowerLabel = label.toLowerCase();
            for (const p of paragraphs) {
                if (p.toLowerCase().startsWith(lowerLabel)) {
                    if (p.includes(':')) {
                        return p.split(':').slice(1).join(':').trim();
                    }
                    return p.substring(label.length).trim();
                }
            }
            return '';
        };

        const service = {
            theme: findValue('Service Theme'),
            keyVerse: findValue('Key Verse'),
            serviceLeader: findValue('Service Leader'),
            musicLeader: findValue('Music Leader'),
            preacher: findValue('Preacher'),
            hasBaptism: findValue('Baptism').length > 0,
            notes: {},
            liturgy: {
                preparatoryHymn: matchHymn(findValue('Preparatory Hymn')),
                callToWorship: findValue('Scriptural Call to Worship'),
                hymn1: { id: null, name: '' },
                hymn2: { id: null, name: '' },
                callToConfession: findValue('Call to Confession'),
                assuranceOfPardon: findValue('Scriptural Assurance of Pardon'),
                hymnMid1: { id: null, name: '' },
                hymnMid2: { id: null, name: '' },
                scriptureReading: findValue('Scripture Reading'),
                sermon: findValue('Sermon'),
                baptism: findValue('Baptism'),
                hymnEnd1: { id: null, name: '' },
                hymnEnd2: { id: null, name: '' },
                benediction: findValue('Benediction')
            }
        };

        // Date Parsing
        let dateId = null;
        const dateStr = findValue('Date');
        if (dateStr) {
            // Remove ordinal suffixes (1st, 2nd, 3rd, 4th, etc.) and caret symbols
            const cleanDateStr = dateStr.replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/\^/g, '');
            const dateObj = new Date(cleanDateStr);
            if (!isNaN(dateObj)) {
                // Correct format: YYYY-MM-DD (Month is 0-indexed in JS, so add 1)
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                dateId = `${year}-${month}-${day}`;
            }
        }

        if (!dateId) {
            return { success: false, error: 'Could not find or parse "Date" field.' };
        }

        // Project Start Date Check: July 9, 2023
        const projectStartDate = new Date(2023, 6, 9); // Month is 0-indexed
        if (new Date(dateId) < projectStartDate) {
            return { success: false, error: `Date (${dateId}) is before the project start date of July 9, 2023.` };
        }

        // Hymn Collection
        const hymnsFound = paragraphs
            .filter(p => p.toLowerCase().startsWith('hymn:'))
            .map(p => matchHymn(p.split(':').slice(1).join(':').trim()));

        /**
         * Baptism Displacement Logic (from Python reference):
         * - Hymn3 is cleared for baptism.
         * - Subsequent hymns are shifted down.
         * Mapping to our Liturgy object:
         * Hymn1 = hymn1
         * Hymn2 = hymn2
         * Hymn3 = hymnMid1
         * Hymn4 = hymnMid2
         * Hymn5 = hymnEnd1
         * Hymn6 = hymnEnd2
         */
        if (service.hasBaptism) {
            service.liturgy.hymn1 = hymnsFound[0] || { id: null, name: '' };
            service.liturgy.hymn2 = hymnsFound[1] || { id: null, name: '' };
            // Hymn3 (hymnMid1) is cleared/reserved for baptism
            service.liturgy.hymnMid1 = { id: null, name: '' }; 
            service.liturgy.hymnMid2 = hymnsFound[2] || { id: null, name: '' }; // Original Hymn3 -> Hymn4
            service.liturgy.hymnEnd1 = hymnsFound[3] || { id: null, name: '' }; // Original Hymn4 -> Hymn5
            service.liturgy.hymnEnd2 = hymnsFound[4] || { id: null, name: '' }; // Original Hymn5 -> Hymn6
        } else {
            service.liturgy.hymn1 = hymnsFound[0] || { id: null, name: '' };
            service.liturgy.hymn2 = hymnsFound[1] || { id: null, name: '' };
            service.liturgy.hymnMid1 = hymnsFound[2] || { id: null, name: '' };
            service.liturgy.hymnMid2 = hymnsFound[3] || { id: null, name: '' };
            service.liturgy.hymnEnd1 = hymnsFound[4] || { id: null, name: '' };
            service.liturgy.hymnEnd2 = hymnsFound[5] || { id: null, name: '' };
        }

        // Notes Extraction
        let inNotes = false;
        for (const p of paragraphs) {
            if (p.toLowerCase().startsWith('notes:')) {
                inNotes = true;
                continue;
            }
            if (inNotes) {
                const noteMatch = p.match(/(.+?):\s*(.+)/);
                if (noteMatch) {
                    const key = mapNoteKey(noteMatch[1]);
                    if (key) {
                        service.notes[key] = noteMatch[2];
                    }
                }
            }
        }

        try {
            const db = firebase.firestore();
            const docRef = db.collection('services').doc(dateId);
            const existingDoc = await docRef.get();
            const exists = existingDoc.exists;

            if (exists) {
                // SURGICAL UPDATE: Use dot-notation to avoid wiping out the entire nested object
                const updates = {
                    theme: service.theme,
                    keyVerse: service.keyVerse,
                    serviceLeader: service.serviceLeader,
                    musicLeader: service.musicLeader,
                    preacher: service.preacher,
                    hasBaptism: service.hasBaptism,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // Surgical updates for liturgy
                for (const [key, value] of Object.entries(service.liturgy)) {
                    updates[`liturgy.${key}`] = value;
                }

                // Surgical updates for notes (preserve existing manual notes not in docx)
                for (const [key, value] of Object.entries(service.notes)) {
                    updates[`notes.${key}`] = value;
                }

                await docRef.update(updates);
            } else {
                // New document
                service.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
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

    const mapNoteKey = (label) => {
        const mapping = {
            'call to worship': 'callToWorship',
            'call to confession': 'callToConfession',
            'scriptural assurance of pardon': 'assuranceOfPardon',
            'assurance of pardon': 'assuranceOfPardon',
            'scripture reading': 'sermon', // Per request: Scripture Reading goes with pastoral prayer/sermon section
            'sermon': 'sermon',
            'baptism': 'baptism'
        };
        return mapping[label.toLowerCase()];
    };
};
