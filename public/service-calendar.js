let allSundays = [];
let serviceDataMap = {};

document.addEventListener('DOMContentLoaded', async () => {
    const startDate = new Date(2023, 6, 9); // July 9, 2023 (Month is 0-indexed)
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 2);

    allSundays = [];
    let current = new Date(startDate);
    
    // Ensure we start on a Sunday
    while (current <= endDate) {
        allSundays.push(new Date(current));
        current.setDate(current.getDate() + 7);
    }

    const showHistory = false;
    window.refreshCalendar(showHistory);
    
    // Wait for service data to load so layout is final before we scroll
    await loadServiceData();
    
    // Small delay to ensure any layout shifts from image/content injection are settled
    setTimeout(() => {
        scrollToClosestSunday(allSundays);
    }, 200);
});

window.refreshCalendar = function(showHistory) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filteredSundays = showHistory 
        ? allSundays 
        : allSundays.filter(d => {
            const date = new Date(d);
            date.setHours(0, 0, 0, 0);
            return date >= today;
        });

    const grouped = filteredSundays.reduce((acc, date) => {
        const year = date.getFullYear();
        const month = date.toLocaleString('default', { month: 'long' });
        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];
        acc[year][month].push(date);
        return acc;
    }, {});

    renderList(grouped);
    renderTable(grouped);
    renderSidebar(grouped);
    
    // Re-apply loaded service data if it exists
    if (Object.keys(serviceDataMap).length > 0) {
        injectServiceData(serviceDataMap);
    }
};

window.jumpToUpcoming = function() {
    scrollToClosestSunday(allSundays);
};

function scrollToClosestSunday(sundays) {
    if (!sundays || sundays.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the first Sunday that is today or in the future
    let upcomingSunday = sundays.find(date => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d >= today;
    });

    // Fallback to the last one if they are all in the past (unlikely)
    if (!upcomingSunday) upcomingSunday = sundays[sundays.length - 1];

    const dateKey = `${upcomingSunday.getFullYear()}-${upcomingSunday.getMonth()}-${upcomingSunday.getDate()}`;
    const view = localStorage.getItem('calendarView') || 'list';
    const prefix = view === 'table' ? 'table-date-' : 'date-';
    const targetId = `${prefix}${dateKey}`;
    const targetElement = document.getElementById(targetId);
    
    if (targetElement) {
        // Smooth jump centered on the element
        setTimeout(() => {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetElement.classList.add('ring-2', 'ring-primary', 'ring-offset-4');
            // Remove highlight after a few seconds
            setTimeout(() => {
                targetElement.classList.remove('ring-2', 'ring-primary', 'ring-offset-4');
            }, 2000);
        }, 100);
    }
}

