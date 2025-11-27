# Booking Redesign - Implementation Guide

## ✅ Completed Steps

### 1. Database Migration
- ✅ Updated `db/schema.sql` with new booking fields
- ✅ Created migration script (`db/migrate-bookings-v2.js`)
- ✅ Successfully migrated 9 existing bookings
- ✅ New schema includes:
  - `requested_date` (date client wants)
  - `requested_time_window` (MORNING/AFTERNOON/LATE_AFTERNOON/EVENING)
  - `assigned_start_time` (exact time set by admin)
  - `assigned_end_time` (calculated from service duration)
  - `status` (REQUESTED/CONFIRMED/COMPLETED/CANCELLED)

### 2. Shared Constants
- ✅ Created `shared/booking-constants.js` with:
  - TIME_WINDOWS definitions
  - BOOKING_STATUS definitions
  - Helper functions for formatting and validation

## 📋 Remaining Implementation Steps

### Step 3: Update BookingRepository (db/database.js)

The BookingRepository needs to be updated to work with new fields. Here are the key changes:

#### 3.1 Update `create()` method
**Current (lines 437-449):**
```javascript
async create(booking) {
    const sql = `
        INSERT INTO bookings (id, user_id, booking_type, stylist_id, service_id, service_name, service_price, date, preferred_time_of_day, time, confirmed_time, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await dbRun(sql, [
        booking.id, booking.userId, booking.type || booking.bookingType, booking.stylistId || null,
        booking.serviceId, booking.serviceName, booking.servicePrice, booking.date,
        booking.preferredTimeOfDay || null, booking.time || null,
        booking.confirmedTime || null, booking.status || 'pending', booking.notes || null
    ]);
    return this.findById(booking.id);
},
```

**Updated:**
```javascript
async create(booking) {
    const sql = `
        INSERT INTO bookings (
            id, user_id, booking_type, stylist_id, service_id, service_name, service_price,
            requested_date, requested_time_window, assigned_start_time, assigned_end_time,
            status, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await dbRun(sql, [
        booking.id,
        booking.userId,
        booking.type || booking.bookingType,
        booking.stylistId || null,
        booking.serviceId,
        booking.serviceName,
        booking.servicePrice,
        booking.requestedDate,
        booking.requestedTimeWindow,
        booking.assignedStartTime || null,
        booking.assignedEndTime || null,
        booking.status || 'REQUESTED',
        booking.notes || null
    ]);
    return this.findById(booking.id);
},
```

#### 3.2 Update `update()` method
**Current field map (lines 455-458):**
```javascript
const fieldMap = {
    status: 'status', date: 'date', preferredTimeOfDay: 'preferred_time_of_day',
    time: 'time', confirmedTime: 'confirmed_time', notes: 'notes'
};
```

**Updated field map:**
```javascript
const fieldMap = {
    status: 'status',
    requestedDate: 'requested_date',
    requestedTimeWindow: 'requested_time_window',
    assignedStartTime: 'assigned_start_time',
    assignedEndTime: 'assigned_end_time',
    stylistId: 'stylist_id',
    notes: 'notes',
    // Keep legacy fields for backward compatibility during transition
    date: 'date',
    preferredTimeOfDay: 'preferred_time_of_day',
    time: 'time',
    confirmedTime: 'confirmed_time'
};
```

#### 3.3 Update `findAll()` filtering
**Current (line 395):**
```javascript
if (filters.timeOfDay && filters.timeOfDay !== 'all') {
    sql += ' AND b.preferred_time_of_day = ?';
    params.push(filters.timeOfDay);
}
```

**Updated:**
```javascript
// Time window filter (new field)
if (filters.timeWindow && filters.timeWindow !== 'all') {
    sql += ' AND b.requested_time_window = ?';
    params.push(filters.timeWindow);
}

// Legacy time of day filter (for backward compatibility)
if (filters.timeOfDay && filters.timeOfDay !== 'all') {
    sql += ' AND (b.preferred_time_of_day = ? OR b.requested_time_window = ?)';
    params.push(filters.timeOfDay, filters.timeOfDay);
}
```

#### 3.4 Update sorting (lines 421-432)
**Updated sort fields:**
```javascript
const validSortFields = {
    'date': 'b.requested_date',
    'requestedDate': 'b.requested_date',
    'assignedTime': 'b.assigned_start_time',
    'customer': 'u.name',
    'stylist': 's.name',
    'service': 'b.service_name',
    'status': 'b.status',
    'created': 'b.created_at'
};
const sortBy = filters.sortBy && validSortFields[filters.sortBy] ? validSortFields[filters.sortBy] : 'b.requested_date';
const sortDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';
sql += ` ORDER BY ${sortBy} ${sortDir}, b.assigned_start_time ${sortDir}`;
```

#### 3.5 Update `findConflict()` for new time fields
**Current (lines 331-345):**
```javascript
async findConflict(stylistId, date, time, excludeId = null) {
    let sql = `
        SELECT * FROM bookings
        WHERE stylist_id = ? AND date = ? AND status != 'cancelled'
        AND (confirmed_time = ? OR time = ?)
    `;
    const params = [stylistId, date, time, time];
    // ...
}
```

**Updated:**
```javascript
async findConflict(stylistId, assignedStartTime, assignedEndTime, excludeId = null) {
    // Check for overlapping time slots
    let sql = `
        SELECT * FROM bookings
        WHERE stylist_id = ?
        AND status IN ('CONFIRMED', 'REQUESTED')
        AND assigned_start_time IS NOT NULL
        AND (
            -- New booking starts during existing booking
            (? >= assigned_start_time AND ? < assigned_end_time)
            OR
            -- New booking ends during existing booking
            (? > assigned_start_time AND ? <= assigned_end_time)
            OR
            -- New booking completely overlaps existing booking
            (? <= assigned_start_time AND ? >= assigned_end_time)
        )
    `;
    const params = [
        stylistId,
        assignedStartTime, assignedStartTime,
        assignedEndTime, assignedEndTime,
        assignedStartTime, assignedEndTime
    ];

    if (excludeId) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }

    return dbGet(sql, params);
}
```

#### 3.6 Add new method: `assignTime()`
Add this new method to BookingRepository:

```javascript
async assignTime(bookingId, assignment) {
    // assignment = { stylistId, assignedStartTime, assignedEndTime }

    // Check for conflicts
    const conflict = await this.findConflict(
        assignment.stylistId,
        assignment.assignedStartTime,
        assignment.assignedEndTime,
        bookingId
    );

    if (conflict) {
        throw new Error(`Time slot conflict with booking ${conflict.id}`);
    }

    // Update booking with assigned time and CONFIRMED status
    const sql = `
        UPDATE bookings
        SET stylist_id = ?,
            assigned_start_time = ?,
            assigned_end_time = ?,
            status = 'CONFIRMED',
            updated_at = datetime('now')
        WHERE id = ?
    `;

    await dbRun(sql, [
        assignment.stylistId,
        assignment.assignedStartTime,
        assignment.assignedEndTime,
        bookingId
    ]);

    return this.findById(bookingId);
},
```

### Step 4: Update Backend API Endpoints (server.js)

#### 4.1 Update POST /api/bookings (Client Create)
**Location:** Search for `app.post('/api/bookings'`

**Current creates booking with:**
- date, preferred_time_of_day, time

**Update to:**
```javascript
app.post('/api/bookings', authenticateToken, async (req, res) => {
    try {
        const {
            serviceId,
            requestedDate,
            requestedTimeWindow,
            stylistId,  // Optional - can be null for "Any available"
            notes
        } = req.body;

        // Validate required fields
        if (!serviceId || !requestedDate || !requestedTimeWindow) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: serviceId, requestedDate, requestedTimeWindow'
            });
        }

        // Validate time window
        const { TIME_WINDOWS } = require('./shared/booking-constants');
        if (!TIME_WINDOWS[requestedTimeWindow]) {
            return res.status(400).json({
                success: false,
                message: 'Invalid requestedTimeWindow. Must be MORNING, AFTERNOON, LATE_AFTERNOON, or EVENING'
            });
        }

        // Get service details
        const service = await ServiceRepository.findById(serviceId);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Create booking with REQUESTED status
        const booking = await BookingRepository.create({
            id: generateId(),
            userId: req.user.id,
            bookingType: service.service_type,
            stylistId: stylistId || null,
            serviceId: service.id,
            serviceName: service.name,
            servicePrice: service.price,
            requestedDate,
            requestedTimeWindow,
            assignedStartTime: null,  // Not assigned yet
            assignedEndTime: null,
            status: 'REQUESTED',
            notes: notes || null
        });

        res.json({
            success: true,
            booking,
            message: 'Booking request submitted! We\'ll confirm your exact time shortly.'
        });

    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
```

#### 4.2 Create NEW endpoint: POST /api/admin/bookings/:id/assign-time
Add this completely new endpoint for admin time assignment:

```javascript
app.post('/api/admin/bookings/:id/assign-time', authenticateAdmin, async (req, res) => {
    try {
        const { stylistId, assignedStartTime, assignedEndTime } = req.body;

        // Validate inputs
        if (!stylistId || !assignedStartTime || !assignedEndTime) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: stylistId, assignedStartTime, assignedEndTime'
            });
        }

        // Verify booking exists and is in REQUESTED status
        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (booking.status !== 'REQUESTED') {
            return res.status(400).json({
                success: false,
                message: `Booking is already ${booking.status}. Can only assign time to REQUESTED bookings.`
            });
        }

        // Assign the time (this checks for conflicts)
        const updatedBooking = await BookingRepository.assignTime(req.params.id, {
            stylistId,
            assignedStartTime,
            assignedEndTime
        });

        // TODO: Send notification to customer
        // await sendBookingConfirmationEmail(updatedBooking);
        // await sendBookingConfirmationPush(updatedBooking);

        res.json({
            success: true,
            booking: updatedBooking,
            message: 'Time assigned and booking confirmed!'
        });

    } catch (error) {
        console.error('Assign time error:', error);
        if (error.message.includes('conflict')) {
            return res.status(409).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});
```

#### 4.3 Update GET /api/admin/bookings
Add support for filtering by new status values:

```javascript
// In the endpoint, after building filters:
if (filters.status) {
    // Map legacy status values to new ones if needed
    const statusMap = {
        'pending': 'REQUESTED',  // Legacy → New
        'confirmed': 'CONFIRMED',
        'completed': 'COMPLETED',
        'cancelled': 'CANCELLED'
    };
    filters.status = statusMap[filters.status] || filters.status;
}
```

### Step 5: Update Client Booking Form (flirt-hair-app.html)

#### 5.1 Find the booking form
Search for booking form UI (likely has service selector, date picker)

#### 5.2 Replace time input with time window selector
**Current:** Probably has a time picker or dropdown for exact times

**Replace with:**
```html
<div class="form-group">
    <label class="form-label">Preferred Time</label>
    <p style="font-size: 12px; color: var(--gray-medium); margin-bottom: 10px;">
        Select your preferred time window. We'll confirm the exact time shortly.
    </p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <button type="button" class="time-window-btn" data-window="MORNING" onclick="selectTimeWindow('MORNING')">
            <div style="font-size: 24px; margin-bottom: 5px;">🌅</div>
            <div style="font-weight: 600;">Morning</div>
            <div style="font-size: 11px; color: var(--gray-medium);">6AM - 12PM</div>
        </button>
        <button type="button" class="time-window-btn" data-window="AFTERNOON" onclick="selectTimeWindow('AFTERNOON')">
            <div style="font-size: 24px; margin-bottom: 5px;">☀️</div>
            <div style="font-weight: 600;">Afternoon</div>
            <div style="font-size: 11px; color: var(--gray-medium);">12PM - 3PM</div>
        </button>
        <button type="button" class="time-window-btn" data-window="LATE_AFTERNOON" onclick="selectTimeWindow('LATE_AFTERNOON')">
            <div style="font-size: 24px; margin-bottom: 5px;">🌤️</div>
            <div style="font-weight: 600;">Late Afternoon</div>
            <div style="font-size: 11px; color: var(--gray-medium);">3PM - 6PM</div>
        </button>
        <button type="button" class="time-window-btn" data-window="EVENING" onclick="selectTimeWindow('EVENING')">
            <div style="font-size: 24px; margin-bottom: 5px;">🌙</div>
            <div style="font-weight: 600;">Evening</div>
            <div style="font-size: 11px; color: var(--gray-medium);">6PM - 10PM</div>
        </button>
    </div>
    <input type="hidden" id="bookingTimeWindow" required>
</div>

<style>
.time-window-btn {
    border: 2px solid var(--gray-light);
    background: white;
    padding: 15px;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
}

.time-window-btn:hover {
    border-color: var(--primary);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.time-window-btn.selected {
    border-color: var(--primary);
    background: var(--primary-light);
    box-shadow: 0 0 0 3px rgba(255, 107, 157, 0.2);
}
</style>

<script>
let selectedTimeWindow = null;

function selectTimeWindow(window) {
    selectedTimeWindow = window;
    document.getElementById('bookingTimeWindow').value = window;

    // Update UI
    document.querySelectorAll('.time-window-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.querySelector(`[data-window="${window}"]`).classList.add('selected');
}
</script>
```

#### 5.3 Update booking submission
**Find the submit handler**, update to send:
```javascript
const bookingData = {
    serviceId: selectedService,
    requestedDate: selectedDate,
    requestedTimeWindow: selectedTimeWindow,  // Instead of exact time
    stylistId: selectedStylist || null,
    notes: notesInput
};

const response = await apiCall('/bookings', {
    method: 'POST',
    body: JSON.stringify(bookingData)
});
```

### Step 6: Update Client Booking History Display

#### 6.1 Find booking list/history rendering
Search for where user bookings are displayed

#### 6.2 Update status rendering
```javascript
function renderBooking(booking) {
    const status = booking.status;
    const statusConfig = {
        'REQUESTED': { label: 'Pending', color: '#FFC107', icon: '⏳' },
        'CONFIRMED': { label: 'Confirmed', color: '#28A745', icon: '✓' },
        'COMPLETED': { label: 'Completed', color: '#007BFF', icon: '✓✓' },
        'CANCELLED': { label: 'Cancelled', color: '#DC3545', icon: '✗' }
    };
    const s = statusConfig[status] || statusConfig['REQUESTED'];

    // Show different UI for REQUESTED vs CONFIRMED
    const timeDisplay = booking.assignedStartTime
        ? `<div class="booking-time">
             <strong>Confirmed Time:</strong><br>
             ${new Date(booking.assignedStartTime).toLocaleString()}
           </div>`
        : `<div class="booking-time-pending">
             <strong>Requested:</strong> ${booking.requestedTimeWindow}<br>
             <small style="color: var(--gray-medium);">⏳ Awaiting exact time confirmation</small>
           </div>`;

    return `
        <div class="booking-card status-${status.toLowerCase()}">
            <div class="booking-header">
                <span class="status-badge" style="background: ${s.color};">
                    ${s.icon} ${s.label}
                </span>
                <span class="booking-date">${booking.requestedDate}</span>
            </div>
            <div class="booking-details">
                <h4>${booking.serviceName}</h4>
                ${timeDisplay}
                ${booking.stylistName ? `<div>Stylist: ${booking.stylistName}</div>` : ''}
            </div>
        </div>
    `;
}
```

### Step 7: Create Admin "Assign Time" Modal

This is a completely new component for the admin console.

#### 7.1 Add Modal HTML to flirt-admin-console.html
Add this after other modals (around line 1600-1700):

```html
<!-- Assign Time Modal -->
<div id="assignTimeModal" class="modal-overlay" style="display: none;">
    <div class="modal-content" style="max-width: 900px;">
        <div class="modal-header">
            <h3>Assign Exact Time</h3>
            <button class="modal-close" onclick="closeModal('assignTimeModal')">&times;</button>
        </div>
        <div class="modal-body">
            <!-- Booking Summary -->
            <div id="assignTimeBookingSummary" style="background: var(--gray-light); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <!-- Populated by JS -->
            </div>

            <!-- Stylist Selector -->
            <div class="form-group">
                <label class="form-label">Assign to Stylist</label>
                <select id="assignTimeStylist" class="form-input" onchange="loadStylistSchedule()">
                    <option value="">Select stylist...</option>
                    <!-- Populated by JS -->
                </select>
            </div>

            <!-- Date Selector -->
            <div class="form-group">
                <label class="form-label">Date</label>
                <input type="date" id="assignTimeDate" class="form-input" onchange="loadStylistSchedule()">
            </div>

            <!-- Schedule Grid -->
            <div id="assignTimeSchedule" style="border: 1px solid var(--gray-light); border-radius: 8px; padding: 15px; max-height: 400px; overflow-y: auto;">
                <p style="text-align: center; color: var(--gray-medium);">
                    Select a stylist and date to view available time slots
                </p>
            </div>

            <!-- Selected Time Display -->
            <div id="assignTimeSelected" style="display: none; margin-top: 15px; padding: 15px; background: var(--primary-light); border-radius: 8px;">
                <strong>Selected Time:</strong>
                <span id="assignTimeSelectedDisplay"></span>
            </div>

            <div id="assignTimeError" style="display: none; margin-top: 15px; padding: 15px; background: var(--danger-light); color: var(--danger); border-radius: 8px;"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-outline" onclick="closeModal('assignTimeModal')">Cancel</button>
            <button class="btn btn-primary" onclick="confirmTimeAssignment()" id="assignTimeConfirmBtn" disabled>
                Confirm & Notify Client
            </button>
        </div>
    </div>
</div>
```

#### 7.2 Add JavaScript for Assign Time Modal
```javascript
let currentAssigningBooking = null;
let selectedAssignmentSlot = null;

async function openAssignTimeModal(bookingId) {
    currentAssigningBooking = adminBookings.find(b => b.id === bookingId);
    if (!currentAssigningBooking) {
        alert('Booking not found');
        return;
    }

    // Populate summary
    document.getElementById('assignTimeBookingSummary').innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
            <div>
                <div style="font-size: 12px; color: var(--gray-medium); margin-bottom: 5px;">CLIENT</div>
                <div style="font-weight: 600;">${currentAssigningBooking.customerName}</div>
                <div style="font-size: 12px; color: var(--gray-medium);">${currentAssigningBooking.customerEmail}</div>
            </div>
            <div>
                <div style="font-size: 12px; color: var(--gray-medium); margin-bottom: 5px;">SERVICE</div>
                <div style="font-weight: 600;">${currentAssigningBooking.serviceName}</div>
                <div style="font-size: 12px; color: var(--gray-medium);">R${currentAssigningBooking.servicePrice}</div>
            </div>
            <div>
                <div style="font-size: 12px; color: var(--gray-medium); margin-bottom: 5px;">REQUESTED</div>
                <div style="font-weight: 600;">${currentAssigningBooking.requestedDate}</div>
                <div style="font-size: 12px; color: var(--gray-medium);">${currentAssigningBooking.requestedTimeWindow}</div>
            </div>
            <div>
                <div style="font-size: 12px; color: var(--gray-medium); margin-bottom: 5px;">PREFERRED STYLIST</div>
                <div style="font-weight: 600;">${currentAssigningBooking.stylistName || 'Any Available'}</div>
            </div>
        </div>
    `;

    // Populate stylist dropdown
    await ensureAdminBookingData();
    const stylistSelect = document.getElementById('assignTimeStylist');
    stylistSelect.innerHTML = '<option value="">Select stylist...</option>' +
        adminBookingStylists.map(s => `
            <option value="${s.id}" ${s.id === currentAssigningBooking.stylistId ? 'selected' : ''}>
                ${s.name}
            </option>
        `).join('');

    // Set default date to requested date
    document.getElementById('assignTimeDate').value = currentAssigningBooking.requestedDate;

    // Reset selected slot
    selectedAssignmentSlot = null;
    document.getElementById('assignTimeSelected').style.display = 'none';
    document.getElementById('assignTimeConfirmBtn').disabled = true;

    openModal('assignTimeModal');

    // Load schedule if stylist is preselected
    if (currentAssigningBooking.stylistId) {
        loadStylistSchedule();
    }
}

