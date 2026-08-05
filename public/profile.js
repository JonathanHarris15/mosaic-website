
/**
 * Logic for the profile page, including admin user management.
 */

// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };
let currentUserUid = null;

let isInitialAuthCheck = true;

// Cache of directory people, used to display and pick person links in the admin panel.
let peopleCache = [];

async function loadPeopleCache() {
    try {
        const snap = await db.collection('people').orderBy('name').get();
        peopleCache = snap.docs.map(doc => ({
            id: doc.id,
            name: doc.data().name || '(Unnamed)',
            email: doc.data().contact?.email || '',
            userId: doc.data().userId || null
        }));
    } catch (error) {
        console.error('Error loading people for linking:', error);
        peopleCache = [];
    }
}

async function initProfile() {
    auth.onAuthStateChanged(async (user) => {
        if (!user || user.isAnonymous) {
            // Redirect if not signed in or only signed in anonymously
            window.location.href = 'login.html';
            return;
        }

        isInitialAuthCheck = false;
        currentUserUid = user.uid;
        document.getElementById('user-email').textContent = user.email;
        
        // Fetch user permission level from Firestore
        try {
            const userData = await getUserData(user.uid);
            const permissionLevel = (userData && userData.permissionLevel) || (userData && userData.role) || 'viewer';

            // Update permission level displays
            const roleLabels = {
                'admin': 'Admin',
                'super_admin': 'Super Admin',
                'elder': 'Elder',
                'editor': 'Editor',
                'member': 'Member',
                'viewer': 'Viewer'
            };
            const permissionLevelText = roleLabels[permissionLevel] || permissionLevel.charAt(0).toUpperCase() + permissionLevel.slice(1);
            document.getElementById('user-role-badge').textContent = `${permissionLevelText} Access`;
            document.getElementById('user-role-display').textContent = permissionLevelText;

            // Show Admin Panel if admin or super_admin
            if (['admin', 'super_admin'].includes(permissionLevel)) {
                const adminPanel = document.getElementById('admin-panel');
                if (adminPanel) {
                    adminPanel.classList.remove('hidden');
                    loadUsersList();
                }
            }

            // Self-service (MS-87): a Linked User maintains their own Person's
            // contact details, birthday, and (set-once) sex. Everything else on
            // the Person — Membership Track, tags, shepherding — is read-only here
            // and enforced by the Firestore rules.
            drUser = user;
            if (userData && userData.personId) {
                drPersonId = userData.personId;
                initMyInfo(userData.personId);
            } else {
                // Not a Linked User yet. Rather than showing this person an empty
                // page and leaving them to wait for an admin to notice their
                // account, let them ask (ADR-0025).
                initLinkPanel(user);
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
            document.getElementById('user-role-badge').textContent = 'Error loading permission level';
        }
    });
}

// --- SELF-SERVICE PERSON INFO (MS-87) ---
// A Linked User edits their own Person record's self-editable fields. Sex is
// set-once: editable only while unset, then locked (an editor changes it after).
async function initMyInfo(personId) {
    const panel = document.getElementById('my-info-panel');
    const form = document.getElementById('my-info-form');
    if (!panel || !form) return;
    let sexWasUnset = true;
    try {
        const snap = await db.collection('people').doc(personId).get();
        if (!snap.exists) return;
        const p = snap.data() || {};
        const contact = p.contact || {};
        document.getElementById('my-email').value = contact.email || '';
        document.getElementById('my-phone').value = contact.phone || '';
        document.getElementById('my-address').value = contact.address || '';
        document.getElementById('my-birthday').value = p.birthday || '';
        const sexSelect = document.getElementById('my-sex');
        sexSelect.value = p.sex || '';
        sexWasUnset = !p.sex;
        if (!sexWasUnset) {
            sexSelect.disabled = true;
            document.getElementById('my-sex-locked').classList.remove('hidden');
        }
        panel.classList.remove('hidden');

        // The name is shown but not editable, with a way to ask for a spelling
        // fix; the household is proposed the same way. Both need the People
        // list to turn ids into names (ADR-0027). The photo, unlike the name,
        // goes straight in (ADR-0029).
        initMyPhoto(personId, p);
        await loadPeopleCache();
        const requests = await loadMyRequests(currentUserUid);
        renderMyName(p, requests.find(
            r => r.kind === DRC.KIND.NAME_FIX && r.status !== DRC.STATUS.APPROVED));
        await initFamilyPanel(personId, requests);
    } catch (e) {
        console.error('Error loading my info:', e);
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = document.getElementById('my-info-status');
        status.textContent = 'Saving…';
        status.className = 'text-[11px] font-body-md text-primary animate-pulse';
        // The self-editable field policy lives in ShepherdingCore so the client
        // and the Firestore rules share one allow-list — never membership, tags
        // or shepherding, and sex only while unset.
        const updates = ShepherdingCore.buildSelfEditUpdate(
            { sex: sexWasUnset ? null : 'set' },
            {
                email: document.getElementById('my-email').value,
                phone: document.getElementById('my-phone').value,
                address: document.getElementById('my-address').value,
                birthday: document.getElementById('my-birthday').value,
                sex: document.getElementById('my-sex').value,
            }
        );
        updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        try {
            await db.collection('people').doc(personId).update(updates);
            status.textContent = 'Saved.';
            status.className = 'text-[11px] font-body-md text-green-600';
            if (sexWasUnset && updates.sex) {
                sexWasUnset = false;
                document.getElementById('my-sex').disabled = true;
                document.getElementById('my-sex-locked').classList.remove('hidden');
            }
            setTimeout(() => { status.textContent = ''; }, 4000);
        } catch (err) {
            console.error('Error saving my info:', err);
            status.textContent = 'Save failed: ' + err.message;
            status.className = 'text-[11px] font-body-md text-error';
        }
    });
}

// --- MY DIRECTORY PHOTO (ADR-0029) ---
//
// Self-editable, like contact details and unlike the name: a photo is a fact
// about you that only you have, and nothing in the app reads it as an
// identifier. So there is no approval queue — it goes straight onto the Person.
//
// Framing is stored beside the image rather than baked into it, so reframing
// later edits two numbers instead of needing the original file, which most
// people no longer have.

