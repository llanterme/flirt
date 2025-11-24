#!/usr/bin/env node
// Flirt Hair & Beauty - JSON to SQLite Migration Script
// Run this once to migrate existing JSON data to the SQLite database

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
    initializeDatabase,
    closeDb,
    dbRun,
    dbAll,
    UserRepository,
    StylistRepository,
    ServiceRepository,
    BookingRepository,
    ProductRepository,
    OrderRepository,
    PromoRepository,
    LoyaltyRepository,
    NotificationRepository
} = require('./database');

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadJSON(filename) {
    const filePath = path.join(DATA_DIR, filename);
    try {
        if (!fs.existsSync(filePath)) {
            console.log(`  Skipping ${filename} - file not found`);
            return null;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`  Error loading ${filename}:`, error.message);
        return null;
    }
}

async function migrateUsers() {
    console.log('\n=== Migrating Users ===');
    const data = loadJSON('users.json');
    if (!data || !data.users) return;

    let migrated = 0;
    for (const user of data.users) {
        try {
            // Check if user already exists
            const existing = await UserRepository.findById(user.id);
            if (existing) {
                console.log(`  Skipping user ${user.email} - already exists`);
                continue;
            }

            await UserRepository.create({
                id: user.id,
                email: user.email,
                passwordHash: user.password, // Map from 'password' field in JSON
                name: user.name,
                phone: user.phone,
                role: user.role || 'customer',
                points: user.loyaltyPoints || user.points || 0, // Map from 'loyaltyPoints' field
                tier: user.tier || 'bronze',
                referralCode: user.referralCode,
                referredBy: user.referredBy,
                mustChangePassword: user.mustChangePassword || false
            });

            // Migrate hair tracker if exists
            if (user.hairTracker && (user.hairTracker.lastInstallDate || user.hairTracker.extensionType)) {
                await UserRepository.updateHairTracker(user.id, {
                    lastInstallDate: user.hairTracker.lastInstallDate,
                    extensionType: user.hairTracker.extensionType
                });
            }

            migrated++;
        } catch (error) {
            console.error(`  Error migrating user ${user.email}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} users`);
}

async function migrateStylists() {
    console.log('\n=== Migrating Stylists ===');
    const data = loadJSON('stylists.json');
    if (!data || !data.stylists) return;

    let migrated = 0;
    for (const stylist of data.stylists) {
        try {
            const existing = await StylistRepository.findById(stylist.id);
            if (existing) {
                console.log(`  Skipping stylist ${stylist.name} - already exists`);
                continue;
            }

            await StylistRepository.create({
                id: stylist.id,
                name: stylist.name,
                specialty: stylist.specialty,
                tagline: stylist.tagline,
                rating: stylist.rating,
                reviewCount: stylist.reviewCount,
                clientsCount: stylist.clientsCount,
                yearsExperience: stylist.yearsExperience,
                instagram: stylist.instagram,
                color: stylist.color,
                available: stylist.available !== false,
                imageUrl: stylist.imageUrl
            });
            migrated++;
        } catch (error) {
            console.error(`  Error migrating stylist ${stylist.name}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} stylists`);
}

async function migrateServices() {
    console.log('\n=== Migrating Services ===');
    const data = loadJSON('services.json');
    if (!data) return;

    let migrated = 0;

    // Migrate hair services
    if (data.hairServices) {
        for (const service of data.hairServices) {
            try {
                const existing = await ServiceRepository.findById(service.id);
                if (existing) {
                    console.log(`  Skipping service ${service.name} - already exists`);
                    continue;
                }

                await ServiceRepository.create({
                    id: service.id,
                    name: service.name,
                    description: service.description,
                    price: service.price,
                    duration: service.duration,
                    serviceType: 'hair',
                    category: service.category
                });
                migrated++;
            } catch (error) {
                console.error(`  Error migrating hair service ${service.name}:`, error.message);
            }
        }
    }

    // Migrate beauty services
    if (data.beautyServices) {
        for (const service of data.beautyServices) {
            try {
                const existing = await ServiceRepository.findById(service.id);
                if (existing) continue;

                await ServiceRepository.create({
                    id: service.id,
                    name: service.name,
                    description: service.description,
                    price: service.price,
                    duration: service.duration,
                    serviceType: 'beauty',
                    category: service.category
                });
                migrated++;
            } catch (error) {
                console.error(`  Error migrating beauty service ${service.name}:`, error.message);
            }
        }
    }

    console.log(`  Migrated ${migrated} services`);
}

async function migrateProducts() {
    console.log('\n=== Migrating Products ===');
    const data = loadJSON('products.json');
    if (!data || !data.products) return;

    let migrated = 0;
    for (const product of data.products) {
        try {
            const existing = await ProductRepository.findById(product.id);
            if (existing) {
                console.log(`  Skipping product ${product.name} - already exists`);
                continue;
            }

            await ProductRepository.create({
                id: product.id,
                name: product.name,
                category: product.category,
                description: product.description,
                price: product.price,
                salePrice: product.salePrice,
                onSale: product.onSale || false,
                stock: product.stock || 0,
                imageUrl: product.imageUrl
            });
            migrated++;
        } catch (error) {
            console.error(`  Error migrating product ${product.name}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} products`);
}

async function migrateBookings() {
    console.log('\n=== Migrating Bookings ===');
    const data = loadJSON('bookings.json');
    if (!data || !data.bookings) return;

    let migrated = 0;
    for (const booking of data.bookings) {
        try {
            const existing = await BookingRepository.findById(booking.id);
            if (existing) {
                console.log(`  Skipping booking ${booking.id} - already exists`);
                continue;
            }

            await BookingRepository.create({
                id: booking.id,
                userId: booking.userId,
                type: booking.serviceType, // Map from 'serviceType' field in JSON
                stylistId: booking.stylistId,
                serviceId: booking.serviceId,
                serviceName: booking.serviceName,
                servicePrice: booking.price, // Map from 'price' field in JSON
                date: booking.date,
                preferredTimeOfDay: booking.preferredTimeOfDay,
                time: booking.time,
                confirmedTime: booking.confirmedTime,
                status: booking.status || 'pending',
                notes: booking.notes
            });
            migrated++;
        } catch (error) {
            console.error(`  Error migrating booking ${booking.id}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} bookings`);
}

async function migrateOrders() {
    console.log('\n=== Migrating Orders ===');
    const data = loadJSON('orders.json');
    if (!data || !data.orders) return;

    let migrated = 0;
    for (const order of data.orders) {
        try {
            const existing = await OrderRepository.findById(order.id);
            if (existing) {
                console.log(`  Skipping order ${order.id} - already exists`);
                continue;
            }

            await OrderRepository.create({
                id: order.id,
                userId: order.userId,
                items: order.items.map(item => ({
                    productId: item.productId,
                    productName: item.name, // Map from 'name' field in JSON
                    quantity: item.quantity,
                    unitPrice: item.price // Map from 'price' field in JSON
                })),
                subtotal: order.subtotal,
                deliveryMethod: order.deliveryMethod || 'pickup',
                deliveryFee: order.deliveryFee || 0,
                deliveryAddress: order.deliveryAddress,
                promoCode: order.promoCode,
                discount: order.discount || 0,
                total: order.total,
                status: order.status || 'pending'
            });
            migrated++;
        } catch (error) {
            console.error(`  Error migrating order ${order.id}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} orders`);
}

async function migratePromos() {
    console.log('\n=== Migrating Promos ===');
    const data = loadJSON('promos.json');
    if (!data || !data.promos) return;

    let migrated = 0;
    for (const promo of data.promos) {
        try {
            const existing = await PromoRepository.findById(promo.id);
            if (existing) {
                console.log(`  Skipping promo ${promo.code} - already exists`);
                continue;
            }

            await PromoRepository.create({
                id: promo.id,
                code: promo.code,
                description: promo.description,
                discountType: promo.discountType,
                discountValue: promo.discountValue,
                minOrder: promo.minOrder,
                expiresAt: promo.expiresAt,
                usageLimit: promo.usageLimit,
                active: promo.active !== false
            });

            // Update times used if any
            if (promo.timesUsed > 0) {
                for (let i = 0; i < promo.timesUsed; i++) {
                    await PromoRepository.incrementUsage(promo.id);
                }
            }
            migrated++;
        } catch (error) {
            console.error(`  Error migrating promo ${promo.code}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} promos`);
}

async function migrateLoyaltyTransactions() {
    console.log('\n=== Migrating Loyalty Transactions ===');
    const data = loadJSON('loyalty.json');
    if (!data || !data.transactions) return;

    let migrated = 0;
    for (const tx of data.transactions) {
        try {
            // Check if transaction exists
            const existing = await dbAll('SELECT * FROM loyalty_transactions WHERE id = ?', [tx.id]);
            if (existing.length > 0) {
                continue;
            }

            await dbRun(
                `INSERT INTO loyalty_transactions (id, user_id, points, transaction_type, description, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [tx.id, tx.userId, tx.points, tx.type, tx.description, tx.createdAt]
            );
            migrated++;
        } catch (error) {
            console.error(`  Error migrating loyalty transaction:`, error.message);
        }
    }

    // Migrate tier thresholds and points rules if present
    if (data.tierThresholds) {
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('tier_bronze', ?)`, [String(data.tierThresholds.bronze || 0)]);
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('tier_silver', ?)`, [String(data.tierThresholds.silver || 500)]);
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('tier_gold', ?)`, [String(data.tierThresholds.gold || 1500)]);
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('tier_platinum', ?)`, [String(data.tierThresholds.platinum || 3000)]);
    }

    if (data.pointsRules) {
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('points_per_rand', ?)`, [String(data.pointsRules.spendRand || 1)]);
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('booking_points', ?)`, [String(data.pointsRules.bookingPoints || 50)]);
        await dbRun(`INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES ('referral_points', ?)`, [String(data.pointsRules.referralPoints || 100)]);
    }

    console.log(`  Migrated ${migrated} loyalty transactions`);
}

async function migrateNotifications() {
    console.log('\n=== Migrating Notifications ===');
    const data = loadJSON('notifications.json');
    if (!data || !data.notifications) return;

    let migrated = 0;
    for (const notification of data.notifications) {
        try {
            const existing = await NotificationRepository.findById(notification.id);
            if (existing) {
                console.log(`  Skipping notification ${notification.title} - already exists`);
                continue;
            }

            await NotificationRepository.create({
                id: notification.id,
                title: notification.title,
                message: notification.message,
                type: notification.type || 'promo',
                action: notification.action,
                actionText: notification.actionText,
                active: notification.active !== false,
                startsAt: notification.startsAt,
                expiresAt: notification.expiresAt,
                createdBy: notification.createdBy
            });
            migrated++;
        } catch (error) {
            console.error(`  Error migrating notification ${notification.title}:`, error.message);
        }
    }
    console.log(`  Migrated ${migrated} notifications`);
}

async function runMigration() {
    console.log('========================================');
    console.log('Flirt Hair & Beauty - Data Migration');
    console.log('JSON Files -> SQLite Database');
    console.log('========================================');

    try {
        // Initialize database with schema
        console.log('\nInitializing database...');
        await initializeDatabase();

        // Run migrations in order (respecting foreign key constraints)
        await migrateUsers();
        await migrateStylists();
        await migrateServices();
        await migrateProducts();
        await migrateBookings();
        await migrateOrders();
        await migratePromos();
        await migrateLoyaltyTransactions();
        await migrateNotifications();

        console.log('\n========================================');
        console.log('Migration completed successfully!');
        console.log('========================================');
        console.log('\nYour JSON data has been migrated to:');
        console.log(`  ${path.join(__dirname, 'flirt.db')}`);
        console.log('\nBackup your JSON files before removing them.');
        console.log('Update your server.js to use the database module.');

    } catch (error) {
        console.error('\nMigration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        closeDb();
    }
}

// Run migration
runMigration();
