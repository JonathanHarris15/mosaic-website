
/**
 * Logic for the profile page, including admin user management.
 */

let currentUserUid = null;

let isInitialAuthCheck = true;

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
        
        // Fetch user role from Firestore
        try {
            const userData = await getUserData(user.uid);
            const role = (userData && userData.role) || 'viewer';
            
            // Update role displays
            const roleLabels = {
                'admin': 'Admin',
                'super_admin': 'Super Admin',
                'elder': 'Elder',
                'editor': 'Editor',
                'viewer': 'Viewer'
            };
            const roleText = roleLabels[role] || role.charAt(0).toUpperCase() + role.slice(1);
            document.getElementById('user-role-badge').textContent = `${roleText} Access`;
            document.getElementById('user-role-display').textContent = roleText;

            // Show Hymn Manager button if editor, elder, admin, or super_admin
            if (['editor', 'elder', 'admin', 'super_admin'].includes(role)) {
                const managerBtn = document.getElementById('hymn-manager-btn');
                if (managerBtn) managerBtn.classList.remove('hidden');
                
                const peoplesBtn = document.getElementById('peoples-manager-btn');
                if (peoplesBtn) peoplesBtn.classList.remove('hidden');
            }

            // Show Admin Panel if admin or super_admin
            if (['admin', 'super_admin'].includes(role)) {
                const adminPanel = document.getElementById('admin-panel');
                if (adminPanel) {
                    adminPanel.classList.remove('hidden');
                    loadUsersList();
                }
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
            document.getElementById('user-role-badge').textContent = 'Error loading role';
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

// --- ADMIN: CREATE USER ---
const createUserForm = document.getElementById('create-user-form');
const createUserStatus = document.getElementById('create-user-status');

if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('new-user-email').value;
        const password = document.getElementById('new-user-password').value;
        const role = document.getElementById('new-user-role').value;

        createUserStatus.textContent = 'Provisionsing staff account...';
        createUserStatus.className = 'mt-sm text-xs font-body-md text-primary animate-pulse';

        try {
            const createUserFunc = firebase.functions().httpsCallable('createUser');
            await createUserFunc({ email, password, role });
            
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
        const snapshot = await db.collection('users').orderBy('email').get();
        usersList.innerHTML = '';
        
        if (userCount) userCount.textContent = `${snapshot.size} Active Accounts`;

        if (snapshot.empty) {
            usersList.innerHTML = '<div class="p-md text-sm text-on-surface-variant italic">No staff accounts found.</div>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const role = data.role || 'viewer';
            const roleLabels = {
                'admin': 'Admin',
                'super_admin': 'Super Admin',
                'elder': 'Elder',
                'editor': 'Editor',
                'viewer': 'Viewer'
            };
            const roleLabel = roleLabels[role] || role.charAt(0).toUpperCase() + role.slice(1);
            const isSelf = doc.id === currentUserUid;
            
            // Status color logic
            let statusColor = 'bg-outline-variant';
            if (role === 'admin' || role === 'super_admin') statusColor = 'bg-primary';
            else if (role === 'editor' || role === 'elder') statusColor = 'bg-secondary';

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
                                <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option>
                                <option value="editor" ${role === 'editor' ? 'selected' : ''}>Editor</option>
                                <option value="elder" ${role === 'elder' ? 'selected' : ''}>Elder</option>
                                <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                                <option value="super_admin" ${role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
                            </select>
                            <span class="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none text-outline">expand_more</span>
                        </div>
                        ${!isSelf ? `
                            <button onclick="deleteUser('${doc.id}', '${data.email}')" class="text-error hover:bg-error-container/20 p-1 rounded transition-colors" title="Delete User">
                                <span class="material-symbols-outlined text-sm">delete</span>
                            </button>
                        ` : '<span class="text-[10px] font-label-md text-outline italic">Self</span>'}
                    </div>
                </div>
                <div class="mt-3 flex items-center gap-4 pt-3 border-t border-surface-container/50">
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
            Failed to load staff directory: ${error.message}
        </div>`;
    }
}

// --- ADMIN ACTIONS ---
async function updateUserRole(uid, newRole) {
    try {
        await db.collection('users').doc(uid).update({ role: newRole });
        console.log(`Role for ${uid} updated to ${newRole}`);
    } catch (error) {
        alert('Error updating role: ' + error.message);
    }
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
window.deleteUser = deleteUser;
window.updateUserPasswordAdmin = updateUserPasswordAdmin;
window.copyToClipboard = copyToClipboard;
window.togglePasswordVisibility = togglePasswordVisibility;

initProfile();
