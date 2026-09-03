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

    // ⚠ A BLANK PAGE IS THE WORST FAILURE THIS PAGE HAS, because it cannot tell
    // anybody anything — not the stranger looking at it, and not whoever has to
    // work out why. Anything thrown before or during boot unhides a plain block
    // that owes nothing to Alpine, and takes x-cloak off the body so the page
    // is visible enough to say so.
    function fatal(why) {
        try {
            document.body.removeAttribute('x-cloak');
            var main = document.getElementById('answer-main');
            var box = document.getElementById('fatal');
            var line = document.getElementById('fatal-why');
            if (line) line.textContent = why || 'Something went wrong before the page could load.';
            if (box) box.hidden = false;
            if (main) main.style.display = 'none';
        } catch (ignored) { /* there is nothing left to try */ }
    }
    window.addEventListener('error', function (e) { fatal(e && e.message); });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        fatal((r && r.message) || String(r || ''));
    });

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
    // ⚠ `enabled` HAS TO AGREE WITH enforceAppCheck ON THE SERVER. Enabled here
    // and not enforced there checks nothing; enforced there and not enabled
    // here refuses everybody. It is currently off at both ends — the reasons
    // are written out in app-check-config.js, and a test fails if they drift
    // apart.
    const appCheckOn = !!(window.MOSAIC_APP_CHECK && window.MOSAIC_APP_CHECK.enabled);
    const appCheckKey = (appCheckOn && window.MOSAIC_APP_CHECK.siteKey) || '';
    const appCheckKind = (window.MOSAIC_APP_CHECK && window.MOSAIC_APP_CHECK.provider) || 'enterprise';

    // ⚠ ACTIVATION NEEDS <body> TO EXIST, and failing that is not survivable.
    // The reCAPTCHA provider appends its container to document.body. From
    // <head> that is null, and it throws AFTER App Check has already recorded
    // an "attestation is starting" promise that will now never resolve — so
    // every later call waits for a token that is never coming. A hang, not an
    // error, and a hang is the one failure this page cannot report.
    //
    // This script is loaded at the end of <body> so it cannot happen. The
    // check is here so that if somebody ever moves it back, they get a loud
    // refusal in the console instead of a spinner nobody can explain.
    if (appCheckKey && !document.body) {
        console.error(
            'form-answer.js ran before <body> existed. App Check is NOT being ' +
            'started, because starting it here hangs every call for ever. ' +
            'Move this script back to the end of <body>.');
    } else if (appCheckKey) {
        try {
            // ⚠ THE PROVIDER IS NAMED, NEVER INFERRED. activate() given a bare
            // string quietly builds a ReCaptchaV3Provider — and ours is an
            // Enterprise key, which the v3 flow cannot attest. The symptom is
            // not an error mentioning reCAPTCHA; it is every submission
            // refused and a form that will not load.
            const P = firebase.appCheck;
            const provider = appCheckKind === 'v3'
                ? new P.ReCaptchaV3Provider(appCheckKey)
                : new P.ReCaptchaEnterpriseProvider(appCheckKey);
            firebase.appCheck().activate(provider, true);
        } catch (e) {
            // Never fatal. A page that will not render because attestation
            // failed to start is worse than one that renders and is refused
            // with a message somebody can act on.
            console.warn('App Check did not start:', e && e.message);
        }
    } else if (!appCheckOn) {
        console.info('App Check is off at both ends on purpose — see app-check-config.js.');
    } else {
        console.warn(
            'App Check is enabled but has no site key, so public forms will be ' +
            'refused. Run: bash scripts/wizard-app-check.sh');
    }

    const fns = firebase.app().functions('us-central1');

    // ⚠ NOTHING ON THIS PAGE IS ALLOWED TO WAIT FOR EVER.
    //
    // The worst bug this page has had was not a crash — it was a wait. App
    // Check failed to start in a way that left the callable waiting on a token
    // that never arrived, so the page sat on its spinner with no error, no
    // rejection and nothing to report. From the outside that is a blank page,
    // and it took days to find precisely because nothing had gone "wrong".
    //
    // So every wait here has an end. A page that gives up and says so can be
    // retried by whoever is looking at it; a page that hangs cannot, and it
    // tells whoever is debugging it nothing at all. The cause of the next hang
    // will be different — the symptom will not be silent.
    function withTimeout(promise, ms, what) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(what)), ms);
            promise.then(
                v => { clearTimeout(timer); resolve(v); },
                e => { clearTimeout(timer); reject(e); });
        });
    }

    const CALL_TIMEOUT = 20000;   // a slow phone on mobile data, and then some
    const AUTH_TIMEOUT = 8000;    // longer than a session ever takes to rehydrate

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
                // Absolute for the same reason every asset path is: at
                // /f/<token> a relative 'login.html' resolves to /f/login.html,
                // which the rewrite answers with this page again.
                return '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
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
                // ⚠ AND IF AUTH NEVER SETTLES, CARRY ON AS SIGNED OUT. The
                // worst that costs a member is being shown the sign-in door
                // they can already open. Waiting instead costs everybody the
                // whole page.
                await withTimeout(new Promise(resolve => {
                    const stop = firebase.auth().onAuthStateChanged(u => {
                        this.myName = (u && u.displayName) || '';
                        stop();
                        resolve();
                    });
                }), AUTH_TIMEOUT, 'auth never settled').catch(e => {
                    console.warn('Carrying on signed out:', e && e.message);
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
                    const res = await withTimeout(
                        fns.httpsCallable('publicForm')(payload),
                        CALL_TIMEOUT,
                        'the server did not answer in time');
                    this.settle(res.data || {}, isFetch);
                } catch (e) {
                    // ⚠ WHAT THEY TYPED STAYS ON THE SCREEN. A network that
                    // dropped mid-send is the one moment somebody has already
                    // done the work, and a page that clears itself here is a
                    // page they do not come back to.
                    // The underlying message goes to the console for whoever
                    // is diagnosing, never onto the page — "internal" and an
                    // App Check rejection mean nothing to somebody trying to
                    // sign up for a bible study.
                    console.error('publicForm failed:', e && (e.code || ''), e && e.message);
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
