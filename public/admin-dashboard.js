// Admin Dashboard — hosts admin-only system tools. The first tools wrap the SMS
// (Textbelt) integration: key status, remaining credits, and a test send. The
// Textbelt key lives server-side as a Firebase secret, so every action here goes
// through an admin-gated callable function rather than touching the key directly.

// Default prayer-request SMS templates. {name} is replaced with the person's
// first name when sent (falls back to "there"). These mirror the constants in
// the prayer-request sending flow; the admin can override them, and the saved
// values in Firestore (app_config/prayer_request_sms) take precedence.
const PRAYER_MESSAGE_DEFAULTS = {
    initial: "Hi {name}, this is Mosaic Church. You're in our pastoral prayer " +
        "this Sunday. What would you like us to pray about? (This information " +
        "will be private and only shared with Elders) Just reply to this message.",
    reminder: "Hi {name}, a gentle reminder from Mosaic Church — we'd love to " +
        "pray for you this Sunday. What would you like us to pray about? (This " +
        "information will be private and only shared with Elders) Just reply " +
        "here whenever you're ready.",
    thankyou: "Thank you, {name}. We'll be lifting this up in prayer this " +
        "Sunday. — Mosaic Church",
    // Sent to Elder-tagged people once a service's requests are all in by text.
    // Uses {date} and {requests} (not {name}); {requests} auto-builds one
    // "Name — request" line per subject.
    elderDigest: "Mosaic prayer requests for {date}:\n{requests}",
};