let myPhotoCrop = null;      // the crop as saved
let myPhotoDraft = null;     // the crop being dragged, before Save framing
let myPhotoPersonId = null;

function initMyPhoto(personId, person) {
    const input = document.getElementById('my-photo-input');
    const choose = document.getElementById('my-photo-choose');
    const remove = document.getElementById('my-photo-remove');
    const reframe = document.getElementById('my-photo-reframe');
    const status = document.getElementById('my-photo-status');
    if (!input) return;

    myPhotoPersonId = personId;
    myPhotoCrop = PersonPhotoCore.normalizeCrop(person.photoCrop);
    showMyPhoto(person.photoUrl || null);

    choose.onclick = () => input.click();

    input.onchange = async () => {
        const file = input.files && input.files[0];
        input.value = ''; // so picking the same file twice still fires
        if (!file) return;

        const check = PersonPhotoCore.validatePhotoFile(file);
        if (!check.ok) {
            status.textContent = check.error;
            status.className = 'text-[11px] font-body-md text-error';
            return;
        }

        choose.disabled = true;
        closeReframer();
        status.textContent = 'Uploading…';
        status.className = 'text-[11px] font-body-md text-primary animate-pulse';
        try {
            const saved = await PersonPhotoCore.uploadPersonPhoto(db, personId, file);
            myPhotoCrop = PersonPhotoCore.normalizeCrop(saved.crop);
            showMyPhoto(saved.url);
            // A group shot in a circle almost always needs moving, so offer that
            // straight away rather than making them find the button.
            openReframer();
            status.textContent = 'Uploaded. Drag it into place.';
            status.className = 'text-[11px] font-body-md text-green-600';
        } catch (e) {
            console.error('Photo upload failed:', e);
            status.textContent = e.message || 'That upload did not work.';
            status.className = 'text-[11px] font-body-md text-error';
        } finally {
            choose.disabled = false;
        }
    };

    remove.onclick = async () => {
        if (!confirm('Remove your directory photo?')) return;
        status.textContent = 'Removing…';
        status.className = 'text-[11px] font-body-md text-primary animate-pulse';
        try {
            await PersonPhotoCore.clearPersonPhoto(db, personId);
            myPhotoCrop = PersonPhotoCore.normalizeCrop(null);
            closeReframer();
            showMyPhoto(null);
            status.textContent = '';
        } catch (e) {
            console.error('Could not remove the photo:', e);
            status.textContent = e.message || 'Could not remove that photo.';
            status.className = 'text-[11px] font-body-md text-error';
        }
    };

    reframe.onclick = openReframer;
    document.getElementById('my-photo-crop-cancel').onclick = () => {
        myPhotoDraft = null;
        applyMyPhotoStyle(myPhotoCrop);
        closeReframer();
    };
    document.getElementById('my-photo-crop-reset').onclick = () => {
        myPhotoDraft = Object.assign({}, PersonPhotoCore.DEFAULT_CROP);
        document.getElementById('my-photo-zoom').value = myPhotoDraft.zoom;
        applyMyPhotoStyle(myPhotoDraft);
    };
    document.getElementById('my-photo-crop-save').onclick = saveMyPhotoCrop;
    document.getElementById('my-photo-zoom').oninput = (e) => {
        myPhotoDraft = PersonPhotoCore.normalizeCrop(
            Object.assign({}, myPhotoDraft || myPhotoCrop, { zoom: parseFloat(e.target.value) }));
        applyMyPhotoStyle(myPhotoDraft);
    };

    wireMyPhotoDrag();
}

// Drag the picture under the frame. Pointer events so a finger on a phone works
// the same as a mouse, and pointer capture so letting go outside the small
// circle still ends the drag.
function wireMyPhotoDrag() {
    const frame = document.getElementById('my-photo-frame');
    const img = document.getElementById('my-photo-img');
    if (!frame) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    frame.addEventListener('pointerdown', (e) => {
        if (document.getElementById('my-photo-reframer').classList.contains('hidden')) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        frame.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    frame.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const size = frame.getBoundingClientRect().width;
        myPhotoDraft = PersonPhotoCore.panCrop(
            myPhotoDraft || myPhotoCrop, e.clientX - lastX, e.clientY - lastY, size);
        lastX = e.clientX;
        lastY = e.clientY;
        applyMyPhotoStyle(myPhotoDraft);
    });

    const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        try { frame.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    };
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('pointercancel', stop);
    if (img) img.addEventListener('dragstart', (e) => e.preventDefault());
}

function openReframer() {
    if (!document.getElementById('my-photo-img').src) return;
    myPhotoDraft = Object.assign({}, myPhotoCrop);
    document.getElementById('my-photo-zoom').value = myPhotoDraft.zoom;
    document.getElementById('my-photo-reframer').classList.remove('hidden');
    document.getElementById('my-photo-reframe-hint').classList.remove('hidden');
    document.getElementById('my-photo-frame').classList.add('cursor-move');
}

function closeReframer() {
    document.getElementById('my-photo-reframer').classList.add('hidden');
    document.getElementById('my-photo-reframe-hint').classList.add('hidden');
    document.getElementById('my-photo-frame').classList.remove('cursor-move');
}

async function saveMyPhotoCrop() {
    const status = document.getElementById('my-photo-status');
    status.textContent = 'Saving…';
    status.className = 'text-[11px] font-body-md text-primary animate-pulse';
    try {
        myPhotoCrop = await PersonPhotoCore.savePersonCrop(
            db, myPhotoPersonId, myPhotoDraft || myPhotoCrop);
        myPhotoDraft = null;
        applyMyPhotoStyle(myPhotoCrop);
        closeReframer();
        status.textContent = 'Framing saved.';
        status.className = 'text-[11px] font-body-md text-green-600';
        setTimeout(() => { status.textContent = ''; }, 4000);
    } catch (e) {
        console.error('Could not save the framing:', e);
        status.textContent = e.message || 'Could not save that framing.';
        status.className = 'text-[11px] font-body-md text-error';
    }
}

