/**
 * Account levels editor — Discord classic Variant A (MS-695).
 * Requires permission-catalog.js, account-levels-core.js, Firestore.
 */

/* global AccountLevelsCore, PermissionCatalog, db */

let levelsCache = [];
let selectedLevelId = null;
let levelMemberCounts = {};

async function ensureBuiltinLevelsSeeded() {
    const Levels = AccountLevelsCore;
    const writes = Levels.seedBuiltinLevelDocs();
    const batch = db.batch();
    writes.forEach(({ id, data }) => {
        batch.set(db.collection('account_levels').doc(id), data, { merge: true });
    });
    await batch.commit();
}

async function loadAccountLevels() {
    await ensureBuiltinLevelsSeeded();
    const snap = await db.collection('account_levels').orderBy('name').get();
    levelsCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return levelsCache;
}

async function countUsersPerLevel() {
    const snap = await db.collection('users').get();
    levelMemberCounts = {};
    snap.forEach(doc => {
        const data = doc.data();
        const id = data.accountLevelId
            || AccountLevelsCore.accountLevelIdForPreset(
                AccountLevelsCore.presetKeyFromPermissionLevel(
                    data.permissionLevel || data.role || 'viewer'));
        levelMemberCounts[id] = (levelMemberCounts[id] || 0) + 1;
    });
}

function levelLabel(level) {
    return level.name || level.presetKey || level.id;
}

function isKeyLocked(level, key) {
    const locked = level.lockedKeys || [];
    if (locked.includes(key)) return true;
    if (level.system && level.presetKey) {
        const presetLocked = AccountLevelsCore.LOCKED_KEYS_BY_PRESET[level.presetKey] || [];
        return presetLocked.includes(key);
    }
    return false;
}

function renderLevelsList() {
    const list = document.getElementById('perm-levels-list');
    if (!list) return;
    list.innerHTML = levelsCache.map(level => {
        const active = level.id === selectedLevelId ? ' perm-role--active' : '';
        const badge = level.system ? 'System' : 'Custom';
        const count = levelMemberCounts[level.id] || 0;
        const meta = `${count} account${count === 1 ? '' : 's'}`;
        return `<li>
            <button type="button" class="perm-role${active}" data-level-id="${level.id}">
                <span class="perm-role__badge">${badge}</span>
                <div>
                    <div class="perm-role__name">${levelLabel(level)}</div>
                    <div class="perm-role__meta">${meta}${level.system && level.presetKey === 'pastoral_assistant' ? ' · locked rules' : ''}</div>
                </div>
            </button>
        </li>`;
    }).join('');
    list.querySelectorAll('[data-level-id]').forEach(btn => {
        btn.addEventListener('click', () => selectLevel(btn.getAttribute('data-level-id')));
    });
}

function renderPermissionEditor() {
    const host = document.getElementById('perm-level-editor');
    if (!host) return;
    const level = levelsCache.find(l => l.id === selectedLevelId);
    if (!level) {
        host.innerHTML = '<p class="text-sm text-on-surface-variant">Select an account level to edit its permissions.</p>';
        return;
    }
    const lockedNote = level.presetKey === 'pastoral_assistant'
        ? `<div class="perm-callout"><span class="material-symbols-outlined">lock</span>
            <div>System preset — elder-equivalent access. <strong>count_as_elder</strong> and <strong>be_assignee</strong> stay off.</div></div>`
        : '';
    const canEdit = !level.system || level.custom;
    const cats = PermissionCatalog.CATEGORIES.map(cat => {
        const rows = cat.keys.map(key => {
            const on = level.permissions && level.permissions[key] === true;
            const locked = isKeyLocked(level, key);
            const toggleClass = on ? 'perm-toggle perm-toggle--on' : 'perm-toggle';
            const rowClass = locked ? 'perm-row perm-row--locked' : 'perm-row';
            const label = PermissionCatalog.LABELS[key] || key;
            const control = locked
                ? `<span class="material-symbols-outlined" style="font-size:16px;color:var(--on-surface-variant)">lock</span>`
                : `<button type="button" class="${toggleClass}" data-perm-key="${key}" ${canEdit ? '' : 'disabled'} aria-pressed="${on}"></button>`;
            return `<div class="${rowClass}">
                <div class="perm-row__label">${label}<small>${key}</small></div>
                ${control}
            </div>`;
        }).join('');
        return `<div class="perm-cat">
            <p class="perm-cat__title"><span class="material-symbols-outlined" style="font-size:18px">${cat.icon}</span> ${cat.title}</p>
            <div class="perm-grid">${rows}</div>
        </div>`;
    }).join('');

    host.innerHTML = `
        <h4 class="font-headline-md text-primary text-lg m-0 mb-1">${levelLabel(level)}</h4>
        <p class="text-sm text-on-surface-variant m-0 mb-3">${level.system ? 'System preset' : 'Custom level'}${canEdit ? '' : ' — permissions are fixed.'}</p>
        ${lockedNote}
        ${cats}
        ${level.custom ? '<button type="button" id="perm-delete-level" class="m-btn m-btn--quiet m-btn--sm mt-sm text-error">Delete custom level</button>' : ''}
    `;

    host.querySelectorAll('[data-perm-key]').forEach(btn => {
        btn.addEventListener('click', () => toggleLevelPermission(level.id, btn.getAttribute('data-perm-key')));
    });
    const del = document.getElementById('perm-delete-level');
    if (del) del.addEventListener('click', () => deleteCustomLevel(level.id));
}

