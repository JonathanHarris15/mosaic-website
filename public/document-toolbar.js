// Document Toolbar — the one editing toolbar, mounted wherever a Note Body is
// written.
//
// There were two. The Elder Document page had one and the Event Document page
// had another, built later and better, and the two disagreed about what bold
// looks like, whether a heading is reachable at all, and where a divider goes.
// They are the same editor over the same Note Body (ADR-0049), so a person
// moving between them was being asked to learn the same tool twice.
//
// A COPY WOULD DRIFT — it already had. So the markup lives here once and every
// page injects it, the same arrangement `roles-panel.js` uses for the one Roles
// surface.
//
// ONLY THE MARKUP IS SHARED. The behaviour stays in each page's own component,
// because what a command does differs: an Elder Document's editor is the outer
// document OR a Person Panel's body depending on where the cursor is, and an
// Event Document has one editor and no panels.
//
// ── What a host page must provide ────────────────────────────────────────────
//
//   isActive(name, attrs)   is the cursor in one of these? Takes a node name,
//                           or a bare bag of attributes (alignment). MUST touch
//                           the host's own redraw counter, so the buttons light
//                           up when the cursor moves — Alpine cannot see inside
//                           TipTap.
//   command(fn)             fn is handed a focused chain to run.
//   toggle(name)            toggleBold, toggleItalic, … by mark name.
//   setHeading(level)       1-3, or 0 for ordinary text.
//   setAlign(align)         'left' | 'center' | 'right', or '' to clear.
//   setLink()               ask for an address and apply it.
//   insertTable(rows, cols)
//   setFontFamily(css)      '' to clear.
//   setFontSize(css)        '' to clear.
//   setHighlight(colour)    a hex, or null to remove.
//   chooseImage($event)     from the file input this markup carries.
//   insertingImage          true while a picture is being read.
//   pendingImage            { name, size } while asking whether to shrink one,
//                           null otherwise. Plus confirmImageShrink() and
//                           cancelImage().
//   toolbarHasPersonPanel   whether to offer the Person Note button at all, and
//                           insertPersonPanel() if so.
//
// A host opts in with placeholders and omits whichever it does not want:
//
//     <div data-document-toolbar="bar"></div>
//     <div data-document-toolbar="table-tools"></div>
//     <div data-document-toolbar="image-dialog"></div>
//
// Injected synchronously, so this script must load AFTER the placeholders and
// BEFORE Alpine (which is deferred).

