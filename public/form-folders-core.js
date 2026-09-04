// Form Folders Core — where a Form Template is filed, in the Forms library's
// own words.
//
// The walks themselves — breadcrumb, what is in here, how much goes if I
// delete this, may I drop this there — live in `filing-core.js`, which this
// module wraps. They moved there when the Printables library (MS-392) needed
// the same engine; the Forms-flavoured names (`formsIn`, `formsUnder`) stay so
// nothing that already read this module had to change, and the "Move to…"
// dialog's top row keeps saying "Forms".
//
// ⚠ THIS IS DELIBERATELY NOT HOW THE DOCUMENT LIBRARY STORES FOLDERS — a form
// remembers its folder; a folder does not remember its forms. ADR-0054 carries
// the reasoning, and the comment at the top of filing-core.js restates it.

(function (global) {
    'use strict';

    const Filing = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
        ? require('./filing-core.js')
        : global.FilingCore;

    const FormFoldersCore = {
        TOP_LEVEL: Filing.TOP_LEVEL,
        MAX_FOLDER_NAME_LENGTH: Filing.MAX_FOLDER_NAME_LENGTH,
        DEFAULT_FOLDER_NAME: Filing.DEFAULT_FOLDER_NAME,
        normaliseFolderName: Filing.normaliseFolderName,
        buildFolder: Filing.buildFolder,
        breadcrumbFor: Filing.breadcrumbFor,
        childFolders: Filing.childFolders,
        formsIn: Filing.itemsIn,
        descendantFolderIds: Filing.descendantFolderIds,
        formsUnder: Filing.itemsUnder,
        isDescendant: Filing.isDescendant,
        canMoveFolder: Filing.canMoveFolder,
        moveTargets: (folders, excludeFolderId) => Filing.moveTargets(folders, excludeFolderId, 'Forms'),
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FormFoldersCore;
    }
    if (global) {
        global.FormFoldersCore = FormFoldersCore;
    }
})(typeof window !== 'undefined' ? window : null);