function applyMyPhotoStyle(crop) {
    document.getElementById('my-photo-img').style.cssText =
        'width:100%;height:100%;' + PersonPhotoCore.frameStyle(crop);
}

function showMyPhoto(url) {
    const img = document.getElementById('my-photo-img');
    const placeholder = document.getElementById('my-photo-placeholder');
    const choose = document.getElementById('my-photo-choose');
    const remove = document.getElementById('my-photo-remove');
    const reframe = document.getElementById('my-photo-reframe');

    img.classList.toggle('hidden', !url);
    placeholder.classList.toggle('hidden', !!url);
    remove.classList.toggle('hidden', !url);
    reframe.classList.toggle('hidden', !url);
    choose.textContent = url ? 'Replace photo' : 'Upload a photo';
    if (url) {
        img.src = url;
        applyMyPhotoStyle(myPhotoCrop);
    } else {
        img.removeAttribute('src');
    }
}

// --- DIRECTORY REQUESTS (ADR-0025, ADR-0027) ---
//
// The directory is editor-authored on purpose, which leaves the person it
// describes unable to fix it. A Directory Request is how they ask. Four kinds,
// one queue, all answered by an editor or elder in the Membership Directory:
//
//   link_match / link_new — for someone with no Person yet (panel below)
//   name_fix              — "my name is spelt wrong" (inside My Information)
//   family                — "this is my household" (the Family panel)
//
// This file only ever CREATES or WITHDRAWS a request. Approval is privileged
// and happens in the resolveDirectoryRequest callable.

const DRC = window.DirectoryRequestCore;

let drKind = DRC.KIND.LINK_MATCH;
let drChosenPersonId = null;
let drUser = null;
let drPersonId = null;          // the signed-in user's own Person, when linked
let drFamilies = [];

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function personName(personId) {
    const p = peopleCache.find(x => x.id === personId);
    return p ? p.name : null;
}

// Every request this user has open, by kind — so each panel can show its own
// waiting state without four separate reads.
async function loadMyRequests(uid) {
    try {
        const snap = await db.collection(DRC.REQUEST_PATH)
            .where('uid', '==', uid).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } catch (e) {
        console.error('Error loading directory requests:', e);
        return [];
    }
}

async function withdrawRequest(requestId) {
    await db.collection(DRC.REQUEST_PATH).doc(requestId).delete();
}

// ── Panel 1: connect an unlinked account to the directory ────────────────────

async function initLinkPanel(user) {
    const panel = document.getElementById('link-request-panel');
    if (!panel) return;
    drUser = user;
    panel.classList.remove('hidden');

    const mine = await loadMyRequests(user.uid);
    const request = mine.find(r => DRC.isLinkKind(r.kind) && r.status !== DRC.STATUS.APPROVED);

    if (request) {
        await loadPeopleCache();
        renderLinkState(request);
    } else {
        await showLinkForm();
    }
}

function renderLinkState(request) {
    const stateEl = document.getElementById('link-request-state');
    const formEl = document.getElementById('link-request-form');
    const icon = document.getElementById('link-request-state-icon');
    const text = document.getElementById('link-request-state-text');
    const withdraw = document.getElementById('link-request-withdraw');

    const pending = DRC.isPending(request);
    icon.textContent = pending ? 'hourglass_top' : 'info';
    icon.className = 'material-symbols-outlined ' + (pending ? 'text-primary' : 'text-error');
    text.textContent = DRC.statusMessage(request, personName);
    withdraw.textContent = pending ? 'Withdraw request' : 'Start a new request';
    withdraw.onclick = async () => {
        const status = document.getElementById('link-request-state-status');
        status.textContent = 'Working…';
        status.className = 'text-[11px] font-body-md text-primary animate-pulse';
        try {
            await withdrawRequest(request.id);
            drChosenPersonId = null;
            status.textContent = '';
            document.getElementById('lr-chosen').classList.add('hidden');
            await showLinkForm();
        } catch (e) {
            console.error('Error withdrawing request:', e);
            status.textContent = 'Could not withdraw that request: ' + e.message;
            status.className = 'text-[11px] font-body-md text-error';
        }
    };

    formEl.classList.add('hidden');
    stateEl.classList.remove('hidden');
}

async function showLinkForm() {
    document.getElementById('link-request-state').classList.add('hidden');
    document.getElementById('link-request-form').classList.remove('hidden');

    await loadPeopleCache();
    setLinkKind(DRC.KIND.LINK_MATCH);

    const search = document.getElementById('lr-search');
    search.oninput = () => renderLinkMatches(search.value);
    renderLinkMatches('');

    document.getElementById('lr-tab-match').onclick = () => setLinkKind(DRC.KIND.LINK_MATCH);
    document.getElementById('lr-tab-new').onclick = () => setLinkKind(DRC.KIND.LINK_NEW);
    document.getElementById('lr-submit').onclick = submitLinkRequest;
}

function setLinkKind(kind) {
    drKind = kind;
    const isMatch = kind === DRC.KIND.LINK_MATCH;
    const on = 'flex-1 px-3 py-2 rounded-lg border border-primary bg-primary/10 text-primary font-label-md text-[10px] uppercase tracking-widest transition-all';
    const off = 'flex-1 px-3 py-2 rounded-lg border border-outline-variant/50 text-on-surface-variant hover:text-primary font-label-md text-[10px] uppercase tracking-widest transition-all';
    document.getElementById('lr-tab-match').className = isMatch ? on : off;
    document.getElementById('lr-tab-new').className = isMatch ? off : on;
    document.getElementById('lr-match').classList.toggle('hidden', !isMatch);
    document.getElementById('lr-new').classList.toggle('hidden', isMatch);
    document.getElementById('lr-status').textContent = '';
}

