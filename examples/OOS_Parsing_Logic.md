# Order of Service (OOS) Parsing Logic Overview

This document provides a detailed technical overview of how the current system parses Order of Service `.docx` files to extract data for generating service guides.

## 1. Core Technology
The parsing is implemented in Python using the `python-docx` library. This allows the system to iterate through the structural elements (primarily paragraphs) of a Word document.

## 2. Input Requirements
The parser expects a `.docx` file where information is organized by labels at the beginning of paragraphs. While not strictly "structured data," it follows a "Label: Value" or "Label Value" convention.

### Example OOS Format:
```text
Date: May 10, 2026
Service Leader: John Doe
Music Leader: Jane Smith
Service Theme: Grace Abounding
Key Verse: Ephesians 2:8-9
Hymn: Amazing Grace
Hymn: How Great Thou Art
...
```

## 3. Extraction Process

### A. Label-Based Search (`find_value`)
The primary extraction method is a simple linear search through all paragraphs in the document.
- **Matching:** It checks if a paragraph's text (stripped of whitespace) starts with a specific case-insensitive label.
- **Extraction:** 
    - If a colon (`:`) is found in the matching paragraph, it takes everything after the first colon.
    - If no colon is found, it takes everything after the label itself.
- **Fields Extracted via this method:**
    - `Date` (Mapped to `TitlePageDate`)
    - `Service Leader`
    - `Music Leader`
    - `Preacher`
    - `Service Theme`
    - `Key Verse` (The reference only, e.g., "John 3:16")
    - `Preparatory Hymn`
    - `Scriptural Call to Worship`
    - `Call to Confession`
    - `Scriptural Assurance of Pardon`
    - `Scripture Reading`
    - `Sermon`
    - `Baptism`
    - `Benediction`

### B. Hymn Collection
Hymns are handled differently because there are multiple entries with the same label.
- The parser iterates through all paragraphs.
- It collects every paragraph starting with `Hymn:`.
- These are stored in a list and then mapped to sequential keys: `Hymn1`, `Hymn2`, `Hymn3`, `Hymn4`, `Hymn5`, and `Hymn6`.

## 4. Post-Parsing Logic (Generator Level)
Once the raw strings are extracted, the `Generator` class performs several critical transformations before the data is ready for the template.

### A. Scripture Fetching
For the `Key Verse`, the parser only extracts the reference. The `Generator` uses the `esv_client` (ESV API) to fetch the actual text of the scripture passage to be printed in the guide.

### B. Hymn Metadata Retrieval
For each hymn name (e.g., "Amazing Grace"), the system:
1.  Queries a hymn API to find the closest matching hymn.
2.  Retrieves image URLs for the sheet music (handling multi-page hymns).
3.  Retrieves attribution/copyright information.

### C. Baptism Displacement Logic
If a `Baptism` value is found in the document, the system automatically adjusts the order of hymns:
- `Hymn3` is cleared (to make room for the baptism segment in the printed guide).
- Subsequent hymns are shifted down (`Hymn3` -> `Hymn4`, `Hymn4` -> `Hymn5`, etc.).

### D. LaTeX Escaping
Since the final output is a LaTeX document, all extracted text is passed through an escaping function to handle special characters (like `&`, `$`, `%`, `_`, etc.) that would otherwise break the LaTeX compilation.

## 5. Limitations & Heuristics
- **No Table Support:** The current parser does not look inside Word tables. All information must be in standard paragraphs.
- **Top-Down Priority:** If a label appears multiple times (except for `Hymn:`), the parser usually takes the first occurrence.
- **Exact Label Matching:** The logic relies on the labels being at the *start* of the paragraph. If there is introductory text before the label, it will be missed.

## 6. Data Structure Example
The resulting dictionary passed to the template engine looks like this:
```json
{
  "TitlePageDate": "May 10, 2026",
  "ServiceLeader": "John Doe",
  "KeyVerse": "For by grace you have been saved through faith...",
  "Hymn1": "Amazing Grace",
  "SermonScripture": "Romans 5:1-11",
  ...
}
```

This structured data is then injected into the LaTeX template by replacing placeholders like `!KeyVerse!`.
