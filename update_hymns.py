import re

with open('public/service-builder.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern to match the old hymnPicker blocks
pattern = re.compile(
    r'<div x-data="hymnPicker\(service\.liturgy\.(.*?)\)" @input="service\.liturgy\.(.*?) = \$event\.detail" class="input-container relative">.*?<div x-show="service\.liturgy\.(.*?)\.name".*?</div>\s*</div>',
    re.DOTALL
)

replacement = r'''<div x-data="hymnPicker(service.liturgy.\1)" @input="service.liturgy.\2 = $event.detail" class="input-container relative">
                        <div class="flex items-center bg-surface-container-low rounded-lg border border-outline-variant px-3 py-2">
                            <input type="text" placeholder="Search hymns..." x-model="query" @focus="open = true" @input.debounce="search()" class="bg-transparent border-none p-0 w-full focus:ring-0 text-sm" :disabled="!canEdit">
                            <div class="flex items-center gap-1">
                                <button x-show="query" @click="clear()" class="text-secondary hover:text-primary transition-colors cursor-pointer" :disabled="!canEdit">
                                    <span class="material-symbols-outlined text-[18px]">close</span>     
                                </button>
                                <span class="material-symbols-outlined text-[18px] text-secondary">music_note</span>
                            </div>
                        </div>
                        <div x-show="open && results.length > 0" @click.away="open = false" class="absolute z-50 w-full mt-1 bg-white border border-outline-variant rounded-xl shadow-2xl max-h-48 overflow-y-auto left-0">
                            <template x-for="h in results" :key="h.id">
                                <button @click="select(h)" class="w-full text-left px-4 py-2 hover:bg-primary-fixed transition-colors border-b last:border-0">
                                    <p class="font-label-md text-sm" x-text="h.hymn_name"></p>
                                    <p class="text-[10px] text-secondary" x-text="h.lyrics_writer"></p>  
                                </button>
                            </template>
                        </div>
                    </div>'''

new_content = pattern.sub(replacement, content)

with open('public/service-builder.html', 'w', encoding='utf-8') as f:
    f.write(new_content)