// The directory is publicly readable, so a viewer can find themselves. People
// already claimed by another account are shown but not selectable — seeing the
// name is how someone realises the church has them twice.
function renderLinkMatches(query) {
    const list = document.getElementById('lr-results');
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        list.innerHTML = '<div class="px-3 py-2 text-[11px] text-on-surface-variant italic">Start typing to find your name.</div>';
        return;
    }

    const matches = peopleCache
        .filter(p => p.name.toLowerCase().includes(q) || (p.email && p.email.toLowerCase().includes(q)))
        .slice(0, 25);

    if (matches.length === 0) {
        list.innerHTML = '<div class="px-3 py-2 text-[11px] text-on-surface-variant italic">No one by that name. If you’re new here, choose “I’m not listed yet”.</div>';
        return;
    }

    list.innerHTML = matches.map(p => {
        const taken = !!p.userId;
        return `
            <button type="button" ${taken ? 'disabled' : `onclick="chooseLinkPerson('${p.id}')"`}
                    class="w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${taken ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/5'}">
                <span class="flex flex-col">
                    <span class="text-sm text-on-surface">${escapeHtml(p.name)}</span>
                    ${p.email ? `<span class="text-[10px] text-on-surface-variant">${escapeHtml(p.email)}</span>` : ''}
                </span>
                ${taken ? '<span class="text-[9px] font-label-md uppercase tracking-widest text-on-surface-variant whitespace-nowrap">Already claimed</span>' : ''}
            </button>
        `;
    }).join('');
}

function chooseLinkPerson(personId) {
    const person = peopleCache.find(p => p.id === personId);
    if (!person) return;
    drChosenPersonId = personId;

    const chosen = document.getElementById('lr-chosen');
    chosen.classList.remove('hidden');
    chosen.classList.add('flex');
    chosen.innerHTML = `
        <span class="material-symbols-outlined text-primary text-base">check_circle</span>
        <span>You’ve chosen <strong>${escapeHtml(person.name)}</strong>.</span>
    `;

    // Close the dropdown. The chip above is now the answer, so leaving a list of
    // other names open under it just invites a second click. Emptying the list
    // hides it outright (the container is `empty:hidden`); the search box is
    // cleared with it, because it is a search rather than the chosen value.
    document.getElementById('lr-search').value = '';
    document.getElementById('lr-results').innerHTML = '';
    document.getElementById('lr-status').textContent = '';
}

async function submitLinkRequest() {
    const status = document.getElementById('lr-status');
    const button = document.getElementById('lr-submit');

    const draft = {
        uid: drUser.uid,
        email: drUser.email || '',
        kind: drKind,
        personId: drKind === DRC.KIND.LINK_MATCH ? drChosenPersonId : null,
        note: document.getElementById('lr-note').value,
        proposed: {
            name: document.getElementById('lr-name').value,
            email: document.getElementById('lr-email').value || drUser.email || '',
            phone: document.getElementById('lr-phone').value,
            address: document.getElementById('lr-address').value,
            birthday: document.getElementById('lr-birthday').value,
            sex: document.getElementById('lr-sex').value,
        },
    };

    const check = DRC.validateDraft(draft);
    if (!check.ok) {
        status.textContent = check.error;
        status.className = 'text-[11px] font-body-md text-error';
        return;
    }

    button.disabled = true;
    status.textContent = 'Sending…';
    status.className = 'text-[11px] font-body-md text-primary animate-pulse';

    try {
        const doc = DRC.buildRequest(draft);
        doc.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const id = DRC.requestId(drUser.uid, drKind);
        await db.collection(DRC.REQUEST_PATH).doc(id).set(doc);
        renderLinkState(Object.assign({ id: id }, doc));
    } catch (e) {
        console.error('Error sending request:', e);
        status.textContent = 'Could not send that request: ' + e.message;
        status.className = 'text-[11px] font-body-md text-error';
    } finally {
        button.disabled = false;
    }
}

// ── Panel 2: the name, and asking for a spelling fix ─────────────────────────
//
// The name is NOT self-editable — it is how the whole church refers to this
// person, and a member renaming themselves silently would break every place a
// name is read. But being unable to correct your own misspelt name is worse, so
// it is shown here, read-only, with a way to ask.

function renderMyName(person, pending) {
    const nameEl = document.getElementById('my-name-value');
    const askBtn = document.getElementById('my-name-ask');
    const form = document.getElementById('my-name-form');
    const state = document.getElementById('my-name-pending');
    if (!nameEl) return;

    nameEl.textContent = person.name || '(no name on record)';

    if (pending) {
        askBtn.classList.add('hidden');
        form.classList.add('hidden');
        state.classList.remove('hidden');
        document.getElementById('my-name-pending-text').textContent =
            DRC.statusMessage(pending, personName);
        document.getElementById('my-name-withdraw').onclick = async () => {
            await withdrawRequest(pending.id);
            renderMyName(person, null);
        };
        return;
    }

    state.classList.add('hidden');
    form.classList.add('hidden');
    askBtn.classList.remove('hidden');
    askBtn.onclick = () => {
        askBtn.classList.add('hidden');
        form.classList.remove('hidden');
        document.getElementById('my-name-input').value = person.name || '';
        document.getElementById('my-name-input').focus();
    };
    document.getElementById('my-name-cancel').onclick = () => {
        form.classList.add('hidden');
        askBtn.classList.remove('hidden');
        document.getElementById('my-name-status').textContent = '';
    };
    document.getElementById('my-name-send').onclick = () => submitNameFix(person);
}

async function submitNameFix(person) {
    const status = document.getElementById('my-name-status');
    const draft = {
        uid: drUser.uid,
        email: drUser.email || '',
        kind: DRC.KIND.NAME_FIX,
        personId: drPersonId,
        currentName: person.name || '',
        proposed: { name: document.getElementById('my-name-input').value },
        note: '',
    };

    const check = DRC.validateDraft(draft);
    if (!check.ok) {
        status.textContent = check.error;
        status.className = 'text-[11px] font-body-md text-error';
        return;
    }

    status.textContent = 'Sending…';
    status.className = 'text-[11px] font-body-md text-primary animate-pulse';
    try {
        const doc = DRC.buildRequest(draft);
        doc.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const id = DRC.requestId(drUser.uid, DRC.KIND.NAME_FIX);
        await db.collection(DRC.REQUEST_PATH).doc(id).set(doc);
        status.textContent = '';
        renderMyName(person, Object.assign({ id: id }, doc));
    } catch (e) {
        console.error('Error requesting a name fix:', e);
        status.textContent = 'Could not send that request: ' + e.message;
        status.className = 'text-[11px] font-body-md text-error';
    }
}

