/**
 * @fileoverview Resolve the Textbelt API key for prod-ops scripts.
 *
 * Matches Cloud Functions defineSecret("TEXTBELT_KEY") — same Secret Manager
 * secret id in the Firebase project.
 */

const {GoogleAuth} = require('google-auth-library');

/** @type {string} Same id as functions/index.js defineSecret("TEXTBELT_KEY"). */
const TEXTBELT_SECRET_ID = 'TEXTBELT_KEY';

const SECRET_MANAGER_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * @param {string} projectId
 * @param {string} secretId
 * @return {string} REST resource name for latest version access.
 */
function secretAccessUrl(projectId, secretId) {
    return 'https://secretmanager.googleapis.com/v1/' +
        `projects/${projectId}/secrets/${secretId}/versions/latest:access`;
}

/**
 * @param {?{payload?: {data?: string}}} response Secret Manager access body.
 * @return {string}
 */
function decodeSecretPayload(response) {
    const b64 = response && response.payload && response.payload.data;
    if (!b64) {
        throw new Error('Secret Manager returned no payload data.');
    }
    const value = Buffer.from(b64, 'base64').toString('utf8').trim();
    if (!value) {
        throw new Error('Secret Manager payload was empty.');
    }
    return value;
}

/**
 * Prefer env TEXTBELT_KEY; otherwise call fetchSecret(projectId, secretId).
 * @param {string} projectId
 * @param {?string} envKey process.env.TEXTBELT_KEY
 * @param {function(string, string): Promise<string>} fetchSecret
 * @return {Promise<{key: string, source: 'env'|'secret-manager'}>}
 */
async function resolveTextbeltKey(projectId, envKey, fetchSecret) {
    const trimmed = envKey == null ? '' : String(envKey).trim();
    if (trimmed) {
        return {key: trimmed, source: 'env'};
    }
    const key = await fetchSecret(projectId, TEXTBELT_SECRET_ID);
    return {key, source: 'secret-manager'};
}

/**
 * @param {string} projectId
 * @return {Promise<string>}
 */
async function fetchTextbeltKeyFromSecretManager(projectId) {
    const auth = new GoogleAuth({scopes: [SECRET_MANAGER_SCOPE]});
    const client = await auth.getClient();
    const url = secretAccessUrl(projectId, TEXTBELT_SECRET_ID);
    const {data} = await client.request({url, method: 'GET'});
    return decodeSecretPayload(data);
}

module.exports = {
    TEXTBELT_SECRET_ID,
    secretAccessUrl,
    decodeSecretPayload,
    resolveTextbeltKey,
    fetchTextbeltKeyFromSecretManager,
};
