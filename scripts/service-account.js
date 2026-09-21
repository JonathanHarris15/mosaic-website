/**
 * @fileoverview Locate the Firebase admin service account key.
 *
 * The key file's name carries a Google-generated suffix that changes every time
 * the key is rotated, so hardcoding one name means every script breaks the next
 * time somebody generates a new key — with a confusing MODULE_NOT_FOUND rather
 * than anything that says "your credentials are missing".
 *
 * The caller must pass `--project`, and the church project also needs
 * `--i-mean-prod`. The key file has to be for that project.
 *
 * Resolution order:
 *   1. GOOGLE_APPLICATION_CREDENTIALS — an explicit path wins.
 *   2. The newest `<projectId>-firebase-adminsdk-*.json` at the repo root.
 *      Newest, so a freshly rotated key is preferred over a stale one.
 *
 * These files are gitignored (`*firebase-adminsdk*.json`) and must stay that way.
 */

const fs = require('fs');
const path = require('path');
const {requireProject} = require('./firebase-project');

const REPO_ROOT = path.join(__dirname, '..');

function assertKeyProject(file, projectId) {
    let key;
    try {
        key = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`Could not read service account key ${file}: ${err.message}`);
    }
    if (key.project_id && key.project_id !== projectId) {
        throw new Error(`Service account is for ${key.project_id}, not ${projectId}.`);
    }
    return file;
}

function serviceAccountPath() {
    const projectId = requireProject(process.argv);
    const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            throw new Error(
                'GOOGLE_APPLICATION_CREDENTIALS points at a file that does not exist:\n  ' + explicit
            );
        }
        return assertKeyProject(explicit, projectId);
    }

    const prefix = `${projectId}-firebase-adminsdk-`;
    const candidates = fs.readdirSync(REPO_ROOT)
        .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
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

    return assertKeyProject(candidates[0], projectId);
}

function serviceAccount() {
    return require(serviceAccountPath());
}

module.exports = { serviceAccountPath, serviceAccount };
