document.addEventListener('alpine:init', () => {
    Alpine.data('versePicker', (initialValue = '') => ({
        open: false,
        step: 'book', // book, chapter, verse, range
        selectedBook: '',
        selectedChapter: null,
        selectedVerse: null,
        selectedRangeEnd: null,
        value: initialValue,
        query: initialValue,
        
        books: Object.keys(BIBLE_DATA),
        
        init() {
            this.$watch('value', (val) => {
                this.query = val;
            });
        },

        toggle() {
            this.open = !this.open;
            if (this.open) {
                this.step = 'book';
                this.selectedBook = '';
                this.selectedChapter = null;
                this.selectedVerse = null;
                this.selectedRangeEnd = null;
            }
        },

        selectBook(book) {
            this.selectedBook = book;
            this.step = 'chapter';
        },

        selectChapter(chapter) {
            this.selectedChapter = chapter;
            this.step = 'verse';
        },

        selectVerse(verse) {
            if (this.selectedVerse === null) {
                this.selectedVerse = verse;
                this.updateValue();
            } else if (this.selectedVerse === verse) {
                // Deselect if same verse
                this.selectedVerse = null;
                this.updateValue();
            } else {
                // Toggle range or change single verse? 
                // Let's support ranges if they click another verse
                if (verse > this.selectedVerse) {
                    this.selectedRangeEnd = verse;
                } else {
                    this.selectedRangeEnd = this.selectedVerse;
                    this.selectedVerse = verse;
                }
                this.updateValue();
                this.open = false; // Close on range select
            }
        },

        updateValue() {
            let val = `${this.selectedBook} ${this.selectedChapter}:${this.selectedVerse}`;
            if (this.selectedRangeEnd) {
                val += `-${this.selectedRangeEnd}`;
            }
            this.value = val;
            this.query = val;
            
            // Dispatch event for parent components (like x-model)
            this.$el.dispatchEvent(new CustomEvent('input', {
                detail: val,
                bubbles: true
            }));
        },

        get chapters() {
            if (!this.selectedBook) return [];
            const count = BIBLE_DATA[this.selectedBook].length;
            return Array.from({ length: count }, (_, i) => i + 1);
        },

        get verses() {
            if (!this.selectedBook || this.selectedChapter === null) return [];
            const count = BIBLE_DATA[this.selectedBook][this.selectedChapter - 1];
            return Array.from({ length: count }, (_, i) => i + 1);
        },

        get filteredBooks() {
            if (!this.query || this.selectedBook) return this.books;
            return this.books.filter(b => b.toLowerCase().includes(this.query.toLowerCase()));
        },

        finish() {
            this.open = false;
        }
    }));
});
