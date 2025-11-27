// ============================================
// BOOKINGS (Enhanced with Advanced Filtering & Search)
// ============================================
// To integrate: Replace lines 3954-4318 in flirt-admin-console.html with this content

let adminBookings = [];
let adminBookingsFiltered = [];
let bookingsCalendarMonthOffset = 0;
let currentBookingsView = 'list';
let adminBookingDataLoaded = false;
let adminBookingServices = [];
let adminBookingStylists = [];
let adminBookingCustomers = [];

// Enhanced state management for filters, sorting, pagination, selection
const bookingsState = {
    filters: {
        status: 'all',
        stylistId: 'all',
        serviceId: 'all',
        timeOfDay: 'all',
        dateFrom: null,
        dateTo: null,
        search: ''
    },
    sorting: {
        sortBy: 'date',
        sortDir: 'asc'
    },
    pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
    },
    selection: {
        selected: new Set(),
        selectAll: false
    },
    grouping: {
        enabled: false
    }
};

const formatAdminDate = (value, options = {}) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date)) return '';
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...options
    }).format(date);
};

const formatAdminDateWithTime = (value, timeText) => {
    const formatted = formatAdminDate(value);
    if (!formatted) return '';
    return timeText ? `${formatted} ${timeText.startsWith('at') ? timeText : `at ${timeText}`}` : formatted;
};

// Debounce for search
let searchDebounceTimer = null;

