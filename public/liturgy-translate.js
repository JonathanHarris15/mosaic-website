// Asks the translateLiturgy callable, and matches by kind and position when
// that call does not answer. The key stays on the server. Loaded after
// liturgy-translate-core.js.
(function (global) {
    'use strict';

    const TranslateCore = global.LiturgyTranslateCore;

    async function translate(sources, targets, mode, options) {
        const opts = options || {};
        const local = TranslateCore.plan(sources, targets, {
            mode: mode,
            sourceOrder: opts.sourceOrder,
            targetOrder: opts.targetOrder,
        });
        local.fromJev = false;
        if (typeof firebase === 'undefined' || !firebase.app) return local;
        try {
            const fn = firebase.app().functions('us-central1').httpsCallable('translateLiturgy');
            const result = await fn({
                sources: sources,
                targets: targets,
                mode: mode || 'order',
                sourceOrder: opts.sourceOrder || '',
                targetOrder: opts.targetOrder || '',
            });
            const data = result && result.data;
            if (data && Array.isArray(data.placements)) {
                data.fromJev = data.judge === 'jev';
                return data;
            }
        } catch (err) {
            console.warn('Liturgy translator unavailable; matching by kind and position.', err);
        }
        return local;
    }

    const LiturgyTranslate = { translate: translate };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = LiturgyTranslate;
    } else {
        global.LiturgyTranslate = LiturgyTranslate;
    }
}(typeof window !== 'undefined' ? window : globalThis));
