// Who else is in this Sunday, and which box they are in.
//
// A guide-writing night is a dozen men editing the same handful of documents.
// MS-243 stopped them overwriting each other and MS-244 let them see each
// other's work; this is the last part — seeing each other, and being kept out
// of a box somebody is already typing in.
//
// The rules and the store now live in presence-core.js (MS-489), shared with
// Shepherding. This file is the Order of Service's view of them, kept under the
// names its two pages already call:
//
//   ServicePresence — the rules. A Sunday is the scope and a liturgy field
//                     path is the box, so holderOf(entries, uid, dateKey,
//                     fieldKey, now) reads exactly as it always did.
//   PresenceStore   — the store, on the `presence` collection, with no idle
//                     rule: these men are in one room and can ask (ADR-0062).
//
// Load presence-core.js before this file.

var ServicePresence = (typeof PresenceCore !== 'undefined')
    ? PresenceCore
    : require('./presence-core.js').PresenceCore;

var PresenceStore = ((typeof createPresenceStore !== 'undefined')
    ? createPresenceStore
    : require('./presence-core.js').createPresenceStore)({ collection: 'presence' });

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ServicePresence: ServicePresence, PresenceStore: PresenceStore };
}
