// One Trade, as a row somebody can read and act on (MS-190, MS-216).
//
// `trade-core` says what is legal; this says what it LOOKS like from where you
// are standing. Every screen renders what this returns and decides nothing.
//
// ⚠ THE SAME DOCUMENT READS DIFFERENTLY FROM EACH END, and getting that wrong
// is the whole difficulty of the page. "You asked Sarah" and "Bob asked you"
// are one Trade in one state. So the row is always built FOR somebody, and the
// first thing it works out is whether the next move is theirs.
//
// ⚠ THE SPLIT IS WHOSE MOVE IT IS, NOT WHO STARTED IT. Who opened a
// conversation is a fact about the past and tells a reader nothing about what to
// do now. An invitation you received and an offer you received both need an
// answer from you today, and they belong together — even though one of them you
// began and the other you did not.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./trade-core.js')
        : global.TradeCore;

    const Roles = (typeof require !== 'undefined')
        ? require('./roles-core.js')
        : global.RolesCore;

    // What somebody may do to this Trade from where they stand. Advisory: the
    // callable checks it all again, and the server's answer is the wall.
    function actionsFor(trade, personId) {
        const none = {
            offer: false, refuse: false, accept: false, withdraw: false,
        };
        if (!trade || !personId) return none;
        if (Core.waitingOn(trade) === null) return none;

        const holder = trade.holderId === personId;
        const opener = trade.origin === Core.ORIGINS.INVITATION
            ? trade.holderId : trade.counterpartyId;

        // ⚠ YOU TAKE YOUR WORDS BACK WHILE YOU ARE WAITING; ONCE IT IS YOUR
        // MOVE, YOU ANSWER. Bob invites Sarah, Sarah offers, and now Bob has
        // both a Refuse and a Withdraw that do almost the same thing — except
        // Refuse tells her no and Withdraw says "never mind" and leaves her
        // guessing. Two buttons for one act is clutter, and the honest one wins.
        //
        // trade-core permits both; this narrows what is OFFERED, which is the
        // right way round. A screen may show less than the rules allow.
        const canWithdraw = personId === opener &&
            Core.waitingOn(trade) !== personId;

        if (trade.state === Core.STATES.INVITED) {
            return {
                // Replying means putting your own dates up — or none at all,
                // which settles it outright rather than waiting to be accepted.
                offer: !holder,
                refuse: !holder,
                accept: false,
                withdraw: canWithdraw,
            };
        }
        if (trade.state === Core.STATES.OFFERED) {
            return {
                offer: false,
                refuse: holder,
                accept: holder,
                withdraw: canWithdraw,
            };
        }
        return none;
    }

    // How it reads. Written from the reader's side of the conversation, in the
    // words they would use about it themselves.
    function wordingFor(trade, personId, nameOf) {
        const name = nameOf || (id => id);
        const holder = trade.holderId === personId;
        const other = holder ? trade.counterpartyId : trade.holderId;
        const them = name(other);
        const place = trade.roleName || trade.assignment.roleSlug;
        const count = (trade.offered || []).length;

        if (trade.state === Core.STATES.INVITED) {
            return holder
                ? {
                    headline: 'You asked ' + them,
                    detail: 'Waiting to hear back about ' + place + '.',
                }
                : {
                    headline: them + ' asked you',
                    detail: 'They cannot make ' + place + '. You can offer one ' +
                        'of your own dates in return, or simply take it.',
                };
        }

        if (trade.state === Core.STATES.OFFERED) {
            return holder
                ? {
                    headline: them + ' will swap',
                    detail: count === 1
                        ? 'They will take ' + place + ' if you take theirs.'
                        : 'They will take ' + place + ' if you take one of ' +
                          'these ' + count + '.',
                }
                : {
                    headline: 'You offered ' + them + ' ' +
                        (count === 1 ? 'a date' : count + ' dates'),
                    detail: 'Waiting on them to pick one.',
                };
        }

        // Ended. Said in the past tense, and said at all — an offer that simply
        // stops being answered teaches somebody not to make the next one.
        if (trade.state === Core.STATES.SETTLED) {
            return {
                headline: 'Sorted with ' + them,
                detail: holder
                    ? them + ' has ' + place + ' now.'
                    : 'You have ' + place + ' now.',
            };
        }
        if (trade.state === Core.STATES.REFUSED) {
            return {
                headline: holder ? them + ' said no' : 'You said no',
                detail: 'Nothing changed. ' + place + ' is still ' +
                    (holder ? 'yours' : 'theirs') + '.',
            };
        }
        // Withdrawn. Either the person who opened it took their words back, or
        // it was killed from outside the conversation — and those want quite
        // different sentences, because they leave the reader with different
        // thoughts about what to do next (MS-212).
        if (trade.closedBecause === Core.CAUSES.SETTLED) {
            return {
                headline: 'Sorted another way',
                detail: place + ' found somebody else while this was open.',
            };
        }
        if (trade.closedBecause === Core.CAUSES.FILLED) {
            return {
                headline: 'Somebody else was put in',
                detail: 'An editor filled ' + place + '. Nothing you could ' +
                    'have done faster.',
            };
        }
        if (trade.closedBecause === Core.CAUSES.GONE) {
            return {
                headline: 'That place has gone',
                detail: place + ' is no longer on the Event.',
            };
        }
        if (trade.closedBecause === Core.CAUSES.KEPT) {
            return {
                headline: holder ? 'You kept it' : them + ' kept it',
                detail: (holder ? 'You are' : 'They are') + ' doing ' + place +
                    ' after all, so there is nothing to cover.',
            };
        }
        return { headline: 'Taken back', detail: 'Nothing changed.' };
    }

    // One Trade as a row. `today` decides whether it is still live at all.
    function rowFor(trade, options) {
        const opts = options || {};
        const personId = opts.personId;
        const waiting = Core.waitingOn(trade);
        const words = wordingFor(trade, personId, opts.nameOf);

        return {
            id: trade.id,
            key: trade.id,
            mine: trade.holderId === personId,
            // The one thing the page sorts on. Null once it has ended.
            waitingOnYou: !!waiting && waiting === personId,
            waitingOnThem: !!waiting && waiting !== personId,
            over: waiting === null,
            headline: words.headline,
            detail: words.detail,
            can: actionsFor(trade, personId),
            offered: trade.offered || [],
            assignment: trade.assignment,
            eventName: trade.eventName,
            roleName: trade.roleName || trade.assignment.roleSlug,
            date: trade.assignment && trade.assignment.date,
            otherId: trade.holderId === personId
                ? trade.counterpartyId : trade.holderId,
        };
    }

    // Everything a person has going, as rows, split by whose move it is — plus
    // the ones that have ENDED and which this reader has not yet been told about
    // (MS-212).
    //
    // ⚠ THE ENDED ONES ARE A SEPARATE LIST, NOT A THIRD SORT ORDER. They want
    // nothing from the reader except to be read, and mixing a thing you must
    // answer with a thing you must merely notice is how both get ignored.
    function rowsFor(trades, options) {
        const opts = options || {};
        const all = trades || [];
        const rows = Core.liveOnes(all, opts.today).map(t => rowFor(t, opts));
        const ended = Core.noticesFor(all, opts.personId, opts.today)
            .map(t => rowFor(t, opts));

        return {
            all: rows.concat(ended),
            live: rows,
            // Waiting on you first, always. This is a page somebody opens
            // because something needs them, and burying that under what they
            // are waiting for would make them hunt for it.
            yours: rows.filter(r => r.waitingOnYou),
            theirs: rows.filter(r => r.waitingOnThem),
            ended: ended,
        };
    }

    // How many things this person has not seen — the whole notification
    // (MS-215). Both halves count: something waiting on an answer, and something
    // that ended while they were not looking. The second is the one the first
    // cut missed, and it is the one that matters more — a person who is never
    // told their offer died concludes the app ate it.
    function needingYou(trades, options) {
        const rows = rowsFor(trades, options);
        return rows.yours.length + rows.ended.length;
    }

    // ── Who can be asked ─────────────────────────────────────────────────────

    // ⚠ HIDDEN MEANS ABSENT, NOT DISABLED (ADR-0021 §1). Somebody Inactive, or
    // hidden by a tag, must not appear at all: a greyed row saying why they
    // cannot help still prints the name the tag exists to hide, which is the tag
    // failing at the one job it has. `RolesCore.assignablePeople` already holds
    // that rule and this must not grow a second copy of it.
    //
    // People with NO LINKED ACCOUNT are offered anyway, and that is deliberate.
    // They cannot answer in the app today — so the sender is warned — but MS-189
    // will text exactly those people, and a picker that excluded them would have
    // to be unpicked. Withdraw is what makes an unanswerable invitation harmless.
    function askableFrom(people, options) {
        const opts = options || {};
        const already = opts.alreadyAsked || [];
        return Roles.assignablePeople(people, {
            rank: opts.rank, hidingTags: opts.hidingTags,
        }).filter(p =>
            p.id !== opts.personId && already.indexOf(p.id) === -1);
    }

    // Who is already in a conversation about this place — they cannot be asked
    // twice, and the picker should not offer them at all rather than refusing
    // after the tap.
    function alreadyAsked(trades, assignment, today) {
        return Core.liveOnes(trades || [], today)
            .filter(t => Core.sameAssignment(t.assignment, assignment))
            .map(t => t.counterpartyId);
    }

    // How many more people may be asked. Zero renders the picker's own reason
    // rather than an empty list.
    function invitesLeft(trades, assignment, today) {
        return Math.max(0, Core.MAX_INVITATIONS -
            Core.liveInvitationCount(trades, assignment, today));
    }

    const TradesView = {
        actionsFor,
        wordingFor,
        rowFor,
        rowsFor,
        needingYou,
        askableFrom,
        alreadyAsked,
        invitesLeft,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TradesView;
    } else {
        global.TradesView = TradesView;
    }
}(typeof window !== 'undefined' ? window : globalThis));