// ── Panel 3: my family ───────────────────────────────────────────────────────
//
// A Family is editor-authored (ADR-0012) and its shape has real rules — one
// husband, one wife, a Person is a child in at most one Family. So a member
// does not edit it; they propose one relation at a time, and approval REPLAYS
// the proposal through the same FamilyCore planners the directory uses. A
// proposal that the planner could never apply is therefore never approvable,
// and the member finds that out from the approver rather than from a silent
// no-op.

async function initFamilyPanel(personId, requests) {
    const panel = document.getElementById('my-family-panel');
    if (!panel) return;
    panel.classList.remove('hidden');

    try {
        const snap = await db.collection('families').get();
        drFamilies = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } catch (e) {
        console.error('Error loading families:', e);
        drFamilies = [];
    }

    renderFamily(personId, requests.filter(r => r.kind === DRC.KIND.FAMILY));

    const search = document.getElementById('fam-search');
    search.oninput = () => renderFamilyCandidates(personId, search.value);
    document.getElementById('fam-relation').onchange = () =>
        renderFamilyCandidates(personId, search.value);
    renderFamilyCandidates(personId, '');
}

function relationRow(label, otherId, relation, pendingRemoval) {
    const name = personName(otherId) || '(record missing)';
    if (pendingRemoval) {
        return `
            <div class="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-surface-container last:border-b-0 opacity-60">
                <span><span class="text-on-surface-variant">${escapeHtml(label)}</span> ${escapeHtml(name)}</span>
                <span class="text-[10px] font-label-md uppercase tracking-widest text-on-surface-variant">Removal requested</span>
            </div>`;
    }
    return `
        <div class="flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-surface-container last:border-b-0">
            <span><span class="text-on-surface-variant">${escapeHtml(label)}</span> ${escapeHtml(name)}</span>
            <button type="button" onclick="askFamilyChange('remove','${relation}','${otherId}')"
                    class="text-error/70 hover:text-error text-[9px] font-label-md uppercase tracking-widest px-2 py-1 rounded transition-all">Ask to remove</button>
        </div>`;
}

function renderFamily(personId, familyRequests) {
    const list = document.getElementById('fam-current');
    const rel = FamilyCore.resolveRelations(drFamilies, personId);
    const pendingRemove = {};
    for (const r of familyRequests) {
        if (DRC.isPending(r) && r.family && r.family.op === 'remove') {
            pendingRemove[r.family.otherId] = true;
        }
    }

    const rows = [];
    if (rel.spouseId) rows.push(relationRow('Spouse', rel.spouseId, 'spouse', pendingRemove[rel.spouseId]));
    for (const id of rel.parentIds) rows.push(relationRow('Parent', id, 'parent', pendingRemove[id]));
    for (const id of rel.childIds) rows.push(relationRow('Child', id, 'child', pendingRemove[id]));

    list.innerHTML = rows.length ? rows.join('') :
        '<div class="px-3 py-3 text-[11px] italic text-on-surface-variant">We have no household recorded for you yet.</div>';

    // Requests still waiting, so nobody asks twice for the same thing.
    const waiting = familyRequests.filter(r => DRC.isPending(r) || r.status === DRC.STATUS.DECLINED);
    const waitEl = document.getElementById('fam-pending');
    waitEl.innerHTML = waiting.map(r => `
        <div class="flex items-center justify-between gap-2 px-3 py-2 text-[11px] border-b border-surface-container last:border-b-0">
            <span class="${r.status === DRC.STATUS.DECLINED ? 'text-error' : 'text-on-surface-variant'}">${escapeHtml(DRC.statusMessage(r, personName))}</span>
            <button type="button" onclick="withdrawFamilyRequest('${r.id}')"
                    class="text-on-surface-variant hover:text-primary text-[9px] font-label-md uppercase tracking-widest px-2 py-1 whitespace-nowrap">Withdraw</button>
        </div>
    `).join('');
}

// Who can be offered. Nobody already in the relation, never yourself, and never
// somebody whose record another account has claimed as a different relation —
// the planner would refuse those anyway, so offering them would be a promise we
// cannot keep.
function renderFamilyCandidates(personId, query) {
    const list = document.getElementById('fam-results');
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        list.innerHTML = '<div class="px-3 py-2 text-[11px] text-on-surface-variant italic">Search for the person.</div>';
        return;
    }
    const rel = FamilyCore.resolveRelations(drFamilies, personId);
    const already = new Set([personId, rel.spouseId].concat(rel.parentIds, rel.childIds).filter(Boolean));

    const matches = peopleCache
        .filter(p => !already.has(p.id) && p.name.toLowerCase().includes(q))
        .slice(0, 20);

    list.innerHTML = matches.length ? matches.map(p => `
        <button type="button" onclick="askFamilyChangeFromPicker('${p.id}')"
                class="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 transition-colors border-b border-surface-container last:border-b-0">
            ${escapeHtml(p.name)}
        </button>
    `).join('') : '<div class="px-3 py-2 text-[11px] italic text-on-surface-variant">No one by that name.</div>';
}

function askFamilyChangeFromPicker(otherId) {
    askFamilyChange('add', document.getElementById('fam-relation').value, otherId);
}

