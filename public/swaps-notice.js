// The whole notification (MS-190, MS-215).
//
// One count and one line on the dashboard, which lands on the Commitments page
// where everything actually happens. Deliberately NOT a notification system:
// there is no read state, no inbox, no bell, and nothing to dismiss.
//
// ⚠ IT IS BUILT TO BE THROWN AWAY. MS-187 reworks the header and will swallow
// this whole, so it is its own small read model with one job rather than a
// feature wired into the dashboard's card grid. Unpicking it should be one
// deletion.
//
// ⚠ AND IT MUST NEVER BREAK THE DASHBOARD. Somebody with no linked Person, or a
// failed read, gets nothing at all — silently. A home screen that fails to paint
// because a swap count could not load would be a poor trade for a line of text.

(function () {
    'use strict';

    // ⚠ TWO KINDS, AND THE LINE HAS TO BE TRUE OF BOTH (MS-212). Something
    // waiting on an answer and something that ENDED while you were not looking
    // are both reasons to open the page, and the second is the one that gets
    // dropped: an offer killed by somebody else's settlement disappears with no
    // explanation, and the member concludes the app ate it. So it counts — and
    // the sentence says which it is, because "waiting on your answer" about a
    // conversation that is already over would send somebody looking for a
    // button that is not there.
    function sentence(waiting, ended) {
        if (!ended) {
            return waiting === 1
                ? 'A swap is waiting on your answer'
                : waiting + ' swaps are waiting on your answer';
        }
        if (!waiting) {
            return ended === 1
                ? 'A swap you were in has ended'
                : ended + ' swaps you were in have ended';
        }
        return (waiting + ended) + ' swaps need a look';
    }

    function mount(waiting, ended) {
        if (!waiting && !ended) return;
        const main = document.querySelector('main');
        if (!main) return;

        const line = document.createElement('a');
        line.href = 'commitments.html';
        line.className = 'flex items-center gap-2.5 rounded-lg border border-outline-variant ' +
            'bg-surface-container-lowest px-4 py-3 text-on-surface hover:border-secondary';
        line.innerHTML =
            '<span class="material-symbols-outlined text-[19px] text-warning">swap_horiz</span>' +
            '<span class="text-[14.5px]">' + sentence(waiting, ended) + '</span>' +
            '<span class="ml-auto material-symbols-outlined text-[18px] ' +
            'text-on-surface-variant">chevron_right</span>';

        // Above the cards, below the mark. It is the only thing on this page
        // that is waiting on the reader.
        const logo = main.firstElementChild;
        if (logo && logo.nextSibling) main.insertBefore(line, logo.nextSibling);
        else main.appendChild(line);
    }

    async function count(personId, today) {
        const mine = await window.TradesStore.loadMine(window.db, {
            personId: personId, today: today,
        });
        const rows = window.TradesView.rowsFor(mine.all, {
            personId: personId, today: today,
        });
        return { waiting: rows.yours.length, ended: rows.ended.length };
    }

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    window.addEventListener('DOMContentLoaded', () => {
        if (typeof auth === 'undefined' || !window.TradesStore) return;
        auth.onAuthStateChanged(async user => {
            if (!user) return;
            try {
                const data = await getUserData(user.uid);
                const personId = (data && data.personId) || null;
                if (!personId) return;
                const seen = await count(personId, todayStr());
                mount(seen.waiting, seen.ended);
            } catch (e) {
                // Silent on purpose. See the note at the top.
                console.warn('Swap count unavailable:', e);
            }
        });
    });
}());
