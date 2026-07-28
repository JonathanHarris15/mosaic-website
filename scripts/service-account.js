/**
 * @fileoverview Locate the Firebase admin service account key.
 *
 * The key file's name carries a Google-generated suffix that changes every time
 * the key is rotated, so hardcoding one name means every script breaks the next
 * time somebody generates a new key — with a confusing MODULE_NOT_FOUND rather
 * than anything that says "your credentials are missing".
 *
 * Resolution order:
 *   1. GOOGLE_APPLICATION_CREDENTIALS — an explicit path wins.
 *   2. The newest `mosaic-hymn-database-firebase-adminsdk-*.json` at the repo
 *      root. Newest, so a freshly rotated key is preferred over a stale one.
 *
 * These files are gitignored (`*firebase-adminsdk*.json`) and must stay that way.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const KEY_PATTERN = /^mosaic-hymn-database-firebase-adminsdk-.*\.json$/;

function serviceAccountPath() {
    const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            throw new Error(
                'GOOGLE_APPLICATION_CREDENTIALS points at a file that does not exist:\n  ' + explicit
            );
        }
        return explicit;
    }

    const candidates = fs.readdirSync(REPO_ROOT)
        .filter(name => KEY_PATTERN.test(name))
        .map(name => path.join(REPO_ROOT, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (candidates.length === 0) {
        throw new Error(
            'No Firebase service account key found.\n\n' +
            'Firebase Console -> Project Settings -> Service Accounts -> Generate new private key,\n' +
            'then save it at the repo root. It is gitignored, so it will not be committed.\n' +
            'Alternatively set GOOGLE_APPLICATION_CREDENTIALS to its path.'
        );
    }

    return candidates[0];
}

function serviceAccount() {
    return require(serviceAccountPath());
}

module.exports = { serviceAccountPath, serviceAccount };
