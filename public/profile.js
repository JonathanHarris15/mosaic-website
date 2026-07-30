
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
            if (userData && userData.personId) {
                initMyInfo(userData.personId);
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

initProfile();
