// Shared inline trigger plugin: # (add tag), -# (remove tag), $$ (status matrix)
// Requires window._TipTap before calling createInlineTriggersExtension.

function _buildStatusMatrixPopup({ anchorCoords, currentStatus, onSelect }) {
    // Status value model from shepherding-core.js; the inline `$$` matrix uses
    // the tiny label variant.
    const UL = ShepherdingCore.URGENCY_LEVELS;
    const IL = ShepherdingCore.IMPORTANCE_LEVELS;
    const ULbl = ShepherdingCore.URGENCY_LABEL_TINY;
    const ILbl = ShepherdingCore.IMPORTANCE_LABEL_TINY;

    const popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:10px;font-family:"Work Sans",sans-serif;font-size:12px;';

    const hdrRow = document.createElement('div');
    hdrRow.style.cssText = 'display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;';
    hdrRow.appendChild(document.createElement('div'));
    UL.forEach(u => {
        const h = document.createElement('div');
        h.style.cssText = 'text-align:center;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#75777f;';
        h.textContent = ULbl[u];
        hdrRow.appendChild(h);
    });
    popup.appendChild(hdrRow);

    IL.forEach(imp => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;padding-right:4px;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#75777f;line-height:1.2;text-align:right;';
        lbl.textContent = ILbl[imp];
        row.appendChild(lbl);
        UL.forEach(urg => {
            const active = currentStatus?.urgency === urg && currentStatus?.importance === imp;
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.style.cssText = `width:44px;height:44px;border-radius:6px;border:2px solid ${active ? '#001a43' : '#c5c6d0'};background:${active ? '#001a43' : 'transparent'};cursor:pointer;display:flex;align-items:center;justify-content:center;`;
            if (active) {
                const dot = document.createElement('span');
                dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#fff;display:block;';
                cell.appendChild(dot);
            }
            cell.addEventListener('mousedown', e => { e.preventDefault(); popup.remove(); onSelect(urg, imp); });
            row.appendChild(cell);
        });
        popup.appendChild(row);
    });

    const clr = document.createElement('button');
    clr.type = 'button';
    clr.style.cssText = 'width:100%;margin-top:6px;padding:4px 8px;font-size:11px;font-family:inherit;color:#75777f;background:transparent;border:none;cursor:pointer;text-align:center;';
    clr.textContent = currentStatus ? 'Clear status' : '(No status set)';
    if (currentStatus) clr.addEventListener('mousedown', e => { e.preventDefault(); popup.remove(); onSelect(null, null); });
    else clr.style.opacity = '0.5';
    popup.appendChild(clr);

    popup.style.top  = `${anchorCoords.bottom + 4}px`;
    popup.style.left = `${Math.min(anchorCoords.left, window.innerWidth - 220)}px`;
    document.body.appendChild(popup);
    return popup;
}

// ── Action chip node (atomic, single-backspace delete) ────────────────────────

