/**
 * Admin account provisioning and directory (MS-694).
 * Lives on admin-dashboard.html Accounts tab; was profile.html #admin-panel.
 */

var FRESH_READ = { source: 'server' };

let adminCurrentUserUid = null;
let peopleCache = [];
let peopleCacheLoad = null;

function loadPeopleCache() {
    if (peopleCacheLoad) return peopleCacheLoad;
    peopleCacheLoad = db.collection('people').orderBy('name').get()
        .then(snap => {
            peopleCache = snap.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name || '(Unnamed)',
                email: doc.data().contact?.email || '',
                userId: doc.data().userId || null
            }));
        })
        .catch(error => {
            console.error('Error loading people for linking:', error);
            peopleCache = [];
            peopleCacheLoad = null;
        });
    return peopleCacheLoad;
}

function forgetPeopleCache() {
    peopleCacheLoad = null;
    peopleCache = [];
}

let accountsTabReady = false;

function initAdminAccountsTab() {
    const user = auth.currentUser;
    if (!user) return;
    adminCurrentUserUid = user.uid;

    if (!accountsTabReady) {
        accountsTabReady = true;
        const createUserForm = document.getElementById('create-user-form');
        const createUserStatus = document.getElementById('create-user-status');
        if (createUserForm) {
            createUserForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('new-user-email').value;
                const password = document.getElementById('new-user-password').value;
                const accountLevelId = document.getElementById('new-user-role').value;
                const level = (typeof accountLevelsForSelect === 'function'
                    ? accountLevelsForSelect().find(l => l.id === accountLevelId) : null);
                const permissionLevel = level && level.presetKey
                    ? level.presetKey
                    : accountLevelId;

                createUserStatus.textContent = 'Provisioning account...';
                createUserStatus.className = 'mt-xs text-xs font-body-md text-primary animate-pulse';

                try {
                    const createUserFunc = firebase.functions().httpsCallable('createUser');
                    await createUserFunc({
                        email,
                        password,
                        role: permissionLevel,
                        permissionLevel,
                        accountLevelId,
                    });

                    createUserStatus.textContent = 'Account successfully authorized.';
                    createUserStatus.className = 'mt-xs text-xs font-body-md text-green-600';
                    createUserForm.reset();
                    setTimeout(() => {
                        createUserStatus.textContent = '';
                    }, 5000);
                    loadUsersList();
                } catch (error) {
                    console.error(error);
                    createUserStatus.textContent = 'Authorization failed: ' + error.message;
                    createUserStatus.className = 'mt-xs text-xs font-body-md text-error';
                }
            });
        }

        const linkSearch = document.getElementById('link-search');
        if (linkSearch) {
            linkSearch.addEventListener('input', function () {
                renderLinkPeopleList(this.value);
            });
        }
    }

    if (typeof refreshAccountLevelsPanel === 'function') {
        refreshAccountLevelsPanel().then(() => loadUsersList());
    } else {
        loadUsersList();
    }
}

