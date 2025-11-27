# Booking Flow Redesign - Implementation Plan

## Overview
Redesigning the booking system to implement a two-step flow:
1. **Client Request**: Date + Time Window + Service + Stylist (or "Any")
2. **Admin Confirmation**: Exact time assignment

## Current Schema Analysis

### Existing Bookings Table
```sql
- id
- user_id
- booking_type (hair/beauty)
- stylist_id (nullable)
- service_id
- service_name
- service_price
- date (TEXT - date only)
- preferred_time_of_day (TEXT - nullable)  ← Currently used but inconsistent
- time (TEXT - nullable)                    ← Conflated with exact time
- confirmed_time (TEXT - nullable)          ← Admin-set time
- status ('pending', 'confirmed', 'completed', 'cancelled')
- notes
- created_at
- updated_at
```

### Migration Strategy

**Current State Problems:**
1. `preferred_time_of_day` and `time` are used inconsistently
2. No clear separation between "client requested time window" and "admin assigned exact time"
3. Status `pending` is ambiguous (could mean "awaiting admin" OR "confirmed but not yet serviced")

**New Schema (Aligned with Requirements):**
```sql
- id
- user_id
- booking_type
- stylist_id (nullable - can be "Any available" initially)
- service_id
- service_name
- service_price
- requested_date (TEXT - ISO date)
- requested_time_window (TEXT - enum: MORNING, AFTERNOON, LATE_AFTERNOON, EVENING)
- assigned_start_time (TEXT - ISO datetime, nullable)
- assigned_end_time (TEXT - ISO datetime, nullable)
- status (TEXT - enum: REQUESTED, CONFIRMED, COMPLETED, CANCELLED)
- notes
- created_at
- updated_at
```

**Migration Steps:**
1. Add new columns to existing table
2. Migrate existing data:
   - `preferred_time_of_day` → `requested_time_window`
   - `date` → `requested_date`
   - `confirmed_time` → `assigned_start_time` (calculate `assigned_end_time` from service duration)
   - Map old `status`:
     - 'pending' with no `confirmed_time` → 'REQUESTED'
     - 'pending' with `confirmed_time` → 'CONFIRMED'
     - 'confirmed' → 'CONFIRMED'
     - 'completed' → 'COMPLETED'
     - 'cancelled' → 'CANCELLED'
3. Drop old columns (time, preferred_time_of_day, confirmed_time) after migration
4. Update constraints

## Implementation Phases

### Phase 1: Data Layer & Constants
- [ ] Create shared constants file for time windows and statuses
- [ ] Update database schema (add new columns)
- [ ] Create migration script
- [ ] Update BookingRepository with new field mappings
- [ ] Update API response/request types

### Phase 2: Backend API Updates
- [ ] Update POST /api/bookings (client create - REQUESTED status)
- [ ] Create POST /api/admin/bookings/:id/assign-time (admin confirms)
- [ ] Update PATCH /api/admin/bookings/:id (edit confirmed booking)
- [ ] Update GET /api/bookings (client view - show status clearly)
- [ ] Update GET /api/admin/bookings (admin view - filter by status)
- [ ] Add conflict detection for time assignments

### Phase 3: Client App Updates
- [ ] Update booking form UI (time window selector instead of exact time)
- [ ] Update booking history/status display
- [ ] Show "Pending" vs "Confirmed" states clearly
- [ ] Handle notifications for confirmed bookings

### Phase 4: Admin Console - List View
- [ ] Add status filter (All / Requested / Confirmed / Completed / Cancelled)
- [ ] Update table columns to show:
   - For REQUESTED: Date, Time Window, "Any" or Stylist Name, [Assign Time] button
   - For CONFIRMED: Date, Exact Time, Stylist, [Edit] [Cancel] buttons
- [ ] Implement inline "Assign Time" action

### Phase 5: Admin Console - Assign Time Modal
- [ ] Create modal UI with:
   - Booking details summary
   - Stylist selector (pre-select if chosen, allow change)
   - Date selector (default to requested date)
   - Timeline/schedule view showing stylist availability
   - Visual indication of requested time window
   - Conflict detection
- [ ] Handle save: set assigned times, update status to CONFIRMED
- [ ] Trigger client notification

### Phase 6: Admin Console - Calendar View
- [ ] Separate pending requests area (top of each day)
- [ ] Only show CONFIRMED bookings in timeline grid
- [ ] Ensure edit/drag-drop updates assignedStartTime/assignedEndTime
- [ ] Fix synchronization between list and calendar views

### Phase 7: Notifications
- [ ] Email notification on booking confirmation
- [ ] Email notification on booking modification
- [ ] Push notification (if already implemented)

### Phase 8: Testing & QA
- [ ] Test client request → admin assign → notification flow
- [ ] Test edit confirmed booking
- [ ] Test cancel flows
- [ ] Test conflict detection
- [ ] Test calendar/list sync
- [ ] Test migration script on copy of production data

