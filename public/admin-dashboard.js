// Admin Dashboard — hosts admin-only system tools. The first tools wrap the SMS
// (Textbelt) integration: key status, remaining credits, and a test send. The
// Textbelt key lives server-side as a Firebase secret, so every action here goes
// through an admin-gated callable function rather than touching the key directly.

// Default prayer-request SMS templates. {name} is replaced with the person's
// first name when sent (falls back to "there"). These mirror the constants in
// the prayer-request sending flow; the admin can override them, and the saved
// values in Firestore (app_config/prayer_request_sms) take precedence.
// Optional boolean on the same doc: includeAnswerLinkInSms (default false; MS-768).
// When false, server SMS omits the Answer URL (reply-only). When true, SMS adds
// the link in addition to reply instructions — both paths must record the same
// prayer_requests doc (see MS-768).
const PRAYER_MESSAGE_DEFAULTS = {
    initial: "Hi {name}, this is Mosaic Church. You're in our pastoral prayer " +
        "this Sunday. What would you like us to pray about? (This information " +
        "will be private and only shared with Elders) Just reply to this " +
        "message, or answer here: {link}",
    reminder: "Hi {name}, a gentle reminder from Mosaic Church — we'd love to " +
        "pray for you this Sunday. What would you like us to pray about? (This " +
        "information will be private and only shared with Elders) Just reply " +
        "here whenever you're ready, or answer here: {link}",
    thankyou: "Thank you, {name}. We'll be lifting this up in prayer this " +
        "Sunday. — Mosaic Church",
    // Sent to Elder-tagged people once a service's requests are all in by text.
    // Uses {date} and {requests} (not {name}); {requests} auto-builds one
    // "Name — request" line per subject.
    elderDigest: "Mosaic prayer requests for {date}:\n{requests}",
};

/** @type {Object<string, string>} */
const EVENT_ANNOUNCEMENT_DEFAULTS = {
    text: "{title}\n\n{prose}\n{link}",
    pushTitle: "{title}",
    pushBody: "{prose}",
};

// Nudge wording (MS-248). Mirrors DEFAULT_TEXT / DEFAULT_PUSH in
// functions/assignment-nudge.js; test/admin-nudge-wording.test.js holds them
// equal, so a blank field means the same words on the page and the server.
/** @type {Object<string, string>} */
const NUDGE_DEFAULTS = {
    text: "Hi {name}, you're down for {places} and haven't said yet whether you can make it. Let the church know here: {link}",
    pushTitle: "Can you make it?",
    pushBody: "You're down for {places}. Tap to answer.",
};
/** @type {Object<string, string>} */
const NUDGE_STORED = { text: 'nudgeText', pushTitle: 'pushNudgeTitle', pushBody: 'pushNudgeBody' };
// Trade invitation text (MS-249). Mirrors DEFAULT_TEXT in
// functions/trade-invitation-text.js; test/admin-invitation-wording.test.js
// holds them equal.
/** @type {Object<string, string>} */
const INVITATION_DEFAULTS = {
    text: "Hi {name}, {inviter} from Mosaic Church asked if you could take their place: {role} at {event} on {date}. Tap to answer: {link}",
};
/** @type {Object<string, string>} */
const INVITATION_STORED = { text: 'tradeInvitationText' };

/** @type {Object<string, string>} */
const ANNOUNCEMENT_STORED = { text: 'eventAnnouncementText', pushTitle: 'pushEventAnnouncementTitle', pushBody: 'pushEventAnnouncementBody' };

/**
 * The wording blocks on System tools, one row each: where its words are
 * stored, their defaults, and the component fields that hold its draft,
 * its live controller and its saved chip.
 * @type {Object<string, {stored: Object<string, string>, defaults: Object<string, string>, draft: string, live: string, chip: string, what: string}>}
 */
const WORDING_BLOCKS = {
    announcement: {
        stored: ANNOUNCEMENT_STORED, defaults: EVENT_ANNOUNCEMENT_DEFAULTS,
        draft: 'eventAnnouncementWording', live: 'wordingLive', chip: 'wordingChip',
        what: 'event announcement wording',
    },
    nudge: {
        stored: NUDGE_STORED, defaults: NUDGE_DEFAULTS,
        draft: 'nudgeWording', live: 'nudgeLive', chip: 'nudgeChip',
        what: 'nudge wording',
    },
    invitation: {
        stored: INVITATION_STORED, defaults: INVITATION_DEFAULTS,
        draft: 'invitationWording', live: 'invitationLive', chip: 'invitationChip',
        what: 'invitation wording',
    },
};

