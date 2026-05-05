document.addEventListener('DOMContentLoaded', () => {
    const calendarContainer = document.getElementById('calendar-container');
    const sidebarNav = document.getElementById('sidebar-nav');
    const startDate = new Date(2023, 6, 9); // July 9, 2023 (Month is 0-indexed)
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 2);

    const sundays = [];
    let current = new Date(startDate);
    
    // Ensure we start on a Sunday
    while (current <= endDate) {
        sundays.push(new Date(current));
        current.setDate(current.getDate() + 7);
    }

    const grouped = sundays.reduce((acc, date) => {
        const year = date.getFullYear();
        const month = date.toLocaleString('default', { month: 'long' });
        if (!acc[year]) acc[year] = {};
        if (!acc[year][month]) acc[year][month] = [];
        acc[year][month].push(date);
        return acc;
    }, {});

    renderCalendar(grouped);
    renderSidebar(grouped);
    scrollToClosestSunday(sundays);
});

function scrollToClosestSunday(sundays) {
    const today = new Date();
    let closestDate = sundays[0];
    let minDiff = Math.abs(today - closestDate);

    sundays.forEach(date => {
        const diff = Math.abs(today - date);
        if (diff < minDiff) {
            minDiff = diff;
            closestDate = date;
        }
    });

    const dateId = `date-${closestDate.getFullYear()}-${closestDate.getMonth()}-${closestDate.getDate()}`;
    const targetElement = document.getElementById(dateId);
    
    if (targetElement) {
        // Delay slightly to ensure layout is complete and sticky headers don't interfere
        setTimeout(() => {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetElement.classList.add('ring-2', 'ring-primary', 'ring-offset-4');
            // Remove highlight after a few seconds
            setTimeout(() => {
                targetElement.classList.remove('ring-2', 'ring-primary', 'ring-offset-4');
            }, 3000);
        }, 500);
    }
}

function renderSidebar(grouped) {
    const nav = document.getElementById('sidebar-nav');
    nav.innerHTML = '';

    const years = Object.keys(grouped).sort((a, b) => a - b);

    years.forEach(year => {
        const yearDiv = document.createElement('div');
        yearDiv.className = 'mb-sm';
        
        const yearLink = document.createElement('a');
        yearLink.href = `#year-${year}`;
        yearLink.className = 'block font-headline-md text-secondary hover:text-primary py-1 transition-colors';
        yearLink.textContent = year;
        yearDiv.appendChild(yearLink);

        const monthsDiv = document.createElement('div');
        monthsDiv.className = 'ml-md space-y-1';
        
        const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        monthsOrder.forEach(month => {
            if (grouped[year][month]) {
                const monthLink = document.createElement('a');
                monthLink.href = `#month-${year}-${month}`;
                monthLink.className = 'block font-body-md text-on-surface-variant hover:text-primary text-sm py-0.5 transition-colors';
                monthLink.textContent = month;
                monthsDiv.appendChild(monthLink);
            }
        });

        yearDiv.appendChild(monthsDiv);
        nav.appendChild(yearDiv);
    });
}

function renderCalendar(grouped) {
    const container = document.getElementById('calendar-container');
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
                    const dateRow = document.createElement('div');
                    dateRow.id = `date-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    dateRow.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-md flex flex-col sm:flex-row justify-between items-center group hover:shadow-[0_4px_16px_rgba(4,22,46,0.05)] transition-all duration-300 scroll-mt-32';
                    
                    const dateInfo = document.createElement('div');
                    dateInfo.className = 'flex items-center gap-md mb-md sm:mb-0 w-full sm:w-auto';
                    
                    const dayNum = date.getDate();
                    const dayName = date.toLocaleString('default', { weekday: 'short' });
                    
                    dateInfo.innerHTML = `
                        <div class="bg-primary-fixed text-on-primary-fixed rounded-xl w-14 h-14 flex flex-col items-center justify-center flex-shrink-0">
                            <span class="text-[10px] uppercase font-bold tracking-wider">${dayName}</span>
                            <span class="text-xl font-bold">${dayNum}</span>
                        </div>
                        <div>
                            <p class="font-headline-md text-body-lg text-on-surface mb-0">${date.toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            <p class="font-body-md text-on-surface-variant text-sm">Sunday Service</p>
                        </div>
                    `;

                    const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    
                    const actions = document.createElement('div');
                    actions.className = 'flex gap-sm w-full sm:w-auto justify-end';
                    actions.innerHTML = `
                        <button class="flex-1 sm:flex-none bg-secondary text-on-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-primary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">auto_stories</span>
                            <span>Service Guide</span>
                        </button>
                        <a href="service-builder.html?date=${formattedDate}" class="flex-1 sm:flex-none border border-outline text-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-secondary hover:text-on-secondary hover:border-secondary transition-colors flex items-center justify-center gap-2 group/btn">
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