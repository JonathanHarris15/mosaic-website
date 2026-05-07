# Mosaic Website

A Firebase-based platform for managing liturgical resources, including a hymn directory, service planning tools, and administrative controls.

## Project Overview

- **Frontend**: Single Page Application (SPA) style built with HTML, [Tailwind CSS](https://tailwindcss.com/) (via CDN), and [Alpine.js](https://alpinejs.dev/).
- **Backend**: [Firebase Cloud Functions](https://firebase.google.com/docs/functions) (Node.js 20, v2 functions).
- **Database**: [Cloud Firestore](https://firebase.google.com/docs/firestore).
- **Authentication**: [Firebase Auth](https://firebase.google.com/docs/auth).
- **Storage**: [Firebase Storage](https://firebase.google.com/docs/storage) for hymn pages/images.
- **Documentation**: [Sphinx](https://www.sphinx-doc.org/) documentation located in `docs/`.

## Project Structure

- `public/`: Static frontend assets.
  - `main.js`: Core logic for hymn lookup and search using Alpine.js.
  - `auth.js`: Firebase Authentication integration and user session management.
  - `hymn-directory.html`: Main interface for searching and browsing hymns.
  - `manager.html`: Administrative interface for hymn management.
- `functions/`: Firebase Cloud Functions source code.
  - `index.js`: Contains callable functions like `getHymnIndex` and user management helpers.
- `scripts/`: Utility and maintenance scripts.
  - `migrate.js`: Script for migrating hymn data from JSON to Firestore.
  - `check-duplicates.js` / `clean-duplicates.js`: Database maintenance utilities.
- `docs/`: Sphinx documentation source files.
- `design/`: UI/UX design assets and specific `DESIGN.md` for the Sunday Service Logistics Hub.

## Building and Running

### Prerequisites
- [Firebase CLI](https://firebase.google.com/docs/cli) installed and logged in.
- Node.js 20.x.

### Local Development
The project uses Firebase Emulators for local development of all services.
```powershell
firebase emulators:start
```
- Hosting: http://localhost:5005
- Functions: http://localhost:5001
- Firestore: http://localhost:8080
- Auth: http://localhost:9099
- Emulator UI: http://localhost:4000

### Deployment
To deploy the entire project to Firebase:
```powershell
firebase deploy
```
To deploy specific components:
```powershell
firebase deploy --only functions
firebase deploy --only hosting
```

### Functions Management
In the `functions/` directory:
- `npm run lint`: Run ESLint.
- `npm run logs`: View function logs from production.

## Development Conventions

- **Frontend**:
  - Prefer Tailwind CSS classes for styling.
  - Use Alpine.js for lightweight reactivity (defined in `main.js`).
  - Access Firestore and Functions via the Firebase Compat SDK (v9).
- **Backend**:
  - Use `onCall` (v2) for all client-invoked functions.
  - Functions should be region-locked to `us-central1` (consistent with existing setup).
  - Implement caching (as seen in `getHymnIndex`) for read-heavy operations.
- **Data Model**:
  - `hymns`: Collection containing hymn metadata and `versions` (array of objects).
  - `tags`: Collection where document IDs are the tag names.
  - `users`: Collection for storing user roles and supplementary data.
- **Documentation**:
  - Maintain Sphinx docs for any significant logic changes.
  - Use JSDoc for function headers in JS files.
