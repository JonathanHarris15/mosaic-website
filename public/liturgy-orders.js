// Liturgy Orders — the page where a congregation places the five kinds into
// Liturgy Orders (ADR-0080). The kinds are code. Each placement lives on
// the order.
//
// The page edits a draft of the whole catalog and saves it with one button,
// the same way the Service Guide Manager saves a template. A Sunday only ever
// points at an order, and nothing here writes a Sunday: deleting an element or
// an order leaves every value already planned where it is, and a Sunday that
// named a deleted order reads as Standard.
//
// Reached from the Order of Service (the manage control beside the order
// select, which passes ?date= so the back link returns to that Sunday) and
// from the Service calendar's table toggles.

// Say what actually failed. A preview channel serves these pages against the
// live rules, which do not know liturgy_elements / liturgy_orders until those
// rules ship, so the read is permission-denied — not a dropped connection.
// Standard stands in (ADR-0080: the pages fall back) and is not a draft.
function describeLiturgyLoadFailure(error) {
    const code = error && error.code;
    if (code === 'permission-denied') {
        return 'The liturgy orders could not be read. This is a permissions problem, not a connection problem. Standard is shown in their place, and saving stays off until they load.';
    }
    if (code === 'unavailable') {
        return 'The liturgy orders could not be reached. Check your connection and try again. Standard is shown in their place, and saving stays off until they load.';
    }
    return 'The liturgy orders did not load. Try again. Standard is shown in their place, and saving stays off until they load.';
}

// A dragged kind is a copy of an Alpine row. The copy must not carry
// directives: Alpine would evaluate `kind` outside the loop that defined it.
// Sortable's newDraggableIndex counts with the list the drag started in.
// A kind dropped into the order is still a library row, so that count is 0
// and the placement snaps to the top. The index is where the row actually sits.
function indexInList(list, item) {
    let index = 0;
    if (!list) return index;
    for (const child of list.children) {
        if (child === item) return index;
        if (child.tagName === 'TEMPLATE') continue;
        if (child.classList.contains('m-empty')) continue;
        if (child.classList.contains('sortable-ghost') || child.classList.contains('sortable-fallback')) continue;
        if (child.style.display === 'none') continue;
        index += 1;
    }
    return index;
}

function stripAlpine(node) {
    [node, ...node.querySelectorAll('*')].forEach((el) => {
        [...el.attributes].forEach((attr) => {
            const name = attr.name;
            if (name.startsWith('x-') || name.startsWith(':') || name.startsWith('@')) el.removeAttribute(name);
        });
    });
}

const KIND_ICONS = Object.freeze({
    hymn: 'music_note',
    scripture: 'menu_book',
    prayer: 'volunteer_activism',
    person: 'person',
    other: 'more_horiz',
});

