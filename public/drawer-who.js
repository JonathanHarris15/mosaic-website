// Who the hamburger drawer says you are — one builder for the home dashboard
// and the shared desktop header lead (MS-714).
//
// Directory Photo (ADR-0029) belongs in the drawer head beside name and role.
// The phone shell and app already fetch the linked Person's photoUrl; the desktop
// drawer must not be the one surface that still guesses from initials alone.

(function (global) {
    'use strict';

    const Photo = (typeof require === 'function')
        ? require('./person-photo-core.js')
        : (global && global.PersonPhotoCore);

    function initialsFor(name, Destinations) {
        if (Destinations && typeof Destinations.initials === 'function') {
            return Destinations.initials(name);
        }
        if (Photo && typeof Photo.initialsOf === 'function') {
            return Photo.initialsOf(name);
        }
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    /** Prefer the linked Person's name, then the user doc, then email — same
     *  chain as mobile-shell-header.js so the two drawers cannot disagree. */
    async function displayName(user, userData, db) {
        let name = (userData && (userData.name || userData.displayName))
            || (user && user.displayName)
            || 'Friend';
        if (user && user.email && name === 'Friend') {
            const local = user.email.split('@')[0];
            name = local.charAt(0).toUpperCase() + local.slice(1);
        }
        const personId = userData && userData.personId;
        if (!personId || !db) return name;
        try {
            const personDoc = await db.collection('people').doc(personId).get();
            const personName = personDoc.exists
                ? String(personDoc.data().name || '').trim() : '';
            if (personName) name = personName.split(/\s+/)[0];
        } catch (e) {
            console.error('Error fetching linked person for drawer:', e);
        }
        return name;
    }

    async function linkedPersonPhoto(db, personId) {
        if (!personId || !db) return { photoUrl: null, photoCrop: null };
        try {
            const personDoc = await db.collection('people').doc(personId).get();
            const p = personDoc.exists ? personDoc.data() : {};
            return {
                photoUrl: p.photoUrl || null,
                photoCrop: p.photoCrop || null,
            };
        } catch (e) {
            console.error('Error fetching directory photo for drawer:', e);
            return { photoUrl: null, photoCrop: null };
        }
    }

    /**
     * @param {object} opts
     *   account       AccessCore-shaped account for role label
     *   name          display name
     *   photoUrl      Directory Photo when linked
     *   photoCrop     framing for the photo
     *   Destinations  MosaicDestinations when loaded
     */
    function build(opts) {
        const account = opts.account;
        const name = opts.name || 'Friend';
        const Destinations = opts.Destinations
            || (global && global.MosaicDestinations);
        return {
            name,
            role: Destinations ? Destinations.accountLabel(account) : '',
            initials: initialsFor(name, Destinations),
            href: 'profile.html',
            photoUrl: opts.photoUrl || null,
            photoCrop: opts.photoCrop || null,
        };
    }

    async function fromSession(user, userData, db) {
        const name = await displayName(user, userData, db);
        const photo = await linkedPersonPhoto(db, userData && userData.personId);
        const permissionLevel = (userData && (userData.permissionLevel || userData.role))
            || 'viewer';
        const pastoralAssistant = userData && userData.pastoralAssistant === true;
        const account = (typeof DashboardNav !== 'undefined')
            ? DashboardNav.accountOf({ permissionLevel, pastoralAssistant })
            : { permissionLevel, pastoralAssistant };
        return build({
            account,
            name,
            photoUrl: photo.photoUrl,
            photoCrop: photo.photoCrop,
        });
    }

    const DrawerWho = {
        initialsFor,
        displayName,
        linkedPersonPhoto,
        build,
        fromSession,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = DrawerWho;
    if (global) global.DrawerWho = DrawerWho;
}(typeof window !== 'undefined' ? window : null));
