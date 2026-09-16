// Document Tree Client (MS-493) — the one way a page or the phone changes a
// folder tree.
//
// ⚠ NOBODY WRITES A TREE RECORD DIRECTLY ANY MORE. A tree — the Library's, or
// one person's Documents tab — is a single record, and the pages used to write
// back the whole copy they had loaded, so two elders filing at the same moment
// lost one of the changes. A change now goes to the server as ONE change
// (ShepherdingDocsCore.applyTreeChange), which applies it to the latest tree
// inside a transaction. The page applies the same change to its own copy first
// so a click still shows at once; the live tree it listens to then confirms it.
//
// Loaded as a plain script by the web pages and by the phone shell, after the
// Firebase functions SDK.
var DocumentTree = (function () {
    'use strict';

    // Apply one change to a tree. Resolves { ok, changed }; rejects with the
    // server's sentence when what it names has gone.
    function change(treeId, treeChange) {
        return firebase.functions().httpsCallable('shepherdingTree')({ treeId: treeId, change: treeChange })
            .then(function (result) { return (result && result.data) || { ok: true }; });
    }

    return { change: change };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DocumentTree: DocumentTree };
}
