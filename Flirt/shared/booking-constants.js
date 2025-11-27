/**
 * Booking System Constants
 * Shared between client app, admin console, and backend
 *
 * These constants define the two-step booking flow:
 * 1. Client requests appointment with time window
 * 2. Admin assigns exact time
 */

// Time window options for client booking requests
const TIME_WINDOWS = {
    MORNING: {
        value: 'MORNING',
        label: 'Morning',
        description: '6:00 AM - 12:00 PM',
        startHour: 6,
        endHour: 12,
        icon: '🌅'
    },
    AFTERNOON: {
        value: 'AFTERNOON',
        label: 'Afternoon',
        description: '12:00 PM - 3:00 PM',
        startHour: 12,
        endHour: 15,
        icon: '☀️'
    },
    LATE_AFTERNOON: {
        value: 'LATE_AFTERNOON',
        label: 'Late Afternoon',
        description: '3:00 PM - 6:00 PM',
        startHour: 15,
        endHour: 18,
        icon: '🌤️'
    },
    EVENING: {
        value: 'EVENING',
        label: 'Evening',
        description: '6:00 PM - 10:00 PM',
        startHour: 18,
        endHour: 22,
        icon: '🌙'
    }
};

// Array of time windows for iteration
const TIME_WINDOWS_ARRAY = Object.values(TIME_WINDOWS);

// Booking status definitions
const BOOKING_STATUS = {
    REQUESTED: {
        value: 'REQUESTED',
        label: 'Pending Assignment',
        shortLabel: 'Pending',
        description: 'Awaiting exact time assignment from salon',
        color: '#FFC107',      // Amber/Yellow
        bgColor: '#FFF3CD',
        borderColor: '#FFE69C',
        icon: '⏳',
        isActive: true,
        requiresAction: true  // Requires admin action
    },
    CONFIRMED: {
        value: 'CONFIRMED',
        label: 'Confirmed',
        shortLabel: 'Confirmed',
        description: 'Exact time assigned and confirmed',
        color: '#28A745',      // Green
        bgColor: '#D4EDDA',
        borderColor: '#C3E6CB',
        icon: '✓',
        isActive: true,
        requiresAction: false
    },
    COMPLETED: {
        value: 'COMPLETED',
        label: 'Completed',
        shortLabel: 'Completed',
        description: 'Service has been completed',
        color: '#007BFF',      // Blue
        bgColor: '#D1ECF1',
        borderColor: '#BEE5EB',
        icon: '✓✓',
        isActive: false,
        requiresAction: false
    },
    CANCELLED: {
        value: 'CANCELLED',
        label: 'Cancelled',
        shortLabel: 'Cancelled',
        description: 'Booking has been cancelled',
        color: '#DC3545',      // Red
        bgColor: '#F8D7DA',
        borderColor: '#F5C6CB',
        icon: '✗',
        isActive: false,
        requiresAction: false
    }
};

// Array of statuses for iteration
const BOOKING_STATUS_ARRAY = Object.values(BOOKING_STATUS);

// Helper function to get time window by value
function getTimeWindow(value) {
    return TIME_WINDOWS[value] || null;
}

// Helper function to get booking status by value
function getBookingStatus(value) {
    return BOOKING_STATUS[value] || null;
}

// Helper function to check if time falls within a time window
function isTimeInWindow(time, windowValue) {
    const window = getTimeWindow(windowValue);
    if (!window) return false;

    const hour = parseInt(time.split(':')[0]);
    return hour >= window.startHour && hour < window.endHour;
}

// Helper function to format time window for display
function formatTimeWindow(windowValue) {
    const window = getTimeWindow(windowValue);
    return window ? `${window.icon} ${window.label} (${window.description})` : windowValue;
}

// Helper function to get CSS class for status
function getStatusClass(statusValue) {
    const status = getBookingStatus(statusValue);
    return status ? `status-${statusValue.toLowerCase()}` : '';
}

// Helper function to format date and time for display
function formatBookingDateTime(requestedDate, assignedStartTime, requestedTimeWindow) {
    if (assignedStartTime) {
        // Has exact time - format as full date/time
        const dt = new Date(assignedStartTime);
        return dt.toLocaleString('en-ZA', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } else {
        // Only has date and time window
        const date = new Date(requestedDate);
        const window = getTimeWindow(requestedTimeWindow);
        return `${date.toLocaleDateString('en-ZA', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })} - ${window ? window.label : requestedTimeWindow}`;
    }
}

// Export for Node.js (backend)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TIME_WINDOWS,
        TIME_WINDOWS_ARRAY,
        BOOKING_STATUS,
        BOOKING_STATUS_ARRAY,
        getTimeWindow,
        getBookingStatus,
        isTimeInWindow,
        formatTimeWindow,
        getStatusClass,
        formatBookingDateTime
    };
}

// Export for browser (frontend) - attach to window
if (typeof window !== 'undefined') {
    window.BookingConstants = {
        TIME_WINDOWS,
        TIME_WINDOWS_ARRAY,
        BOOKING_STATUS,
        BOOKING_STATUS_ARRAY,
        getTimeWindow,
        getBookingStatus,
        isTimeInWindow,
        formatTimeWindow,
        getStatusClass,
        formatBookingDateTime
    };
}
