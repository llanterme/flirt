// Flirt Hair & Beauty - Web Push Notification Service
// Using web-push library for VAPID-based push notifications

const webpush = require('web-push');

// VAPID keys for push notification authentication
// Generate keys with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:bookings@flirthair.co.za';

// Configure web-push with VAPID details
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.warn('VAPID keys not configured. Push notifications will be disabled.');
}

// ============================================
// NOTIFICATION TEMPLATES
// ============================================

const NotificationTemplates = {
    // Booking notifications
    BOOKING_CONFIRMED: (booking) => ({
        title: 'Booking Confirmed!',
        body: `Your ${booking.serviceName} appointment on ${formatDate(booking.date)} at ${booking.confirmedTime || booking.time} is confirmed.`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `booking-${booking.id}`,
        data: {
            type: 'booking_confirmed',
            bookingId: booking.id,
            url: '/?section=bookings'
        },
        actions: [
            { action: 'view', title: 'View Details' },
            { action: 'reschedule', title: 'Reschedule' }
        ]
    }),

    BOOKING_REMINDER: (booking) => ({
        title: 'Appointment Tomorrow!',
        body: `Reminder: ${booking.serviceName} at ${booking.confirmedTime || booking.time} tomorrow.`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `reminder-${booking.id}`,
        requireInteraction: true,
        data: {
            type: 'booking_reminder',
            bookingId: booking.id,
            url: '/?section=bookings'
        },
        actions: [
            { action: 'confirm', title: "I'll Be There" },
            { action: 'reschedule', title: 'Need to Reschedule' }
        ]
    }),

    BOOKING_CANCELLED: (booking) => ({
        title: 'Booking Cancelled',
        body: `Your ${booking.serviceName} appointment on ${formatDate(booking.date)} has been cancelled.`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `booking-${booking.id}`,
        data: {
            type: 'booking_cancelled',
            bookingId: booking.id,
            url: '/?section=book'
        },
        actions: [
            { action: 'rebook', title: 'Book Again' }
        ]
    }),

    // Order notifications
    ORDER_CONFIRMED: (order) => ({
        title: 'Order Confirmed!',
        body: `Order #${order.id.substring(0, 8).toUpperCase()} (R${order.total}) has been placed.`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `order-${order.id}`,
        data: {
            type: 'order_confirmed',
            orderId: order.id,
            url: '/?section=orders'
        }
    }),

    ORDER_SHIPPED: (order) => ({
        title: 'Order Shipped!',
        body: `Your order #${order.id.substring(0, 8).toUpperCase()} is on its way!`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `order-${order.id}`,
        data: {
            type: 'order_shipped',
            orderId: order.id,
            url: '/?section=orders'
        },
        actions: [
            { action: 'track', title: 'Track Order' }
        ]
    }),

    ORDER_READY: (order) => ({
        title: 'Order Ready for Pickup!',
        body: `Your order #${order.id.substring(0, 8).toUpperCase()} is ready to collect.`,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `order-${order.id}`,
        requireInteraction: true,
        data: {
            type: 'order_ready',
            orderId: order.id,
            url: '/?section=orders'
        },
        actions: [
            { action: 'directions', title: 'Get Directions' }
        ]
    }),

    // Promotional notifications
    PROMO: (notification) => ({
        title: notification.title,
        body: notification.message,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: `promo-${notification.id}`,
        data: {
            type: 'promo',
            notificationId: notification.id,
            action: notification.action,
            url: notification.action || '/'
        },
        actions: notification.actionText ? [
            { action: 'view', title: notification.actionText }
        ] : []
    }),

    // Loyalty notifications
    POINTS_EARNED: (points, description) => ({
        title: `+${points} Points Earned!`,
        body: description || 'Keep earning to unlock rewards!',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: 'points-earned',
        data: {
            type: 'points_earned',
            points,
            url: '/?section=rewards'
        }
    }),

    TIER_UPGRADE: (newTier) => ({
        title: `Congratulations! You're Now ${newTier.toUpperCase()}!`,
        body: 'Enjoy your new exclusive benefits and discounts.',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: 'tier-upgrade',
        requireInteraction: true,
        data: {
            type: 'tier_upgrade',
            tier: newTier,
            url: '/?section=rewards'
        },
        actions: [
            { action: 'view', title: 'View Benefits' }
        ]
    })
};

// Helper function to format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
}

// ============================================
// PUSH NOTIFICATION SERVICE
// ============================================

/**
 * Send a push notification to a single subscription
 * @param {Object} subscription - Push subscription object
 * @param {Object} payload - Notification payload
 * @returns {Promise<boolean>} Success status
 */
