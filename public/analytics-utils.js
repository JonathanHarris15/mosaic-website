/**
 * Parses a Bible reference string into an array of book/chapter objects.
 * Supports: 
 * - "John 3:16"
 * - "John 3:16-18"
 * - "John 3:16 - 4:5"
 * - "1 John 2:3"
 */
export function parseBibleReference(ref) {
    if (!ref) return [];
    
    const results = [];
    const parts = ref.split(/[;|,]/);
    
    parts.forEach(part => {
        const p = part.trim();
        // Match "Book Chapter:Verse" or "Book Chapter:Verse-Verse" or "Book Chapter:Verse - Chapter:Verse"
        const match = p.match(/^(\d?\s*[a-zA-Z\s]+?)\s+(\d+):(\d+)(?:\s*-\s*(?:(\d+):)?(\d+))?.*$/);
        
        if (match) {
            const book = match[1].trim();
            const startChapter = parseInt(match[2]);
            const startVerse = parseInt(match[3]);
            const endChapter = match[4] ? parseInt(match[4]) : startChapter;
            const endVerse = match[5] ? parseInt(match[5]) : startVerse;
            
            if (startChapter === endChapter) {
                const verses = [];
                for (let v = startVerse; v <= endVerse; v++) {
                    verses.push(v);
                }
                results.push({ book, chapter: startChapter, verses });
            } else {
                // For multi-chapter ranges, we'd need BIBLE_DATA to know how many verses are in the first chapter.
                // Since this is for a heat map, we'll at least record the chapters.
                for (let c = startChapter; c <= endChapter; c++) {
                    results.push({ book, chapter: c, verses: [] }); // Verses empty for multi-chapter to keep it simple unless we have BIBLE_DATA
                }
            }
        }
    });
    
    return results;
}
