/**
 * @fileoverview Rewrite the shipped Firebase config from the catalog.
 *
 * Run against the church project only with the loud flag:
 *   node scripts/apply-firebase-project.js --project mosaic-hymn-database --i-mean-prod
 *
 * Commit the result. A deploy checks these files rather than trusting that
 * somebody remembered to run this.
 */

const fs = require('fs');
const path = require('path');
const {
    requireProject,
    loadProject,
    renderBrowserConfig,
    functionsProject,
} = require('./firebase-project');

const root = path.join(__dirname, '..');
const projectId = requireProject(process.argv, {root});
const project = loadProject(root, projectId);

fs.writeFileSync(
    path.join(root, 'public', 'firebase-config.js'),
    renderBrowserConfig(project));
fs.writeFileSync(
    path.join(root, 'functions', 'firebase-project.json'),
    JSON.stringify(functionsProject(project), null, 2) + '\n');

console.log(`Wrote Firebase config for ${projectId}.`);