async function loadStylistSchedule() {
    const stylistId = document.getElementById('assignTimeStylist').value;
    const date = document.getElementById('assignTimeDate').value;
    const scheduleDiv = document.getElementById('assignTimeSchedule');

    if (!stylistId || !date) {
        scheduleDiv.innerHTML = '<p style="text-align: center; color: var(--gray-medium);">Select a stylist and date to view available time slots</p>';
        return;
    }

    scheduleDiv.innerHTML = '<p style="text-align: center; color: var(--gray-medium);">Loading schedule...</p>';

    try {
        // Fetch bookings for this stylist on this date
        const response = await apiCall(`/admin/bookings?stylistId=${stylistId}&date=${date}`);
        const existingBookings = response.bookings.filter(b => b.status === 'CONFIRMED' && b.assignedStartTime);

        // Generate time slots (6 AM to 10 PM, 30-minute intervals)
        const slots = [];
        for (let hour = 6; hour < 22; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                const slotStart = new Date(`${date}T${timeStr}:00`);
                const slotEnd = new Date(slotStart.getTime() + (2 * 60 * 60 * 1000)); // Assume 2-hour duration

                // Check if slot conflicts with existing bookings
                const hasConflict = existingBookings.some(b => {
                    const bookingStart = new Date(b.assignedStartTime);
                    const bookingEnd = new Date(b.assignedEndTime);
                    return (slotStart < bookingEnd && slotEnd > bookingStart);
                });

                // Check if slot is in requested time window
                const requestedWindow = currentAssigningBooking.requestedTimeWindow;
                const windowRanges = {
                    'MORNING': [6, 12],
                    'AFTERNOON': [12, 15],
                    'LATE_AFTERNOON': [15, 18],
                    'EVENING': [18, 22]
                };
                const [windowStart, windowEnd] = windowRanges[requestedWindow] || [0, 24];
                const inRequestedWindow = hour >= windowStart && hour < windowEnd;

                slots.push({ timeStr, slotStart, slotEnd, hasConflict, inRequestedWindow });
            }
        }

        // Render slots
        scheduleDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid var(--gray-light);">
                <div style="display: flex; align-items: center; gap: 5px;">
                    <div style="width: 15px; height: 15px; background: var(--primary-light); border: 2px solid var(--primary); border-radius: 3px;"></div>
                    <span style="font-size: 12px;">Requested Window</span>
                </div>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <div style="width: 15px; height: 15px; background: var(--gray-light); border: 2px solid var(--gray-medium); border-radius: 3px;"></div>
                    <span style="font-size: 12px;">Booked</span>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px;">
                ${slots.map(slot => {
                    const slotId = slot.timeStr.replace(':', '');
                    return `
                        <button
                            class="time-slot-btn ${slot.inRequestedWindow ? 'in-window' : ''} ${slot.hasConflict ? 'booked' : ''}"
                            data-time="${slot.timeStr}"
                            data-start="${slot.slotStart.toISOString()}"
                            data-end="${slot.slotEnd.toISOString()}"
                            onclick="selectTimeSlot(this)"
                            ${slot.hasConflict ? 'disabled' : ''}
                        >
                            ${slot.timeStr}
                        </button>
                    `;
                }).join('')}
            </div>
        `;

    } catch (error) {
        scheduleDiv.innerHTML = `<p style="text-align: center; color: var(--danger);">Error loading schedule: ${error.message}</p>`;
    }
}

function selectTimeSlot(button) {
    // Remove previous selection
    document.querySelectorAll('.time-slot-btn').forEach(btn => btn.classList.remove('selected'));

    // Mark as selected
    button.classList.add('selected');

    // Store selection
    selectedAssignmentSlot = {
        time: button.dataset.time,
        start: button.dataset.start,
        end: button.dataset.end
    };

    // Update display
    const selectedDiv = document.getElementById('assignTimeSelected');
    const selectedDisplay = document.getElementById('assignTimeSelectedDisplay');
    selectedDisplay.textContent = `${new Date(selectedAssignmentSlot.start).toLocaleString()} - ${new Date(selectedAssignmentSlot.end).toLocaleTimeString()}`;
    selectedDiv.style.display = 'block';

    // Enable confirm button
    document.getElementById('assignTimeConfirmBtn').disabled = false;
}

async function confirmTimeAssignment() {
    if (!selectedAssignmentSlot) {
        alert('Please select a time slot');
        return;
    }

    const stylistId = document.getElementById('assignTimeStylist').value;
    if (!stylistId) {
        alert('Please select a stylist');
        return;
    }

    try {
        const response = await apiCall(`/admin/bookings/${currentAssigningBooking.id}/assign-time`, {
            method: 'POST',
            body: JSON.stringify({
                stylistId,
                assignedStartTime: selectedAssignmentSlot.start,
                assignedEndTime: selectedAssignmentSlot.end
            })
        });

        if (response.success) {
            alert('Time assigned and client notified!');
            closeModal('assignTimeModal');
            loadBookings(); // Refresh bookings list
        }
    } catch (error) {
        const errorDiv = document.getElementById('assignTimeError');
        errorDiv.textContent = error.message;
        errorDiv.style.display = 'block';
    }
}
```

#### 7.3 Add CSS for time slots
```css
.time-slot-btn {
    padding: 10px;
    border: 2px solid var(--gray-light);
    background: white;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
}

.time-slot-btn:hover:not(:disabled) {
    border-color: var(--primary);
    transform: translateY(-2px);
}

.time-slot-btn.in-window {
    background: var(--primary-light);
    border-color: var(--primary);
}

.time-slot-btn.selected {
    background: var(--primary);
    color: white;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(255, 107, 157, 0.3);
}

.time-slot-btn.booked {
    background: var(--gray-light);
    border-color: var(--gray-medium);
    cursor: not-allowed;
    opacity: 0.5;
}
```

### Step 8: Update Admin Bookings List View

#### 8.1 Add Status Filter Tabs/Dropdown
Add this above the bookings table:

```html
<div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
    <button class="filter-tab active" data-status="all" onclick="filterBookingsByStatus('all')">
        All <span class="badge" id="filterBadgeAll">0</span>
    </button>
    <button class="filter-tab" data-status="REQUESTED" onclick="filterBookingsByStatus('REQUESTED')">
        ⏳ Pending <span class="badge badge-warning" id="filterBadgeREQUESTED">0</span>
    </button>
    <button class="filter-tab" data-status="CONFIRMED" onclick="filterBookingsByStatus('CONFIRMED')">
        ✓ Confirmed <span class="badge badge-success" id="filterBadgeCONFIRMED">0</span>
    </button>
    <button class="filter-tab" data-status="COMPLETED" onclick="filterBookingsByStatus('COMPLETED')">
        ✓✓ Completed <span class="badge badge-info" id="filterBadgeCOMPLETED">0</span>
    </button>
    <button class="filter-tab" data-status="CANCELLED" onclick="filterBookingsByStatus('CANCELLED')">
        ✗ Cancelled <span class="badge badge-danger" id="filterBadgeCANCELLED">0</span>
    </button>
</div>

<script>
function filterBookingsByStatus(status) {
    // Update filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.status === status);
    });

    // Apply filter
    bookingsFilters.status = status;
    loadBookings();
}
</script>
```

#### 8.2 Update Table Rendering
In `renderBookingsTable()`, update the action buttons based on status:

```javascript
<td class="action-btns">
    ${b.status === 'REQUESTED' ? `
        <button class="btn btn-sm btn-primary" onclick="openAssignTimeModal('${b.id}')" title="Assign exact time">
            🕐 Assign Time
        </button>
        <button class="btn btn-sm btn-outline booking-cancel-btn" data-booking-id="${b.id}" title="Cancel">✗</button>
    ` : b.status === 'CONFIRMED' ? `
        <button class="btn btn-sm booking-edit-btn" data-booking-id="${b.id}" title="Edit booking">✏️ Edit</button>
        <button class="btn btn-sm booking-complete-btn" data-booking-id="${b.id}" title="Complete">✓ Complete</button>
        <button class="btn btn-sm btn-outline booking-cancel-btn" data-booking-id="${b.id}" title="Cancel">✗</button>
    ` : b.status === 'COMPLETED' ? `
        <button class="btn btn-sm booking-edit-btn" data-booking-id="${b.id}" title="View details">👁️ View</button>
    ` : `
        <span style="color: var(--gray-medium);">No actions</span>
    `}
</td>
```

### Step 9: Update Admin Calendar View

The calendar should show REQUESTED bookings separately from CONFIRMED ones.

#### 9.1 Update Day Cell Rendering
```javascript
// In renderBookingsCalendar() or equivalent

// For each day, separate bookings by status
const confirmedBookings = dayBookings.filter(b => b.status === 'CONFIRMED' && b.assignedStartTime);
const requestedBookings = dayBookings.filter(b => b.status === 'REQUESTED');

html += `
    <div class="calendar-day-cell">
        <div class="day-number">${day}</div>

        <!-- Pending Requests Section -->
        ${requestedBookings.length > 0 ? `
            <div class="pending-requests-section">
                <div class="pending-header">⏳ Pending (${requestedBookings.length})</div>
                ${requestedBookings.map(b => `
                    <div class="pending-request-item" onclick="openAssignTimeModal('${b.id}')">
                        <div style="font-size: 11px; font-weight: 600;">${b.customerName}</div>
                        <div style="font-size: 10px; color: var(--gray-medium);">${b.serviceName}</div>
                        <div style="font-size: 10px; color: var(--primary);">${b.requestedTimeWindow}</div>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        <!-- Confirmed Bookings Timeline -->
        ${confirmedBookings.map(b => `
            <div class="calendar-booking-item confirmed" data-booking-id="${b.id}">
                <div style="font-weight: 600; font-size: 13px;">${b.customerName}</div>
                <div style="font-size: 11px;">${new Date(b.assignedStartTime).toLocaleTimeString()}</div>
                <div style="font-size: 11px; color: var(--gray-medium);">${b.serviceName}</div>
            </div>
        `).join('')}
    </div>
`;
```

## 🎯 Testing Checklist

Once implementation is complete, test these flows:

1. **Client Request Flow:**
   - [ ] Client can select date + time window (no exact time)
   - [ ] Stylist is optional ("Any available")
   - [ ] Booking is created with status REQUESTED
   - [ ] Client sees "Pending" status in their bookings

2. **Admin Assignment Flow:**
   - [ ] Admin sees REQUESTED bookings in pending list
   - [ ] "Assign Time" button opens modal
   - [ ] Modal shows booking details + stylist schedule
   - [ ] Requested time window is highlighted
   - [ ] Can select available time slot
   - [ ] Conflict detection prevents double-booking
   - [ ] Assignment changes status to CONFIRMED

3. **Notifications:**
   - [ ] Client receives email when time is confirmed
   - [ ] Push notification sent (if enabled)

4. **Edit/Modify Flow:**
   - [ ] Admin can edit CONFIRMED booking times
   - [ ] Changes sync between list and calendar views
   - [ ] Client is notified of changes

5. **Calendar Display:**
   - [ ] REQUESTED bookings show in pending section
   - [ ] CONFIRMED bookings show in timeline with exact time
   - [ ] No mix-up between pending and confirmed

## 📝 Notes

- Legacy fields (`date`, `time`, `preferred_time_of_day`, `confirmed_time`) are kept in schema for backward compatibility
- Once fully migrated and tested, can drop legacy columns via migration
- All booking display logic should check `assignedStartTime` first - if null, use `requestedDate` + `requestedTimeWindow`
- Status values are now UPPERCASE: `REQUESTED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`
