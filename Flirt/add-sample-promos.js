// Script to add 5 sample promotions to the database
const { PromoRepository } = require('./db/database');
const { v4: uuidv4 } = require('uuid');

const samplePromos = [
    {
        id: `promo_${uuidv4().substring(0, 8)}`,
        code: 'NEWCLIENT20',
        description: '20% off for first-time customers',
        discountType: 'percentage',
        discountValue: 20,
        minOrder: 500,
        expiresAt: null,
        usageLimit: null,
        active: true
    },
    {
        id: `promo_${uuidv4().substring(0, 8)}`,
        code: 'SUMMER2025',
        description: 'Summer special - R200 off extensions',
        discountType: 'fixed',
        discountValue: 200,
        minOrder: 1000,
        expiresAt: new Date('2025-03-31').toISOString(),
        usageLimit: 100,
        active: true
    },
    {
        id: `promo_${uuidv4().substring(0, 8)}`,
        code: 'LOYALTY15',
        description: '15% off for loyal customers',
        discountType: 'percentage',
        discountValue: 15,
        minOrder: 800,
        expiresAt: null,
        usageLimit: null,
        active: true
    },
    {
        id: `promo_${uuidv4().substring(0, 8)}`,
        code: 'FREESHIP',
        description: 'Free shipping on orders over R500',
        discountType: 'fixed',
        discountValue: 0,
        minOrder: 500,
        expiresAt: null,
        usageLimit: null,
        active: true
    },
    {
        id: `promo_${uuidv4().substring(0, 8)}`,
        code: 'BLACKFRIDAY',
        description: 'Black Friday Sale - 30% off everything!',
        discountType: 'percentage',
        discountValue: 30,
        minOrder: 0,
        expiresAt: new Date('2025-11-30').toISOString(),
        usageLimit: 500,
        active: false  // Not active yet - future promotion
    }
];

async function addSamplePromos() {
    console.log('Adding 5 sample promotions...\n');

    for (const promo of samplePromos) {
        try {
            const created = await PromoRepository.create(promo);
            console.log(`✅ Created: ${created.code} - ${created.description}`);
        } catch (error) {
            console.error(`❌ Failed to create ${promo.code}:`, error.message);
        }
    }

    console.log('\n✨ Sample promotions added successfully!');
    process.exit(0);
}

addSamplePromos().catch(error => {
    console.error('Error adding promos:', error);
    process.exit(1);
});
