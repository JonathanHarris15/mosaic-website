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

        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                const text = result.value;
                await parseAndSaveService(text);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Error processing ${file.name}`);
            }
        }

        importBtn.disabled = false;
        importBtn.classList.remove('opacity-100', 'bg-secondary');
        importBtn.innerHTML = `<span class="material-symbols-outlined">upload_file</span><span class="font-label-md text-sm hidden md:inline">Import from docx</span>`;
        fileInput.value = '';

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
            const dateObj = new Date(dateStr);
            if (!isNaN(dateObj)) {
                // Correct format: YYYY-MM-DD (Month is 0-indexed in JS, so add 1)
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                dateId = `${year}-${month}-${day}`;
            }
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

        if (dateId) {
            const db = firebase.firestore();
            await db.collection('services').doc(dateId).set(service, { merge: true });
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