async function askFamilyChange(op, relation, otherId) {
    const status = document.getElementById('fam-status');
    const draft = {
        uid: drUser.uid,
        email: drUser.email || '',
        kind: DRC.KIND.FAMILY,
        personId: drPersonId,
        family: { op: op, relation: relation, otherId: otherId },
        note: '',
    };

    const check = DRC.validateDraft(draft);
    if (!check.ok) {
        status.textContent = check.error;
        status.className = 'text-[11px] font-body-md text-error';
        return;
    }

    status.textContent = 'Sending…';
    status.className = 'text-[11px] font-body-md text-primary animate-pulse';
    try {
        const doc = DRC.buildRequest(draft);
        doc.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const id = DRC.requestId(drUser.uid, DRC.KIND.FAMILY, doc.family);
        await db.collection(DRC.REQUEST_PATH).doc(id).set(doc);
        document.getElementById('fam-search').value = '';
        renderFamilyCandidates(drPersonId, '');
        status.textContent = 'Sent. Someone from the church will confirm it.';
        status.className = 'text-[11px] font-body-md text-green-600';
        const mine = await loadMyRequests(drUser.uid);
        renderFamily(drPersonId, mine.filter(r => r.kind === DRC.KIND.FAMILY));
    } catch (e) {
        console.error('Error requesting a family change:', e);
        status.textContent = 'Could not send that request: ' + e.message;
        status.className = 'text-[11px] font-body-md text-error';
    }
}

async function withdrawFamilyRequest(requestId) {
    try {
        await withdrawRequest(requestId);
        const mine = await loadMyRequests(drUser.uid);
        renderFamily(drPersonId, mine.filter(r => r.kind === DRC.KIND.FAMILY));
    } catch (e) {
        console.error('Error withdrawing family request:', e);
    }
}

// --- SELF PASSWORD CHANGE ---
const changePasswordForm = document.getElementById('change-password-form');
const changePasswordStatus = document.getElementById('change-password-status');

if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('old-password').value;
        const newPassword = document.getElementById('new-password').value;

        changePasswordStatus.textContent = 'Updating password...';
        changePasswordStatus.className = 'text-[10px] font-body-md text-primary animate-pulse';

        try {
            const updateSelfPasswordFunc = firebase.functions().httpsCallable('updateUserPasswordSelf');
            await updateSelfPasswordFunc({ oldPassword, newPassword });
            
            changePasswordStatus.textContent = 'Password updated successfully.';
            changePasswordStatus.className = 'text-[10px] font-body-md text-green-600';
            changePasswordForm.reset();
            setTimeout(() => {
                changePasswordStatus.textContent = '';
            }, 5000);
        } catch (error) {
            console.error(error);
            changePasswordStatus.textContent = 'Update failed: ' + error.message;
            changePasswordStatus.className = 'text-[10px] font-body-md text-error';
        }
    });
}

// --- SELF ACCOUNT DELETION ---
// Deletes the LOGIN, not the member. The Person record is the church's
// membership record and survives — see tearDownLogin in functions/index.js.
// The password is re-checked here rather than trusting the session, so a phone
// left unlocked on a pew can't be used to delete someone's account.
const deleteAccountForm = document.getElementById('delete-account-form');
const deleteAccountStatus = document.getElementById('delete-account-status');

if (deleteAccountForm) {
    deleteAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = auth.currentUser;
        if (!user) return;

        const password = document.getElementById('delete-account-password').value;
        const btn = document.getElementById('delete-account-btn');

        if (!confirm('Delete your account?\n\nYou will be signed out and will not be able to sign in again. Your membership record stays with the church.\n\nThis cannot be undone.')) {
            return;
        }

        btn.disabled = true;
        deleteAccountStatus.textContent = 'Deleting your account...';
        deleteAccountStatus.className = 'text-[10px] font-body-md text-primary animate-pulse';

        try {
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
            await user.reauthenticateWithCredential(credential);

            const deleteOwnAccountFunc = firebase.functions().httpsCallable('deleteOwnAccount');
            await deleteOwnAccountFunc({});

            // The Auth user is gone server-side; drop the stale local session
            // before leaving, or the login page sees a signed-in ghost.
            await auth.signOut();
            window.location.href = 'login.html';
        } catch (error) {
            console.error(error);
            const wrongPassword = error.code === 'auth/wrong-password' ||
                error.code === 'auth/invalid-credential';
            deleteAccountStatus.textContent = wrongPassword ?
                'That password is not correct.' :
                'Could not delete account: ' + error.message;
            deleteAccountStatus.className = 'text-[10px] font-body-md text-error';
            btn.disabled = false;
        }
    });
}

// --- ADMIN: CREATE USER ---
const createUserForm = document.getElementById('create-user-form');
const createUserStatus = document.getElementById('create-user-status');

if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('new-user-email').value;
        const password = document.getElementById('new-user-password').value;
        const permissionLevel = document.getElementById('new-user-role').value;

        createUserStatus.textContent = 'Provisioning account...';
        createUserStatus.className = 'mt-sm text-xs font-body-md text-primary animate-pulse';

        try {
            const createUserFunc = firebase.functions().httpsCallable('createUser');
            await createUserFunc({ email, password, role: permissionLevel });
            
            createUserStatus.textContent = 'Account successfully authorized.';
            createUserStatus.className = 'mt-sm text-xs font-body-md text-green-600';
            createUserForm.reset();
            setTimeout(() => {
                createUserStatus.textContent = '';
            }, 5000);
            loadUsersList();
        } catch (error) {
            console.error(error);
            createUserStatus.textContent = 'Authorization failed: ' + error.message;
            createUserStatus.className = 'mt-sm text-xs font-body-md text-error';
        }
    });
}