function _createActionChipNode(onChipDeleted) {
    const { Node, Plugin } = window._TipTap;

    return Node.create({
        name: 'actionChip',
        group: 'inline',
        inline: true,
        atom: true,
        selectable: true,

        addAttributes() {
            return {
                chipId:         { default: '' },
                chipKind:       { default: 'tag' },   // 'tag' | 'status'
                action:         { default: null },     // 'added' | 'removed' (tag only)
                tagId:          { default: null },
                tagName:        { default: null },
                urgency:        { default: null },
                importance:     { default: null },
                prevUrgency:    { default: null },
                prevImportance: { default: null },
                label:          { default: '' },
                chipColor:      { default: '#d8e2ff' },
            };
        },

        parseHTML() { return [{ tag: 'span[data-action-chip]' }]; },

        renderHTML({ node }) {
            const a = node.attrs;
            return ['span', {
                'data-action-chip':    '',
                'data-chip-id':        a.chipId,
                'data-chip-kind':      a.chipKind,
                'data-action':         a.action         || '',
                'data-tag-id':         a.tagId          || '',
                'data-tag-name':       a.tagName        || '',
                'data-urgency':        a.urgency        || '',
                'data-importance':     a.importance     || '',
                'data-prev-urgency':   a.prevUrgency    || '',
                'data-prev-importance':a.prevImportance || '',
                style: `display:inline;background:${a.chipColor};padding:0 4px;border-radius:3px;font-weight:600;font-size:0.9em;`,
            }, a.label];
        },

        addNodeView() {
            return ({ node }) => {
                const dom = document.createElement('span');
                dom.style.cssText = `display:inline;background:${node.attrs.chipColor};padding:1px 6px;border-radius:3px;font-weight:600;font-size:0.875em;cursor:default;user-select:none;`;
                dom.contentEditable = 'false';
                dom.textContent = node.attrs.label;
                return { dom, contentDOM: null };
            };
        },

        addProseMirrorPlugins() {
            return [new Plugin({
                view() {
                    return {
                        update(view, prevState) {
                            if (prevState.doc.eq(view.state.doc)) return;

                            const prevChips = new Map();
                            prevState.doc.descendants(n => {
                                if (n.type.name === 'actionChip') prevChips.set(n.attrs.chipId, { ...n.attrs });
                            });

                            const newChipIds = new Set();
                            view.state.doc.descendants(n => {
                                if (n.type.name === 'actionChip') newChipIds.add(n.attrs.chipId);
                            });

                            for (const [chipId, attrs] of prevChips) {
                                if (!newChipIds.has(chipId)) onChipDeleted(attrs);
                            }
                        },
                    };
                },
            })];
        },
    });
}

// ── Main factory ──────────────────────────────────────────────────────────────

