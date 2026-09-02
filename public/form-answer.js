// The page somebody answers a form on (MS-371).
//
// ⚠ THIS PAGE TALKS TO ONE CLOUD FUNCTION AND NOTHING ELSE. No Firestore
// client is loaded (see the comment in form-answer.html), so the acceptance
// criterion "makes no direct Firestore call when signed out" is met by
// construction rather than by remembering. ADR-0051.
//
// It runs for somebody who may have no account, no history with this church,
// and no intention of getting either. Everything it does has to work in that
// case first, and be an improvement in the others.

(function () {
    'use strict';

    // ⚠ DUPLICATED FROM auth.js ON PURPOSE. This page deliberately does not
    // load auth.js — that module calls firebase.firestore() and brings the
    // whole signed-in UI with it, neither of which belongs on a stranger's
    // page. The key is public by design (it ships in every browser), so this is
    // a tidiness cost rather than a security one. If a third page ever needs
    // it, lift it into firebase-config.js and have auth.js read that.
    const firebaseConfig = {
        apiKey: "AIzaSyCJLgZP27CWayqFoqYoqg9mVdkhgCWqgbg",
        authDomain: "mosaic-hymn-database.firebaseapp.com",
        projectId: "mosaic-hymn-database",
        storageBucket: "mosaic-hymn-database.firebasestorage.app",
        messagingSenderId: "1004095249066",
        appId: "1:1004095249066:web:0dcbf3cbbcd0be2ff4bbdd",
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    // ── App Check ────────────────────────────────────────────────────────────
    //
    // The browser collects a token proving it is running this website, and
    // `publicForm` refuses anything without one. Invisible to whoever is
    // filling the form in — no "tick to prove you are human", because a waiver
    // is already friction and a second hurdle loses people.
    //
    // ⚠ ACTIVATED ONLY WHEN A SITE KEY IS SET, and the server enforces either
    // way. So an unconfigured deploy REFUSES public submissions rather than
    // accepting them unchecked. That asymmetry is deliberate: the failure of a
    // half-finished setup should be "nothing works yet", never "everything
    // works and nothing is checked".
    const appCheckKey = (window.MOSAIC_APP_CHECK && window.MOSAIC_APP_CHECK.siteKey) || '';
    if (appCheckKey) {
        try {
            firebase.appCheck().activate(appCheckKey, true);
        } catch (e) {
            // Never fatal. A page that will not render because attestation
            // failed to start is worse than one that renders and is refused
            // with a message somebody can act on.
            console.warn('App Check did not start:', e && e.message);
        }
    } else {
        console.warn(
            'App Check has no site key, so public forms will be refused. ' +
            'Run: bash scripts/wizard-app-check.sh');
    }

    const fns = firebase.app().functions('us-central1');

    // The form's id, from /f/<token> or ?f=<token>. Both work: the rewrite
    // gives the pretty one, and the query string is what a copied link from an
    // older build looks like.
    function formIdFromLocation() {
        const path = String(location.pathname || '');
        const m = path.match(/\/f\/([A-Za-z0-9]+)\/?$/);
        if (m) return m[1];
        return new URLSearchParams(location.search).get('f') || '';
    }

    window.answerPage = function answerPage() {
        return {
            state: 'loading',
            form: { title: '', description: '', questions: [], ballot: false, promise: '' },
            answers: {},
            was: {},
            missing: [],
            problem: '',
            afterword: '',
            sending: false,
            closedTitle: '',
            closedLine: '',
            answeredWhen: '',
            answeredNote: '',
            whoami: 'College Station',

            get missingIds() { return this.missing.map(m => m.id); },

            get missingLine() {
                if (!this.missing.length) return '';
                return this.missing.map(m => m.text).join(' · ');
            },

            get countLine() {
                const qs = this.form.questions || [];
                const need = qs.filter(q => q.required).length;
                const n = qs.length + (qs.length === 1 ? ' question' : ' questions');
                // ⚠ No time estimate. The design offered "About 2 minutes"; a
                // guess presented as a fact is wrong often enough to make the
                // church look careless, and it buys nothing a count does not.
                return need ? `${n} · ${need} needed` : n;
            },

            get sendLabel() {
                if (this.sending) return 'Sending…';
                if (this.state === 'answered') return 'Update my answer';
                if (this.form.ballot) return 'Send my answers anonymously';
                return 'Send my answers';
            },

            get thanks() {
                // Personalised only where the form records who answered AND we
                // actually know them. Fishing a name out of an answer would be
                // wrong the first time somebody typed a nickname.
                return this.myName ? `Thank you, ${this.myName}.` : 'Thank you.';
            },

            get canShare() {
                return typeof navigator !== 'undefined' && !!navigator.share;
            },

            get signInHref() {
                return 'login.html?next=' + encodeURIComponent(location.pathname + location.search);
            },

            myName: '',

            async load() {
                const formId = formIdFromLocation();
                if (!formId) { this.state = 'notfound'; return; }
                this.formId = formId;

                // Wait for auth to settle before asking. Asking first would
                // read a members-only form as signed-out for anybody whose
                // session had not yet rehydrated — they would be told to sign
                // in while already signed in.
                await new Promise(resolve => {
                    const stop = firebase.auth().onAuthStateChanged(u => {
                        this.myName = (u && u.displayName) || '';
                        stop();
                        resolve();
                    });
                });

                await this.ask({ op: 'fetch', formId: formId }, true);
            },

            async submit() {
                if (this.sending) return;
                this.sending = true;
                this.problem = '';
                this.missing = [];
                await this.ask({ op: 'submit', formId: this.formId, answers: this.answers }, false);
                this.sending = false;
            },

            async ask(payload, isFetch) {
                try {
                    const res = await fns.httpsCallable('publicForm')(payload);
                    this.settle(res.data || {}, isFetch);
                } catch (e) {
                    // ⚠ WHAT THEY TYPED STAYS ON THE SCREEN. A network that
                    // dropped mid-send is the one moment somebody has already
                    // done the work, and a page that clears itself here is a
                    // page they do not come back to.
                    this.problem = isFetch ?
                        'This did not load. Check your connection and try again.' :
                        'That did not send. Nothing has been lost — try again.';
                    if (isFetch) this.state = 'error';
                }
            },

            settle(data, isFetch) {
                if (data.ok && isFetch) {
                    this.form = data.view || this.form;
                    this.state = 'open';
                    return;
                }
                if (data.ok) {
                    this.afterword = data.afterword || '';
                    this.state = 'submitted';
                    return;
                }

                switch (data.code) {
                    case 'not-found':
                        this.state = 'notfound';
                        return;
                    case 'sign-in-required':
                        this.state = 'signin';
                        return;
                    case 'permission-denied':
                        this.state = 'denied';
                        return;
                    case 'closed':
                        this.closedTitle = data.title || 'This form is closed.';
                        this.closedLine = data.closedOn ?
                            `It closed on ${this.pretty(data.closedOn)}.` :
                            'It is no longer taking answers.';
                        this.state = 'closed';
                        return;
                    case 'incomplete':
                        this.missing = data.missing || [];
                        this.problem = data.message || 'Some questions still need an answer.';
                        return;
                    case 'already-answered':
                        // Only a ballot reaches this. An attributed one-each
                        // form hands the answer back instead — ADR-0052.
                        this.problem = data.message;
                        return;
                    default:
                        this.problem = data.message || 'That did not work.';
                }
            },

            pretty(dateStr) {
                const parts = String(dateStr).split('-');
                if (parts.length !== 3) return dateStr;
                const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
            },

            share() {
                if (!this.canShare) return;
                navigator.share({ title: this.form.title, url: location.href }).catch(() => {});
            },
        };
    };
})();
