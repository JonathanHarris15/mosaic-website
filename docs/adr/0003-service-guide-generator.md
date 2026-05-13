# ADR 0003: Service Guide Generator Architecture

## Status
Accepted

## Context
The legacy Service Guide Generator used Python and LaTeX to generate PDFs from Word documents. This system was disconnected from the main website and required manual data entry. We need a web-based replacement that integrates with the existing Service data (Firestore) and provides a live preview/editor.

## Decision
1. **Rendering**: We will move away from LaTeX and use **HTML/CSS (Tailwind)** for the service guide's layout. We will use CSS Print Media queries and `window.print()` for PDF generation, leveraging standard browser print engines for high-fidelity output.
2. **Persistence**: The configuration for each service guide (element order, custom content, visibility) will be stored in a `guide` field within the `services/{date}` document in Firestore.
3. **Editor Interface**: A **Split-View Editor** will be used:
    - **Left Side**: A draggable list of "Guide Elements" (using Sortable.js).
    - **Right Side**: A live, print-accurate viewport.
4. **Data Sourcing**: The guide will automatically pull data from the `Service` entity, the `hymns` collection, and the ESV API (for scripture).

## Consequences
- **Pros**:
    - Real-time preview of the printed guide.
    - No need for a server-side LaTeX environment.
    - Seamless integration with existing church data.
    - Accessible to any admin via the browser.
- **Cons**:
    - Browser print engines vary slightly (though Chromium is very consistent).
    - `window.print()` requires user interaction to save as PDF.