(function (global) {
    'use strict';

    // `@mousedown.prevent` rather than `@click` on every button that changes the
    // document: a click steals focus from the editor first, and a command with
    // no selection to act on does nothing. This was already true of the Elder
    // Document toolbar and is the sort of thing a second copy gets wrong.
    const BAR = `
            <div class="flex flex-wrap items-center gap-1 border-b border-outline-variant pb-sm">

                <!-- Font and size. Selects rather than icons because the value
                     itself is the label — an icon for "14pt" would be a puzzle.
                     They are sized to the 28px icon buttons beside them and the
                     arrow is pulled in: the forms plugin gives every select
                     2.5rem of padding-right and a 1.5em arrow, which next to a
                     row of icons reads as two fat pills. -->
                <select @change="setFontFamily($event.target.value)" title="Font"
                        style="background-size:1.05em 1.05em;background-position:right 0.25rem center"
                        class="h-7 pl-2 pr-6 py-0 text-xs leading-none font-label-md rounded
                               border border-outline-variant text-on-surface-variant bg-surface-container
                               hover:bg-surface-container-high focus:outline-none
                               focus:ring-1 focus:ring-primary/30 cursor-pointer">
                    <option value="">Font</option>
                    <option value="Work Sans, sans-serif">Work Sans</option>
                    <option value="Noto Serif, serif">Noto Serif</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="Arial, Helvetica, sans-serif">Arial</option>
                    <option value="Times New Roman, Times, serif">Times New Roman</option>
                    <option value="Courier New, Courier, monospace">Courier New</option>
                </select>
                <!-- Word's own list, and in POINTS rather than pixels. Word
                     measures type in points, so a document written at 12pt
                     exports as 12pt exactly instead of arriving via a pixel
                     conversion that lands half a point out. -->
                <select @change="setFontSize($event.target.value)" title="Size"
                        style="background-size:1.05em 1.05em;background-position:right 0.25rem center"
                        class="h-7 pl-2 pr-6 py-0 text-xs leading-none font-label-md rounded
                               border border-outline-variant text-on-surface-variant bg-surface-container
                               hover:bg-surface-container-high focus:outline-none
                               focus:ring-1 focus:ring-primary/30 cursor-pointer">
                    <option value="">Size</option>
                    <option value="8pt">8</option>
                    <option value="9pt">9</option>
                    <option value="10pt">10</option>
                    <option value="10.5pt">10.5</option>
                    <option value="11pt">11</option>
                    <option value="12pt">12</option>
                    <option value="14pt">14</option>
                    <option value="16pt">16</option>
                    <option value="18pt">18</option>
                    <option value="20pt">20</option>
                    <option value="22pt">22</option>
                    <option value="24pt">24</option>
                    <option value="26pt">26</option>
                    <option value="28pt">28</option>
                    <option value="36pt">36</option>
                    <option value="48pt">48</option>
                    <option value="72pt">72</option>
                </select>

                <span class="w-px h-4 bg-outline-variant mx-1"></span>

                <button type="button" @mousedown.prevent="toggle('bold')" :aria-pressed="isActive('bold')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('bold') && 'bg-surface-container'" title="Bold">
                    <span class="material-symbols-outlined text-[16px]">format_bold</span>
                </button>
                <button type="button" @mousedown.prevent="toggle('italic')" :aria-pressed="isActive('italic')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('italic') && 'bg-surface-container'" title="Italic">
                    <span class="material-symbols-outlined text-[16px]">format_italic</span>
                </button>
                <button type="button" @mousedown.prevent="toggle('underline')" :aria-pressed="isActive('underline')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('underline') && 'bg-surface-container'" title="Underline">
                    <span class="material-symbols-outlined text-[16px]">format_underlined</span>
                </button>
                <button type="button" @mousedown.prevent="toggle('strike')" :aria-pressed="isActive('strike')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('strike') && 'bg-surface-container'" title="Strikethrough">
                    <span class="material-symbols-outlined text-[16px]">format_strikethrough</span>
                </button>

                <!-- Highlight, with the pens behind it. -->
                <div class="relative" x-data="{ open: false }" @click.outside="open = false">
                    <button type="button" @mousedown.prevent="open = !open" :aria-pressed="isActive('highlight')"
                            class="m-icon-btn m-icon-btn--sm cal-focus"
                            :class="isActive('highlight') && 'bg-surface-container'" title="Highlight">
                        <span class="material-symbols-outlined text-[16px]">highlight</span>
                    </button>
                    <div x-show="open" style="display:none;min-width:116px"
                         class="absolute top-full left-0 mt-1 bg-surface-container-lowest border
                                border-outline-variant rounded-lg shadow-md z-50 p-2 flex flex-wrap gap-1">
                        <button type="button" @mousedown.prevent="setHighlight('#fef08a'); open = false" class="w-6 h-6 rounded border border-outline-variant hover:scale-110 transition-transform bg-highlight-yellow" title="Yellow"></button>
                        <button type="button" @mousedown.prevent="setHighlight('#bbf7d0'); open = false" class="w-6 h-6 rounded border border-outline-variant hover:scale-110 transition-transform bg-highlight-green" title="Green"></button>
                        <button type="button" @mousedown.prevent="setHighlight('#bfdbfe'); open = false" class="w-6 h-6 rounded border border-outline-variant hover:scale-110 transition-transform bg-highlight-blue" title="Blue"></button>
                        <button type="button" @mousedown.prevent="setHighlight('#fecaca'); open = false" class="w-6 h-6 rounded border border-outline-variant hover:scale-110 transition-transform bg-highlight-red" title="Red"></button>
                        <button type="button" @mousedown.prevent="setHighlight('#fed7aa'); open = false" class="w-6 h-6 rounded border border-outline-variant hover:scale-110 transition-transform bg-highlight-orange" title="Orange"></button>
                        <button type="button" @mousedown.prevent="setHighlight('#f0abfc'); open = false" class="w-6 h-6 rounded border border-outline-variant hover:scale-110 transition-transform bg-highlight-purple" title="Purple"></button>
                        <button type="button" @mousedown.prevent="setHighlight(null); open = false"
                                class="w-6 h-6 rounded border border-outline-variant hover:bg-surface-container
                                       flex items-center justify-center text-on-surface-variant" title="Remove highlight">
                            <span class="material-symbols-outlined text-[12px]">close</span>
                        </button>
                    </div>
                </div>

                <span class="w-px h-4 bg-outline-variant mx-1"></span>

                <template x-for="level in [1, 2, 3]" :key="level">
                    <button type="button" @mousedown.prevent="setHeading(level)"
                            :aria-pressed="isActive('heading', { level: level })"
                            class="m-icon-btn m-icon-btn--sm cal-focus"
                            :class="isActive('heading', { level: level }) && 'bg-surface-container'"
                            :title="'Heading ' + level">
                        <span class="material-symbols-outlined text-[16px]" x-text="'format_h' + level"></span>
                    </button>
                </template>
                <button type="button" @mousedown.prevent="setHeading(0)"
                        class="m-icon-btn m-icon-btn--sm cal-focus" title="Normal text">
                    <span class="material-symbols-outlined text-[16px]">format_paragraph</span>
                </button>

                <span class="w-px h-4 bg-outline-variant mx-1"></span>

                <button type="button" @mousedown.prevent="toggle('bulletList')" :aria-pressed="isActive('bulletList')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('bulletList') && 'bg-surface-container'" title="Bulleted list">
                    <span class="material-symbols-outlined text-[16px]">format_list_bulleted</span>
                </button>
                <button type="button" @mousedown.prevent="toggle('orderedList')" :aria-pressed="isActive('orderedList')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('orderedList') && 'bg-surface-container'" title="Numbered list">
                    <span class="material-symbols-outlined text-[16px]">format_list_numbered</span>
                </button>
                <button type="button" @mousedown.prevent="toggle('blockquote')" :aria-pressed="isActive('blockquote')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('blockquote') && 'bg-surface-container'" title="Quote">
                    <span class="material-symbols-outlined text-[16px]">format_quote</span>
                </button>

                <!-- Table, with its size behind the button rather than beside
                     it — the bar stays a row of icons. -->
                <div class="relative" x-data="{ open: false, rows: 3, cols: 3 }" @click.outside="open = false">
                    <button type="button" @mousedown.prevent="open = !open"
                            class="m-icon-btn m-icon-btn--sm cal-focus" title="Insert a table">
                        <span class="material-symbols-outlined text-[16px]">table</span>
                    </button>
                    <div x-show="open" style="display:none"
                         class="absolute top-full left-0 mt-1 bg-surface-container-lowest border
                                border-outline-variant rounded-lg shadow-md z-50 p-2 flex items-center gap-1">
                        <input type="number" x-model.number="rows" min="1" max="20" title="Rows"
                               class="w-11 h-7 border border-outline-variant rounded px-1 text-xs text-center
                                      bg-surface focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <span class="text-xs text-on-surface-variant">×</span>
                        <input type="number" x-model.number="cols" min="1" max="20" title="Columns"
                               class="w-11 h-7 border border-outline-variant rounded px-1 text-xs text-center
                                      bg-surface focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <button type="button" @mousedown.prevent="insertTable(rows, cols); open = false"
                                class="m-icon-btn m-icon-btn--sm cal-focus" title="Insert">
                            <span class="material-symbols-outlined text-[16px]">add</span>
                        </button>
                    </div>
                </div>

                <span class="w-px h-4 bg-outline-variant mx-1"></span>

                <template x-for="a in ['left', 'center', 'right']" :key="a">
                    <button type="button" @mousedown.prevent="setAlign(a)"
                            :aria-pressed="isActive({ textAlign: a })"
                            class="m-icon-btn m-icon-btn--sm cal-focus"
                            :class="isActive({ textAlign: a }) && 'bg-surface-container'"
                            :title="'Align ' + a">
                        <span class="material-symbols-outlined text-[16px]" x-text="'format_align_' + a"></span>
                    </button>
                </template>

                <span class="w-px h-4 bg-outline-variant mx-1"></span>

                <button type="button" @mousedown.prevent="setLink()" :aria-pressed="isActive('link')"
                        class="m-icon-btn m-icon-btn--sm cal-focus"
                        :class="isActive('link') && 'bg-surface-container'" title="Link">
                    <span class="material-symbols-outlined text-[16px]">link</span>
                </button>
                <input type="file" x-ref="imageInput" class="hidden" accept="image/*"
                       @change="chooseImage($event)" />
                <button type="button" @mousedown.prevent="$refs.imageInput.click()"
                        class="m-icon-btn m-icon-btn--sm cal-focus" title="Insert a picture">
                    <span class="material-symbols-outlined text-[16px]"
                          :class="insertingImage ? 'm-spinner' : ''"
                          x-text="insertingImage ? 'progress_activity' : 'image'"></span>
                </button>

                <span class="w-px h-4 bg-outline-variant mx-1"></span>

                <button type="button" @mousedown.prevent="command(c => c.undo().run())"
                        class="m-icon-btn m-icon-btn--sm cal-focus" title="Undo">
                    <span class="material-symbols-outlined text-[16px]">undo</span>
                </button>
                <button type="button" @mousedown.prevent="command(c => c.redo().run())"
                        class="m-icon-btn m-icon-btn--sm cal-focus" title="Redo">
                    <span class="material-symbols-outlined text-[16px]">redo</span>
                </button>

                <!-- Elder Documents only. A Person Panel links a block of this
                     document to somebody's Shepherding Note, which is an
                     elder-only record — so it is absent where the document can
                     be read by a member (ADR-0049). -->
                <template x-if="toolbarHasPersonPanel">
                    <span class="contents">
                        <span class="w-px h-4 bg-outline-variant mx-1"></span>
                        <button type="button" @mousedown.prevent="insertPersonPanel()"
                                class="flex items-center gap-1 px-2 h-7 rounded text-xs font-label-md
                                       text-on-surface-variant hover:bg-surface-container cal-focus
                                       cal-motion"
                                title="Insert a Person Note panel (or type /person)">
                            <span class="material-symbols-outlined text-[15px]">person_add</span>
                            Person Note
                        </button>
                    </span>
                </template>
            </div>`;


    // Shown only while the cursor is inside a table. The Elder Document editor
    // had this and the Event one did not, which is the sort of thing two
    // toolbars quietly disagree about.
    const TABLE_TOOLS = `
            <div x-show="isActive('table')" style="display:none"
                 class="flex items-center flex-wrap gap-xs px-md py-xs border-b border-outline-variant
                        bg-secondary-container/30">
                <span class="font-label-md text-label-md text-on-surface-variant text-xs mr-xs">Table:</span>
                <button type="button" @mousedown.prevent="command(c => c.addColumnBefore().run())" class="m-btn m-btn--quiet m-btn--sm">+ Col &larr;</button>
                <button type="button" @mousedown.prevent="command(c => c.addColumnAfter().run())"  class="m-btn m-btn--quiet m-btn--sm">+ Col &rarr;</button>
                <button type="button" @mousedown.prevent="command(c => c.deleteColumn().run())"
                        class="px-2 py-1 text-xs font-label-md text-on-surface-variant hover:bg-error/10 hover:text-error rounded transition-colors">&minus; Col</button>
                <div class="w-px h-4 bg-outline-variant mx-xs"></div>
                <button type="button" @mousedown.prevent="command(c => c.addRowBefore().run())" class="m-btn m-btn--quiet m-btn--sm">+ Row &uarr;</button>
                <button type="button" @mousedown.prevent="command(c => c.addRowAfter().run())"  class="m-btn m-btn--quiet m-btn--sm">+ Row &darr;</button>
                <button type="button" @mousedown.prevent="command(c => c.deleteRow().run())"
                        class="px-2 py-1 text-xs font-label-md text-on-surface-variant hover:bg-error/10 hover:text-error rounded transition-colors">&minus; Row</button>
                <div class="w-px h-4 bg-outline-variant mx-xs"></div>
                <button type="button" @mousedown.prevent="command(c => c.deleteTable().run())"
                        class="px-2 py-1 text-xs font-label-md text-error hover:bg-error/10 rounded transition-colors">Delete table</button>
            </div>`;

    // Asked rather than refused: a document carries its pictures inside itself,
    // so a photograph off a phone will not fit as it is.
    const IMAGE_DIALOG = `
    <div x-show="pendingImage" @keydown.escape.window="cancelImage()"
         class="fixed inset-0 z-50 bg-on-surface/30 flex items-start justify-center overflow-y-auto p-4">
        <div class="bg-surface-container-lowest rounded-lg border border-outline-variant w-full max-w-[460px] mt-[14vh]">
            <div class="px-md py-md flex items-start gap-sm">
                <span class="material-symbols-outlined text-[22px] text-secondary shrink-0 mt-0.5">compress</span>
                <div class="min-w-0">
                    <h3 class="font-display text-[20px] text-primary">Shrink this picture?</h3>
                    <p class="text-[13px] text-on-surface-variant mt-2">
                        <span class="font-medium" x-text="pendingImage && pendingImage.name"></span>
                        is <span x-text="pendingImage && pendingImage.size"></span>. A document carries its
                        pictures inside it, so this one needs making smaller before it will fit.
                    </p>
                    <p class="text-[12.5px] text-on-surface-variant mt-2">
                        It will still be big enough to fill the page. If you need the original at full
                        size, attach it as a file instead.
                    </p>
                </div>
            </div>
            <div class="px-md py-md border-t border-outline-variant flex items-center justify-end gap-sm">
                <button @click="cancelImage()"
                        class="px-md py-2 rounded-lg font-label-md text-xs uppercase tracking-wider
                               text-on-surface-variant cal-motion cal-focus hover:bg-surface-container">Cancel</button>
                <button @click="confirmImageShrink()"
                        class="bg-secondary text-on-secondary px-md py-2 rounded-lg shadow-xs font-label-md
                               text-xs uppercase tracking-wider cal-motion cal-press cal-focus">
                    Shrink and insert
                </button>
            </div>
        </div>
    </div>`;

    const PARTS = { bar: BAR, 'table-tools': TABLE_TOOLS, 'image-dialog': IMAGE_DIALOG };

    function mount() {
        const placeholders = document.querySelectorAll('[data-document-toolbar]');
        placeholders.forEach(el => {
            const markup = PARTS[el.getAttribute('data-document-toolbar')];
            if (markup) el.outerHTML = markup;
        });
    }

    mount();

    if (global) global.DocumentToolbar = { BAR, IMAGE_DIALOG, mount };
})(typeof window !== 'undefined' ? window : null);
