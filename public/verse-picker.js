document.addEventListener('alpine:init', () => {
    Alpine.data('versePicker', (initialValue = '') => ({
        open: false,
        step: 'book',
        selectedBook: '',
        selectedChapter: null,
        selectedVerse: null,
        rangeBook: '',
        rangeChapter: null,
        rangeVerse: null,
        value: initialValue,
        selectingRangeEnd: false,
        // Whatever book/chapter/verse the pointer is currently over —
        // {label, stat} | null — read by the footer instead of a native
        // title tooltip, which is inconsistently styled and easy to miss.
        hovered: null,

        books: Object.keys(BIBLE_DATA),

        // Fixed-positioned and computed fresh on open (positionPanel below),
        // so a clipping ancestor — an overflow-hidden list box, a sticky
        // column — can never cut the picker off the way `position: absolute`
        // anchored to a `relative` parent could. Bound via :style on the
        // panel in place of the old absolute/left-0 utility classes.
        panelStyle: '',

        init() {
            // Watch for external changes (via x-model or manual updates)
            this.$watch('value', (val) => {
                if (val) {
                    this.parseValue(val);
                } else {
                    this.reset();
                }
            });

            // Also parse initial value
            if (this.value) {
                this.parseValue(this.value);
            }

            // The panel's position is computed once, on open — a scroll
            // OUTSIDE it afterwards would leave it pinned over the wrong
            // spot, so close it instead of letting it drift. `scroll` does
            // not bubble, hence capture phase, so this also catches an
            // outer scrolling container, not just the window — but the
            // book/chapter/verse grids scroll internally too, and that must
            // NOT close the picker out from under the finger scrolling it.
            this._closeOnScroll = (e) => {
                if (!this.open) return;
                if (this.$el.contains(e.target)) return;
                this.open = false;
            };
            this._closeOnResize = () => { if (this.open) this.open = false; };
            window.addEventListener('scroll', this._closeOnScroll, true);
            window.addEventListener('resize', this._closeOnResize);
        },

        destroy() {
            window.removeEventListener('scroll', this._closeOnScroll, true);
            window.removeEventListener('resize', this._closeOnResize);
        },

        // Flips above the field when there isn't room below (the Benediction
        // field, last in a long list, rarely has 400px of viewport under
        // it), and caps the panel's own height to whichever side it lands
        // on — so it fits the space rather than running off the screen the
        // fixed positioning no longer clips it against.
        positionPanel() {
            const rect = this.$el.getBoundingClientRect();
            const width = Math.max(rect.width, 288);
            const margin = 8;
            const spaceBelow = window.innerHeight - rect.bottom - margin;
            const spaceAbove = rect.top - margin;
            const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
            const maxHeight = Math.max(160, Math.min(400, below ? spaceBelow : spaceAbove));
            const vertical = below
                ? `top: ${rect.bottom + 4}px;`
                : `bottom: ${window.innerHeight - rect.top + 4}px;`;
            // margin: 0 neutralizes verse-picker-dropdown's own margin-top —
            // the inline style already accounts for that gap via top/bottom.
            this.panelStyle = `position: fixed; margin: 0; z-index: 90; ${vertical} left: ${rect.left}px; width: ${width}px; max-height: ${maxHeight}px;`;
        },

        parseValue(val) {
            if (!val) return;
            // Simple regex to try and match "Book Chapter:Verse"
            // Handles "John 3:16" or "1 John 2:3" or "Song of Solomon 1:2"
            const match = val.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?.*$/);
            if (match) {
                const book = match[1];
                if (BIBLE_DATA[book]) {
                    this.selectedBook = book;
                    this.selectedChapter = parseInt(match[2]);
                    this.selectedVerse = parseInt(match[3]);
                    if (match[4]) {
                        this.rangeBook = book;
                        this.rangeChapter = this.selectedChapter;
                        this.rangeVerse = parseInt(match[4]);
                    }
                }
                return;
            }
            // A whole chapter, no verse: "Romans 8".
            const chapterOnly = val.match(/^(.+?)\s+(\d+)$/);
            if (chapterOnly && BIBLE_DATA[chapterOnly[1]]) {
                this.selectedBook = chapterOnly[1];
                this.selectedChapter = parseInt(chapterOnly[2]);
                this.selectedVerse = null;
            }
        },

        // Opens back to wherever the current value already points — not a
        // blank book grid — since picking is now the only way in (no text
        // field to fall back on for a small adjustment).
        toggle() {
            this.open = !this.open;
            if (!this.open) return;
            this.clearHover();
            this.selectingRangeEnd = false;
            if (this.value) {
                this.parseValue(this.value);
                this.step = this.selectedVerse !== null ? 'verse'
                    : this.selectedChapter !== null ? 'chapter' : 'book';
            } else {
                this.reset();
            }
            this.positionPanel();
        },

        // How often each book/chapter/verse has actually been used, read
        // from UsageStats.scriptureHeatMap — which whichever page this
        // picker lives on builds once at startup (service-builder.js /
        // service-calendar.js's loadScriptureIndex()). A global rather than
        // an argument threaded through every x-data="versePicker(...)" call
        // site, because the inline picker service-calendar.js injects on a
        // table-view cell click has no enclosing Alpine scope to pass one
        // through.
        get heatMap() {
            return (typeof UsageStats !== 'undefined' && UsageStats.scriptureHeatMap) || null;
        },

        // Each level's button classes as one array — [background, text,
        // ring] — so a template applies them with a single :class binding
        // rather than recomputing the same bucket three times over.
        bookClasses(book) {
            const count = this.heatMap ? (this.heatMap.bookCounts[book] || 0) : 0;
            return this._heatClasses(count, this.heatMap && this.heatMap.maxBookCount,
                this.activeBook === book);
        },
        chapterClasses(chapter) {
            const stat = this.chapterStat(chapter);
            return this._heatClasses(stat ? stat.count : 0, this.heatMap && this.heatMap.maxChapterCount,
                this.activeChapter === chapter);
        },
        verseClasses(verse) {
            const stat = this.verseStat(verse);
            const selected = (!this.selectingRangeEnd && this.selectedVerse === verse) ||
                (this.selectingRangeEnd && this.rangeVerse === verse);
            return this._heatClasses(stat ? stat.count : 0, this.heatMap && this.heatMap.maxVerseCount, selected);
        },
        _heatClasses(count, max, selected) {
            const ring = selected ? 'ring-2 ring-primary ring-offset-1' : '';
            if (typeof UsageStats === 'undefined') return [ring];
            return [UsageStats.heatColorFor(count, max), UsageStats.heatTextColorFor(count, max), ring];
        },

        // Book-step hover → footer.
        hoverBook(book) {
            const count = this.heatMap ? (this.heatMap.bookCounts[book] || 0) : 0;
            this.hovered = { label: book, stat: { count, lastUsed: null } };
        },

        // Chapter-step stat/hover, within whichever book is active for this
        // step (selectedBook, or rangeBook while picking a range's end).
        chapterStat(chapter) {
            if (!this.heatMap || !this.activeBook) return null;
            return this.heatMap.chapterStats[`${this.activeBook}-${chapter}`] || null;
        },
        hoverChapter(chapter) {
            this.hovered = {
                label: `${this.activeBook} ${chapter}`,
                stat: this.chapterStat(chapter) || { count: 0, lastUsed: null },
            };
        },

        // Verse-step stat/hover, within whichever chapter is active.
        verseStat(verse) {
            if (!this.heatMap || !this.activeBook || this.activeChapter === null) return null;
            return this.heatMap.verseStats[`${this.activeBook}-${this.activeChapter}-${verse}`] || null;
        },
        hoverVerse(verse) {
            this.hovered = {
                label: `${this.activeBook} ${this.activeChapter}:${verse}`,
                stat: this.verseStat(verse) || { count: 0, lastUsed: null },
            };
        },

        clearHover() {
            this.hovered = null;
        },

        get footerText() {
            if (!this.hovered) return 'Hover a book, chapter, or verse to see how often it’s been used';
            const label = typeof UsageStats !== 'undefined'
                ? UsageStats.formatLabel(this.hovered.stat) : '';
            return `${this.hovered.label} — ${label}`;
        },

        reset() {
            this.step = 'book';
            this.selectedBook = '';
            this.selectedChapter = null;
            this.selectedVerse = null;
            this.rangeBook = '';
            this.rangeChapter = null;
            this.rangeVerse = null;
            this.selectingRangeEnd = false;
        },

        // Takes the field back to empty and closes the picker — the button
        // never had a text field to backspace through, so this is the only
        // way to clear an already-set reference.
        clear() {
            this.value = '';
            this.reset();
            this.$el.dispatchEvent(new CustomEvent('input', { detail: '', bubbles: true }));
            this.open = false;
        },

        selectBook(book) {
            if (this.selectingRangeEnd) {
                this.rangeBook = book;
            } else {
                this.selectedBook = book;
            }
            this.step = 'chapter';
        },

        selectChapter(chapter) {
            if (this.selectingRangeEnd) {
                this.rangeChapter = chapter;
            } else {
                this.selectedChapter = chapter;
            }
            this.step = 'verse';
        },

        selectVerse(verse) {
            if (this.selectingRangeEnd) {
                this.rangeVerse = verse;
                this.updateValue();
                this.open = false;
                return;
            }

            if (this.selectedVerse === null) {
                // Wait — don't save yet; let the user decide whether to add a range
                this.selectedVerse = verse;
            } else if (this.selectedVerse === verse) {
                // Second click on same verse = confirm single verse
                this.updateValue();
                this.open = false;
            } else {
                // Same-chapter range
                this.rangeBook = this.selectedBook;
                this.rangeChapter = this.selectedChapter;
                this.rangeVerse = Math.max(this.selectedVerse, verse);
                this.selectedVerse = Math.min(this.selectedVerse, verse);
                this.updateValue();
                this.open = false;
            }
        },

        startRangeSelection() {
            this.selectingRangeEnd = true;
            // Default to same book & chapter as start — user can back out via breadcrumb
            this.rangeBook = this.selectedBook;
            this.rangeChapter = this.selectedChapter;
            this.rangeVerse = null;
            this.step = 'verse';
        },

        // No verse — the whole chapter is the reference. A range doesn't mean
        // anything against that, so this always closes the picker rather than
        // offering "Select range end point" the way a single verse does.
        selectWholeChapter() {
            this.selectedVerse = null;
            this.rangeBook = '';
            this.rangeChapter = null;
            this.rangeVerse = null;
            this.updateValue();
            this.open = false;
        },

        updateValue() {
            if (!this.selectedBook || !this.selectedChapter) return;

            if (this.selectedVerse === null) {
                const val = `${this.selectedBook} ${this.selectedChapter}`;
                this.value = val;
                this.$el.dispatchEvent(new CustomEvent('input', { detail: val, bubbles: true }));
                return;
            }

            let val = `${this.selectedBook} ${this.selectedChapter}:${this.selectedVerse}`;

            if (this.rangeBook && this.rangeChapter && this.rangeVerse) {
                if (this.rangeBook === this.selectedBook && this.rangeChapter === this.selectedChapter) {
                    if (this.rangeVerse !== this.selectedVerse) val += `-${this.rangeVerse}`;
                } else if (this.rangeBook === this.selectedBook) {
                    val += ` - ${this.rangeChapter}:${this.rangeVerse}`;
                } else {
                    val += ` - ${this.rangeBook} ${this.rangeChapter}:${this.rangeVerse}`;
                }
            }

            this.value = val;
            this.$el.dispatchEvent(new CustomEvent('input', { detail: val, bubbles: true }));
        },

        get activeBook() {
            return this.selectingRangeEnd ? this.rangeBook : this.selectedBook;
        },
        get activeChapter() {
            return this.selectingRangeEnd ? this.rangeChapter : this.selectedChapter;
        },

        get chapters() {
            if (!this.activeBook) return [];
            return Array.from({ length: BIBLE_DATA[this.activeBook].length }, (_, i) => i + 1);
        },

        get verses() {
            if (!this.activeBook || this.activeChapter === null) return [];
            const count = BIBLE_DATA[this.activeBook][this.activeChapter - 1];
            return Array.from({ length: count }, (_, i) => i + 1);
        },

        get filteredBooks() {
            return this.books;
        },

        get breadcrumbBook() {
            return this.selectingRangeEnd ? (this.rangeBook || 'Book') : (this.selectedBook || 'Book');
        },
        get breadcrumbChapter() {
            return this.selectingRangeEnd ? (this.rangeChapter || 'Chapter') : (this.selectedChapter || 'Chapter');
        },
        get breadcrumbVerse() {
            return this.selectingRangeEnd ? (this.rangeVerse || 'Verse') : (this.selectedVerse || 'Verse');
        },
        get startLabel() {
            if (!this.selectedBook) return '';
            let l = this.selectedBook;
            if (this.selectedChapter !== null) l += ' ' + this.selectedChapter;
            if (this.selectedVerse !== null) l += ':' + this.selectedVerse;
            return l;
        }
    }));
});