function createInlineTriggersExtension(config) {
    // config: { personId, getAllTags, getPersonTags, getCurrentStatus,
    //           createTag, onTagAdd, onTagRemove, onStatusChange }
    // onStatusChange(urgency|null, importance|null) — null means clear

    function onChipDeleted(attrs) {
        try {
            if (attrs.chipKind === 'tag') {
                if (attrs.action === 'added') {
                    config.onTagRemove(attrs.tagId, attrs.tagName).catch(e => console.error('Revert tag add:', e));
                } else if (attrs.action === 'removed') {
                    config.onTagAdd(attrs.tagId, attrs.tagName).catch(e => console.error('Revert tag remove:', e));
                }
            } else if (attrs.chipKind === 'status') {
                config.onStatusChange(attrs.prevUrgency || null, attrs.prevImportance || null)
                    .catch(e => console.error('Revert status:', e));
            }
        } catch (e) { console.error('onChipDeleted error:', e); }
    }

    const { Extension, Plugin, PluginKey } = window._TipTap;
    const ActionChipNode = _createActionChipNode(onChipDeleted);
    const pluginKey = new PluginKey('inlineTriggers_' + config.personId);

    let phase = null;       // null | 'tag-add' | 'tag-remove'
    let triggerFrom = 0;
    let phaseStart  = 0;
    let popup = null;
    let statusPopup = null;
    let edView = null;
    let selIdx = 0;

    function getQuery() {
        if (!edView || !phase) return '';
        try {
            const cur = edView.state.selection.from;
            if (cur <= phaseStart) return '';
            return edView.state.doc.textBetween(phaseStart, Math.min(cur, edView.state.doc.content.size));
        } catch { return ''; }
    }

    function getItems() {
        const q = getQuery().toLowerCase().trim();
        const all = config.getAllTags();
        if (phase === 'tag-add') {
            const filtered = all.filter(t => t.name.toLowerCase().includes(q));
            if (q && !all.some(t => t.name.toLowerCase() === q)) {
                filtered.push({ id: '__create__', name: q, isCreate: true });
            }
            return filtered.slice(0, 10);
        }
        if (phase === 'tag-remove') {
            const applied = config.getPersonTags();
            return all.filter(t => applied.includes(t.id) && t.name.toLowerCase().includes(q)).slice(0, 10);
        }
        return [];
    }

    function reset() {
        phase = null;
        popup?.remove(); popup = null;
        statusPopup?.remove(); statusPopup = null;
        selIdx = 0;
    }

    function redraw() {
        popup?.remove(); popup = null;
        if (!phase || !edView) return;
        const items = getItems();
        let coords = null;
        try { coords = edView.coordsAtPos(edView.state.selection.from); } catch {}
        if (!coords) return;

        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:200px;max-height:280px;overflow-y:auto;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
        el.style.left = `${Math.min(coords.left, window.innerWidth - 220)}px`;
        el.style.top  = `${coords.bottom + 4}px`;

        const hdr = document.createElement('div');
        hdr.style.cssText = 'padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#75777f;';
        hdr.textContent = phase === 'tag-add' ? 'Add tag' : 'Remove tag';
        el.appendChild(hdr);

        if (!items.length) {
            const msg = document.createElement('div');
            msg.style.cssText = 'padding:8px 16px;color:#75777f;font-style:italic;';
            msg.textContent = phase === 'tag-remove' ? 'No tags applied' : 'Type to search or create';
            el.appendChild(msg);
        } else {
            items.forEach((item, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const sel = i === selIdx;
                btn.style.cssText = `display:block;width:100%;text-align:left;padding:6px 16px;cursor:pointer;border:none;background:${sel ? '#d8e2ff' : 'transparent'};color:${sel ? '#001a42' : '#1c1c18'};font-size:14px;font-family:inherit;`;
                btn.textContent = item.isCreate ? `Create tag "#${item.name}"` : `#${item.name}`;
                btn.addEventListener('mousedown', ev => { ev.preventDefault(); selectItem(item); });
                el.appendChild(btn);
            });
        }

        document.body.appendChild(el);
        popup = el;
    }

    function _insertTagChip(view, pos, tagId, tagName, action) {
        try {
            const chipType = view.state.schema.nodes.actionChip;
            if (!chipType) return;
            const node = chipType.create({
                chipId:    'chip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                chipKind:  'tag',
                action,
                tagId,
                tagName,
                label:     action === 'added' ? `#${tagName}` : `−#${tagName}`,
                chipColor: action === 'added' ? '#d8e2ff' : '#e5e2dc',
            });
            view.dispatch(view.state.tr.insert(Math.max(0, pos), node).setStoredMarks([]));
        } catch (e) { console.error('Insert tag chip:', e); }
    }

    function _insertStatusChip(view, urgency, importance, prevUrgency, prevImportance) {
        try {
            const chipType = view.state.schema.nodes.actionChip;
            if (!chipType) return;
            const UL = { urgent: 'Urgent', somewhat_urgent: 'Somewhat', not_urgent: 'Not Urgent' };
            const IL = { important: 'Important', somewhat_important: 'Somewhat', not_important: 'Not Imp.' };
            const label = (urgency && importance) ? `● ${UL[urgency]} · ${IL[importance]}` : `● Cleared`;
            const node = chipType.create({
                chipId:        'chip_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                chipKind:      'status',
                urgency:       urgency    || null,
                importance:    importance || null,
                prevUrgency:   prevUrgency    || null,
                prevImportance:prevImportance || null,
                label,
                chipColor: '#fef9c3',
            });
            const pos = view.state.selection.from;
            view.dispatch(view.state.tr.insert(Math.max(0, pos), node).setStoredMarks([]));
        } catch (e) { console.error('Insert status chip:', e); }
    }

    async function selectItem(item) {
        if (!edView) return;
        const currentPhase = phase;
        const view = edView;
        const from = triggerFrom;
        const to = Math.min(view.state.selection.from, view.state.doc.content.size);
        try { view.dispatch(view.state.tr.delete(from, to)); } catch {}
        reset();

        if (currentPhase === 'tag-add') {
            let tagId = item.id, tagName = item.name;
            if (item.isCreate) {
                try { const t = await config.createTag(tagName); tagId = t.id; tagName = t.name; }
                catch (e) { console.error('Error creating tag:', e); return; }
            }
            _insertTagChip(view, from, tagId, tagName, 'added');
            await config.onTagAdd(tagId, tagName);
        } else if (currentPhase === 'tag-remove') {
            _insertTagChip(view, from, item.id, item.name, 'removed');
            await config.onTagRemove(item.id, item.name);
        }
    }

    function openStatusMatrix(view) {
        statusPopup?.remove(); statusPopup = null;
        const capturedView = view;
        const previousStatus = config.getCurrentStatus();
        let coords = null;
        try { coords = view.coordsAtPos(view.state.selection.from); } catch {}
        if (!coords) return;

        statusPopup = _buildStatusMatrixPopup({
            anchorCoords: coords,
            currentStatus: previousStatus,
            onSelect: async (urg, imp) => {
                statusPopup = null;
                await config.onStatusChange(urg, imp);
                _insertStatusChip(capturedView, urg, imp, previousStatus?.urgency, previousStatus?.importance);
            },
        });

        const closeOnOutside = ev => {
            if (statusPopup && !statusPopup.contains(ev.target)) {
                statusPopup.remove(); statusPopup = null;
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
    }

    return Extension.create({
        name: 'inlineTriggers',

        addExtensions() { return [ActionChipNode]; },

        addProseMirrorPlugins() {
            return [new Plugin({
                key: pluginKey,

                view(v) {
                    edView = v;
                    return {
                        update(v2) {
                            if (!phase) { popup?.remove(); popup = null; return; }
                            const cur = v2.state.selection.from;
                            if (cur <= triggerFrom) { reset(); return; }
                            const sz = v2.state.doc.content.size;
                            if (triggerFrom >= sz) { reset(); return; }
                            try {
                                if (phase === 'tag-add') {
                                    const tc = v2.state.doc.textBetween(triggerFrom, Math.min(triggerFrom + 1, sz));
                                    if (tc !== '#') { reset(); return; }
                                } else if (phase === 'tag-remove') {
                                    const pair = v2.state.doc.textBetween(triggerFrom, Math.min(triggerFrom + 2, sz));
                                    if (pair !== '-#') { reset(); return; }
                                }
                            } catch { reset(); return; }
                            redraw();
                        },
                        destroy() { reset(); edView = null; },
                    };
                },

                props: {
                    handleKeyDown(v, e) {
                        if (!phase) return false;
                        const items = getItems();
                        if (e.key === 'Escape') { reset(); return true; }
                        if (!items.length) return false;
                        if (e.key === 'ArrowUp')   { selIdx = (selIdx - 1 + items.length) % items.length; redraw(); return true; }
                        if (e.key === 'ArrowDown') { selIdx = (selIdx + 1) % items.length; redraw(); return true; }
                        if (e.key === 'Enter')     { if (items[selIdx]) selectItem(items[selIdx]); return true; }
                        if (e.key === 'Backspace' && getQuery().length === 0) { reset(); return false; }
                        return false;
                    },

                    handleTextInput(v, from, to, text) {
                        if (text === '#') {
                            const pre = from > 0 ? v.state.doc.textBetween(Math.max(0, from - 1), from) : '';
                            if (pre === '-') {
                                setTimeout(() => {
                                    if (!edView) return;
                                    const cur = edView.state.selection.from;
                                    phase = 'tag-remove'; triggerFrom = cur - 2; phaseStart = cur; selIdx = 0; redraw();
                                }, 0);
                            } else if (!phase && (!pre || pre === ' ' || pre === '\n')) {
                                setTimeout(() => {
                                    if (!edView) return;
                                    const cur = edView.state.selection.from;
                                    phase = 'tag-add'; triggerFrom = cur - 1; phaseStart = cur; selIdx = 0; redraw();
                                }, 0);
                            }
                        }
                        if (text === '$' && !phase) {
                            const pre = from > 0 ? v.state.doc.textBetween(Math.max(0, from - 1), from) : '';
                            if (pre === '$') {
                                setTimeout(() => {
                                    if (!edView) return;
                                    const cur = edView.state.selection.from;
                                    const sz = edView.state.doc.content.size;
                                    try { edView.dispatch(edView.state.tr.delete(Math.max(0, cur - 2), Math.min(cur, sz))); } catch {}
                                    openStatusMatrix(edView);
                                }, 0);
                            }
                        }
                        return false;
                    },
                },
            })];
        },
    });
}
