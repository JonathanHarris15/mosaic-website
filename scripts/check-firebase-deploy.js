/**
 * @fileoverview Fail the deploy unless the shipped config is the --project.
 *
 * The prod workflow pins mosaic-hymn-database and passes --i-mean-prod.
 * It does not read .firebaserc default: flipping that alias must not retarget
 * the church.
 */

const path = require('path');
const {requireProject, assertDeploy} = require('./firebase-project');

const root = path.join(__dirname, '..');
const projectId = requireProject(process.argv, {root});
assertDeploy({
    root,
    projectId,
    iMeanProd: process.argv.includes('--i-mean-prod'),
});
console.log(`Firebase deploy check passed for ${projectId}.`);
