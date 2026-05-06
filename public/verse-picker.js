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
        query: initialValue,
        selectingRangeEnd: false,
        
        books: Object.keys(BIBLE_DATA),
        
        init() {
            // Watch for external changes (via x-model or manual updates)
            this.$watch('value', (val) => {
                if (val !== this.query) {
                    this.query = val || '';
                    if (val) {
                        this.parseValue(val);
                    } else {
                        this.reset();
                    }
                }
            });
            
            // Also parse initial value
            if (this.value) {
                this.parseValue(this.value);
            }
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
            }
        },

        toggle() {
            this.open = !this.open;
            if (this.open) {
                this.reset();
            }
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
                this.selectedVerse = verse;
                this.updateValue();
            } else if (this.selectedVerse === verse) {
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

        updateValue() {
            if (!this.selectedBook || !this.selectedChapter || !this.selectedVerse) return;

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
            this.query = val;
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