async function sendNotification(subscription, payload) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.log('Push notification (simulated):', payload.title);
        return true;
    }

    const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: subscription.p256dh_key || subscription.keys?.p256dh,
            auth: subscription.auth_key || subscription.keys?.auth
        }
    };

    try {
        await webpush.sendNotification(
            pushSubscription,
            JSON.stringify(payload),
            {
                TTL: 86400, // 24 hours
                urgency: payload.urgency || 'normal'
            }
        );
        return true;
    } catch (error) {
        if (error.statusCode === 410 || error.statusCode === 404) {
            // Subscription expired or invalid - should be removed
            console.log('Subscription expired:', subscription.endpoint);
            return { expired: true, endpoint: subscription.endpoint };
        }
        console.error('Push notification error:', error.message);
        return false;
    }
}

/**
 * Send notification to multiple subscriptions
 * @param {Array} subscriptions - Array of push subscriptions
 * @param {Object} payload - Notification payload
 * @returns {Promise<Object>} Results summary
 */
async function sendToMultiple(subscriptions, payload) {
    const results = {
        sent: 0,
        failed: 0,
        expired: []
    };

    const promises = subscriptions.map(async (sub) => {
        const result = await sendNotification(sub, payload);
        if (result === true) {
            results.sent++;
        } else if (result?.expired) {
            results.expired.push(result.endpoint);
        } else {
            results.failed++;
        }
    });

    await Promise.all(promises);
    return results;
}

/**
 * Send notification by template type
 */
async function sendByTemplate(subscriptions, templateType, data) {
    const templateFn = NotificationTemplates[templateType];
    if (!templateFn) {
        throw new Error(`Unknown notification template: ${templateType}`);
    }

    const payload = templateFn(data);
    return sendToMultiple(subscriptions, payload);
}

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * Validate a push subscription object
 */
function validateSubscription(subscription) {
    if (!subscription || !subscription.endpoint) {
        return { valid: false, reason: 'Missing endpoint' };
    }

    if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
        return { valid: false, reason: 'Missing keys' };
    }

    // Check endpoint URL format
    try {
        new URL(subscription.endpoint);
    } catch {
        return { valid: false, reason: 'Invalid endpoint URL' };
    }

    return { valid: true };
}

/**
 * Get the public VAPID key for client-side subscription
 */
function getPublicVapidKey() {
    return VAPID_PUBLIC_KEY;
}

// ============================================
// SCHEDULED NOTIFICATIONS
// ============================================

/**
 * Calculate reminder time (24 hours before appointment)
 */
function calculateReminderTime(bookingDate, bookingTime) {
    const [hours, minutes] = (bookingTime || '09:00').split(':').map(Number);
    const appointmentDate = new Date(bookingDate);
    appointmentDate.setHours(hours, minutes, 0, 0);

    // 24 hours before
    const reminderTime = new Date(appointmentDate.getTime() - 24 * 60 * 60 * 1000);
    return reminderTime;
}

/**
 * Check if it's time to send a reminder
 */
function shouldSendReminder(booking) {
    if (booking.status === 'cancelled') return false;
    if (!booking.confirmedTime && !booking.time) return false;

    const reminderTime = calculateReminderTime(booking.date, booking.confirmedTime || booking.time);
    const now = new Date();

    // Send if reminder time is within the next hour
    const timeDiff = reminderTime.getTime() - now.getTime();
    return timeDiff > 0 && timeDiff <= 60 * 60 * 1000;
}

// ============================================
// CLIENT-SIDE HELPERS (to include in frontend)
// ============================================

const clientSideHelpers = `
// Push notification helper functions for client-side use
const PushNotifications = {
    // Check if push is supported
    isSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window;
    },

    // Request notification permission
    async requestPermission() {
        if (!this.isSupported()) return 'unsupported';
        const permission = await Notification.requestPermission();
        return permission;
    },

    // Subscribe to push notifications
    async subscribe(vapidPublicKey) {
        if (!this.isSupported()) throw new Error('Push not supported');

        const registration = await navigator.serviceWorker.ready;

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey)
        });

        return subscription.toJSON();
    },

    // Unsubscribe from push notifications
    async unsubscribe() {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            await subscription.unsubscribe();
            return true;
        }
        return false;
    },

    // Check current subscription status
    async getSubscription() {
        const registration = await navigator.serviceWorker.ready;
        return registration.pushManager.getSubscription();
    },

    // Helper to convert VAPID key
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
};
`;

module.exports = {
    // Core functions
    sendNotification,
    sendToMultiple,
    sendByTemplate,

    // Templates
    NotificationTemplates,

    // Subscription management
    validateSubscription,
    getPublicVapidKey,

    // Scheduling
    calculateReminderTime,
    shouldSendReminder,

    // Client helpers
    clientSideHelpers
};
