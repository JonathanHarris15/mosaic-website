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

document.addEventListener('alpine:init', () => {
    Alpine.data('adminDashboard', () => ({
        currentUser: null,
        currentPermissionLevel: null,
        loading: true,

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

        adminTab: 'messaging',

        pushOverviewLoading: false,
        pushOverview: { flow: [], triggers: [], smsMigrationNote: '', autoSendEnabled: false },
        pushPurposeStats: {},

        pushLogRows: [],
        pushLogLoading: false,
        pushLogHasMore: false,
        pushLogCursor: null,
        pushLogFilter: { channel: '', purpose: '', failuresOnly: false },
        pushPersonNames: {},

        pushDevices: [],
        pushDevicesLoading: false,
        pushTestSending: false,

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
            });
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

        nac() {
            return window.NotificationAdminCore;
        },

        openPushTab() {
            this.adminTab = 'push';
            if (!this.pushOverview.flow.length) {
                this.loadPushOverview();
            }
            if (!this.pushLogRows.length) {
                this.resetPushLog();
            }
            if (!this.pushDevices.length) {
                this.loadPushDevices();
            }
        },

        async loadPushOverview() {
            this.pushOverviewLoading = true;
            try {
                const fn = firebase.app().functions('us-central1')
                    .httpsCallable('adminNotificationOverview');
                const { data } = await fn();
                this.pushOverview = data;
                await this.loadPushPurposeStats();
            } catch (e) {
                console.error('adminNotificationOverview failed:', e);
                const core = this.nac();
                if (core) {
                    this.pushOverview = {
                        flow: core.buildSendFlow({}),
                        triggers: core.notificationTriggers(),
                        smsMigrationNote: 'Could not reach overview callable — showing static registry.',
                        autoSendEnabled: this.autoSendEnabled,
                    };
                }
                this.showToast('Overview loaded from cache only', 'error');
            } finally {
                this.pushOverviewLoading = false;
            }
        },

        async loadPushPurposeStats() {
            try {
                const snap = await db.collection('notifications')
                    .where('direction', '==', 'outbound')
                    .orderBy('createdAt', 'desc')
                    .limit(400)
                    .get();
                const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
                const core = this.nac();
                this.pushPurposeStats = core ?
                    core.aggregatePurposeStats(rows) : {};
            } catch (e) {
                console.error('push stats query failed:', e);
                this.pushPurposeStats = {};
            }
        },

        pushPurposeOptions() {
            const core = this.nac();
            const triggers = (this.pushOverview.triggers && this.pushOverview.triggers.length) ?
                this.pushOverview.triggers :
                (core ? core.notificationTriggers() : []);
            const set = new Set(triggers.map((t) => t.purpose).filter(Boolean));
            return [...set].sort();
        },

        pushTriggerRows() {
            const core = this.nac();
            const triggers = this.pushOverview.triggers || (core ? core.notificationTriggers() : []);
            const stats = this.pushPurposeStats || {};
            return triggers.map((t) => {
                const s = stats[t.purpose] || { lastSentMs: null, count30d: 0 };
                const lastSentLabel = s.lastSentMs && core ?
                    core.formatChurchLocal(s.lastSentMs) : '—';
                let killSwitch = t.killSwitch;
                if (t.killSwitch === 'app_config/prayer_request_sms.autoSendEnabled') {
                    killSwitch = this.pushOverview.autoSendEnabled ?
                        'Automatic sending ON' : 'Automatic sending OFF';
                }
                return Object.assign({}, t, {
                    lastSentLabel,
                    count30d: s.count30d || 0,
                    killSwitch,
                });
            });
        },

        resetPushLog() {
            this.pushLogRows = [];
            this.pushLogCursor = null;
            this.pushLogHasMore = false;
            this.loadPushLog(false);
        },

        async loadPushLog(append) {
            if (this.pushLogLoading) return;
            this.pushLogLoading = true;
            try {
                let q = db.collection('notifications')
                    .where('direction', '==', 'outbound')
                    .orderBy('createdAt', 'desc')
                    .limit(30);
                if (append && this.pushLogCursor) {
                    q = q.startAfter(this.pushLogCursor);
                }
                const snap = await q.get();
                const core = this.nac();
                const docs = snap.docs;
                if (docs.length) {
                    this.pushLogCursor = docs[docs.length - 1];
                }
                this.pushLogHasMore = docs.length === 30;

                const personIds = [...new Set(docs.map((d) => d.data().personId).filter(Boolean))];
                await this.ensurePersonNames(personIds);

                const mapped = docs.map((doc) => {
                    const data = doc.data();
                    if (this.pushLogFilter.channel && data.channel !== this.pushLogFilter.channel) {
                        return null;
                    }
                    if (this.pushLogFilter.purpose && data.purpose !== this.pushLogFilter.purpose) {
                        return null;
                    }
                    const failed = core ? core.isFailedNotification(data) : !data.accepted;
                    if (this.pushLogFilter.failuresOnly && !failed) return null;
                    const whenLabel = core ? core.formatChurchLocal(data.createdAt) :
                        this.formatDatetime(data.createdAt);
                    const pid = data.personId;
                    const recipientLabel = pid ?
                        (this.pushPersonNames[pid] || pid) :
                        (data.adminUid ? 'Admin test' : '—');
                    let statusLabel = data.accepted ? 'accepted' : 'not accepted';
                    if (data.unreachable) statusLabel = 'unreachable';
                    if (data.channel === 'none') statusLabel = 'unreachable';
                    const purposeLabel = data.purpose +
                        (data.wording ? ' · ' + data.wording : '');
                    return {
                        id: doc.id,
                        whenLabel,
                        recipientLabel,
                        purposeLabel,
                        channel: data.channel || '—',
                        statusLabel,
                        failed,
                    };
                }).filter(Boolean);

                this.pushLogRows = append ? this.pushLogRows.concat(mapped) : mapped;
            } catch (e) {
                console.error('push log load failed:', e);
                this.showToast('Could not load sent history', 'error');
            } finally {
                this.pushLogLoading = false;
            }
        },

        async ensurePersonNames(personIds) {
            const missing = personIds.filter((id) => !this.pushPersonNames[id]);
            if (!missing.length) return;
            await Promise.all(missing.map(async (id) => {
                try {
                    const snap = await db.collection('people').doc(id).get();
                    if (!snap.exists) {
                        this.pushPersonNames[id] = id;
                        return;
                    }
                    const name = snap.data().name;
                    this.pushPersonNames[id] = (name && name.full) ||
                        (name && name.first) || id;
                } catch (err) {
                    this.pushPersonNames[id] = id;
                }
            }));
        },

        async loadPushDevices() {
            this.pushDevicesLoading = true;
            try {
                const fn = firebase.app().functions('us-central1')
                    .httpsCallable('adminPushDevices');
                const { data } = await fn();
                const core = this.nac();
                this.pushDevices = (data.devices || []).map((dev) => ({
                    ...dev,
                    lastSeenLabel: core && dev.updatedAtMs ?
                        core.formatChurchLocal(dev.updatedAtMs) : '—',
                }));
            } catch (e) {
                console.error('adminPushDevices failed:', e);
                this.showToast('Could not load devices', 'error');
            } finally {
                this.pushDevicesLoading = false;
            }
        },

        async revokePushToken(dev) {
            if (!dev || !dev.uid || !dev.tokenId) return;
            const label = dev.personName || dev.accountEmail || 'this device';
            if (!confirm('Revoke the push token for ' + label + '? They will not get pushes until they sign in on the app again.')) {
                return;
            }
            try {
                const fn = firebase.app().functions('us-central1')
                    .httpsCallable('adminRevokePushToken');
                await fn({ uid: dev.uid, tokenId: dev.tokenId });
                this.pushDevices = this.pushDevices.filter(
                    (d) => !(d.uid === dev.uid && d.tokenId === dev.tokenId));
                this.showToast('Token revoked');
            } catch (e) {
                console.error('adminRevokePushToken failed:', e);
                this.showToast(e.message || 'Revoke failed', 'error');
            }
        },

        async sendSelfPushTest() {
            if (this.pushTestSending) return;
            if (!confirm('Send a test push to every device token on your account?')) return;
            this.pushTestSending = true;
            try {
                const fn = firebase.app().functions('us-central1')
                    .httpsCallable('adminSendSelfPushTest');
                const { data } = await fn({});
                this.showToast('Test push sent to ' + data.accepted + ' of ' + data.sent + ' device(s)');
                this.resetPushLog();
            } catch (e) {
                console.error('adminSendSelfPushTest failed:', e);
                this.showToast(e.message || 'Test send failed', 'error');
            } finally {
                this.pushTestSending = false;
            }
        },
    }));
});