// Ensure admin booking data loaded
async function ensureAdminBookingData() {
    if (adminBookingDataLoaded) return;

    const [hairServices, beautyServices, stylistsData, customersData] = await Promise.all([
        apiCall('/services/hair'),
        apiCall('/services/beauty'),
        apiCall('/stylists'),
        apiCall('/admin/customers')
    ]);

    adminBookingServices = [...(hairServices.services || []), ...(beautyServices.services || [])];
    adminBookingStylists = stylistsData.stylists || [];
    adminBookingCustomers = (customersData.customers || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    adminBookingDataLoaded = true;
    populateAdminBookingForm();
}

function populateAdminBookingForm() {
    const serviceSelect = document.getElementById('adminBookingService');
    if (serviceSelect) {
        serviceSelect.innerHTML = '<option value="">Select service...</option>' +
            adminBookingServices.map(s => `
                <option value="${s.id}" data-type="${s.service_type || s.serviceType || 'hair'}">
                    ${s.name} - R${s.price}
                </option>
            `).join('');
    }

    const stylistSelect = document.getElementById('adminBookingStylist');
    if (stylistSelect) {
        stylistSelect.innerHTML = '<option value="">Any available</option>' +
            adminBookingStylists.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    const customerSelect = document.getElementById('adminBookingCustomer');
    if (customerSelect) {
        customerSelect.innerHTML = '<option value="">Select customer...</option>' +
            adminBookingCustomers.map(c => `<option value="${c.id}">${c.name} (${c.email})</option>`).join('');
    }
}

async function openAdminBookingModal() {
    const errorEl = document.getElementById('adminBookingError');
    if (errorEl) errorEl.textContent = '';

    try {
        await ensureAdminBookingData();
        populateAdminBookingForm();
        document.getElementById('adminBookingDate').value = '';
        document.getElementById('adminBookingTime').value = '';
        document.getElementById('adminBookingPreferredTime').value = '';
        document.getElementById('adminBookingNotes').value = '';
        document.getElementById('adminBookingCustomer').value = '';
        document.getElementById('adminBookingService').value = '';
        handleAdminBookingServiceChange();
        openModal('addBookingModal');
    } catch (err) {
        alert(`Failed to load booking data: ${err.message}`);
    }
}

function handleAdminBookingServiceChange() {
    const select = document.getElementById('adminBookingService');
    const type = select?.selectedOptions[0]?.dataset.type || 'hair';
    const stylistGroup = document.getElementById('adminBookingStylistGroup');
    const preferredRow = document.getElementById('adminBookingPreferredRow');
    const timeGroup = document.getElementById('adminBookingTimeGroup');

    if (type === 'hair') {
        if (stylistGroup) stylistGroup.style.display = 'block';
        if (preferredRow) preferredRow.style.display = 'flex';
        if (timeGroup) timeGroup.style.display = 'none';
    } else {
        if (stylistGroup) stylistGroup.style.display = 'none';
        if (preferredRow) preferredRow.style.display = 'none';
        if (timeGroup) timeGroup.style.display = 'block';
    }
}

// Initialize filters (load stylists & services for dropdowns)
async function initBookingsFilters() {
    try {
        await ensureAdminBookingData();

        // Populate stylist filter
        const stylistFilter = document.getElementById('bookingsStylistFilter');
        if (stylistFilter) {
            stylistFilter.innerHTML = '<option value="all">All Stylists</option>' +
                adminBookingStylists.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }

        // Populate service filter
        const serviceFilter = document.getElementById('bookingsServiceFilter');
        if (serviceFilter) {
            serviceFilter.innerHTML = '<option value="all">All Services</option>' +
                adminBookingServices.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }

    } catch (error) {
        console.error('Error initializing bookings filters:', error);
    }
}

// Load bookings with current filters
async function loadBookings() {
    try {
        // Build query parameters
        const params = new URLSearchParams();

        // Filters
        if (bookingsState.filters.status !== 'all') {
            params.append('status', bookingsState.filters.status);
        }
        if (bookingsState.filters.stylistId !== 'all') {
            params.append('stylistId', bookingsState.filters.stylistId);
        }
        if (bookingsState.filters.serviceId !== 'all') {
            params.append('serviceId', bookingsState.filters.serviceId);
        }
        if (bookingsState.filters.timeOfDay !== 'all') {
            params.append('timeOfDay', bookingsState.filters.timeOfDay);
        }
        if (bookingsState.filters.dateFrom) {
            params.append('dateFrom', bookingsState.filters.dateFrom);
        }
        if (bookingsState.filters.dateTo) {
            params.append('dateTo', bookingsState.filters.dateTo);
        }
        if (bookingsState.filters.search) {
            params.append('search', bookingsState.filters.search);
        }

        // Sorting
        params.append('sortBy', bookingsState.sorting.sortBy);
        params.append('sortDir', bookingsState.sorting.sortDir);

        // Pagination
        params.append('page', bookingsState.pagination.page);
        params.append('limit', bookingsState.pagination.limit);

        const data = await apiCall(`/admin/bookings?${params.toString()}`);
        adminBookings = data.bookings || [];
        adminBookingsFiltered = adminBookings;

        // Update pagination state
        if (data.pagination) {
            bookingsState.pagination.total = data.pagination.total;
            bookingsState.pagination.totalPages = data.pagination.totalPages;
        }

        // Update total count display
        document.getElementById('bookingsTotalCount').textContent =
            `${adminBookings.length} shown of ${bookingsState.pagination.total} total`;

        // Render table and pagination
        renderBookingsTable();
        renderPaginationControls();
        updateSortIcons();

        // Render calendar if in calendar view
        if (currentBookingsView === 'calendar') {
            renderBookingsCalendar();
        }

    } catch (error) {
        console.error('Bookings load error:', error);
        document.getElementById('bookingsTableBody').innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: var(--danger);">
                    Failed to load bookings: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Render bookings table
function renderBookingsTable() {
    const container = document.getElementById('bookingsTableBody');
    if (!container) return;

    // Clear selection state when re-rendering
    bookingsState.selection.selected.clear();
    updateBulkActionsBar();

    if (adminBookingsFiltered.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: var(--gray-medium);">
                    No bookings found matching your filters
                </td>
            </tr>
        `;
        return;
    }

    if (bookingsState.grouping.enabled) {
        renderGroupedBookings(container);
    } else {
        renderFlatBookings(container);
    }
}

function formatBookingTimeDisplay(booking) {
    const windowLabels = {
        MORNING: 'Morning',
        AFTERNOON: 'Afternoon',
        LATE_AFTERNOON: 'Late Afternoon',
        EVENING: 'Evening'
    };
    if (booking.requestedTimeWindow && windowLabels[booking.requestedTimeWindow]) {
        return windowLabels[booking.requestedTimeWindow];
    }
    const rawTime = booking.confirmedTime || booking.assignedStartTime || booking.time || booking.preferredTimeOfDay;
    if (!rawTime) return 'TBC';
    if (typeof rawTime === 'string' && rawTime.includes('T')) {
        const d = new Date(rawTime);
        if (!isNaN(d)) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }
    return rawTime;
}

// Render flat list
function renderFlatBookings(container) {
    container.innerHTML = adminBookingsFiltered.map(b => renderBookingRow(b)).join('');
}

// Render grouped by date
function renderGroupedBookings(container) {
    const grouped = {};
    adminBookingsFiltered.forEach(b => {
        const dateKey = b.date.split('T')[0];
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(b);
    });

    const sortedDates = Object.keys(grouped).sort();
    let html = '';

    sortedDates.forEach(dateKey => {
        const date = new Date(dateKey + 'T00:00:00');
        const formattedDate = formatAdminDate(date, {
            weekday: 'long'
        });

        html += `
            <tr style="background: var(--gray-light);">
                <td colspan="9" style="font-weight: 600; padding: 12px 15px; color: var(--dark);">
                    📅 ${formattedDate} (${grouped[dateKey].length} booking${grouped[dateKey].length > 1 ? 's' : ''})
                </td>
            </tr>
        `;

        grouped[dateKey].forEach(b => {
            html += renderBookingRow(b);
        });
    });

    container.innerHTML = html;
}

// Render single booking row
function renderBookingRow(b) {
    const dateStr = formatAdminDate(b.date);
    const timeStr = formatBookingTimeDisplay(b);
    const shortId = b.id.substring(0, 8);
    const isSelected = bookingsState.selection.selected.has(b.id);

    // Status badge colors
    const statusColors = {
        'pending': 'background: rgba(255, 152, 0, 0.15); color: var(--warning);',
        'confirmed': 'background: rgba(76, 175, 80, 0.15); color: var(--success);',
        'completed': 'background: rgba(246, 117, 153, 0.2); color: var(--brand-pink);',
        'cancelled': 'background: rgba(231, 76, 60, 0.18); color: var(--danger);'
    };

    return `
        <tr style="${isSelected ? 'background: var(--primary-light);' : ''}">
            <td>
                <input type="checkbox" class="booking-checkbox" data-booking-id="${b.id}"
                       ${isSelected ? 'checked' : ''} onchange="toggleBookingSelection('${b.id}')">
            </td>
            <td>
                <code style="font-size: 11px; background: var(--gray-light); padding: 2px 6px; border-radius: 3px;"
                      title="${b.id}">${shortId}</code>
            </td>
            <td>
                <div style="font-weight: 500;">${b.customerName || 'Guest'}</div>
                <div style="font-size: 12px; color: var(--gray-medium);">${b.customerEmail || ''}</div>
            </td>
            <td>${b.serviceName}</td>
            <td>${b.stylistName || 'Any Available'}</td>
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td>
                <span style="display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; ${statusColors[b.status] || ''}">
                    ${b.status}
                </span>
            </td>
            <td class="action-btns">
                ${b.status === 'pending' ? `
                    <button class="btn btn-sm" onclick="confirmBookingTime('${b.id}')" title="Confirm">✓</button>
                    <button class="btn btn-sm btn-outline" onclick="cancelBooking('${b.id}')" title="Cancel">✗</button>
                ` : b.status === 'confirmed' ? `
                    <button class="btn btn-sm" onclick="completeBooking('${b.id}')" title="Complete">✓</button>
                    <button class="btn btn-sm btn-outline" onclick="cancelBooking('${b.id}')" title="Cancel">✗</button>
                ` : `
                    <span style="color: var(--gray-medium); font-size: 11px;">-</span>
                `}
            </td>
        </tr>
    `;
}

// Search input handler (debounced)
function onBookingsSearchInput(value) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        bookingsState.filters.search = value.trim();
        bookingsState.pagination.page = 1;
        loadBookings();
    }, 300);
}

// Filter change handler
function onBookingsFilterChange() {
    bookingsState.filters.status = document.getElementById('bookingsStatusFilter').value;
    bookingsState.filters.stylistId = document.getElementById('bookingsStylistFilter').value;
    bookingsState.filters.serviceId = document.getElementById('bookingsServiceFilter').value;
    bookingsState.filters.timeOfDay = document.getElementById('bookingsTimeFilter').value;

    // Date range
    const dateFrom = document.getElementById('bookingsDateFrom')?.value;
    const dateTo = document.getElementById('bookingsDateTo')?.value;
    bookingsState.filters.dateFrom = dateFrom || null;
    bookingsState.filters.dateTo = dateTo || null;

    bookingsState.pagination.page = 1;
    loadBookings();
}

// Date preset change
function onBookingsDatePresetChange() {
    const preset = document.getElementById('bookingsDatePreset').value;
    const today = new Date();
    const dateFromGroup = document.getElementById('bookingsDateFromGroup');
    const dateToGroup = document.getElementById('bookingsDateToGroup');

    if (preset === 'custom') {
        dateFromGroup.style.display = 'block';
        dateToGroup.style.display = 'block';
        return;
    } else {
        dateFromGroup.style.display = 'none';
        dateToGroup.style.display = 'none';
    }

    let dateFrom = null;
    let dateTo = null;

    switch(preset) {
        case 'today':
            dateFrom = dateTo = today.toISOString().split('T')[0];
            break;
        case 'tomorrow':
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateFrom = dateTo = tomorrow.toISOString().split('T')[0];
            break;
        case 'thisweek':
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            dateFrom = startOfWeek.toISOString().split('T')[0];
            dateTo = endOfWeek.toISOString().split('T')[0];
            break;
        case 'next7days':
            dateFrom = today.toISOString().split('T')[0];
            const next7 = new Date(today);
            next7.setDate(today.getDate() + 7);
            dateTo = next7.toISOString().split('T')[0];
            break;
    }

    bookingsState.filters.dateFrom = dateFrom;
    bookingsState.filters.dateTo = dateTo;

    if (preset !== 'all') {
        document.getElementById('bookingsDateFrom').value = dateFrom || '';
        document.getElementById('bookingsDateTo').value = dateTo || '';
    }

    bookingsState.pagination.page = 1;
    loadBookings();
}

// Clear all filters
function clearAllBookingsFilters() {
    // Reset filters
    bookingsState.filters = {
        status: 'all',
        stylistId: 'all',
        serviceId: 'all',
        timeOfDay: 'all',
        dateFrom: null,
        dateTo: null,
        search: ''
    };
    bookingsState.pagination.page = 1;

    // Reset UI
    document.getElementById('bookingsSearchInput').value = '';
    document.getElementById('bookingsStatusFilter').value = 'all';
    document.getElementById('bookingsStylistFilter').value = 'all';
    document.getElementById('bookingsServiceFilter').value = 'all';
    document.getElementById('bookingsTimeFilter').value = 'all';
    document.getElementById('bookingsDatePreset').value = 'all';
    document.getElementById('bookingsDateFrom').value = '';
    document.getElementById('bookingsDateTo').value = '';
    document.getElementById('bookingsDateFromGroup').style.display = 'none';
    document.getElementById('bookingsDateToGroup').style.display = 'none';

    loadBookings();
}

// Sorting
function sortBookingsBy(field) {
    if (bookingsState.sorting.sortBy === field) {
        // Toggle direction
        bookingsState.sorting.sortDir = bookingsState.sorting.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        bookingsState.sorting.sortBy = field;
        bookingsState.sorting.sortDir = 'asc';
    }

    loadBookings();
}

// Update sort icons
function updateSortIcons() {
    const fields = ['customer', 'service', 'stylist', 'date', 'status'];
    fields.forEach(field => {
        const icon = document.getElementById(`sortIcon${field.charAt(0).toUpperCase() + field.slice(1)}`);
        if (icon) {
            if (bookingsState.sorting.sortBy === field) {
                icon.textContent = bookingsState.sorting.sortDir === 'asc' ? '↑' : '↓';
                icon.style.color = 'var(--primary)';
            } else {
                icon.textContent = '↕';
                icon.style.color = 'var(--gray-medium)';
            }
        }
    });
}

// Pagination
function renderPaginationControls() {
    const paginationDiv = document.getElementById('bookingsPagination');
    const infoDiv = document.getElementById('bookingsPaginationInfo');
    const pagesDiv = document.getElementById('bookingsPaginationPages');
    const prevBtn = document.getElementById('bookingsPrevPage');
    const nextBtn = document.getElementById('bookingsNextPage');

    if (!paginationDiv) return;

    const { page, limit, total, totalPages } = bookingsState.pagination;

    if (total === 0) {
        paginationDiv.style.display = 'none';
        return;
    }

    paginationDiv.style.display = 'flex';

    // Update info
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    infoDiv.textContent = `Showing ${start}-${end} of ${total}`;

    // Update buttons
    prevBtn.disabled = page === 1;
    nextBtn.disabled = page === totalPages;

    // Render page numbers (show 5 pages max)
    let html = '';
    const maxPages = 5;
    let startPage = Math.max(1, page - Math.floor(maxPages / 2));
    let endPage = Math.min(totalPages, startPage + maxPages - 1);

    if (endPage - startPage < maxPages - 1) {
        startPage = Math.max(1, endPage - maxPages + 1);
    }

    if (startPage > 1) {
        html += `<button class="btn btn-sm btn-outline" onclick="goToBookingsPage(1)">1</button>`;
        if (startPage > 2) {
            html += `<span style="padding: 0 10px; color: var(--gray-medium);">...</span>`;
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === page;
        html += `<button class="btn btn-sm ${isActive ? '' : 'btn-outline'}"
                         style="${isActive ? 'background: var(--primary); color: white;' : ''}"
                         onclick="goToBookingsPage(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span style="padding: 0 10px; color: var(--gray-medium);">...</span>`;
        }
        html += `<button class="btn btn-sm btn-outline" onclick="goToBookingsPage(${totalPages})">${totalPages}</button>`;
    }

    pagesDiv.innerHTML = html;
}

function goToBookingsPage(pageOrAction) {
    if (pageOrAction === 'prev') {
        bookingsState.pagination.page = Math.max(1, bookingsState.pagination.page - 1);
    } else if (pageOrAction === 'next') {
        bookingsState.pagination.page = Math.min(bookingsState.pagination.totalPages, bookingsState.pagination.page + 1);
    } else {
        bookingsState.pagination.page = pageOrAction;
    }
    loadBookings();
}

function onBookingsPageSizeChange() {
    bookingsState.pagination.limit = parseInt(document.getElementById('bookingsPageSize').value);
    bookingsState.pagination.page = 1;
    loadBookings();
}

// Selection & Bulk Actions
function toggleBookingSelection(id) {
    if (bookingsState.selection.selected.has(id)) {
        bookingsState.selection.selected.delete(id);
    } else {
        bookingsState.selection.selected.add(id);
    }
    updateBulkActionsBar();
}

function toggleSelectAllBookings() {
    const checkbox = document.getElementById('bookingsSelectAll');
    const checkboxes = document.querySelectorAll('.booking-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => {
            const id = cb.dataset.bookingId;
            bookingsState.selection.selected.add(id);
            cb.checked = true;
        });
    } else {
        checkboxes.forEach(cb => {
            const id = cb.dataset.bookingId;
            bookingsState.selection.selected.delete(id);
            cb.checked = false;
        });
    }

    updateBulkActionsBar();
}

function deselectAllBookings() {
    bookingsState.selection.selected.clear();
    document.querySelectorAll('.booking-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('bookingsSelectAll').checked = false;
    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bookingsBulkActionsBar');
    const count = document.getElementById('bookingsSelectedCount');
    const selectedCount = bookingsState.selection.selected.size;

    if (selectedCount > 0) {
        bar.style.display = 'block';
        count.textContent = `${selectedCount} selected`;
    } else {
        bar.style.display = 'none';
    }
}

// Bulk operations
async function bulkConfirmBookings() {
    await bulkUpdateStatus('confirmed', '✓ Confirm', 'Confirm');
}

async function bulkCompleteBookings() {
    await bulkUpdateStatus('completed', '✓ Mark as Complete', 'Complete');
}

async function bulkCancelBookings() {
    const proceed = confirm('Are you sure you want to cancel the selected bookings? This action cannot be undone.');
    if (!proceed) return;
    await bulkUpdateStatus('cancelled', '✗ Cancel', 'Cancel');
}

async function bulkUpdateStatus(status, actionName, verb) {
    const bookingIds = Array.from(bookingsState.selection.selected);

    if (bookingIds.length === 0) {
        alert('No bookings selected');
        return;
    }

    try {
        const response = await apiCall('/admin/bookings/bulk-status', {
            method: 'PATCH',
            body: JSON.stringify({ bookingIds, status })
        });

        if (response.success) {
            alert(`${verb}ed ${response.updated} booking(s) successfully!${response.failed > 0 ? `\n${response.failed} failed.` : ''}`);
            deselectAllBookings();
            loadBookings();
        } else {
            throw new Error(response.message || 'Bulk update failed');
        }
    } catch (error) {
        console.error('Bulk update error:', error);
        alert(`Error: ${error.message}`);
    }
}

// Grouping toggle
function toggleBookingsGrouping() {
    bookingsState.grouping.enabled = document.getElementById('bookingsGroupByDate').checked;
    renderBookingsTable();
}

// Export to CSV
function exportBookingsToCSV() {
    if (adminBookingsFiltered.length === 0) {
        alert('No bookings to export');
        return;
    }

    // CSV headers
    const headers = ['ID', 'Client Name', 'Client Email', 'Client Phone', 'Service', 'Stylist', 'Date', 'Time', 'Status', 'Created At'];

    // CSV rows
    const rows = adminBookingsFiltered.map(b => [
        b.id,
        b.customerName || '',
        b.customerEmail || '',
        b.customerPhone || '',
        b.serviceName,
        b.stylistName || 'Any Available',
        b.date,
        b.confirmedTime || b.time || b.preferredTimeOfDay || 'TBC',
        b.status,
        b.createdAt || ''
    ]);

    // Build CSV content
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `bookings_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Calendar rendering (keep existing calendar implementation)
function renderBookingsCalendar() {
    const grid = document.getElementById('bookingsCalendarGrid');
    const monthLabel = document.getElementById('bookingsCalendarMonthLabel');
    if (!grid || !monthLabel) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate target month
    const targetDate = new Date(today.getFullYear(), today.getMonth() + bookingsCalendarMonthOffset, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    // Update month label
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    monthLabel.textContent = `${monthNames[month]} ${year}`;

    // Group bookings by date
    const bookingsByDate = {};
    adminBookings.forEach(b => {
        const dateKey = b.date.split('T')[0];
        if (!bookingsByDate[dateKey]) bookingsByDate[dateKey] = [];
        bookingsByDate[dateKey].push(b);
    });

    // Build calendar grid
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = '';

    // Empty cells before first day
    for (let i = 0; i < firstDayOfMonth; i++) {
        html += '<div style="min-height: 100px; background: var(--gray-light); border-radius: 8px; opacity: 0.3;"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(year, month, day);
        const dateKey = cellDate.toISOString().split('T')[0];
        const isToday = cellDate.getTime() === today.getTime();
        const isPast = cellDate < today;
        const dayBookings = bookingsByDate[dateKey] || [];
        const hasBookings = dayBookings.length > 0;

        const pendingCount = dayBookings.filter(b => b.status === 'pending').length;
        const confirmedCount = dayBookings.filter(b => b.status === 'confirmed').length;

        html += `
            <div onclick="${hasBookings ? `showBookingsForDay('${dateKey}')` : ''}"
                 style="min-height: 100px; background: white; border-radius: 8px; padding: 10px; border: 1px solid ${isToday ? 'var(--primary)' : 'var(--gray-light)'}; ${isPast ? 'opacity: 0.5;' : ''} ${hasBookings ? 'cursor: pointer;' : ''} position: relative; ${isToday ? 'box-shadow: 0 0 0 2px var(--primary-light);' : ''}">
                <div style="font-weight: 600; font-size: 14px; color: ${isToday ? 'var(--primary)' : 'var(--dark)'};">${day}</div>
                ${hasBookings ? `
                    <div style="margin-top: 8px;">
                        <div style="font-size: 20px; font-weight: 700; color: var(--primary);">${dayBookings.length}</div>
                        <div style="font-size: 10px; color: var(--gray-medium);">booking${dayBookings.length > 1 ? 's' : ''}</div>
                    </div>
                    <div style="display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap;">
                        ${pendingCount > 0 ? `<span style="font-size: 9px; padding: 2px 6px; background: #fff3cd; color: #856404; border-radius: 10px;">${pendingCount} pending</span>` : ''}
                        ${confirmedCount > 0 ? `<span style="font-size: 9px; padding: 2px 6px; background: #d4edda; color: #155724; border-radius: 10px;">${confirmedCount} confirmed</span>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }

    grid.innerHTML = html;
}

function setBookingsView(view) {
    currentBookingsView = view;
    const listView = document.getElementById('bookingsListView');
    const calendarView = document.getElementById('bookingsCalendarView');
    const listBtn = document.getElementById('bookingsListViewBtn');
    const calendarBtn = document.getElementById('bookingsCalendarViewBtn');

    if (view === 'list') {
        listView.style.display = 'block';
        calendarView.style.display = 'none';
        listBtn.style.background = 'var(--primary)';
        listBtn.style.color = 'white';
        listBtn.classList.remove('btn-outline');
        calendarBtn.style.background = '';
        calendarBtn.style.color = '';
        calendarBtn.classList.add('btn-outline');
    } else {
        listView.style.display = 'none';
        calendarView.style.display = 'block';
        calendarBtn.style.background = 'var(--primary)';
        calendarBtn.style.color = 'white';
        calendarBtn.classList.remove('btn-outline');
        listBtn.style.background = '';
        listBtn.style.color = '';
        listBtn.classList.add('btn-outline');
        renderBookingsCalendar();
    }
}

function changeBookingsCalendarMonth(delta) {
    bookingsCalendarMonthOffset += delta;
    renderBookingsCalendar();
}

function goToBookingsCalendarToday() {
    bookingsCalendarMonthOffset = 0;
    renderBookingsCalendar();
}

function showBookingsForDay(dateKey) {
    const dayBookings = adminBookings.filter(b => b.date.split('T')[0] === dateKey);
    const popup = document.getElementById('bookingsDayPopup');
    const title = document.getElementById('bookingsDayPopupTitle');
    const content = document.getElementById('bookingsDayPopupContent');

    const formattedDate = formatAdminDate(dateKey + 'T00:00:00', {
        weekday: 'long'
    });
    title.textContent = `Bookings for ${formattedDate}`;

    if (dayBookings.length === 0) {
        content.innerHTML = '<p style="color: var(--gray-medium); text-align: center;">No bookings for this day</p>';
    } else {
        content.innerHTML = dayBookings.map(b => {
            const timeStr = b.confirmedTime || b.time || b.preferredTimeOfDay || 'Time TBC';
            return `
                <div style="padding: 15px; border: 1px solid var(--gray-light); border-radius: 10px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                        <div>
                            <div style="font-weight: 600;">${b.customerName || 'Guest'}</div>
                            <div style="font-size: 12px; color: var(--gray-medium);">${b.customerEmail || ''}</div>
                        </div>
                        <span class="status-badge status-${b.status}">${b.status}</span>
                    </div>
                    <div style="font-size: 14px; margin-bottom: 5px;"><strong>Service:</strong> ${b.serviceName}</div>
                    <div style="font-size: 14px; margin-bottom: 5px;"><strong>Time:</strong> ${timeStr}</div>
                    ${b.stylistId ? `<div style="font-size: 14px;"><strong>Stylist:</strong> ${b.stylistId}</div>` : ''}
                    ${b.status === 'pending' ? `
                        <div style="margin-top: 10px; display: flex; gap: 10px;">
                            <button class="btn btn-sm btn-primary" onclick="confirmBookingTime('${b.id}'); closeBookingsDayPopup();">Confirm</button>
                            <button class="btn btn-sm btn-outline" onclick="cancelBooking('${b.id}'); closeBookingsDayPopup();">Cancel</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    popup.style.display = 'flex';
}

function closeBookingsDayPopup() {
    const popup = document.getElementById('bookingsDayPopup');
    if (popup) popup.style.display = 'none';
}

async function createAdminBooking() {
    const errorEl = document.getElementById('adminBookingError');
    if (errorEl) errorEl.textContent = '';

    const customerId = document.getElementById('adminBookingCustomer').value;
    const serviceId = document.getElementById('adminBookingService').value;
    const stylistId = document.getElementById('adminBookingStylist').value;
    const date = document.getElementById('adminBookingDate').value;
    const time = document.getElementById('adminBookingTime').value;
    const preferredTimeOfDay = document.getElementById('adminBookingPreferredTime').value;
    const notes = document.getElementById('adminBookingNotes').value;

    if (!customerId || !serviceId || !date) {
        if (errorEl) errorEl.textContent = 'Please fill in all required fields';
        return;
    }

    const service = adminBookingServices.find(s => s.id === serviceId);
    if (!service) {
        if (errorEl) errorEl.textContent = 'Invalid service selected';
        return;
    }

    const bookingData = {
        userId: customerId,
        bookingType: service.service_type || service.serviceType || 'hair',
        stylistId: stylistId || null,
        serviceId: serviceId,
        serviceName: service.name,
        servicePrice: service.price,
        date: date,
        time: time || null,
        preferredTimeOfDay: preferredTimeOfDay || null,
        notes: notes || null
    };

    try {
        await apiCall('/admin/bookings', {
            method: 'POST',
            body: JSON.stringify(bookingData)
        });

        alert('Booking created successfully!');
        closeModal('addBookingModal');
        loadBookings();
    } catch (error) {
        if (errorEl) errorEl.textContent = error.message;
    }
}

async function confirmBookingTime(id) {
    const time = prompt('Enter confirmed time (e.g., 10:00 AM):');
    if (!time) return;

    try {
        await apiCall(`/admin/bookings/${id}/confirm`, {
            method: 'PATCH',
            body: JSON.stringify({ confirmedTime: time })
        });
        alert('Booking confirmed!');
        loadBookings();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function completeBooking(id) {
    if (confirm('Mark this booking as completed?')) {
        try {
            await apiCall(`/admin/bookings/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'completed', completedAt: new Date().toISOString() })
            });
            alert('Booking marked as completed');
            loadBookings();
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
}

async function cancelBooking(id) {
    if (confirm('Cancel this booking?')) {
        try {
            await apiCall(`/admin/bookings/${id}/confirm`, {
                method: 'PATCH',
                body: JSON.stringify({ confirmedTime: null })
            });
            alert('Booking cancelled');
            loadBookings();
        } catch (error) {
            alert('Error: ' + error.message);
        }
    }
}