function liturgyOrdersPage() {
    const Core = window.LiturgyOrderCore;
    return {
        loading: true,
        problem: '',
        editProblem: '',
        saving: false,
        toast: '',
        canEdit: false,
        date: '',
        catalog: Core.standardCatalog(),
        stored: { elementIds: [], orderIds: [] },
        baseline: '',
        selectedOrderId: Core.STANDARD_ORDER_ID,
        selectedElementId: '',
        dayDrafts: {},
        whoOptions: [
            { value: 'male', label: 'A man' },
            { value: 'female', label: 'A woman' },
            { value: 'either', label: 'Anyone' },
        ],
        orderName: '',
        kinds: Core.KINDS,
        primitives: Core.PRIMITIVES,
        _sortable: null,

        get backHref() {
            return this.date ? 'service-builder.html?date=' + encodeURIComponent(this.date) : 'service-calendar.html';
        },
        get backLabel() { return 'Order of Service'; },
        userName: '',
        userInitials: '',
        get dirty() { return JSON.stringify(this.catalog) !== this.baseline; },

        // Standard first, then by name — the order every other page lists them in.
        get orders() {
            return Core.toggledOrders(this.catalog, this.catalog.orders.map(o => o.id));
        },
        get selectedOrder() {
            return Core.orderById(this.catalog, this.selectedOrderId)
                || Core.orderById(this.catalog, Core.STANDARD_ORDER_ID);
        },
        get isStandard() { return this.selectedOrder.id === Core.STANDARD_ORDER_ID; },
        // A failed read leaves Standard on screen. That is not a draft, and it
        // must not be written back over orders this page did not read.
        get editing() { return this.canEdit && !this.problem && !this.loading; },
        get orderElements() { return Core.elementsOf(this.selectedOrder, this.catalog); },
        get inspectorElement() {
            if (!this.selectedElementId) return null;
            const el = Core.elementById(this.catalog, this.selectedElementId);
            if (!el || this.selectedOrder.elementIds.indexOf(el.id) === -1) return null;
            return el;
        },
        get inspectorIndex() {
            const el = this.inspectorElement;
            if (!el) return -1;
            return this.selectedOrder.elementIds.indexOf(el.id);
        },
        get placeHint() {
            const i = this.inspectorIndex;
            return i >= 0 ? 'Add after No. ' + (i + 1) : 'Add to the end';
        },
        get addable() {
            const inOrder = new Set(this.selectedOrder.elementIds);
            return this.catalog.elements.filter(el => !inOrder.has(el.id));
        },

        kindLabel(kind) { return Core.KIND_LABELS[kind] || kind; },
        kindIcon(kind) { return KIND_ICONS[kind] || 'help'; },
        takesName(kind) { return Core.kindTakesName(kind); },
        displayName(el) { return Core.elementDisplayName(el); },
        orderSubtitle(order) {
            const o = order || this.selectedOrder;
            const n = o.elementIds.length;
            let text = n + ' element' + (n === 1 ? '' : 's');
            if (o.id === Core.STANDARD_ORDER_ID) text += ' · the default, cannot be deleted';
            return text;
        },
        elementMeta(el) {
            if (!el || el.kind !== 'prayer') return '';
            const parts = [];
            if (el.prayedByOther) parts.push('Another may pray it');
            if (el.requests) {
                const count = (el.requests.people || []).length;
                const days = (Array.isArray(el.noticeDays) ? el.noticeDays : []).slice().sort((a, b) => b - a);
                let line = count + ' request' + (count === 1 ? '' : 's');
                line += days.length ? ' · days ' + days.join(', ') : ' · no days';
                parts.push(line);
            }
            return parts.join(' · ');
        },
        usedBy(elementId) {
            const names = this.orders.filter(o => o.elementIds.indexOf(elementId) !== -1).map(o => o.name);
            return names.length ? 'In ' + names.join(', ') : 'In no order';
        },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.date = params.get('date') || '';
            window.addEventListener('beforeunload', (e) => {
                if (this.editing && this.dirty) { e.preventDefault(); e.returnValue = ''; }
            });
            auth.onAuthStateChanged(async (user) => {
                if (!user && typeof window.MosaicEmulatorSignIn === 'function') {
                    try { await window.MosaicEmulatorSignIn(); return; }
                    catch (e) { /* fall through to redirect */ }
                }
                if (!user) { window.location.href = 'index.html'; return; }
                try {
                    const userData = await getUserData(user.uid);
                    this.canEdit = AccessCore.pageFlags(userData).canWriteEditor;
                    const name = (userData && userData.name) || user.displayName || 'Editor';
                    this.userName = name;
                    const Dest = window.MosaicDestinations;
                    this.userInitials = Dest ? Dest.initials(name) : name.trim().charAt(0).toUpperCase() || '?';
                } catch (e) {
                    this.canEdit = false;
                }
                this.$nextTick(() => this.initSortable());
            });
            await this.load();
        },

        async load() {
            this.loading = true;
            try {
                const read = await LiturgyOrderStore.load(db);
                this.catalog = read.catalog;
                this.stored = read.stored;
                this.baseline = JSON.stringify(this.catalog);
                if (!Core.orderById(this.catalog, this.selectedOrderId)) this.selectedOrderId = Core.STANDARD_ORDER_ID;
                this.orderName = this.selectedOrder.name;
                this.problem = '';
            } catch (e) {
                console.error('Liturgy orders did not load', e);
                const catalog = Core.standardCatalog();
                this.catalog = catalog;
                this.stored = { elementIds: [], orderIds: [] };
                this.baseline = JSON.stringify(catalog);
                this.selectedOrderId = Core.STANDARD_ORDER_ID;
                this.orderName = this.selectedOrder.name;
                this.problem = describeLiturgyLoadFailure(e);
            } finally {
                this.loading = false;
                this.$nextTick(() => this.initSortable());
            }
        },

        // Every edit goes through here: the core returns a new catalog or
        // throws a sentence the page shows as it is.
        _apply(edit) {
            if (!this.editing) return false;
            try {
                this.catalog = edit(this.catalog);
                this.editProblem = '';
                return true;
            } catch (e) {
                this.editProblem = e.message;
                return false;
            }
        },

        // ── orders ──────────────────────────────────────────────────────────
        selectOrder(id) {
            this.selectedOrderId = id;
            this.orderName = this.selectedOrder.name;
            this.selectedElementId = '';
            this.editProblem = '';
        },
        selectElement(id) {
            this.selectedElementId = id;
        },

        // An empty order, named so it does not collide with one already open,
        // then the name field is ready to replace "New order".
        addOrder() {
            const names = new Set(this.orders.map(o => o.name));
            let name = 'New order';
            for (let n = 2; names.has(name); n += 1) name = 'New order ' + n;
            let made = null;
            if (!this._apply(cat => {
                made = Core.addOrder(cat, { name: name });
                return made.catalog;
            })) return;
            this.selectOrder(made.order.id);
            this.$nextTick(() => {
                const input = document.getElementById('order-name');
                if (!input) return;
                input.focus();
                input.select();
            });
        },

        renameOrder() {
            if (this.orderName === this.selectedOrder.name) return;
            if (!this._apply(cat => Core.renameOrder(cat, this.selectedOrder.id, this.orderName))) {
                this.orderName = this.selectedOrder.name;
            }
        },

        deleteOrder() {
            const order = this.selectedOrder;
            if (!confirm('Delete "' + order.name + '"? Sundays that follow it will read as Standard. Nothing they hold is deleted.')) return;
            if (this._apply(cat => Core.deleteOrder(cat, order.id))) this.selectOrder(Core.STANDARD_ORDER_ID);
        },

        // A kind from the collection, placed on this order. The same kind can
        // be placed again: each place is its own instance.
        placeKind(kind, index) {
            if (!kind) return;
            let at = index;
            if (at === undefined && this.inspectorIndex >= 0) at = this.inspectorIndex + 1;
            let made = null;
            if (!this._apply(cat => {
                made = Core.placeKind(cat, this.selectedOrder.id, kind, at);
                return made.catalog;
            })) return;
            if (made && made.element) this.selectedElementId = made.element.id;
        },

        removeFromOrder(elementId) {
            if (this.selectedElementId === elementId) this.selectedElementId = '';
            this._apply(cat => Core.removeFromOrder(cat, this.selectedOrder.id, elementId));
        },

        // Up and down keep the focus on the button that was pressed, so a row
        // can be walked through the order from the keyboard.
        move(index, delta, event) {
            const to = index + delta;
            if (to < 0 || to >= this.selectedOrder.elementIds.length) return;
            const which = event && event.currentTarget && event.currentTarget.dataset.move;
            const id = this.selectedOrder.elementIds[index];
            if (!this._apply(cat => Core.moveInOrder(cat, this.selectedOrder.id, index, to))) return;
            if (typeof document !== 'undefined') {
                this.$nextTick(() => {
                    const btn = document.querySelector('[data-order-row="' + id + '"] [data-move="' + which + '"]');
                    if (btn && !btn.disabled) btn.focus();
                    else {
                        const other = document.querySelector('[data-order-row="' + id + '"] [data-move]:not([disabled])');
                        if (other) other.focus();
                    }
                });
            }
        },

        // Sortable moves the DOM; Alpine owns it. Put the row back where it
        // was and let the model move it, so the two never disagree.
        // The library clones into the order: the drop inserts an id, and the
        // element itself stays in the collection.
        initSortable() {
            if (!this.editing || typeof Sortable === 'undefined') return;
            const list = document.getElementById('order-elements');
            if (list && !this._orderSortable) {
                this._orderSortable = Sortable.create(list, {
                    animation: 150,
                    handle: '.lo-row__handle',
                    draggable: '[data-order-row]',
                    filter: '.m-empty',
                    onStart: (evt) => {
                        evt.item.dataset.dragFrom = String(indexInList(evt.from, evt.item));
                    },
                    onEnd: (evt) => {
                        const from = Number(evt.item.dataset.dragFrom);
                        const to = indexInList(evt.to, evt.item);
                        delete evt.item.dataset.dragFrom;
                        evt.item.remove();
                        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex] || null);
                        if (from === to || !Number.isInteger(from)) return;
                        this._apply(cat => Core.moveInOrder(cat, this.selectedOrder.id, from, to));
                    },
                });
            }
        },

        // ── elements ────────────────────────────────────────────────────────
        updateElement(id, patch) {
            this._apply(cat => Core.updateElement(cat, id, patch));
        },

        peopleCopy(el) {
            return ((el.requests && el.requests.people) || []).map(person => ({ who: person.who }));
        },
        toggleRequests(el, on) {
            const patch = { requests: on ? { people: [{ who: 'either' }] } : null };
            if (on) patch.noticeDays = Core.DEFAULT_NOTICE_LIST.slice();
            this.updateElement(el.id, patch);
        },
        addPerson(el) {
            const people = this.peopleCopy(el);
            if (people.length >= Core.REQUEST_PEOPLE_MAX) return;
            people.push({ who: 'either' });
            this.updateElement(el.id, { requests: { people: people } });
        },
        removePerson(el, index) {
            const people = this.peopleCopy(el);
            if (people.length <= 1) return;
            people.splice(index, 1);
            this.updateElement(el.id, { requests: { people: people } });
        },
        movePerson(el, index, delta) {
            const people = this.peopleCopy(el);
            const to = index + delta;
            if (to < 0 || to >= people.length) return;
            const moved = people.splice(index, 1)[0];
            people.splice(to, 0, moved);
            this.updateElement(el.id, { requests: { people: people } });
        },
        setPersonWho(el, index, who) {
            const people = this.peopleCopy(el);
            if (!people[index]) return;
            people[index].who = who;
            this.updateElement(el.id, { requests: { people: people } });
        },
        addDay(el) {
            if (!el) return;
            const n = parseInt(this.dayDrafts[el.id], 10);
            if (!Number.isFinite(n) || n < 1 || n > Core.NOTICE_DAYS_MAX) {
                this.editProblem = 'A day is a number from 1 to 30.';
                return;
            }
            const days = (Array.isArray(el.noticeDays) ? el.noticeDays : []).slice();
            if (days.indexOf(n) === -1) days.push(n);
            this.dayDrafts[el.id] = '';
            this.updateElement(el.id, { noticeDays: days });
        },
        removeDay(el, day) {
            const days = (el.noticeDays || []).filter(value => value !== day);
            this.updateElement(el.id, { noticeDays: days });
        },
        renameElement(id, event) {
            const el = Core.elementById(this.catalog, id);
            if (!el || event.target.value === el.name) return;
            if (!this._apply(cat => Core.updateElement(cat, id, { name: event.target.value }))) {
                event.target.value = el.name;
            }
        },

        deleteElement(id) {
            const el = Core.elementById(this.catalog, id);
            if (!el) return;
            if (!confirm('Delete "' + el.name + '"? It leaves every order. What Sundays already hold under it stays on those Sundays.')) return;
            this._apply(cat => Core.deleteElement(cat, id));
        },

        // ── save ────────────────────────────────────────────────────────────
        discard() {
            if (!this.dirty || !confirm('Throw away the changes on this page?')) return;
            this.catalog = JSON.parse(this.baseline);
            this.selectOrder(Core.orderById(this.catalog, this.selectedOrderId) ? this.selectedOrderId : Core.STANDARD_ORDER_ID);
        },

        async save() {
            if (!this.editing || this.saving || !this.dirty) return;
            const problems = Core.validateCatalog(this.catalog);
            if (problems.length) { this.editProblem = problems[0]; return; }
            this.saving = true;
            this.editProblem = '';
            try {
                this.stored = await LiturgyOrderStore.save(db, this.catalog, this.stored);
                this.baseline = JSON.stringify(this.catalog);
                this.flash('Saved');
            } catch (e) {
                console.error('Liturgy orders did not save', e);
                this.editProblem = 'The changes did not save. ' + (e && e.message ? e.message : 'Try again.');
            } finally {
                this.saving = false;
            }
        },

        flash(text) {
            this.toast = text;
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { this.toast = ''; }, 2400);
        },
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        liturgyOrdersPage,
        describeLiturgyLoadFailure,
        KIND_ICONS,
    };
}