// --- ADMIN: LOAD USERS ---
async function loadUsersList() {
    const usersList = document.getElementById('users-list');
    const userCount = document.getElementById('user-count');
    if (!usersList) return;

    try {
        await loadPeopleCache();
        const snapshot = await db.collection('users').orderBy('email').get();
        usersList.innerHTML = '';

        if (userCount) userCount.textContent = `${snapshot.size} Active Accounts`;

        if (snapshot.empty) {
            usersList.innerHTML = '<div class="p-md text-sm text-on-surface-variant italic">No accounts found.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const permissionLevel = data.permissionLevel || data.role || 'viewer';
            const roleLabels = {
                'admin': 'Admin',
                'super_admin': 'Super Admin',
                'elder': 'Elder',
                'editor': 'Editor',
                'member': 'Member',
                'viewer': 'Viewer'
            };
            const roleLabel = roleLabels[permissionLevel] || permissionLevel.charAt(0).toUpperCase() + permissionLevel.slice(1);
            const isSelf = doc.id === currentUserUid;

            // Linked directory person (if any)
            const linkedPerson = data.personId ? peopleCache.find(p => p.id === data.personId) : null;
            const linkedLabel = linkedPerson ? linkedPerson.name :
                (data.personId ? 'Linked record missing' : 'Not linked');
            const safeEmail = (data.email || '').replace(/'/g, "\\'");

            // Status color logic
            let statusColor = 'bg-outline-variant';
            if (permissionLevel === 'admin' || permissionLevel === 'super_admin') statusColor = 'bg-primary';
            else if (permissionLevel === 'editor' || permissionLevel === 'elder') statusColor = 'bg-secondary';
            else if (permissionLevel === 'member') statusColor = 'bg-tertiary';

            const userItem = document.createElement('div');
            userItem.className = 'flex flex-col p-md bg-surface-container-lowest hover:bg-surface-container-low transition-colors group border-b border-surface-container';
            userItem.innerHTML = `
                <div class="flex justify-between items-center w-full">
                    <div class="flex flex-col gap-0.5">
                        <p class="font-headline-md text-sm text-primary group-hover:text-primary-container transition-colors">${data.email || 'No Email'}</p>
                        <div class="flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full ${statusColor}"></span>
                            <span class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest">${roleLabel}</span>
                        </div>
                    </div>
                    <div class="flex gap-3 items-center">
                        <div class="relative">
                            <select onchange="updateUserRole('${doc.id}', this.value)" 
                                    class="text-[11px] font-label-md uppercase tracking-wider py-1.5 pl-3 pr-8 bg-surface-container-low border border-outline-variant/30 rounded focus:ring-1 focus:ring-primary outline-none appearance-none cursor-pointer">
                                <option value="viewer" ${permissionLevel === 'viewer' ? 'selected' : ''}>Viewer</option>
                                <option value="member" ${permissionLevel === 'member' ? 'selected' : ''}>Member</option>
                                <option value="editor" ${permissionLevel === 'editor' ? 'selected' : ''}>Editor</option>
                                <option value="elder" ${permissionLevel === 'elder' ? 'selected' : ''}>Elder</option>
                                <option value="admin" ${permissionLevel === 'admin' ? 'selected' : ''}>Admin</option>
                                <option value="super_admin" ${permissionLevel === 'super_admin' ? 'selected' : ''}>Super Admin</option>
                            </select>
                            <span class="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none text-outline">expand_more</span>
                        </div>
                        ${!isSelf ? `
                            <button onclick="deleteUser('${doc.id}', '${safeEmail}')" class="text-error hover:bg-error-container/20 p-1 rounded transition-colors" title="Delete User">
                                <span class="material-symbols-outlined text-sm">delete</span>
                            </button>
                        ` : '<span class="text-[10px] font-label-md text-outline italic">Self</span>'}
                    </div>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-4 pt-3 border-t border-surface-container/50">
                    <div class="flex flex-col gap-1">
                        <span class="text-[9px] font-label-md text-on-surface-variant uppercase tracking-widest">Linked Person</span>
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm ${linkedPerson ? 'text-primary' : 'text-outline'}">${linkedPerson ? 'link' : 'link_off'}</span>
                            <span class="text-[11px] font-body-md ${linkedPerson ? 'text-on-surface' : 'text-on-surface-variant italic'}">${linkedLabel}</span>
                            <button onclick="openLinkModal('${doc.id}', '${safeEmail}')" class="bg-primary/10 text-primary hover:bg-primary hover:text-on-primary text-[9px] font-label-md uppercase tracking-widest px-2 py-1.5 rounded transition-all">${linkedPerson ? 'Change' : 'Link'}</button>
                            ${linkedPerson ? `<button onclick="unlinkPerson('${doc.id}')" class="text-error/70 hover:text-error text-[9px] font-label-md uppercase tracking-widest px-2 py-1.5 rounded transition-all" title="Unlink">Unlink</button>` : ''}
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <span class="text-[9px] font-label-md text-on-surface-variant uppercase tracking-widest">Password Visibility</span>
                        <div class="flex items-center gap-2">
                            <input type="password" readonly value="${data.password || ''}" id="pass-${doc.id}" class="text-[11px] font-mono bg-surface-container border-none py-1 px-2 rounded w-32 focus:ring-0" placeholder="••••••••" />
                            <button onclick="togglePasswordVisibility('pass-${doc.id}', this)" class="text-outline hover:text-primary transition-colors" title="Toggle Visibility">
                                <span class="material-symbols-outlined text-xs">visibility</span>
                            </button>
                            <button onclick="copyToClipboard('pass-${doc.id}')" class="text-outline hover:text-primary transition-colors">
                                <span class="material-symbols-outlined text-xs">content_copy</span>
                            </button>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1 flex-grow">
                        <span class="text-[9px] font-label-md text-on-surface-variant uppercase tracking-widest">Change Password</span>
                        <div class="flex items-center gap-2">
                            <input type="text" placeholder="New Password" id="newpass-${doc.id}" class="text-[11px] bg-surface border border-outline-variant/30 py-1 px-2 rounded w-full focus:ring-1 focus:ring-primary outline-none" />
                            <button onclick="updateUserPasswordAdmin('${doc.id}')" class="bg-secondary/10 text-secondary hover:bg-secondary hover:text-on-secondary text-[9px] font-label-md uppercase tracking-widest px-2 py-1.5 rounded transition-all">Update</button>
                        </div>
                    </div>
                </div>
            `;
            usersList.appendChild(userItem);
        });
    } catch (error) {
        console.error("Error loading user directory:", error);
        usersList.innerHTML = `<div class="p-md text-error text-sm font-body-md flex items-center gap-2">
            <span class="material-symbols-outlined text-sm">error</span>
            Failed to load account directory: ${error.message}
        </div>`;
    }
}

// --- ADMIN ACTIONS ---
async function updateUserRole(uid, newRole) {
    try {
        await db.collection('users').doc(uid).update({ permissionLevel: newRole, role: newRole });
        console.log(`Role for ${uid} updated to ${newRole}`);
    } catch (error) {
        alert('Error updating permission level: ' + error.message);
    }
}

