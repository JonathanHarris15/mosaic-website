// Plan deletion of shepherding_reminders after migrate-reminders-to-tasks (MS-791).
(function (global) {
    'use strict';

    const COLLECTION = 'shepherding_reminders';
    const TASKS = 'shepherding_tasks';

    /**
     * @param {string} reminderId
     * @param {*} reminderData
     * @param {Array<{id: string, data: object}>} tasks
     * @return {'migrated'|'undated'|'unmigrated'}
     */
    function classifyReminder(reminderId, reminderData, tasks) {
        const migrated = (tasks || []).some((t) => {
            const d = t.data || t;
            return d.migratedFrom === reminderId;
        });
        if (migrated) return 'migrated';
        const row = reminderData || {};
        const due = row.dueDatetime;
        const hasDue = due && (typeof due.toDate === 'function' || due instanceof Date);
        if (!hasDue) return 'undated';
        return 'unmigrated';
    }

    /**
     * @param {Array<{id: string, data: object}>} reminders
     * @param {Array<{id: string, data: object}>} tasks
     * @return {{canDelete: boolean, migrated: number, unmigrated: number, undated: number, blocked: string[]}}
     */
    function planDelete(reminders, tasks) {
        let migrated = 0;
        let unmigrated = 0;
        let undated = 0;
        const blocked = [];
        for (const r of reminders || []) {
            const status = classifyReminder(r.id, r.data, tasks);
            if (status === 'migrated') migrated += 1;
            else if (status === 'undated') {
                undated += 1;
                blocked.push(r.id + ':no-readable-due-date');
            } else {
                unmigrated += 1;
                blocked.push(r.id + ':not-migrated');
            }
        }
        const canDelete = (reminders || []).length > 0
            && unmigrated === 0
            && undated === 0;
        return {canDelete, migrated, unmigrated, undated, blocked};
    }

    const api = {COLLECTION, TASKS, classifyReminder, planDelete};

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.DeleteShepherdingRemindersCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
