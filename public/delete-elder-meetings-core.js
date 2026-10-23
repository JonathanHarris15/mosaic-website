// Plan deletion of legacy elder_meetings rows (MS-799, ADR-0015).
//
// Meeting minutes live in elder_documents. A meeting row is safe to delete only
// when the collection is empty or the same id exists in elder_documents.
(function (global) {
    'use strict';

    /**
     * @param {string[]} meetingIds ids in elder_meetings
     * @param {string[]} elderDocumentIds ids in elder_documents
     * @return {{ canDelete: boolean, missingInElderDocuments: string[], meetingIds: string[] }}
     */
    function planElderMeetingsDeletion(meetingIds, elderDocumentIds) {
        const meetings = (meetingIds || []).slice().sort();
        const docs = new Set(elderDocumentIds || []);
        const missingInElderDocuments = meetings.filter((id) => !docs.has(id));
        const canDelete = meetings.length === 0 || missingInElderDocuments.length === 0;
        return {
            canDelete,
            missingInElderDocuments,
            meetingIds: meetings,
        };
    }

    const DeleteElderMeetingsCore = {
        planElderMeetingsDeletion,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DeleteElderMeetingsCore;
    }
    if (global) {
        global.DeleteElderMeetingsCore = DeleteElderMeetingsCore;
    }
})(typeof window !== 'undefined' ? window : null);
