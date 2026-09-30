// Loads the desktop header lead on pages that include the shared script set.
(function () {
    'use strict';
    function boot() {
        // A bare attribute's dataset value is "", which is falsy.
        if (document.body && 'mosaicSkipDesktopLead' in document.body.dataset) return;
        if (typeof DesktopHeaderLead === 'undefined' || typeof DashboardNav === 'undefined') {
            return;
        }
        DesktopHeaderLead.bootFromDocument();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
