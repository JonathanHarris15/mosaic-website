
/**
 * Logic for the profile page, including admin user management.
 */

async function initProfile() {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        document.getElementById('user-email').textContent = user.email;
        
        // Fetch user role from Firestore
        const userData = await getUserData(user.uid);
        const role = (userData && userData.role) || 'viewer';
        document.getElementById('user-role').textContent = role.charAt(0).toUpperCase() + role.slice(1);

        // Show Hymn Manager button if editor or admin
        if (role === 'editor' || role === 'admin') {
            document.getElementById('hymn-manager-btn').classList.remove('hidden');
        }

        // Show Admin Panel if admin
        if (role === 'admin') {
            document.getElementById('admin-panel').classList.remove('hidden');
            loadUsersList();
        }
    });
}

const createUserForm = document.getElementById('create-user-form');
const createUserStatus = document.getElementById('create-user-status');

if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('new-user-email').value;
        const password = document.getElementById('new-user-password').value;
        const role = document.getElementById('new-user-role').value;

        createUserStatus.textContent = 'Creating user...';
        createUserStatus.className = 'text-sm font-body-md text-primary';

        try {
            // Since we don't have a backend function yet, we'll suggest creating one.
            // For now, we'll try to use a callable function if it exists,
            // otherwise explain that it needs to be implemented.
            const createUserFunc = firebase.functions().httpsCallable('createUser');
            const result = await createUserFunc({ email, password, role });
            
            createUserStatus.textContent = 'User created successfully!';
            createUserStatus.className = 'text-sm font-body-md text-green-600';
            createUserForm.reset();
            loadUsersList();
        } catch (error) {
            console.error(error);
            createUserStatus.textContent = 'Error: ' + error.message;
            createUserStatus.className = 'text-sm font-body-md text-error';
        }
    });
}

async function loadUsersList() {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;

    usersList.innerHTML = '<p class="text-sm italic">Loading users...</p>';

    try {
        const snapshot = await db.collection('users').get();
        usersList.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const userItem = document.createElement('div');
            userItem.className = 'flex justify-between items-center p-sm bg-white border border-outline-variant rounded-lg';
            userItem.innerHTML = `
                <div>
                    <p class="font-bold text-sm">${data.email || 'No Email'}</p>
                    <p class="text-xs text-on-surface-variant">Role: ${data.role}</p>
                </div>
                <div class="flex gap-2">
                    <select onchange="updateUserRole('${doc.id}', this.value)" class="text-xs rounded border-outline-variant">
                        <option value="viewer" ${data.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                        <option value="editor" ${data.role === 'editor' ? 'selected' : ''}>Editor</option>
                        <option value="admin" ${data.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>
            `;
            usersList.appendChild(userItem);
        });
    } catch (error) {
        usersList.innerHTML = '<p class="text-error text-sm">Error loading users: ' + error.message + '</p>';
    }
}

async function updateUserRole(uid, newRole) {
    try {
        await db.collection('users').doc(uid).update({ role: newRole });
        alert('Role updated successfully');
    } catch (error) {
        alert('Error updating role: ' + error.message);
    }
}

// Global scope for the onchange handler
window.updateUserRole = updateUserRole;

initProfile();