// --- ADMIN: LINK USER <-> DIRECTORY PERSON ---
let linkTargetUid = null;

function openLinkModal(uid, email) {
    linkTargetUid = uid;
    const modal = document.getElementById('link-modal');
    const subtitle = document.getElementById('link-modal-subtitle');
    const search = document.getElementById('link-search');
    if (subtitle) subtitle.textContent = email || '';
    if (search) search.value = '';
    renderLinkPeopleList('');
    if (modal) modal.classList.remove('hidden');
    if (search) search.focus();
}

function closeLinkModal() {
    linkTargetUid = null;
    const modal = document.getElementById('link-modal');
    if (modal) modal.classList.add('hidden');
}

function renderLinkPeopleList(query) {
    const list = document.getElementById('link-people-list');
    if (!list) return;
    const q = (query || '').toLowerCase().trim();
    const matches = peopleCache.filter(p =>
        !q || p.name.toLowerCase().includes(q) || (p.email && p.email.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
        list.innerHTML = '<div class="p-4 text-sm text-on-surface-variant italic text-center">No matching people.</div>';
        return;
    }

    list.innerHTML = matches.map(p => {
        const takenByOther = p.userId && p.userId !== linkTargetUid;
        return `
            <button onclick="selectPersonForLink('${p.id}')"
                    class="w-full text-left px-4 py-2.5 hover:bg-primary-fixed transition-colors flex items-center justify-between gap-2 border-b border-surface-container/50">
                <span class="flex flex-col">
                    <span class="text-sm text-on-surface">${p.name}</span>
                    ${p.email ? `<span class="text-[10px] text-on-surface-variant">${p.email}</span>` : ''}
                </span>
                ${takenByOther ? '<span class="text-[9px] font-label-md uppercase tracking-widest text-error/70 whitespace-nowrap">Linked elsewhere</span>' : ''}
            </button>
        `;
    }).join('');
}

async function selectPersonForLink(personId) {
    if (!linkTargetUid) return;
    const uid = linkTargetUid;
    try {
        await setUserPersonLink(uid, personId);
        closeLinkModal();
        await loadUsersList();
    } catch (error) {
        console.error('Error linking person:', error);
        alert('Error linking person: ' + error.message);
    }
}

async function unlinkPerson(uid) {
    if (!confirm('Unlink this account from its directory person? Existing member tags/roles are left as-is.')) return;
    try {
        await setUserPersonLink(uid, '');
        await loadUsersList();
    } catch (error) {
        console.error('Error unlinking person:', error);
        alert('Error unlinking person: ' + error.message);
    }
}

/**
 * Writes the reciprocal users/{uid}.personId <-> people/{personId}.userId link,
 * clearing any prior link on either side first. The Cloud Functions triggers
 * then reconcile the member tag / role from these writes.
 */
async function setUserPersonLink(uid, personId) {
    const del = firebase.firestore.FieldValue.delete();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get(FRESH_READ);
    const oldPersonId = userSnap.exists ? (userSnap.data().personId || null) : null;

    const batch = db.batch();

    // Clear the back-reference on the person this user used to point at.
    if (oldPersonId && oldPersonId !== personId) {
        const oldPersonSnap = await db.collection('people').doc(oldPersonId).get(FRESH_READ);
        if (oldPersonSnap.exists) {
            batch.update(db.collection('people').doc(oldPersonId), { userId: del });
        }
    }

    if (personId) {
        const personRef = db.collection('people').doc(personId);
        const personSnap = await personRef.get(FRESH_READ);
        if (!personSnap.exists) throw new Error('Selected person no longer exists.');

        // If that person was already linked to a different user, clear that user's link.
        const priorUserId = personSnap.data().userId || null;
        if (priorUserId && priorUserId !== uid) {
            batch.update(db.collection('users').doc(priorUserId), { personId: del });
        }

        batch.update(userRef, { personId });
        batch.update(personRef, { userId: uid });
    } else {
        batch.update(userRef, { personId: del });
    }

    await batch.commit();
}

async function deleteUser(uid, email) {
    if (!confirm(`Are you sure you want to delete ${email}? This action cannot be undone.`)) return;
    
    try {
        const deleteUserFunc = firebase.functions().httpsCallable('deleteUser');
        await deleteUserFunc({ uid });
        loadUsersList();
    } catch (error) {
        alert('Error deleting user: ' + error.message);
    }
}

async function updateUserPasswordAdmin(uid) {
    const newPasswordInput = document.getElementById(`newpass-${uid}`);
    const newPassword = newPasswordInput.value;
    
    if (!newPassword) {
        alert('Please enter a new password.');
        return;
    }

    try {
        const updatePasswordFunc = firebase.functions().httpsCallable('updateUserPasswordAdmin');
        await updatePasswordFunc({ uid, newPassword });
        newPasswordInput.value = '';
        alert('Password updated successfully.');
        loadUsersList(); // Reload to see the new password in the input
    } catch (error) {
        alert('Error updating password: ' + error.message);
    }
}

// --- UTILITIES ---
function copyToClipboard(elementId) {
    const copyText = document.getElementById(elementId);
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyText.value);
}

function togglePasswordVisibility(elementId, btn) {
    const input = document.getElementById(elementId);
    const icon = btn.querySelector('.material-symbols-outlined');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        input.type = 'password';
        icon.textContent = 'visibility';
    }
}

// Global scope for handlers
window.updateUserRole = updateUserRole;
window.openLinkModal = openLinkModal;
window.closeLinkModal = closeLinkModal;
window.renderLinkPeopleList = renderLinkPeopleList;
window.selectPersonForLink = selectPersonForLink;
window.unlinkPerson = unlinkPerson;
window.deleteUser = deleteUser;
window.updateUserPasswordAdmin = updateUserPasswordAdmin;
window.copyToClipboard = copyToClipboard;
window.togglePasswordVisibility = togglePasswordVisibility;
window.chooseLinkPerson = chooseLinkPerson;
window.askFamilyChange = askFamilyChange;
window.askFamilyChangeFromPicker = askFamilyChangeFromPicker;
window.withdrawFamilyRequest = withdrawFamilyRequest;

initProfile();
