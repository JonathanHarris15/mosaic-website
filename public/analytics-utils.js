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
    
    // Regular expression to find "Book Chapter:Verse"
    // This is a simplified parser; in a real-world app, we'd use a library like bcv-parser
    // but for our heat map, we just need the Book and Chapter(s).
    
    const results = [];
    
    // Split by common separators if multiple ranges exist (e.g., "John 3:16; 4:1")
    const parts = ref.split(/[;|,]/);
    
    parts.forEach(part => {
        const p = part.trim();
        // Match "Book Chapter:Verse" or "Book Chapter:Verse-Verse" or "Book Chapter:Verse - Chapter:Verse"
        const match = p.match(/^(\d?\s*[a-zA-Z\s]+?)\s+(\d+):(\d+)(?:\s*-\s*(?:(\d+):)?(\d+))?.*$/);
        
        if (match) {
            const book = match[1].trim();
            const startChapter = parseInt(match[2]);
            const endChapter = match[4] ? parseInt(match[4]) : startChapter;
            
            // Add all chapters in range
            for (let c = startChapter; c <= endChapter; c++) {
                results.push({ book, chapter: c });
            }
        }
    });
    
    return results;
}