function scrollToSection(year, month = null) {
    const view = localStorage.getItem('calendarView') || 'list';
    const prefix = view === 'table' ? 'table-' : '';
    const id = month ? `${prefix}month-${year}-${month}` : `${prefix}year-${year}`;
    const targetElement = document.getElementById(id);
    if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderSidebar(grouped) {
    const navs = [
        document.getElementById('sidebar-nav'),
        document.getElementById('mobile-sidebar-nav')
    ];
    
    navs.forEach(nav => {
        if (!nav) return;
        nav.innerHTML = '';

        const years = Object.keys(grouped).sort((a, b) => a - b);

        years.forEach(year => {
            const yearDiv = document.createElement('div');
            yearDiv.className = 'mb-sm';
            
            const yearLink = document.createElement('a');
            yearLink.href = 'javascript:void(0)';
            yearLink.onclick = () => scrollToSection(year);
            yearLink.className = 'block font-headline-md text-secondary hover:text-primary py-1 transition-colors';
            yearLink.textContent = year;
            yearDiv.appendChild(yearLink);

            const monthsDiv = document.createElement('div');
            monthsDiv.className = 'ml-md space-y-1';
            
            const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            
            monthsOrder.forEach(month => {
                if (grouped[year][month]) {
                    const monthLink = document.createElement('a');
                    monthLink.href = 'javascript:void(0)';
                    monthLink.onclick = () => scrollToSection(year, month);
                    monthLink.className = 'block font-body-md text-on-surface-variant hover:text-primary text-sm py-0.5 transition-colors';
                    monthLink.textContent = month;
                    monthsDiv.appendChild(monthLink);
                }
            });

            yearDiv.appendChild(monthsDiv);
            nav.appendChild(yearDiv);
        });
    });
}

window.navigateToGuide = function(date) {
    const svc = serviceDataMap[date];
    const isViewer = window.currentUserRole === 'viewer';
    
    if (!isViewer && svc) {
        let incomplete = false;
        if (svc.guide && svc.guide.elements) {
            const prayer = svc.guide.elements.find(el => el.type === 'pastoral_prayer');
            const kids = svc.guide.elements.find(el => el.type === 'kids_section');
            const announcements = svc.guide.elements.find(el => el.type === 'announcements');
            
            if (prayer && prayer.enabled && (!prayer.nation || !prayer.capital)) incomplete = true;
            if (kids && kids.enabled && (!kids.lessonTitle || !kids.lessonVerse)) incomplete = true;
            if (announcements && announcements.enabled && (!announcements.items || announcements.items.length === 0 || !announcements.items[0].title)) incomplete = true;
        } else {
            // No guide config yet - definitely incomplete
            incomplete = true;
        }

        if (incomplete) {
            const proceed = confirm("Warning: There are elements that you have not completed yet. Please do so before going to the service guide page.\n\nDo you still want to proceed to the editor?");
            if (!proceed) return;
        }
    }
    window.location.href = `service-guide.html?date=${date}`;
};

function renderList(grouped) {
    const container = document.getElementById('list-view');
    container.innerHTML = '';

    const years = Object.keys(grouped).sort((a, b) => a - b); 

    years.forEach(year => {
        const yearSection = document.createElement('section');
        yearSection.id = `year-${year}`;
        yearSection.className = 'mb-xl scroll-mt-24';
        yearSection.innerHTML = `<h2 class="font-display-lg text-headline-lg text-primary border-b border-outline-variant pb-xs mb-md">${year}</h2>`;

        const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        monthsOrder.forEach(month => {
            if (grouped[year][month]) {
                const monthSection = document.createElement('div');
                monthSection.id = `month-${year}-${month}`;
                monthSection.className = 'mb-lg ml-0 sm:ml-md scroll-mt-24';
                monthSection.innerHTML = `<h3 class="font-headline-md text-headline-md text-secondary mb-sm">${month}</h3>`;
                
                const grid = document.createElement('div');
                grid.className = 'grid grid-cols-1 gap-sm';

                grouped[year][month].forEach(date => {
                    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

                    const dateRow = document.createElement('div');
                    dateRow.id = `date-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    dateRow.dataset.serviceDate = formattedDate;
                    dateRow.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-md flex flex-col sm:flex-row justify-between items-start group hover:shadow-[0_4px_16px_rgba(4,22,46,0.05)] transition-all duration-300 scroll-mt-32';
                    
                    const dateInfo = document.createElement('div');
                    dateInfo.className = 'flex items-start gap-md mb-md sm:mb-0 w-full sm:w-auto';
                    
                    const dayNum = date.getDate();
                    const dayName = date.toLocaleString('default', { weekday: 'short' });
                    
                    dateInfo.innerHTML = `
                        <div class="bg-primary-fixed text-on-primary-fixed rounded-xl w-14 h-14 flex flex-col items-center justify-center flex-shrink-0">
                            <span class="text-[10px] uppercase font-bold tracking-wider">${dayName}</span>
                            <span class="text-xl font-bold">${dayNum}</span>
                        </div>
                        <div class="min-w-0">
                            <p class="font-headline-md text-body-lg text-on-surface mb-0">${date.toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            <p class="font-body-md text-on-surface-variant text-sm">Sunday Service</p>
                            <div class="service-summary hidden mt-2 space-y-0.5"></div>
                        </div>
                    `;

                    const actions = document.createElement('div');
                    actions.className = 'flex flex-col sm:flex-row gap-sm w-full sm:w-auto justify-end flex-shrink-0';
                    actions.innerHTML = `
                        <button onclick="window.navigateToGuide('${formattedDate}')" class="flex-grow sm:flex-none bg-secondary text-on-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-primary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">auto_stories</span>
                            <span>Service Guide</span>
                        </button>
                        <a href="service-builder.html?date=${formattedDate}" class="flex-grow sm:flex-none border border-outline text-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-secondary hover:text-on-secondary hover:border-secondary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">list_alt</span>
                            <span>Order of Service</span>
                        </a>
                    `;

                    dateRow.appendChild(dateInfo);
                    dateRow.appendChild(actions);
                    grid.appendChild(dateRow);
                });

                monthSection.appendChild(grid);
                yearSection.appendChild(monthSection);
            }
        });

        container.appendChild(yearSection);
    });
}

function renderTable(grouped) {
    const container = document.getElementById('calendar-table-container');
    container.innerHTML = '';

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'flex-grow overflow-auto border border-outline-variant rounded-xl bg-surface-container-lowest custom-scrollbar relative';
    
    const table = document.createElement('table');
    table.className = 'w-full text-left border-collapse min-w-[1000px] relative';
    
    // Sticky Header
    const thead = document.createElement('thead');
    thead.className = 'sticky-header font-label-md text-label-md text-primary';
    thead.innerHTML = `
        <tr>
            <th class="px-md py-sm border-b border-outline-variant sticky-col-left">Date</th>
            <th class="px-md py-sm border-b border-outline-variant">Theme</th>
            <th class="px-md py-sm border-b border-outline-variant">Leader</th>
            <th class="px-md py-sm border-b border-outline-variant">Preacher</th>
            <th class="px-md py-sm border-b border-outline-variant">Baptism</th>
            <th class="px-md py-sm border-b border-outline-variant">Music</th>
            <th class="px-md py-sm border-b border-outline-variant">Prayers</th>
            <th class="px-md py-sm border-b border-outline-variant text-right sticky-column">Actions</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-outline-variant/30';

    const years = Object.keys(grouped).sort((a, b) => a - b); 

    years.forEach(year => {
        const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        monthsOrder.forEach(month => {
            if (grouped[year][month]) {
                // Month Separator Row
                const separatorRow = document.createElement('tr');
                separatorRow.id = `table-month-${year}-${month}`;
                separatorRow.className = 'sticky-month-row bg-surface-container-low/50 scroll-mt-24';
                separatorRow.innerHTML = `
                    <td colspan="8" class="px-md py-2 z-25 bg-surface-container-low/90 backdrop-blur-sm">
                        <h3 class="font-headline-md text-sm uppercase tracking-wider text-secondary">${month} ${year}</h3>
                    </td>
                `;
                tbody.appendChild(separatorRow);

                grouped[year][month].forEach(date => {
                    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    
                    const row = document.createElement('tr');
                    row.id = `table-date-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    row.dataset.serviceDate = formattedDate;
                    row.className = 'group hover:bg-surface-container-low transition-colors scroll-mt-32';
                    
                    row.innerHTML = `
                        <td class="px-md py-md whitespace-nowrap sticky-col-left">
                            <span class="font-body-md text-on-surface">${date.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        </td>
                        <td class="px-md py-md min-w-[200px]">
                            <div class="theme-cell font-body-md text-primary text-sm line-clamp-2">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="leader-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="preacher-column-cell flex flex-col items-start gap-1">
                                <div class="preacher-cell font-body-md text-on-surface-variant text-sm">—</div>
                                <div class="sermonette-row flex items-center gap-1 group/sermonette">
                                    <div class="sermonette-cell font-body-md text-xs text-tertiary hidden"></div>
                                    <button title="Add Sermonette" class="add-sermonette-btn hidden p-0.5 text-tertiary/50 hover:text-tertiary transition-colors rounded">
                                        <span class="material-symbols-outlined text-[16px]">add</span>
                                    </button>
                                </div>
                            </div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="baptism-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="music-cell font-body-md text-on-surface-variant text-sm">—</div>
                        </td>
                        <td class="px-md py-md whitespace-nowrap">
                            <div class="prayers-cell font-body-md text-on-surface-variant text-xs space-y-0.5">—</div>
                        </td>
                        <td class="px-md py-md text-right whitespace-nowrap sticky-column">
                            <div class="flex justify-end gap-xs">
                                <button onclick="window.navigateToGuide('${formattedDate}')" title="Service Guide" class="p-2 text-secondary hover:text-primary hover:bg-surface-container rounded-full transition-colors">
                                    <span class="material-symbols-outlined text-[20px]">auto_stories</span>
                                </button>
                                <a href="service-builder.html?date=${formattedDate}" title="Order of Service" class="p-2 text-secondary hover:text-primary hover:bg-surface-container rounded-full transition-colors">
                                    <span class="material-symbols-outlined text-[20px]">list_alt</span>
                                </a>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            }
        });
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);
}

/**
 * Fetch all service documents from Firestore and inject summary info
 * (theme, service leader, preacher) into the matching calendar cards.
 */
async function loadServiceData() {
    if (typeof db === 'undefined') return;

    try {
        const snapshot = await db.collection('services').get();
        serviceDataMap = {};
        snapshot.forEach(doc => {
            serviceDataMap[doc.id] = doc.data();
        });

        injectServiceData(serviceDataMap);
    } catch (e) {
        console.error('Error loading service data for calendar:', e);
    }
}

function injectServiceData(serviceMap) {
    const user = auth.currentUser;
    let canEdit = false;
    
    // We check role from local storage or global state if possible, 
    // but since we need it for injection, we'll try to determine it.
    // In this app, we can use the 'can-edit' class on the body as a signal 
    // if we set it during auth change.
    canEdit = document.body.classList.contains('can-edit');

    // Walk through all rendered date cards/rows and inject data if a service exists
    document.querySelectorAll('[data-service-date]').forEach(el => {
        const dateKey = el.dataset.serviceDate;
        const svc = serviceMap[dateKey] || {};

        // List View Injection
        const summaryEl = el.querySelector('.service-summary');
        if (summaryEl) {
            let html = '';
            
            // Badges Row
            if (svc.hasBaptism || svc.sermonette || svc.isIrregular || canEdit) {
                html += `<div class="flex flex-wrap gap-2 mb-2">`;
                if (svc.isIrregular) {
                    html += `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider">
                            <span class="material-symbols-outlined text-[14px]">layers</span>
                            Irregular
                        </span>`;
                }
                if (svc.hasBaptism) {
                    const baptismName = svc.liturgy?.baptism || svc.baptism || '';
                    html += `
                        <span class="group/baptism relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider cursor-help">
                            <span class="material-symbols-outlined text-[14px]">water_drop</span>
                            Baptism
                            ${baptismName ? `
                            <div class="invisible group-hover/baptism:visible opacity-0 group-hover/baptism:opacity-100 transition-all duration-200 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-primary text-on-primary text-[11px] font-medium rounded-lg shadow-xl whitespace-nowrap z-[100] normal-case tracking-normal flex flex-col items-center">
                                <span>Candidate: ${escapeHtml(baptismName)}</span>
                                <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-primary"></div>
                            </div>
                            ` : ''}
                        </span>`;
                }
                if (svc.sermonette) {
                    html += `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold uppercase tracking-wider">
                            <span class="material-symbols-outlined text-[14px]">mic</span>
                            Sermonette
                        </span>`;
                } else if (canEdit) {
                    // Hidden "Add Sermonette" ghost button
                    html += `
                        <button onclick="window.openPersonSelector('${dateKey}', 'sermonette', { name: '', id: null })" 
                                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary text-[10px] font-bold uppercase tracking-wider transition-colors"
                                title="Add Sermonette">
                            <span class="material-symbols-outlined text-[14px]">add</span>
                            Sermonette
                        </button>`;
                }
                html += `</div>`;
            }

            if (svc.theme) {
                html += `<p class="text-xs font-label-md text-primary flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">bookmark</span>
                    ${escapeHtml(svc.theme)}
                </p>`;
            }
            if (svc.serviceLeader) {
                html += `<p class="hidden md:flex text-xs text-on-surface-variant items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">person</span>
                    Leader: ${escapeHtml(svc.serviceLeader)}
                </p>`;
            }
            if (svc.preacher) {
                html += `<p class="hidden md:flex text-xs text-on-surface-variant items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">podium</span>
                    Preacher: ${escapeHtml(svc.preacher)}
                </p>`;
            }
            if (svc.sermonette) {
                html += `<p class="text-xs text-on-surface-variant flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">mic</span>
                    Sermonette: ${escapeHtml(svc.sermonette)}
                </p>`;
            }

            if (html) {
                summaryEl.innerHTML = html;
                summaryEl.classList.remove('hidden');
            } else {
                summaryEl.classList.add('hidden');
            }
        }

        // Table View Injection
        const dateCell = el.querySelector('.sticky-col-left');
        if (dateCell && svc.isIrregular) {
            // Check if badge already exists
            if (!dateCell.querySelector('.irregular-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'irregular-indicator material-symbols-outlined text-[14px] text-amber-600 ml-1 align-middle cursor-help';
                indicator.textContent = 'layers';
                indicator.title = 'Irregular Service';
                dateCell.appendChild(indicator);
            }
        }

        const themeCell = el.querySelector('.theme-cell');
        if (themeCell) {
            themeCell.textContent = svc.theme || '—';
            if (canEdit) setupInlineEdit(themeCell, dateKey, 'theme');
        }

        const leaderCell = el.querySelector('.leader-cell');
        if (leaderCell) {
            leaderCell.textContent = svc.serviceLeader || '—';
            leaderCell.setAttribute('data-person-id', svc.serviceLeaderId || '');
            if (canEdit) setupInlineEdit(leaderCell, dateKey, 'serviceLeader');
        }

        const preacherCell = el.querySelector('.preacher-cell');
        if (preacherCell) {
            preacherCell.textContent = svc.preacher || '—';
            preacherCell.setAttribute('data-person-id', svc.preacherId || '');
            if (canEdit) setupInlineEdit(preacherCell, dateKey, 'preacher');
        }

        const sermonetteCell = el.querySelector('.sermonette-cell');
        const addSermonetteBtn = el.querySelector('.add-sermonette-btn');
        if (sermonetteCell) {
            if (svc.sermonette) {
                sermonetteCell.textContent = `${svc.sermonette} (Sermonette)`;
                sermonetteCell.setAttribute('data-person-id', svc.sermonetteId || '');
                sermonetteCell.classList.remove('hidden');
                if (addSermonetteBtn) addSermonetteBtn.classList.add('hidden');
            } else {
                sermonetteCell.textContent = '';
                sermonetteCell.setAttribute('data-person-id', '');
                sermonetteCell.classList.add('hidden');
                
                if (canEdit && addSermonetteBtn) {
                    addSermonetteBtn.classList.remove('hidden');
                    addSermonetteBtn.onclick = (e) => {
                        e.stopPropagation();
                        window.openPersonSelector(dateKey, 'sermonette', { name: '', id: null });
                    };
                } else if (addSermonetteBtn) {
                    addSermonetteBtn.classList.add('hidden');
                }
            }
            if (canEdit && svc.sermonette) setupInlineEdit(sermonetteCell, dateKey, 'sermonette');
        }

        const baptismCell = el.querySelector('.baptism-cell');
        if (baptismCell) {
            const baptismVal = svc.liturgy?.baptism || svc.baptism || ''; // Fallback for various schema versions
            baptismCell.textContent = baptismVal || '—';
            if (canEdit) setupInlineEdit(baptismCell, dateKey, 'baptism');
        }

        const musicCell = el.querySelector('.music-cell');
        if (musicCell) {
            musicCell.textContent = svc.musicLeader || '—';
            musicCell.setAttribute('data-person-id', svc.musicLeaderId || '');
            if (canEdit) setupInlineEdit(musicCell, dateKey, 'musicLeader');
        }

        const prayersCell = el.querySelector('.prayers-cell');
        if (prayersCell) {
            prayersCell.innerHTML = '';
            
            const praiseRow = document.createElement('div');
            praiseRow.className = 'flex gap-1 items-center';
            praiseRow.innerHTML = `<span class="opacity-50">P:</span> <span class="praise-name-cell">${svc.prayerPraiseName || '—'}</span>`;
            praiseRow.querySelector('.praise-name-cell').setAttribute('data-person-id', svc.prayerPraiseId || '');
            
            const confRow = document.createElement('div');
            confRow.className = 'flex gap-1 items-center';
            confRow.innerHTML = `<span class="opacity-50">C:</span> <span class="conf-name-cell">${svc.prayerConfessionName || '—'}</span>`;
            confRow.querySelector('.conf-name-cell').setAttribute('data-person-id', svc.prayerConfessionId || '');
            
            prayersCell.appendChild(praiseRow);
            prayersCell.appendChild(confRow);

            if (canEdit) {
                setupInlineEdit(praiseRow.querySelector('.praise-name-cell'), dateKey, 'prayerPraiseName');
                setupInlineEdit(confRow.querySelector('.conf-name-cell'), dateKey, 'prayerConfessionName');
            }
        }
    });
}

function setupInlineEdit(el, dateKey, field) {
    el.classList.add('cursor-edit', 'hover:bg-primary-fixed/30', 'rounded', 'px-1', '-mx-1', 'transition-colors');
    el.title = 'Click to edit';
    
    // Check if it's a Person field
    const personFields = ['serviceLeader', 'musicLeader', 'preacher', 'sermonette', 'prayerPraiseName', 'prayerConfessionName'];

    el.onclick = (e) => {
        e.stopPropagation();

        if (personFields.includes(field)) {
            let currentVal = el.textContent === '—' || el.textContent === '— (Sermonette)' ? '' : el.textContent;
            if (field === 'sermonette') currentVal = currentVal.replace(' (Sermonette)', '');
            const currentId = el.getAttribute('data-person-id');
            window.openPersonSelector(dateKey, field, { name: currentVal, id: currentId });
            return;
        }

        const currentVal = el.textContent === '—' ? '' : el.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentVal;
        input.className = 'w-full bg-surface-container-highest border-primary border rounded px-2 py-1 font-body-md text-sm outline-none focus:ring-1 focus:ring-primary shadow-inner';
        
        const originalParent = el.parentElement;
        const originalDisplay = el.style.display;
        el.style.display = 'none';
        originalParent.appendChild(input);
        input.focus();

        const save = async () => {
            const newVal = input.value.trim();
            if (newVal !== currentVal) {
                // Show saving state
                el.textContent = newVal || '—';
                el.classList.add('saving-pulse', 'text-secondary/50');
                
                try {
                    // Map display field to ID field if applicable
                    const idFieldMap = {
                        'serviceLeader': 'serviceLeaderId',
                        'musicLeader': 'musicLeaderId',
                        'preacher': 'preacherId',
                        'sermonette': 'sermonetteId',
                        'prayerPraiseName': 'prayerPraiseId',
                        'prayerConfessionName': 'prayerConfessionId'
                    };

                    const updates = {
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    if (field === 'baptism') {
                        updates.hasBaptism = newVal !== '';
                        updates['liturgy.baptism'] = newVal;
                    } else {
                        updates[field] = newVal;
                    }

                    // Clear ID if we're updating a name field, as it's now a literal string
                    if (idFieldMap[field]) {
                        updates[idFieldMap[field]] = null;
                    }

                    await db.collection('services').doc(dateKey).set(updates, { merge: true });
                    
                    // Update global map to keep views in sync if they toggle
                    if (!serviceDataMap[dateKey]) serviceDataMap[dateKey] = {};
                    if (field === 'baptism') {
                        serviceDataMap[dateKey].hasBaptism = updates.hasBaptism;
                        if (!serviceDataMap[dateKey].liturgy) serviceDataMap[dateKey].liturgy = {};
                        serviceDataMap[dateKey].liturgy.baptism = newVal;
                    } else {
                        serviceDataMap[dateKey][field] = newVal;
                        if (idFieldMap[field]) serviceDataMap[dateKey][idFieldMap[field]] = null;
                    }
                    
                    // Trigger a re-injection to update all views (List and Table)
                    injectServiceData(serviceDataMap);
                } catch (err) {
                    console.error('Error updating service field:', err);
                    alert('Failed to save change.');
                    el.textContent = currentVal || '—';
                } finally {
                    el.classList.remove('saving-pulse', 'text-secondary/50');
                }
            }
            input.remove();
            el.style.display = originalDisplay;
        };

        input.onblur = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
                input.remove();
                el.style.display = originalDisplay;
            }
        };
    };
}

/**
 * Global bridge to Alpine person selector modal
 */
window.openPersonSelector = (dateKey, field, current) => {
    // Find Alpine data on body
    const body = document.querySelector('body');
    const alpineData = Alpine.$data(body);
    if (alpineData && alpineData.openPersonSelector) {
        alpineData.openPersonSelector(dateKey, field, current);
    }
};

/**
 * Shared Person Picker component logic (Alpine.js)
 */
function personPicker(personRef) {
    return {
        personRef: personRef,
        open: false,
        query: personRef.name || '',
        results: [],
        
        init() {
            this.$watch('personRef.name', (val) => {
                this.query = val || '';
            });
        },

        async search() {
            if (this.query.length < 2) {
                this.results = [];
                return;
            }

            try {
                const snap = await db.collection('people')
                    .where('name', '>=', this.query)
                    .where('name', '<=', this.query + '\uf8ff')
                    .limit(5).get();
                
                let found = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                const exactMatch = found.find(p => p.name.toLowerCase() === this.query.trim().toLowerCase());
                if (!exactMatch && this.query.trim().length >= 2) {
                    found.push({ id: 'NEW', name: this.query.trim(), isNew: true });
                }

                this.results = found;
            } catch (error) {
                console.error("Error searching people:", error);
            }
        },

        select(p) {
            if (p.isNew) {
                this.$dispatch('prompt-add-person', { 
                    name: p.name, 
                    callback: (newPerson) => {
                        this.personRef.id = newPerson.id;
                        this.personRef.name = newPerson.name;
                        this.query = newPerson.name;
                    } 
                });
                this.results = [];
                this.open = false;
                return;
            }
            this.personRef.id = p.id;
            this.personRef.name = p.name;
            this.query = p.name;
            this.results = [];
            this.open = false;
        },

        clear() {
            this.personRef.id = null;
            this.personRef.name = '';
            this.query = '';
            this.results = [];
            this.open = false;
        },

        onInput() {
            this.personRef.id = null; 
            this.search();
        }
    };
}

// --- AUTH PROTECTION ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const userData = await getUserData(user.uid);
            const role = (userData && userData.role) || 'viewer';
            window.currentUserRole = role;
            if (role === 'editor' || role === 'admin') {
                document.body.classList.add('can-edit');
                const importBtn = document.getElementById('import-docx-btn');
                if (importBtn) {
                    importBtn.classList.remove('hidden');
                    if (window.initDocxImporter) {
                        window.initDocxImporter(() => {
                            location.reload(); 
                        });
                    }
                }
                // Re-inject data to enable edit handlers
                if (Object.keys(serviceDataMap).length > 0) {
                    injectServiceData(serviceDataMap);
                }
            }
        } catch (error) {
            console.error("Error checking user permissions:", error);
        }
    } else {
        document.body.classList.remove('can-edit');
    }
});

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}