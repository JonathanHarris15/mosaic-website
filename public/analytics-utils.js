/**
 * Parses a Bible reference string into an array of book/chapter objects.
 * Supports: 
 * - "John 3:16"
 * - "John 3:16-18"
 * - "John 3:16 - 4:5"
 * - "1 John 2:3"
 * - "Genesis 1-2" (Chapter ranges)
 */
export function parseBibleReference(ref, bibleData) {
    if (!ref) return [];
    
    const results = [];
    const parts = ref.split(/[;|,]/);
    
    parts.forEach(part => {
        const p = part.trim();
        
        // 1. Try Chapter:Verse range (e.g., "John 3:16-18" or "John 3:16 - 4:5")
        // Groups: 1:Book, 2:StartCh, 3:StartV, 4:EndCh, 5:EndV
        const cvMatch = p.match(/^(\d?\s*[a-zA-Z\s]+?)\s+(\d+):(\d+)(?:\s*-\s*(?:(\d+):)?(\d+))?.*$/);
        
        if (cvMatch) {
            const book = cvMatch[1].trim();
            const startChapter = parseInt(cvMatch[2]);
            const startVerse = parseInt(cvMatch[3]);
            const endChapter = cvMatch[4] ? parseInt(cvMatch[4]) : startChapter;
            const endVerse = cvMatch[5] ? parseInt(cvMatch[5]) : startVerse;
            
            if (startChapter === endChapter) {
                const verses = [];
                for (let v = startVerse; v <= endVerse; v++) {
                    verses.push(v);
                }
                results.push({ book, chapter: startChapter, verses });
            } else if (bibleData && bibleData[book]) {
                const bookChapters = bibleData[book];
                for (let c = startChapter; c <= endChapter; c++) {
                    const verses = [];
                    const maxVerse = bookChapters[c - 1] || 0;
                    
                    let sV = 1;
                    let eV = maxVerse;
                    
                    if (c === startChapter) sV = startVerse;
                    if (c === endChapter) eV = endVerse;
                    
                    // Clamp eV to maxVerse if it's the end chapter
                    if (c === endChapter && endVerse < maxVerse) eV = endVerse;

                    for (let v = sV; v <= eV; v++) {
                        verses.push(v);
                    }
                    results.push({ book, chapter: c, verses });
                }
            } else {
                // Fallback: just record the chapters if we don't have verse counts
                for (let c = startChapter; c <= endChapter; c++) {
                    results.push({ book, chapter: c, verses: [] });
                }
            }
        } else {
            // 2. Try Chapter-only range (e.g., "Genesis 1-2" or "John 8")
            // Groups: 1:Book, 2:StartCh, 3:EndCh
            const cMatch = p.match(/^(\d?\s*[a-zA-Z\s]+?)\s+(\d+)(?:\s*-\s*(\d+))?.*$/);
            if (cMatch) {
                const book = cMatch[1].trim();
                const startChapter = parseInt(cMatch[2]);
                const endChapter = cMatch[3] ? parseInt(cMatch[3]) : startChapter;
                
                if (bibleData && bibleData[book]) {
                    const bookChapters = bibleData[book];
                    for (let c = startChapter; c <= endChapter; c++) {
                        const verses = [];
                        const maxVerse = bookChapters[c - 1] || 0;
                        for (let v = 1; v <= maxVerse; v++) {
                            verses.push(v);
                        }
                        results.push({ book, chapter: c, verses });
                    }
                } else {
                    for (let c = startChapter; c <= endChapter; c++) {
                        results.push({ book, chapter: c, verses: [] });
                    }
                }
            }
        }
    });
    
    return results;
}
