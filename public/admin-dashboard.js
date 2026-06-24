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

document.addEventListener('alpine:init', () => {
    Alpine.data('adminDashboard', () => ({
        currentUser: null,
        currentUserRole: null,
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
        prayerFields: [
            { key: 'initial', label: 'Initial request', help: 'Sent first, a few days before the service. Uses {name}.' },
            { key: 'reminder', label: 'Reminder', help: 'Sent closer to the service if no reply yet. Uses {name}.' },
            { key: 'thankyou', label: 'Thank-you reply', help: 'Auto-reply after someone sends their request. Uses {name}.' },
            { key: 'elderDigest', label: 'Elder digest', help: 'Texted to Elder-tagged people once all of a service\'s requests are in by reply. Uses {date} and {requests}.' },
        ],
        prayerSaving: false,
        autoSendEnabled: false,
        autoSendSaving: false,

        toast: { show: false, message: '', type: 'success' },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                this.currentUserRole = (userData && userData.role) || 'viewer';
                if (!['admin', 'super_admin'].includes(this.currentUserRole)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.loading = false;
                this.refreshStatus();
                this.loadReplies();
                this.loadPrayerMessages();
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
                this.autoSendEnabled = !!saved.autoSendEnabled;
            } catch (e) {
                console.error('Error loading prayer messages:', e);
                this.showToast('Could not load prayer messages', 'error');
            }
        },

        async savePrayerMessages() {
            this.prayerSaving = true;
            try {
                await db.collection('app_config').doc('prayer_request_sms').set({
                    initial: this.prayerMessages.initial.trim(),
                    reminder: this.prayerMessages.reminder.trim(),
                    thankyou: this.prayerMessages.thankyou.trim(),
                    elderDigest: this.prayerMessages.elderDigest.trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: this.currentUser.uid,
                }, { merge: true });
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
            this.showToast('Reset to defaults — Save to apply');
        },

        // Kill switch — writes immediately so turning automation off takes effect
        // without waiting for a Save.
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
    }));
});
