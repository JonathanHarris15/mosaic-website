// Liturgy Orders — the one page where a congregation makes, renames, reorders,
// and deletes its Liturgy Elements and Liturgy Orders (ADR-0080).
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
        newOrder: { name: '', copyFrom: Core.STANDARD_ORDER_ID },
        newElement: { name: '', primitive: 'song', hasRole: false, hasNote: true },
        addElementId: '',
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
        get orderElements() { return Core.elementsOf(this.selectedOrder, this.catalog); },
        get addable() {
            const inOrder = new Set(this.selectedOrder.elementIds);
            return this.catalog.elements.filter(el => !inOrder.has(el.id));
        },

        primitiveLabel(p) { return Core.PRIMITIVE_LABELS[p] || p; },
        orderSummary(order) {
            const n = Core.elementsOf(order, this.catalog).length;
            return n === 1 ? '1 element' : n + ' elements';
        },
        usedBy(elementId) {
            const names = this.orders.filter(o => o.elementIds.indexOf(elementId) !== -1).map(o => o.name);
            return names.length ? 'In ' + names.join(', ') : 'In no order';
        },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.date = params.get('date') || '';
            window.addEventListener('beforeunload', (e) => {
                if (this.canEdit && this.dirty) { e.preventDefault(); e.returnValue = ''; }
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
            this.problem = '';
            try {
                const read = await LiturgyOrderStore.load(db);
                this.catalog = read.catalog;
                this.stored = read.stored;
                this.baseline = JSON.stringify(this.catalog);
                if (!Core.orderById(this.catalog, this.selectedOrderId)) this.selectedOrderId = Core.STANDARD_ORDER_ID;
                this.orderName = this.selectedOrder.name;
            } catch (e) {
                console.error('Liturgy orders did not load', e);
                this.problem = 'The liturgy orders did not load. Check your connection and try again.';
            } finally {
                this.loading = false;
                this.$nextTick(() => this.initSortable());
            }
        },

        // Every edit goes through here: the core returns a new catalog or
        // throws a sentence the page shows as it is.
        _apply(edit) {
            if (!this.canEdit) return false;
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
            this.addElementId = '';
            this.editProblem = '';
        },

        createOrder() {
            let made = null;
            if (this._apply(cat => {
                made = Core.addOrder(cat, { name: this.newOrder.name, copyFrom: this.newOrder.copyFrom || null });
                return made.catalog;
            })) {
                this.newOrder = { name: '', copyFrom: Core.STANDARD_ORDER_ID };
                this.selectOrder(made.order.id);
            }
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

        addToOrder() {
            if (!this.addElementId) return;
            if (this._apply(cat => Core.addToOrder(cat, this.selectedOrder.id, this.addElementId))) {
                this.addElementId = '';
            }
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
        initSortable() {
            if (this._sortable || !this.canEdit || typeof Sortable === 'undefined') return;
            const list = document.getElementById('order-elements');
            if (!list) return;
            this._sortable = Sortable.create(list, {
                animation: 150,
                handle: '.m-row__handle',
                draggable: '[data-order-row]',
                onEnd: (evt) => {
                    const from = evt.oldDraggableIndex;
                    const to = evt.newDraggableIndex;
                    evt.item.remove();
                    evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex] || null);
                    if (from === to || from == null || to == null) return;
                    this._apply(cat => Core.moveInOrder(cat, this.selectedOrder.id, from, to));
                },
            });
        },

        // ── elements ────────────────────────────────────────────────────────
        createElement() {
            let made = null;
            if (this._apply(cat => {
                made = Core.addElement(cat, this.newElement);
                return made.catalog;
            })) {
                this.newElement = { name: '', primitive: this.newElement.primitive, hasRole: false, hasNote: true };
                this.addElementId = this.selectedOrder.elementIds.indexOf(made.element.id) === -1 ? made.element.id : '';
            }
        },

        updateElement(id, patch) {
            this._apply(cat => Core.updateElement(cat, id, patch));
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
            if (!this.canEdit || this.saving || !this.dirty) return;
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
    module.exports = { liturgyOrdersPage };
}
