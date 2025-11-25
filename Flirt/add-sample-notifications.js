// Script to add 3 sample push notifications to the database
const { NotificationRepository } = require('./db/database');
const { v4: uuidv4 } = require('uuid');

const sampleNotifications = [
    {
        id: `notif_${uuidv4().substring(0, 8)}`,
        title: 'Welcome to FL!RT! 🎉',
        message: 'Get 20% off your first purchase with code NEWCLIENT20. Limited time offer!',
        type: 'promo',
        action: 'promo:NEWCLIENT20',
        targetAudience: 'all',
        sentAt: new Date().toISOString(),
        status: 'sent'
    },
    {
        id: `notif_${uuidv4().substring(0, 8)}`,
        title: 'Summer Hair Extensions Sale! ☀️',
        message: 'Save R200 on premium extensions. Use code SUMMER2025 at checkout.',
        type: 'promo',
        action: 'promo:SUMMER2025',
        targetAudience: 'all',
        sentAt: new Date().toISOString(),
        status: 'sent'
    },
    {
        id: `notif_${uuidv4().substring(0, 8)}`,
        title: 'Book Your Next Appointment 💇‍♀️',
        message: 'Our stylists are ready to transform your look! Book now and earn loyalty points.',
        type: 'booking',
        action: 'open:bookings',
        targetAudience: 'all',
        sentAt: new Date().toISOString(),
        status: 'sent'
    }
];

async function addSampleNotifications() {
    console.log('Adding 3 sample push notifications...\n');

    for (const notif of sampleNotifications) {
        try {
            const created = await NotificationRepository.create(notif);
            console.log(`✅ Created: ${created.title}`);
            console.log(`   Message: ${created.message}`);
            console.log(`   Type: ${created.type}, Action: ${created.action}\n`);
        } catch (error) {
            console.error(`❌ Failed to create notification:`, error.message);
        }
    }

    console.log('✨ Sample notifications added successfully!');
    process.exit(0);
}

addSampleNotifications().catch(error => {
    console.error('Error adding notifications:', error);
    process.exit(1);
});