const EVENT_ANNOUNCEMENT_DEFAULTS = {
    text: "{title}\n\n{prose}\n{link}",
    pushTitle: "{title}",
    pushBody: "{prose}",
};

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

        // Prayer-request message templates
        prayerMessages: { ...PRAYER_MESSAGE_DEFAULTS },
        pushWording: {
            initial: { ...DEFAULT_PUSH_WORDING.initial },
            reminder: { ...DEFAULT_PUSH_WORDING.reminder },
            thankyou: { ...DEFAULT_PUSH_WORDING.thankyou },
        },
        pushTitleLimit: PUSH_TITLE_LIMIT,
        pushKinds: [
            { key: 'initial', label: 'Initial request' },
            { key: 'reminder', label: 'Reminder' },
            { key: 'thankyou', label: 'Thank-you reply' },
        ],
        prayerFields: [
            { key: 'initial', label: 'Initial request', help: 'Sent first, a few days before the service. Uses {name}.' },
            { key: 'reminder', label: 'Reminder', help: 'Sent closer to the service if no reply yet. Uses {name}.' },
            { key: 'thankyou', label: 'Thank-you reply', help: 'Auto-reply after someone sends their request. Uses {name}.' },
            { key: 'elderDigest', label: 'Elder digest', help: 'Texted to Elder-tagged people once all of a service\'s requests are in by reply. Uses {date} and {requests}.' },
        ],
        prayerSaving: false,
        autoSendEnabled: false,
        autoSendSaving: false,

        eventAnnouncementWording: { ...EVENT_ANNOUNCEMENT_DEFAULTS },
        eventAnnouncementSaving: false,

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
                this.currentPermissionLevel = (userData && userData.permissionLevel) || (userData && userData.role) || 'viewer';
                if (!['admin', 'super_admin'].includes(this.currentPermissionLevel)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.loading = false;
                this.refreshStatus();
                this.loadReplies();
                this.loadPrayerMessages();
                this.loadEventAnnouncementWording();
                if (window.location.hash === '#push') this.selectTab('push');
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

        async loadPrayerMessages() {
            try {
                const doc = await db.collection('app_config').doc('prayer_request_sms').get();
                const saved = doc.exists ? doc.data() : {};
                // Fall back to defaults for any template not yet customized.
                this.prayerMessages = {
                    initial: saved.initial || PRAYER_MESSAGE_DEFAULTS.initial,
                    reminder: saved.reminder || PRAYER_MESSAGE_DEFAULTS.reminder,
                    thankyou: saved.thankyou || PRAYER_MESSAGE_DEFAULTS.thankyou,
                    elderDigest: saved.elderDigest || PRAYER_MESSAGE_DEFAULTS.elderDigest,
                };
                const push = {};
                for (const kind of PUSH_WORDING_KINDS) {
                    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
                    const title = (saved['push' + cap + 'Title'] || '').trim();
                    const body = (saved['push' + cap + 'Body'] || '').trim();
                    push[kind] = {
                        title: title || DEFAULT_PUSH_WORDING[kind].title,
                        body: body || DEFAULT_PUSH_WORDING[kind].body,
                    };
                }
                this.pushWording = push;
                this.autoSendEnabled = !!saved.autoSendEnabled;
            } catch (e) {
                console.error('Error loading prayer messages:', e);
                this.showToast('Could not load prayer messages', 'error');
            }
        },

        async savePrayerMessages() {
            this.prayerSaving = true;
            try {
                const payload = {
                    initial: this.prayerMessages.initial.trim(),
                    reminder: this.prayerMessages.reminder.trim(),
                    thankyou: this.prayerMessages.thankyou.trim(),
                    elderDigest: this.prayerMessages.elderDigest.trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: this.currentUser.uid,
                };
                for (const kind of PUSH_WORDING_KINDS) {
                    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
                    payload['push' + cap + 'Title'] = (this.pushWording[kind].title || '').trim();
                    payload['push' + cap + 'Body'] = (this.pushWording[kind].body || '').trim();
                }
                await db.collection('app_config').doc('prayer_request_sms').set(payload, { merge: true });
                this.showToast('Prayer messages saved');
            } catch (e) {
                console.error('Error saving prayer messages:', e);
                this.showToast('Error saving messages', 'error');
            } finally {
                this.prayerSaving = false;
            }
        },

        resetPrayerMessages() {
            this.prayerMessages = { ...PRAYER_MESSAGE_DEFAULTS };
            this.pushWording = {
                initial: { ...DEFAULT_PUSH_WORDING.initial },
                reminder: { ...DEFAULT_PUSH_WORDING.reminder },
                thankyou: { ...DEFAULT_PUSH_WORDING.thankyou },
            };
            this.showToast('Reset to defaults — Save to apply');
        },

        // Kill switch — writes immediately so turning automation off takes effect
        // without waiting for a Save.
        async loadEventAnnouncementWording() {
            try {
                const doc = await db.collection('app_config').doc('prayer_request_sms').get();
                const saved = doc.exists ? doc.data() : {};
                this.eventAnnouncementWording = {
                    text: saved.eventAnnouncementText || EVENT_ANNOUNCEMENT_DEFAULTS.text,
                    pushTitle: saved.pushEventAnnouncementTitle || EVENT_ANNOUNCEMENT_DEFAULTS.pushTitle,
                    pushBody: saved.pushEventAnnouncementBody || EVENT_ANNOUNCEMENT_DEFAULTS.pushBody,
                };
            } catch (e) {
                console.error('Error loading event announcement wording:', e);
                this.showToast('Could not load event announcement wording', 'error');
            }
        },

        async saveEventAnnouncementWording() {
            this.eventAnnouncementSaving = true;
            try {
                await db.collection('app_config').doc('prayer_request_sms').set({
                    eventAnnouncementText: this.eventAnnouncementWording.text.trim(),
                    pushEventAnnouncementTitle: this.eventAnnouncementWording.pushTitle.trim(),
                    pushEventAnnouncementBody: this.eventAnnouncementWording.pushBody.trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: this.currentUser.uid,
                }, { merge: true });
                this.showToast('Event announcement wording saved');
            } catch (e) {
                console.error('Error saving event announcement wording:', e);
                this.showToast('Error saving event announcement wording', 'error');
            } finally {
                this.eventAnnouncementSaving = false;
            }
        },

        resetEventAnnouncementWording() {
            this.eventAnnouncementWording = { ...EVENT_ANNOUNCEMENT_DEFAULTS };
            this.showToast('Reset to defaults — Save to apply');
        },

        async toggleAutoSend() {
            const next = !this.autoSendEnabled;
            this.autoSendSaving = true;
            try {
                await db.collection('app_config').doc('prayer_request_sms').set({
                    autoSendEnabled: next,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: this.currentUser.uid,
                }, { merge: true });
                this.autoSendEnabled = next;
                this.showToast(next ? 'Automatic sending ON' : 'Automatic sending OFF');
            } catch (e) {
                console.error('Error toggling automation:', e);
                this.showToast('Could not change automation', 'error');
            } finally {
                this.autoSendSaving = false;
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