async function loadUsersList() {
    const usersList = document.getElementById('users-list');
    const userCount = document.getElementById('user-count');
    if (!usersList) return;

    try {
        await loadPeopleCache();
        const snapshot = await db.collection('users').orderBy('email').get();
        usersList.innerHTML = '';

        if (userCount) userCount.textContent = `${snapshot.size} account${snapshot.size === 1 ? '' : 's'}`;

        if (snapshot.empty) {
            usersList.innerHTML = '<div class="p-sm text-sm text-on-surface-variant italic">No accounts found.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const accountLevelId = typeof resolveAccountLevelIdForUser === 'function'
                ? resolveAccountLevelIdForUser(data)
                : (data.accountLevelId || data.permissionLevel || data.role || 'viewer');
            const levels = typeof accountLevelsForSelect === 'function' ? accountLevelsForSelect() : [];
            const levelMatch = levels.find(l => l.id === accountLevelId);
            const roleLabel = levelMatch
                ? (levelMatch.name || levelMatch.presetKey)
                : (data.permissionLevel || data.role || 'viewer');
            const shownLevel = data.permissionLevel || data.role || 'viewer';
            const isSelf = doc.id === adminCurrentUserUid;

            const linkedPerson = data.personId ? peopleCache.find(p => p.id === data.personId) : null;
            const linkedLabel = linkedPerson ? linkedPerson.name :
                (data.personId ? 'Linked record missing' : 'Not linked');
            const safeEmail = (data.email || '').replace(/'/g, "\\'");

            let statusColor = 'bg-outline-variant';
            if (shownLevel === 'admin' || shownLevel === 'super_admin') statusColor = 'bg-primary';
            else if (shownLevel === 'editor' || shownLevel === 'elder' || shownLevel === 'pastoral_assistant') statusColor = 'bg-secondary';
            else if (shownLevel === 'member') statusColor = 'bg-tertiary';

            const userItem = document.createElement('div');
            userItem.className = 'flex flex-col p-sm bg-surface-container-lowest hover:bg-surface-container-low transition-colors group border-b border-surface-container';
            userItem.innerHTML = `
                <div class="flex flex-wrap justify-between items-center gap-sm w-full">
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <p class="font-headline-md text-sm text-primary truncate">${data.email || 'No Email'}</p>
                        <div class="flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full ${statusColor}"></span>
                            <span class="text-[10px] font-label-md text-on-surface-variant uppercase tracking-widest">${roleLabel}</span>
                        </div>
                    </div>
                    <div class="flex gap-2 items-center flex-shrink-0">
                        <div class="relative">
                            <select onchange="updateUserAccountLevel('${doc.id}', this.value)"
                                    class="text-[11px] font-label-md tracking-wide py-1.5 pl-3 pr-8 bg-surface-container-low border border-outline-variant/30 rounded focus:ring-1 focus:ring-primary outline-none appearance-none cursor-pointer"
                                    aria-label="Account level for ${data.email || 'account'}">
                                ${(levels.length ? levels : [{ id: accountLevelId, name: roleLabel }]).map(l =>
        `<option value="${l.id}" ${l.id === accountLevelId ? 'selected' : ''}>${l.name || l.presetKey || l.id}</option>`
    ).join('')}
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
                <div class="mt-2 flex flex-wrap items-center gap-3 pt-2 border-t border-surface-container/50">
                    <div class="flex flex-col gap-1">
                        <span class="text-[9px] font-label-md text-on-surface-variant uppercase tracking-widest">Linked Person</span>
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="material-symbols-outlined text-sm ${linkedPerson ? 'text-primary' : 'text-outline'}">${linkedPerson ? 'link' : 'link_off'}</span>
                            <span class="text-[11px] font-body-md ${linkedPerson ? 'text-on-surface' : 'text-on-surface-variant italic'}">${linkedLabel}</span>
                            <button onclick="openLinkModal('${doc.id}', '${safeEmail}')" class="bg-primary/10 text-primary hover:bg-primary hover:text-on-primary text-[9px] font-label-md uppercase tracking-widest px-2 py-1.5 rounded transition-all">${linkedPerson ? 'Change' : 'Link'}</button>
                            ${linkedPerson ? `<button onclick="unlinkPerson('${doc.id}')" class="text-error/70 hover:text-error text-[9px] font-label-md uppercase tracking-widest px-2 py-1.5 rounded transition-all" title="Unlink">Unlink</button>` : ''}
                        </div>
                    </div>
                    <div class="flex flex-col gap-1 flex-grow min-w-[12rem]">
                        <span class="text-[9px] font-label-md text-on-surface-variant uppercase tracking-widest">Change Password</span>
                        <div class="flex items-center gap-2">
                            <input type="text" placeholder="New Password" id="newpass-${doc.id}" class="text-[11px] bg-surface border border-outline-variant/30 py-1 px-2 rounded w-full focus:ring-1 focus:ring-primary outline-none" />
                            <button onclick="updateUserPasswordAdmin('${doc.id}')" class="bg-secondary/10 text-secondary hover:bg-secondary hover:text-on-secondary text-[9px] font-label-md uppercase tracking-widest px-2 py-1.5 rounded transition-all whitespace-nowrap">Update</button>
                        </div>
                    </div>
                </div>
            `;
            usersList.appendChild(userItem);
        });
    } catch (error) {
        console.error('Error loading user directory:', error);
        usersList.innerHTML = `<div class="p-sm text-error text-sm font-body-md flex items-center gap-2">
            <span class="material-symbols-outlined text-sm">error</span>
            Failed to load account directory: ${error.message}
        </div>`;
    }
}

async function updateUserAccountLevel(uid, accountLevelId) {
    try {
        if (typeof assignUserAccountLevel === 'function') {
            await assignUserAccountLevel(uid, accountLevelId);
        } else {
            await db.collection('users').doc(uid).update({
                permissionLevel: accountLevelId,
                role: accountLevelId,
                pastoralAssistant: false,
            });
        }
        await countUsersPerLevel?.();
        renderLevelsList?.();
        console.log(`Account level for ${uid} updated to ${accountLevelId}`);
    } catch (error) {
        alert('Error updating account level: ' + error.message);
    }
}

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
            <button type="button" onclick="selectPersonForLink('${p.id}')"
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

async function setUserPersonLink(uid, personId) {
    const del = firebase.firestore.FieldValue.delete();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get(FRESH_READ);
    const oldPersonId = userSnap.exists ? (userSnap.data().personId || null) : null;

    const batch = db.batch();

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
    forgetPeopleCache();
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
        loadUsersList();
    } catch (error) {
        alert('Error updating password: ' + error.message);
    }
}

window.initAdminAccountsTab = initAdminAccountsTab;
window.updateUserRole = updateUserAccountLevel;
window.updateUserAccountLevel = updateUserAccountLevel;
window.openLinkModal = openLinkModal;
window.closeLinkModal = closeLinkModal;
window.renderLinkPeopleList = renderLinkPeopleList;
window.selectPersonForLink = selectPersonForLink;
window.unlinkPerson = unlinkPerson;
window.deleteUser = deleteUser;
window.updateUserPasswordAdmin = updateUserPasswordAdmin;
