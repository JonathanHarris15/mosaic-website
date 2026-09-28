// Loads the desktop header lead on pages that include the shared script set.
(function () {
    'use strict';
    function boot() {
        if (document.body && document.body.dataset.mosaicSkipDesktopLead) return;
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