async function selectLevel(levelId) {
    selectedLevelId = levelId;
    renderLevelsList();
    renderPermissionEditor();
}

async function toggleLevelPermission(levelId, key) {
    const level = levelsCache.find(l => l.id === levelId);
    if (!level || level.system && !level.custom) return;
    if (isKeyLocked(level, key)) return;
    const perms = Object.assign(PermissionCatalog.emptyPermissions(), level.permissions || {});
    perms[key] = !perms[key];
    await db.collection('account_levels').doc(levelId).update({ permissions: perms });
    level.permissions = perms;
    renderPermissionEditor();
}

async function cloneCustomLevel() {
    const source = levelsCache.find(l => l.id === selectedLevelId) || levelsCache[0];
    if (!source) return;
    const name = prompt('Name for the new custom level', `${levelLabel(source)} copy`);
    if (!name || !name.trim()) return;
    const data = AccountLevelsCore.clonePresetAsCustom(source.presetKey || 'editor', name.trim());
    const ref = await db.collection('account_levels').add(data);
    await loadAccountLevels();
    await countUsersPerLevel();
    await selectLevel(ref.id);
    renderLevelsList();
}

async function deleteCustomLevel(levelId) {
    const level = levelsCache.find(l => l.id === levelId);
    if (!level || !level.custom) return;
    const count = levelMemberCounts[levelId] || 0;
    if (count > 0) {
        alert('Move accounts off this level before deleting it.');
        return;
    }
    if (!confirm(`Delete custom level "${levelLabel(level)}"?`)) return;
    await db.collection('account_levels').doc(levelId).delete();
    selectedLevelId = AccountLevelsCore.BUILTIN_LEVEL_IDS.editor;
    await refreshAccountLevelsPanel();
}

function populateProvisionLevelSelect() {
    const sel = document.getElementById('new-user-role');
    if (!sel) return;
    const levels = accountLevelsForSelect();
    sel.innerHTML = levels.map(l =>
        `<option value="${l.id}">${levelLabel(l)}</option>`).join('');
    const member = levels.find(l => l.presetKey === 'member');
    if (member) sel.value = member.id;
}

async function refreshAccountLevelsPanel() {
    await loadAccountLevels();
    await countUsersPerLevel();
    if (!selectedLevelId && levelsCache.length) {
        selectedLevelId = levelsCache[0].id;
    }
    populateProvisionLevelSelect();
    renderLevelsList();
    renderPermissionEditor();
}

function accountLevelsForSelect() {
    return levelsCache.slice().sort((a, b) => levelLabel(a).localeCompare(levelLabel(b)));
}

function resolveAccountLevelIdForUser(data) {
    if (data.accountLevelId) return data.accountLevelId;
    const preset = AccountLevelsCore.presetKeyFromPermissionLevel(
        data.permissionLevel || data.role || 'viewer');
    if (data.pastoralAssistant === true
        && preset !== 'pastoral_assistant' && preset !== 'elder' && preset !== 'super_admin') {
        return AccountLevelsCore.BUILTIN_LEVEL_IDS.pastoral_assistant;
    }
    return AccountLevelsCore.accountLevelIdForPreset(preset);
}

async function assignUserAccountLevel(uid, accountLevelId) {
    const level = levelsCache.find(l => l.id === accountLevelId);
    const levelData = level || {
        presetKey: AccountLevelsCore.presetKeyFromAccountLevelId(accountLevelId),
    };
    const write = AccountLevelsCore.userWriteFromLevel(accountLevelId, levelData);
    await db.collection('users').doc(uid).update(write);
}

window.ensureBuiltinLevelsSeeded = ensureBuiltinLevelsSeeded;
window.loadAccountLevels = loadAccountLevels;
window.refreshAccountLevelsPanel = refreshAccountLevelsPanel;
window.accountLevelsForSelect = accountLevelsForSelect;
window.resolveAccountLevelIdForUser = resolveAccountLevelIdForUser;
window.assignUserAccountLevel = assignUserAccountLevel;
window.cloneCustomLevel = cloneCustomLevel;
window.countUsersPerLevel = countUsersPerLevel;
window.renderLevelsList = renderLevelsList;
