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
function stripAlpine(node) {
    [node, ...node.querySelectorAll('*')].forEach((el) => {
        [...el.attributes].forEach((attr) => {
            const name = attr.name;
            if (name.startsWith('x-') || name.startsWith(':') || name.startsWith('@')) el.removeAttribute(name);
        });
    });
}

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
        orderName: '',
        kinds: Core.KINDS,
        primitives: Core.PRIMITIVES,
        _sortable: null,

        get backHref() {
            return this.date ? 'service-builder.html?date=' + encodeURIComponent(this.date) : 'service-calendar.html';
        },
        get backLabel() { return this.date ? 'Order of Service' : 'Services'; },
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
        get addable() {
            const inOrder = new Set(this.selectedOrder.elementIds);
            return this.catalog.elements.filter(el => !inOrder.has(el.id));
        },

        kindLabel(kind) { return Core.KIND_LABELS[kind] || kind; },
        takesName(kind) { return Core.kindTakesName(kind); },
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
                if (!user) { window.location.href = 'index.html'; return; }
                try {
                    const userData = await getUserData(user.uid);
                    this.canEdit = AccessCore.pageFlags(userData).canWriteEditor;
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
            this.editProblem = '';
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
            this._apply(cat => Core.placeKind(cat, this.selectedOrder.id, kind, index).catalog);
        },

        removeFromOrder(elementId) {
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
            this.$nextTick(() => {
                const btn = document.querySelector('[data-order-row="' + id + '"] [data-move="' + which + '"]');
                if (btn && !btn.disabled) btn.focus();
                else {
                    const other = document.querySelector('[data-order-row="' + id + '"] [data-move]:not([disabled])');
                    if (other) other.focus();
                }
            });
        },

        // Sortable moves the DOM; Alpine owns it. Put the row back where it
        // was and let the model move it, so the two never disagree.
        // The library clones into the order: the drop inserts an id, and the
        // element itself stays in the collection.
        initSortable() {
            if (!this.editing || typeof Sortable === 'undefined') return;
            const shared = {
                animation: 150,
                group: { name: 'liturgy-library', pull: true, put: false },
            };
            const library = document.getElementById('element-library');
            if (library && !this._librarySortable) {
                // The row itself is the handle. Add stays a click: the filter
                // lets that event through instead of starting a drag.
                this._librarySortable = Sortable.create(library, Object.assign({}, shared, {
                    sort: false,
                    draggable: '[data-library-item]',
                    filter: 'button, input, select, label, a',
                    preventOnFilter: false,
                    group: { name: 'liturgy-library', pull: 'clone', put: false },
                    // The clone is a copy of an Alpine row. Leave the directives
                    // on it and Alpine evaluates `kind` outside the loop.
                    onClone: (evt) => stripAlpine(evt.clone),
                }));
            }
            const list = document.getElementById('order-elements');
            if (list && !this._orderSortable) {
                this._orderSortable = Sortable.create(list, {
                    animation: 150,
                    group: { name: 'liturgy-library', pull: true, put: true },
                    handle: '.m-row__handle',
                    draggable: '[data-order-row]',
                    filter: '.m-empty',
                    onAdd: (evt) => {
                        const kind = evt.item.getAttribute('data-kind');
                        const to = evt.newDraggableIndex;
                        // The drop is the library row itself. Take that node
                        // and Sortable's clone back out, then draw the five
                        // kinds again if one is missing. Alpine owns the list.
                        if (evt.clone) evt.clone.remove();
                        evt.item.remove();
                        evt.from.querySelectorAll(':scope > *').forEach((node) => {
                            if (node.tagName === 'TEMPLATE' || node.hasAttribute('data-library-item')) return;
                            node.remove();
                        });
                        const missing = this.kinds.some((k) => !evt.from.querySelector('[data-kind="' + k + '"]'));
                        if (missing) this.kinds = this.kinds.slice();
                        if (kind) this.placeKind(kind, to);
                    },
                    onEnd: (evt) => {
                        if (evt.from !== evt.to) return;
                        const from = evt.oldDraggableIndex;
                        const to = evt.newDraggableIndex;
                        evt.item.remove();
                        evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex] || null);
                        if (from === to || from == null || to == null) return;
                        this._apply(cat => Core.moveInOrder(cat, this.selectedOrder.id, from, to));
                    },
                });
            }
        },

        // ── elements ────────────────────────────────────────────────────────
        updateElement(id, patch) {
            this._apply(cat => Core.updateElement(cat, id, patch));
        },
        // The number field writes the count onto the draft as it is typed.
        // This puts it back through the core so 0 and 20 become 1 and 12.
        clampRequests(el) {
            if (!el || !el.requests) return;
            this.updateElement(el.id, { requests: { count: el.requests.count, who: el.requests.who } });
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
    module.exports = { liturgyOrdersPage, describeLiturgyLoadFailure };
}