/**
 * @param {string} name a WORDING_BLOCKS key
 * @param {?Object<string, *>} saved app_config/prayer_request_sms
 * @return {Object<string, string>}
 */
function blockFrom(name, saved) {
    const b = WORDING_BLOCKS[name];
    return wordingFromStored(saved, b.stored, b.defaults);
}

/**
 * One wording block read off the config: each field trimmed, a blank one
 * falling back to its default.
 * @param {?Object<string, *>} saved app_config/prayer_request_sms
 * @param {Object<string, string>} stored field → stored key
 * @param {Object<string, string>} defaults field → default words
 * @return {Object<string, string>}
 */
function wordingFromStored(saved, stored, defaults) {
    const d = saved || {};
    /** @type {Object<string, string>} */
    const out = {};
    Object.keys(stored).forEach(f => {
        const v = typeof d[stored[f]] === 'string' ? d[stored[f]].trim() : '';
        out[f] = v || defaults[f];
    });
    return out;
}

/** @param {string} status @return {string} */
function chipText(status) {
    const LF = /** @type {*} */ (window).LiveFields;
    return LF ? LF.chipText(status) : '';
}

/**
 * A live-saving wording block: it writes only the fields that changed,
 * trimmed, merged into the config, and says who wrote them.
 * @param {*} comp the page component (for the user and the toast)
 * @param {{stored: Object<string, string>, initial: Object<string, string>, what: string, onChange: (state: *) => void}} spec
 * @return {*} the LiveFields controller, or null without LiveFields
 */
function liveWordingBlock(comp, spec) {
    const LF = /** @type {*} */ (window).LiveFields;
    if (!LF) return null;
    return LF.create({
        fields: Object.keys(spec.stored),
        initial: { ...spec.initial },
        save: async (/** @type {Object<string, *>} */ patch) => {
            /** @type {Object<string, *>} */
            const write = {
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: comp.currentUser.uid,
            };
            /** @type {Object<string, string>} */
            const stored = {};
            Object.keys(patch).forEach(f => {
                stored[f] = String(patch[f] == null ? '' : patch[f]).trim();
                write[spec.stored[f]] = stored[f];
            });
            try {
                await db.collection('app_config').doc('prayer_request_sms').set(write, { merge: true });
            } catch (e) {
                console.error('Error saving ' + spec.what + ':', e);
                comp.showToast('Error saving ' + spec.what, 'error');
                throw e;
            }
            return stored;
        },
        onChange: spec.onChange,
    });
}

// Lock-screen wording. Mirrors DEFAULT_PUSH_WORDING in functions/prayer-request.js.
// A blank saved field falls back to these. PUSH_TITLE_LIMIT is what a lock
// screen can still show; the editor sees the count and is not blocked.
const PUSH_TITLE_LIMIT = 40;
const DEFAULT_PUSH_WORDING = {
    initial: {
        title: "Sunday's prayer",
        body: "{name}, you're in this Sunday's pastoral prayer. What can we pray about?",
    },
    reminder: {
        title: "Prayer reminder",
        body: "{name}, we'd still love to know what to pray about this Sunday.",
    },
    thankyou: {
        title: "Thank you",
        body: "Thank you, {name}. We'll be praying this Sunday.",
    },
};
const PUSH_WORDING_KINDS = ['initial', 'reminder', 'thankyou'];

// The Push notifications tab (MS-682). Everything it shows arrives from
// admin-gated callables: the device-token subcollection under a user stays
// owner-only in the rules (ADR-0036), so the browser never reads a token —
// masked or otherwise — from Firestore. NotificationAdminCore is the module
// the callables shape
// their payloads with, loaded here for the labels and the church clock.
const PUSH_TAB_CALLABLES = {
    overview: 'notificationOverview',
    history: 'notificationHistory',
    revoke: 'notificationRevokeToken',
    testPush: 'notificationTestPush',
};

const HISTORY_PAGE = 25;

