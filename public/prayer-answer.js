// The page somebody answers a pastoral prayer request on (MS-516, MS-247).
//
// ⚠ ONE CALLABLE, NO FIRESTORE. Same contract as form-answer.html (ADR-0051,
// ADR-0067): the browser never loads a Firestore client; every read and write
// goes through answerLink.

(function () {
    'use strict';

    function fatal(why) {
        try {
            document.body.removeAttribute('x-cloak');
            var main = document.getElementById('prayer-answer-main');
            var box = document.getElementById('fatal');
            var line = document.getElementById('fatal-why');
            if (line) line.textContent = why || 'Something went wrong before the page could load.';
            if (box) box.hidden = false;
            if (main) main.style.display = 'none';
        } catch (ignored) { /* nothing left to try */ }
    }
    window.addEventListener('error', function (e) { fatal(e && e.message); });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        fatal((r && r.message) || String(r || ''));
    });

    const firebaseConfig = window.MosaicFirebaseProject && window.MosaicFirebaseProject.church;
    if (!firebaseConfig || !firebaseConfig.projectId) {
        throw new Error('firebase-config.js must load before prayer-answer.js');
    }

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const fns = firebase.app().functions('us-central1');
    const CALL_TIMEOUT = 20000;
    const AUTH_TIMEOUT = 8000;

    function withTimeout(promise, ms, what) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(what)), ms);
            promise.then(
                v => { clearTimeout(timer); resolve(v); },
                e => { clearTimeout(timer); reject(e); });
        });
    }

    function tokenFromLocation() {
        const path = String(location.pathname || '');
        const m = path.match(/\/a\/([A-Za-z0-9]+)\/?$/);
        if (m) return m[1];
        return new URLSearchParams(location.search).get('a') || '';
    }

    function thingFromLocation() {
        return new URLSearchParams(location.search).get('thing') || '';
    }

    function shellQuery() {
        try {
            if (window.MOSAIC_SHELL === 'mobile') return '?shell=mobile';
            if (sessionStorage.getItem('mosaicShell') === 'mobile') return '?shell=mobile';
        } catch (e) { /* ignore */ }
        return '';
    }

    window.prayerAnswerPage = function prayerAnswerPage() {
        return {
            state: 'loading',
            view: {
                firstName: '',
                serviceDateLabel: '',
                privacyLine: '',
                showAnswerBox: true,
                eldersAlreadyHaveIt: false,
                existingAnswer: null,
            },
            answerText: '',
            problem: '',
            sending: false,
            token: '',
            serviceDate: '',
            signedIn: false,

            get greeting() {
                const name = (this.view && this.view.firstName) || 'there';
                return 'Hi ' + name + ',';
            },

            get saveLabel() {
                if (this.sending) return 'Saving…';
                if (this.view && this.view.existingAnswer) return 'Save changes';
                return 'Save';
            },

            get thanksLine() {
                const name = (this.view && this.view.firstName) || 'there';
                return 'Thank you, ' + name + '.';
            },

            get backHref() {
                if (window.MOSAIC_SHELL === 'mobile') {
                    return 'profile.html' + shellQuery();
                }
                return 'javascript:history.back()';
            },

            async load() {
                this.token = tokenFromLocation();
                const thing = thingFromLocation();
                this.problem = '';

                if (!this.token) {
                    await withTimeout(new Promise(resolve => {
                        // Do not call unsubscribe inside the first callback — a
                        // sync first fire hits the TDZ on `stop` and rejects the
                        // whole wait, which reads as signed-out.
                        firebase.auth().onAuthStateChanged(u => {
                            this.signedIn = !!(u && !u.isAnonymous);
                            resolve();
                        });
                    }), AUTH_TIMEOUT, 'auth never settled').catch(() => {
                        this.signedIn = false;
                    });
                    if (!this.signedIn) {
                        this.state = 'notfound';
                        return;
                    }
                }

                await this.read(thing);
            },

            async read(thingHint) {
                this.state = 'loading';
                const payload = { op: 'read' };
                if (this.token) {
                    payload.token = this.token;
                } else if (thingHint) {
                    payload.thing = thingHint;
                }

                try {
                    const res = await withTimeout(
                        fns.httpsCallable('answerLink')(payload),
                        CALL_TIMEOUT,
                        'the server did not answer in time');
                    this.settleRead(res.data || {}, thingHint);
                } catch (e) {
                    console.error('answerLink read failed:', e && e.message);
                    this.problem = 'This did not load. Check your connection and try again.';
                    this.state = 'error';
                }
            },

            settleRead(data, thingHint) {
                if (!data.ok) {
                    if (data.code === 'rate-limited') {
                        this.state = 'limited';
                        return;
                    }
                    this.state = 'closed';
                    return;
                }

                let view = data.view;
                if (!view && Array.isArray(data.items)) {
                    if (!data.items.length) {
                        this.state = 'closed';
                        return;
                    }
                    let item = data.items.length === 1 ? data.items[0] : null;
                    if (!item && thingHint) {
                        item = data.items.find(it => it.thing === thingHint) || null;
                    }
                    if (!item) {
                        item = data.items[0];
                    }
                    view = item.view;
                    this.serviceDate = item.thing || '';
                } else {
                    this.serviceDate = data.thing || thingHint || '';
                }

                if (!view) {
                    this.state = 'error';
                    this.problem = 'This did not load. Try again in a moment.';
                    return;
                }

                this.view = view;
                this.answerText = view.existingAnswer || '';
                if (view.eldersAlreadyHaveIt) {
                    this.state = 'elders';
                    return;
                }
                this.state = 'open';
            },

            async save() {
                if (this.sending) return;
                this.problem = '';
                const text = String(this.answerText || '').trim();
                if (!text) {
                    this.problem = 'Write something before saving.';
                    return;
                }

                this.sending = true;
                const payload = { op: 'answer', answer: text };
                if (this.token) {
                    payload.token = this.token;
                } else if (this.serviceDate) {
                    payload.thing = this.serviceDate;
                }

                try {
                    const res = await withTimeout(
                        fns.httpsCallable('answerLink')(payload),
                        CALL_TIMEOUT,
                        'the server did not answer in time');
                    this.settleSave(res.data || {});
                } catch (e) {
                    console.error('answerLink save failed:', e && e.message);
                    this.problem = 'That did not save. Nothing has been lost — try again.';
                }
                this.sending = false;
            },

            settleSave(data) {
                if (data.ok) {
                    if (data.view) this.view = data.view;
                    this.state = 'thanks';
                    return;
                }
                if (data.code === 'rate-limited') {
                    this.state = 'limited';
                    return;
                }
                if (data.code === 'already-have-it' || (data.view && data.view.eldersAlreadyHaveIt)) {
                    if (data.view) this.view = data.view;
                    this.state = 'elders';
                    return;
                }
                if (data.code === 'closed') {
                    this.state = 'closed';
                    return;
                }
                this.problem = data.message || 'That did not work.';
            },

            retry() {
                this.problem = '';
                this.load();
            },
        };
    };
})();
