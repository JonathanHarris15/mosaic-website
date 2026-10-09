/* ============================================================
   my-info-live.js — Profile → My info saves itself and stays live
   (ADR 0081, MS-721).

   The pure half of the Profile "My info" form: which fields are live, how
   a Person reads into them, and the patch a change writes. No DOM.

   Email, phone, address and birthday are live: typing saves on the
   LiveFields debounce, blur saves now, Escape puts the box back, and a
   change made elsewhere (an editor fixing your phone number) lands in a
   box you have not touched. The write carries only the changed fields, in
   the self-edit allow-list firestore.rules already checks
   (contact / birthday / updatedAt).

   Sex is NOT live and NOT here: it is set-once, and a dropdown picked by
   accident and stuck a second later is a door only an editor can reopen,
   so it keeps its own explicit Set button.
   ============================================================ */
(function (global) {
    'use strict';

    const FIELDS = ['email', 'phone', 'address', 'birthday'];
    const INPUT_IDS = { email: 'my-email', phone: 'my-phone', address: 'my-address', birthday: 'my-birthday' };

    function valuesFrom(person) {
        const p = person || {};
        const c = p.contact || {};
        return {
            email: c.email || '',
            phone: c.phone || '',
            address: c.address || '',
            birthday: p.birthday || '',
        };
    }

    // Only the changed fields, in the shape buildSelfEditUpdate writes.
    function patchFor(patch) {
        const out = {};
        Object.keys(patch || {}).forEach((f) => {
            const v = patch[f];
            if (f === 'birthday') out.birthday = v ? String(v) : null;
            else if (FIELDS.indexOf(f) !== -1) out['contact.' + f] = String(v == null ? '' : v).trim();
        });
        return out;
    }

    // What the Person now holds for those fields, for the controller's base.
    function storedFrom(patch) {
        const out = {};
        Object.keys(patch || {}).forEach((f) => {
            if (FIELDS.indexOf(f) === -1) return;
            out[f] = f === 'birthday' ? (patch[f] || '') : String(patch[f] == null ? '' : patch[f]).trim();
        });
        return out;
    }

    function chipClass(status) {
        if (status === 'failed') return 'text-[11px] font-body-md text-error';
        if (status === 'saving') return 'text-[11px] font-body-md text-primary animate-pulse';
        if (status === 'unsaved') return 'text-[11px] font-body-md text-on-surface-variant';
        return 'text-[11px] font-body-md text-green-600';
    }

    const api = { FIELDS, INPUT_IDS, valuesFrom, patchFor, storedFrom, chipClass };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    global.MyInfoLive = api;
})(typeof window !== 'undefined' ? window : globalThis);