document.addEventListener('alpine:init', () => {
    Alpine.data('adminDashboard', () => ({
        currentUser: null,
        currentPermissionLevel: null,
        loading: true,

        // Which tab is on screen. Deep-linkable, so "look at the push log"
        // is a URL rather than a click.
        tab: 'tools',

        // SMS key + quota status
        statusLoading: false,
        keyConfigured: null,      // true | false | null (unknown)
        quotaRemaining: null,     // number | null
        statusError: '',

        // Test send
        testPhone: '',
        testMessage: '',
        sending: false,
        lastResult: null,         // { ok: boolean, message: string }

        // Inbound replies to test texts (temporary stack)
        replies: [],
        repliesLoading: false,

        // Prayer-request wording is no longer edited here. A prayer on the
        // Liturgy Order says how many days ahead its people are told, and the
        // words stay the defaults above (a saved override in
        // app_config/prayer_request_sms still wins on the server).

        eventAnnouncementWording: { ...EVENT_ANNOUNCEMENT_DEFAULTS },
        eventAnnouncementSaving: false,

        // Nudges (MS-248): the wording, and the switch that turns them on.
        nudgeWording: { ...NUDGE_DEFAULTS },
        nudgeEnabled: false,
        nudgeSwitchSaving: false,
        /** @type {*} */
        nudgeLive: null,

        // Trade invitation text (MS-249): one box, same live saving.
        invitationWording: { ...INVITATION_DEFAULTS },
        /** @type {*} */
        invitationLive: null,
        invitationChip: 'saved',
        nudgeChip: 'saved',

        // ── Push notifications tab ──────────────────────────────────────
        pushOverview: null,        // the overview callable's whole payload
        pushFlow: null,            // …its flow diagram, pulled out for x-for
        pushLoading: false,
        pushLoaded: false,
        pushError: '',
        pushOffline: false,        // the registry, rendered without a server

        history: [],
        historyCursor: null,
        historyScanned: 0,
        historyLoading: false,
        historyIsFiltered: false,
        historyFilters: { status: '', channel: '', typeId: '', search: '' },

        devices: [],
        deviceSummary: null,
        deviceThresholds: '',
        revokeConfirming: null,    // 'uid/tokenId' while the row asks
        revoking: false,

        testPushConfirming: false,
        testPushSending: false,
        testPushResult: null,

        toast: { show: false, message: '', type: 'success' },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                Object.assign(this, AccessCore.pageFlags(userData));
                if (!AccessCore.accessesAdminDashboard(userData)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.loading = false;
                this.refreshStatus();
                this.loadReplies();
                this.loadEventAnnouncementWording();
                this.loadNudgeSettings();
                this.loadInvitationWording();
                const hash = (window.location.hash || '').replace(/^#/, '');
                if (hash === 'push') this.selectTab('push');
                else if (hash === 'accounts') this.selectTab('accounts');
            });
        },

        // The push tab is four round trips, so it loads on first sight
        // rather than on every page open.
        selectTab(tab) {
            this.tab = tab;
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', tab === 'tools' ? '#' : '#' + tab);
            }
            if (tab === 'push' && !this.pushLoaded) this.loadPush();
            if (tab === 'accounts' && typeof window.initAdminAccountsTab === 'function') {
                window.initAdminAccountsTab();
            }
        },

        // Null while loading, and null when the registry is being shown
        // without a server. Alpine evaluates a binding inside a hidden
        // element, so every count on this tab reads through here.
        get pushRecent() {
            return (this.pushOverview && this.pushOverview.recent) || null;
        },

        get pushTrouble() {
            return this.pushRecent ? this.pushRecent.week.problems : 0;
        },

        callable(name) {
            return firebase.app().functions('us-central1').httpsCallable(name);
        },

        // Reads key-configured state and remaining credits in one round trip.
        async refreshStatus() {
            this.statusLoading = true;
            this.statusError = '';
            try {
                const checkQuota = firebase.app().functions('us-central1').httpsCallable('smsCheckQuota');
                const { data } = await checkQuota();
                this.keyConfigured = !!data.configured;
                this.quotaRemaining = (data.quotaRemaining === null || data.quotaRemaining === undefined)
                    ? null : data.quotaRemaining;
                if (data.error) this.statusError = data.error;
            } catch (e) {
                console.error('smsCheckQuota failed:', e);
                this.keyConfigured = null;
                this.quotaRemaining = null;
                this.statusError = e.message || 'Could not check SMS status.';
            } finally {
                this.statusLoading = false;
            }
        },

        async sendTest() {
            const phone = this.testPhone.trim();
            if (!phone || this.sending) return;
            this.sending = true;
            this.lastResult = null;
            try {
                const sendTest = firebase.app().functions('us-central1').httpsCallable('smsSendTest');
                const { data } = await sendTest({
                    phone,
                    message: this.testMessage.trim(),
                });
                if (data.success) {
                    this.lastResult = {
                        ok: true,
                        message: `Sent. textId ${data.textId}` +
                            (data.quotaRemaining !== null && data.quotaRemaining !== undefined
                                ? ` · ${data.quotaRemaining} credits left` : ''),
                    };
                    if (data.quotaRemaining !== null && data.quotaRemaining !== undefined) {
                        this.quotaRemaining = data.quotaRemaining;
                    }
                    this.showToast('Test SMS sent');
                } else {
                    this.lastResult = { ok: false, message: data.error || 'Textbelt rejected the message.' };
                    this.showToast('Send failed', 'error');
                }
            } catch (e) {
                console.error('smsSendTest failed:', e);
                this.lastResult = { ok: false, message: e.message || 'Send failed.' };
                this.showToast('Send failed', 'error');
            } finally {
                this.sending = false;
            }
        },

        async loadReplies() {
            this.repliesLoading = true;
            try {
                const snap = await db.collection('sms_test_replies')
                    .orderBy('receivedAt', 'desc')
                    .get();
                this.replies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading replies:', e);
                this.showToast('Could not load replies', 'error');
            } finally {
                this.repliesLoading = false;
            }
        },

        async deleteReply(id) {
            try {
                await db.collection('sms_test_replies').doc(id).delete();
                this.replies = this.replies.filter(r => r.id !== id);
                this.showToast('Reply deleted');
            } catch (e) {
                console.error('Error deleting reply:', e);
                this.showToast('Error deleting reply', 'error');
            }
        },

        async clearReplies() {
            if (!confirm('Delete all replies in the stack?')) return;
            try {
                const batch = db.batch();
                this.replies.forEach(r => batch.delete(db.collection('sms_test_replies').doc(r.id)));
                await batch.commit();
                this.replies = [];
                this.showToast('Replies cleared');
            } catch (e) {
                console.error('Error clearing replies:', e);
                this.showToast('Error clearing replies', 'error');
            }
        },

        // ── Message wording saves itself (ADR 0081, MS-721, MS-248, MS-249)
        // Three blocks on one config document: event announcement tells,
        // nudges, and the Trade invitation text. Each is a row in
        // WORDING_BLOCKS; the methods below are the same for all of them.
        // Typing waits 1.5 s, blur saves now, Escape puts back what is
        // stored. One watch on the document feeds every block, and the nudge
        // switch rides on the same read. The page is gated on
        // admin.dashboard.access (accessesAdminDashboard); app_config stays
        // the backstop.
        /** @type {*} */
        wordingLive: null,
        /** @type {*} */
        stopWordingWatch: null,
        wordingChip: 'saved',
        wordingError: '',

        get wordingChipText() { return chipText(this.wordingChip); },
        get nudgeChipText() { return chipText(this.nudgeChip); },
        get invitationChipText() { return chipText(this.invitationChip); },

        /** @param {?Object<string, *>} saved */
        wordingFrom(saved) { return blockFrom('announcement', saved); },
        /** @param {?Object<string, *>} saved */
        nudgeWordingFrom(saved) { return blockFrom('nudge', saved); },

        /** @return {Promise<?Object<string, *>>} the config, or null when it could not be read */
        async readWordingConfig() {
            try {
                const doc = await db.collection('app_config').doc('prayer_request_sms').get();
                return doc.exists ? doc.data() : {};
            } catch (e) {
                console.error('Error loading message wording:', e);
                this.showToast('Could not load message wording', 'error');
                return null;
            }
        },

        /**
         * Load one block's words and start saving it live.
         * @param {string} name a WORDING_BLOCKS key
         * @return {Promise<?Object<string, *>>} the config it read
         */
        async loadBlock(name) {
            const data = await this.readWordingConfig();
            if (!data) return null;
            /** @type {*} */ (this)[WORDING_BLOCKS[name].draft] = blockFrom(name, data);
            this.startBlock(name);
            return data;
        },

        /** @param {string} name */
        startBlock(name) {
            const b = WORDING_BLOCKS[name];
            const self = /** @type {*} */ (this);
            if (self[b.live]) self[b.live].dispose();
            self[b.live] = liveWordingBlock(this, {
                stored: b.stored,
                initial: self[b.draft],
                what: b.what,
                /** @param {{status: string, error?: string}} state */
                onChange: (state) => {
                    self[b.chip] = state.status;
                    if (name === 'announcement') {
                        this.wordingError = state.error || '';
                        this.eventAnnouncementSaving = state.status === 'saving';
                    }
                },
            });
            this.watchWordingConfig();
        },

        /**
         * @param {string} name
         * @param {string} field
         * @param {string} value
         */
        editBlock(name, field, value) {
            const b = WORDING_BLOCKS[name];
            const self = /** @type {*} */ (this);
            self[b.draft] = { ...self[b.draft], [field]: value };
            if (self[b.live]) self[b.live].edit(field, value);
        },

        /**
         * @param {string} name
         * @param {string} field
         */
        revertBlock(name, field) {
            const b = WORDING_BLOCKS[name];
            const self = /** @type {*} */ (this);
            if (!self[b.live]) return;
            self[b.live].revert(field);
            self[b.draft] = { ...self[b.live].state.draft };
        },

        /** @param {string} name */
        async saveBlock(name) {
            const live = /** @type {*} */ (this)[WORDING_BLOCKS[name].live];
            if (live) return live.flush();
        },

        /** @param {string} name */
        resetBlock(name) {
            const defaults = WORDING_BLOCKS[name].defaults;
            Object.keys(defaults).forEach(f => this.editBlock(name, f, defaults[f]));
            this.saveBlock(name);
            this.showToast('Reset to defaults');
        },

        // Somebody else's change lands in the fields this admin has not touched.
        watchWordingConfig() {
            const Live = /** @type {*} */ (window).MosaicLiveRead;
            if (this.stopWordingWatch) { try { this.stopWordingWatch(); } catch (e) {} }
            this.stopWordingWatch = null;
            if (!Live || !db || typeof db.collection !== 'function') return;
            const self = /** @type {*} */ (this);
            try {
                this.stopWordingWatch = Live.watch(db.collection('app_config').doc('prayer_request_sms'), (/** @type {*} */ snap) => {
                    if (!snap) return;
                    const data = snap.exists ? snap.data() : {};
                    const opts = { pendingWrites: !!(snap.metadata && snap.metadata.hasPendingWrites) };
                    if (this.nudgeLive && !this.nudgeSwitchSaving) this.nudgeEnabled = data.nudgeEnabled === true;
                    Object.keys(WORDING_BLOCKS).forEach(name => {
                        const b = WORDING_BLOCKS[name];
                        if (!self[b.live]) return;
                        self[b.live].remote(blockFrom(name, data), opts);
                        self[b.draft] = { ...self[b.live].state.draft };
                    });
                }, { onError: () => {} });
            } catch (e) { /* stays as loaded */ }
        },

        // The names the page binds to, one per block.
        loadEventAnnouncementWording() { return this.loadBlock('announcement'); },
        startLiveWording() { this.startBlock('announcement'); },
        /** @param {string} f @param {string} v */
        editWording(f, v) { this.editBlock('announcement', f, v); },
        /** @param {string} f */
        revertWording(f) { this.revertBlock('announcement', f); },
        saveEventAnnouncementWording() { return this.saveBlock('announcement'); },
        resetEventAnnouncementWording() { this.resetBlock('announcement'); },

        async loadNudgeSettings() {
            const data = await this.loadBlock('nudge');
            if (data) this.nudgeEnabled = data.nudgeEnabled === true;
        },
        startLiveNudge() { this.startBlock('nudge'); },
        /** @param {string} f @param {string} v */
        editNudgeWording(f, v) { this.editBlock('nudge', f, v); },
        /** @param {string} f */
        revertNudgeWording(f) { this.revertBlock('nudge', f); },
        saveNudgeWording() { return this.saveBlock('nudge'); },
        resetNudgeWording() { this.resetBlock('nudge'); },

        loadInvitationWording() { return this.loadBlock('invitation'); },
        /** @param {string} f @param {string} v */
        editInvitationWording(f, v) { this.editBlock('invitation', f, v); },
        /** @param {string} f */
        revertInvitationWording(f) { this.revertBlock('invitation', f); },
        saveInvitationWording() { return this.saveBlock('invitation'); },
        resetInvitationWording() { this.resetBlock('invitation'); },

        // The nudge switch saves the moment it is flipped, and flips back if
        // the save fails. Off unless somebody turned it on.
        /** @param {boolean} on */
        async setNudgeEnabled(on) {
            const was = this.nudgeEnabled;
            this.nudgeEnabled = !!on;
            this.nudgeSwitchSaving = true;
            try {
                await db.collection('app_config').doc('prayer_request_sms').set({
                    nudgeEnabled: !!on,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: /** @type {*} */ (this.currentUser).uid,
                }, { merge: true });
                this.showToast(on ? 'Nudges are on' : 'Nudges are off');
            } catch (e) {
                console.error('Error saving the nudge switch:', e);
                this.nudgeEnabled = was;
                this.showToast('Could not change nudges. Try again.', 'error');
            } finally {
                this.nudgeSwitchSaving = false;
            }
        },

        // ── Push notifications tab ──────────────────────────────────────

        // One call brings the flow, the registry, the counts and the devices,
        // because on the server they are the same two reads.
        //
        // When it fails, the tab does NOT go on to ask for the log as well:
        // one broken connection should say so once, not three times. What is
        // still worth showing is the registry — what this site can send, and
        // what fires it — which is knowledge the page already carries. The
        // counts and the send window are not: they are read off the server,
        // so they come back blank rather than invented.
        async loadPush() {
            if (this.pushLoading) return;
            this.pushLoading = true;
            this.pushError = '';
            this.pushOffline = false;
            try {
                const { data } = await this.callable(PUSH_TAB_CALLABLES.overview)();
                this.pushOverview = data;
                this.pushFlow = data.flow;
                this.devices = data.devices.people;
                this.deviceSummary = data.devices.summary;
                this.deviceThresholds =
                    `Aging after ${data.agingAfterDays} days, stale after ${data.staleAfterDays}.`;
                this.pushLoaded = true;
            } catch (e) {
                console.error('notificationOverview failed:', e);
                this.showRegistryOffline(e);
                this.pushLoading = false;
                return;
            }
            this.pushLoading = false;
            await this.loadHistory();
        },

        showRegistryOffline(error) {
            this.pushOffline = true;
            this.pushError = (error && error.message) ||
                'Could not reach the notification functions.';
            this.pushFlow = null;
            this.devices = [];
            this.deviceSummary = null;
            this.deviceThresholds = '';
            this.history = [];
            this.historyCursor = null;
            this.historyScanned = 0;
            this.pushOverview = {
                constants: { timezone: '' },
                types: NotificationAdminCore.offlineTypes(),
                unmatched: [],
                recent: null,
                devices: null,
            };
        },

        // `more` keeps what is on screen and asks for the next page; anything
        // else starts the list again from the top.
        async loadHistory(more) {
            if (this.historyLoading) return;
            this.historyLoading = true;
            try {
                const { data } = await this.callable(PUSH_TAB_CALLABLES.history)({
                    limit: HISTORY_PAGE,
                    cursor: more ? this.historyCursor : null,
                    status: this.historyFilters.status,
                    channel: this.historyFilters.channel,
                    typeId: this.historyFilters.typeId,
                    search: this.historyFilters.search,
                });
                this.history = more ? this.history.concat(data.rows) : data.rows;
                this.historyScanned = more ? this.historyScanned + data.scanned : data.scanned;
                this.historyCursor = data.nextCursor;
                this.historyIsFiltered = data.filtered;
            } catch (e) {
                console.error('notificationHistory failed:', e);
                this.showToast('Could not read the sent history', 'error');
            } finally {
                this.historyLoading = false;
            }
        },

        clearHistoryFilters() {
            this.historyFilters = { status: '', channel: '', typeId: '', search: '' };
            this.loadHistory();
        },

        // Two presses, always. The first asks; this one is the answer, and it
        // says so to the server — which refuses a call that does not carry it.
        async revokeDevice(person, device) {
            if (this.revoking) return;
            this.revoking = true;
            try {
                await this.callable(PUSH_TAB_CALLABLES.revoke)({
                    confirm: true,
                    uid: person.uid,
                    tokenId: device.id,
                });
                person.devices = person.devices.filter(d => d.id !== device.id);
                this.devices = this.devices.filter(p => p.devices.length > 0);
                this.deviceSummary = NotificationAdminCore.summariseDevices(this.devices);
                this.showToast(`Revoked ${device.masked}`);
            } catch (e) {
                console.error('notificationRevokeToken failed:', e);
                this.showToast(e.message || 'Could not revoke that device', 'error');
            } finally {
                this.revoking = false;
                this.revokeConfirming = null;
            }
        },

        // The payload names nobody. `confirm` is the second press travelling
        // with the call; it cannot aim anything, and the server refuses
        // without it. The recipient is the signed-in uid, server-side.
        async sendTestPush() {
            if (this.testPushSending) return;
            this.testPushSending = true;
            this.testPushResult = null;
            try {
                const { data } = await this.callable(PUSH_TAB_CALLABLES.testPush)({
                    confirm: true,
                });
                const removed = data.removed.length
                    ? ` ${data.removed.length} dead token(s) removed.` : '';
                this.testPushResult = data.accepted > 0
                    ? { ok: true, message: `Accepted by the provider for ${data.accepted} of your ${data.attempted} device(s).${removed}` }
                    : { ok: false, message: `No device accepted it (${data.attempted} tried).${removed}` };
                if (data.removed.length) this.loadPush();
                this.showToast(data.accepted > 0 ? 'Test push sent' : 'Test push not accepted',
                    data.accepted > 0 ? 'success' : 'error');
            } catch (e) {
                console.error('notificationTestPush failed:', e);
                this.testPushResult = { ok: false, message: e.message || 'Could not send the test push.' };
                this.showToast('Test push failed', 'error');
            } finally {
                this.testPushSending = false;
                this.testPushConfirming = false;
            }
        },

        churchTime(iso) {
            const zone = this.pushOverview ? this.pushOverview.constants.timezone : '';
            return NotificationAdminCore.churchLocalLabel(iso, zone);
        },

        branchTone(tone) {
            if (tone === 'go') return 'border-success/40 bg-success-container text-on-success-container';
            if (tone === 'warn') return 'border-warning/40 bg-warning-container text-on-warning-container';
            return 'border-error/40 bg-error-container text-on-error-container';
        },

        branchIcon(tone) {
            if (tone === 'go') return 'arrow_forward';
            if (tone === 'warn') return 'alt_route';
            return 'block';
        },

        statusTone(status) {
            if (status === 'delivered') return 'bg-success-container text-on-success-container';
            if (status === 'failed') return 'bg-error-container text-on-error-container';
            if (status === 'unreachable') return 'bg-warning-container text-on-warning-container';
            return 'bg-surface-container text-on-surface-variant';
        },

        statusIcon(status) {
            if (status === 'delivered') return 'check_circle';
            if (status === 'failed') return 'error';
            if (status === 'unreachable') return 'person_off';
            return 'description';
        },

        deviceTone(state) {
            if (state === 'stale') return 'bg-error-container text-on-error-container';
            if (state === 'aging') return 'bg-warning-container text-on-warning-container';
            if (state === 'fresh') return 'bg-success-container text-on-success-container';
            return 'bg-surface-container text-on-surface-variant';
        },

        platformIcon(platform) {
            if (platform === 'ios') return 'phone_iphone';
            if (platform === 'android') return 'phone_android';
            if (platform === 'web') return 'computer';
            return 'devices_other';
        },

        triggerIcon(kind) {
            if (kind === 'schedule') return 'schedule';
            if (kind === 'trigger') return 'bolt';
            if (kind === 'webhook') return 'cloud_download';
            return 'touch_app';
        },

        formatDatetime(timestamp) {
            if (!timestamp) return '';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit'
            });
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
