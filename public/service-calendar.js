document.addEventListener('DOMContentLoaded', () => {
    const calendarContainer = document.getElementById('calendar-container');
    const startDate = new Date('2023-07-09T00:00:00'); // Ensure local time
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 2);

    const sundays = [];
    let current = new Date(startDate);
    
    // Ensure we start on a Sunday (July 9, 2023 is a Sunday)
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
});

function renderCalendar(grouped) {
    const container = document.getElementById('calendar-container');
    container.innerHTML = '';

    const years = Object.keys(grouped).sort((a, b) => a - b); 

    years.forEach(year => {
        const yearSection = document.createElement('section');
        yearSection.className = 'mb-xl';
        yearSection.innerHTML = `<h2 class="font-display-lg text-headline-lg text-primary border-b border-outline-variant pb-xs mb-md">${year}</h2>`;

        const monthsOrder = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        monthsOrder.forEach(month => {
            if (grouped[year][month]) {
                const monthSection = document.createElement('div');
                monthSection.className = 'mb-lg ml-0 sm:ml-md';
                monthSection.innerHTML = `<h3 class="font-headline-md text-headline-md text-secondary mb-sm">${month}</h3>`;
                
                const grid = document.createElement('div');
                grid.className = 'grid grid-cols-1 gap-sm';

                grouped[year][month].forEach(date => {
                    const dateRow = document.createElement('div');
                    dateRow.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-md flex flex-col sm:flex-row justify-between items-center group hover:shadow-[0_4px_16px_rgba(4,22,46,0.05)] transition-all duration-300';
                    
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

                    const actions = document.createElement('div');
                    actions.className = 'flex gap-sm w-full sm:w-auto justify-end';
                    actions.innerHTML = `
                        <button class="flex-1 sm:flex-none bg-secondary text-on-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-primary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">auto_stories</span>
                            <span>Service Guide</span>
                        </button>
                        <button class="flex-1 sm:flex-none border border-outline text-secondary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-secondary hover:text-on-secondary hover:border-secondary transition-colors flex items-center justify-center gap-2 group/btn">
                            <span class="material-symbols-outlined text-[18px]">list_alt</span>
                            <span>Order of Service</span>
                        </button>
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