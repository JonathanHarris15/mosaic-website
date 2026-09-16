// Block ids in the Elder Document editor (MS-500).
//
// ⚠ A BLOCK NEEDS A LASTING IDENTITY BEFORE IT CAN BE A BOX. An Elder Document
// is saved block by block, updated live block by block, and held by one elder
// block by block (ADR-0062). Every block-level node therefore carries a
// `blockId` attribute that survives typing, and is never shared by two blocks.
//
// Built on the Extension and Plugin classes the vendored bundle already exports
// (ADR-0050): no bundle rebuild, and no TipTap Pro — its UniqueID extension is
// a paid v2 extension, and ADR-0048 already declined that subscription.
//
// After every change, the plugin makes sure each block has an id and no two
// share one. When a change duplicates an id — Enter splitting a paragraph, a
// paste of copied blocks, a Word import, an undo — the block that was already
// there keeps it (found by mapping its old position through the change) and the
// newcomer gets a fresh one: DocumentBodyCore.resolveBlockIds.
//
// Only the Elder Document editors, web and phone, register it. Loaded as a
// plain script after document-body-core.js; exported for Node.
var BlockIdExtension = (function () {
    'use strict';

    // Every block-level node type an Elder Document holds.
    var TYPES = [
        'paragraph', 'heading', 'codeBlock', 'blockquote',
        'bulletList', 'orderedList', 'listItem',
        'table', 'tableRow', 'tableCell', 'tableHeader',
        'horizontalRule', 'image', 'personPanel',
    ];

    function core() {
        return (typeof DocumentBodyCore !== 'undefined') ? DocumentBodyCore : require('./document-body-core.js');
    }

    function holdsBlockId(node) {
        return !!(node && node.isBlock && node.attrs && Object.prototype.hasOwnProperty.call(node.attrs, 'blockId'));
    }

    // A transaction giving every block an id and no two the same one, or null
    // when nothing needs changing. `transactions` and `oldState` are the change
    // that led here, when there was one.
    function assignIds(state, transactions, oldState) {
        var keepers = {};
        if (oldState && transactions && transactions.length) {
            oldState.doc.descendants(function (node, pos) {
                if (!holdsBlockId(node) || !node.attrs.blockId) return;
                var at = pos;
                for (var i = 0; i < transactions.length; i++) at = transactions[i].mapping.map(at, 1);
                keepers[node.attrs.blockId] = at;
            });
        }
        var entries = [];
        var nodes = {};
        state.doc.descendants(function (node, pos) {
            if (!holdsBlockId(node)) return;
            entries.push({ key: pos, id: node.attrs.blockId || null });
            nodes[pos] = node;
        });
        var changes = core().resolveBlockIds(entries, keepers);
        if (!changes.length) return null;
        var tr = state.tr;
        changes.forEach(function (change) {
            var node = nodes[change.key];
            tr.setNodeMarkup(change.key, undefined, Object.assign({}, node.attrs, { blockId: change.id }));
        });
        // Not an edit anybody made: not undoable, and not a keystroke in a box.
        tr.setMeta('addToHistory', false);
        tr.setMeta('blockIds', true);
        return tr;
    }

    // The ProseMirror plugin, given the Plugin and PluginKey classes.
    function plugin(lib) {
        return new lib.Plugin({
            key: new lib.PluginKey('blockIds'),
            appendTransaction: function (transactions, oldState, newState) {
                if (!transactions.some(function (tr) { return tr.docChanged; })) return null;
                return assignIds(newState, transactions, oldState);
            },
            view: function (view) {
                // A document opened without ids (a Word import, a legacy body)
                // gets them straight away, once the view exists.
                Promise.resolve().then(function () {
                    if (view.isDestroyed) return;
                    var tr = assignIds(view.state, null, null);
                    if (tr) view.dispatch(tr);
                });
                return {};
            },
        });
    }

    // The TipTap extension, given the vendored library (Extension, Plugin,
    // PluginKey).
    function create(lib) {
        return lib.Extension.create({
            name: 'blockId',
            addGlobalAttributes: function () {
                return [{
                    types: TYPES,
                    attributes: {
                        blockId: {
                            default: null,
                            // Enter splitting a block must not copy the id.
                            keepOnSplit: false,
                            parseHTML: function (el) { return el.getAttribute('data-block-id'); },
                            renderHTML: function (attrs) {
                                return attrs.blockId ? { 'data-block-id': attrs.blockId } : {};
                            },
                        },
                    },
                }];
            },
            addProseMirrorPlugins: function () { return [plugin(lib)]; },
        });
    }

    return { TYPES: TYPES, assignIds: assignIds, plugin: plugin, create: create };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BlockIdExtension: BlockIdExtension };
}