## Constants & Enums

### Time Windows
```javascript
const TIME_WINDOWS = {
  MORNING: { value: 'MORNING', label: 'Morning (6AM - 12PM)', start: '06:00', end: '12:00' },
  AFTERNOON: { value: 'AFTERNOON', label: 'Afternoon (12PM - 3PM)', start: '12:00', end: '15:00' },
  LATE_AFTERNOON: { value: 'LATE_AFTERNOON', label: 'Late Afternoon (3PM - 6PM)', start: '15:00', end: '18:00' },
  EVENING: { value: 'EVENING', label: 'Evening (6PM - 10PM)', start: '18:00', end: '22:00' }
};
```

### Booking Statuses
```javascript
const BOOKING_STATUS = {
  REQUESTED: { value: 'REQUESTED', label: 'Pending - Awaiting Time Assignment', color: '#FFC107' },
  CONFIRMED: { value: 'CONFIRMED', label: 'Confirmed', color: '#28A745' },
  COMPLETED: { value: 'COMPLETED', label: 'Completed', color: '#007BFF' },
  CANCELLED: { value: 'CANCELLED', label: 'Cancelled', color: '#DC3545' }
};
```

## API Changes Summary

### Client Endpoints
- **POST /api/bookings** (Create Request)
  - Body: { serviceId, requestedDate, requestedTimeWindow, stylistId (optional), notes }
  - Response: { booking with status: REQUESTED }

- **GET /api/bookings** (User's Bookings)
  - Response includes clear status and time info

### Admin Endpoints
- **GET /api/admin/bookings?status=REQUESTED** (Filter pending)
- **POST /api/admin/bookings/:id/assign-time** (New!)
  - Body: { stylistId, assignedStartTime, assignedEndTime }
  - Validates conflicts
  - Sets status to CONFIRMED
  - Triggers notification
- **PATCH /api/admin/bookings/:id** (Edit confirmed booking)
  - Can update assignedStartTime, assignedEndTime, stylistId
  - Maintains CONFIRMED status
  - Triggers update notification

## UI Mockup Notes

### Client Booking Form
```
┌─────────────────────────────────────┐
│ Book Your Appointment               │
├─────────────────────────────────────┤
│ Service: [Tape Extensions ▼]        │
│ Date: [📅 Nov 29, 2025]             │
│ Preferred Time:                     │
│ ○ Morning    ○ Afternoon            │
│ ○ Late Afternoon  ○ Evening         │
│ Stylist: [Any Available ▼]          │
│ Notes: [________________]           │
│ [Request Appointment]               │
└─────────────────────────────────────┘
```

### Admin - Assign Time Modal
```
┌──────────────────────────────────────────────┐
│ Assign Exact Time                        [×] │
├──────────────────────────────────────────────┤
│ Luke Lanterme - Tape Extensions              │
│ Requested: Nov 27, MORNING                   │
│ Preferred Stylist: Any Available             │
├──────────────────────────────────────────────┤
│ Assign to Stylist: [Sarah ▼]                 │
│ Date: [📅 Nov 27, 2025]                      │
│                                              │
│ ┌────────────────────────────────┐          │
│ │ MORNING (Requested Window) ⬛  │          │
│ │ 06:00 ─────────────────────    │          │
│ │ 07:00 ─────────────────────    │          │
│ │ 08:00 ─────────────────────    │          │
│ │ 09:00 [Sarah - Cut & Color]    │          │
│ │ 10:00 ─────────────────────    │ ← Click  │
│ │ 11:00 ─────────────────────    │          │
│ │ 12:00 ─────────────────────    │          │
│ │ AFTERNOON                      │          │
│ │ ...                            │          │
│ └────────────────────────────────┘          │
│                                              │
│ Selected: 10:00 - 12:00                      │
│ [Cancel]                    [Confirm & Notify]│
└──────────────────────────────────────────────┘
```

## Files to Modify

### Database
- `db/schema.sql` - Add migration SQL
- `db/migration-booking-redesign.sql` - New file for migration
- `db/database.js` - Update BookingRepository

### Backend
- `server.js` - Update booking endpoints
- `services/email.js` - Add booking confirmation templates

### Frontend - Client App
- `flirt-hair-app.html` - Update booking form and history

### Frontend - Admin Console
- `flirt-admin-console.html` - Update bookings section, add assign time modal

### Shared
- Create `shared/booking-constants.js` (if we want a shared file, or inline in both apps)

## Success Metrics
1. Client can request appointment with time window ✓
2. Admin sees pending requests clearly ✓
3. Admin can assign exact time from schedule view ✓
4. Client receives notification with confirmed time ✓
5. Calendar and list views stay synchronized ✓
6. No hardcoded time logic remains ✓
