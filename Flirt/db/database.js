// Flirt Hair & Beauty - Database Module
// SQLite3 Database Access Layer

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const loyaltyHelper = require('../helpers/loyalty');
const InvoiceRepositoryClass = require('./repositories/InvoiceRepository');

// Database path configuration:
// 1. DATABASE_PATH env var (for Railway Volume: /data/flirt.db)
// 2. RAILWAY_VOLUME_MOUNT_PATH env var + /flirt.db (auto-detect Railway Volume)
// 3. Default: ./db/flirt.db (local development)
function getDatabasePath() {
    if (process.env.DATABASE_PATH) {
        return process.env.DATABASE_PATH;
    }
    if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
        return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'flirt.db');
    }
    return path.join(__dirname, 'flirt.db');
}

const DB_PATH = getDatabasePath();

let db = null;

// Initialize database connection
function getDb() {
    if (!db) {
        // Ensure directory exists
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log('Created database directory:', dbDir);
        }

        // Check if this is a new database (for logging purposes)
        const isNewDb = !fs.existsSync(DB_PATH);
        if (isNewDb) {
            console.log('Creating new database at:', DB_PATH);
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Failed to connect to database:', err.message);
                throw err;
            }
            console.log('Connected to SQLite database:', DB_PATH);
            if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
                console.log('Using Railway persistent volume storage');
            }
        });

        // Enable foreign keys and WAL mode for better concurrent access
        db.run('PRAGMA foreign_keys = ON');
        db.run('PRAGMA journal_mode = WAL');
    }
    return db;
}

// Promisified database methods
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// Initialize database with schema
async function initializeDatabase() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await new Promise((resolve, reject) => {
        getDb().exec(schema, (err) => {
            if (err) {
                console.error('Failed to initialize database schema:', err.message);
                reject(err);
            } else {
                console.log('Database schema initialized');
                resolve();
            }
        });
    });

    // Lightweight migrations for existing databases
    await ensureColumn(
        'orders',
        'payment_status',
        "TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded'))"
    );
    await ensureColumn('promos', 'highlighted', 'INTEGER DEFAULT 0');
    await ensureColumn('promos', 'badge', 'TEXT');
    await ensureColumn('promos', 'title', 'TEXT');
    await ensureColumn('promos', 'subtitle', 'TEXT');
    await ensureColumn('promos', 'priority', 'INTEGER DEFAULT 0');

    // Services bookable flag migration (distinguishes bookable services from invoice-only)
    await ensureColumn('services', 'bookable', 'INTEGER DEFAULT 1');
    await ensureIndex('idx_services_bookable', 'services', 'bookable');
    // Mark non-bookable categories as invoice-only after adding column
    await migrateServiceBookableFlag();

    // User profile migrations (hair_profile and notification_prefs)
    await ensureColumn('users', 'hair_profile', 'TEXT');
    await ensureColumn('users', 'notification_prefs', 'TEXT');

    // Hair tracker extended columns
    await ensureColumn('hair_tracker', 'maintenance_interval_days', 'INTEGER DEFAULT 42');
    await ensureColumn('hair_tracker', 'next_maintenance_date', 'TEXT');
    await ensureColumn('hair_tracker', 'last_deep_condition_date', 'TEXT');
    await ensureColumn('hair_tracker', 'last_wash_date', 'TEXT');
    await ensureColumn('hair_tracker', 'hair_health_score', 'INTEGER DEFAULT 100');
    await ensureColumn('hair_tracker', 'wash_history', 'TEXT');
    await ensureColumn('hair_tracker', 'products_used', 'TEXT');

    // Ensure user_inspo_photos table exists (for hair inspiration photos)
    await ensureTable('user_inspo_photos', `
        CREATE TABLE IF NOT EXISTS user_inspo_photos (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            image_data TEXT NOT NULL,
            label TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_inspo_photos_user', 'user_inspo_photos', 'user_id');

    // Booking payment tracking columns
    await ensureColumn('bookings', 'payment_status', "TEXT DEFAULT 'unpaid'");
    await ensureColumn('bookings', 'payment_method', 'TEXT');
    await ensureColumn('bookings', 'payment_reference', 'TEXT');
    await ensureColumn('bookings', 'payment_date', 'TEXT');
    await ensureColumn('bookings', 'payment_amount', 'REAL');
    await ensureIndex('idx_bookings_payment_status', 'bookings', 'payment_status');

    // Booking completion tracking
    await ensureColumn('bookings', 'completed_at', 'TEXT');

    // Rewards programme columns for bookings
    await ensureColumn('bookings', 'reward_id', 'TEXT');
    await ensureColumn('bookings', 'discount_amount', 'REAL DEFAULT 0');
    await ensureColumn('bookings', 'package_session_id', 'TEXT');

    // Commission tracking columns for bookings
    await ensureColumn('bookings', 'commission_rate', 'REAL');
    await ensureColumn('bookings', 'commission_amount', 'REAL');

    // Commission rate columns for stylists and services (for invoice commission calculation)
    await ensureColumn('stylists', 'commission_rate', 'REAL DEFAULT 0.30');
    await ensureColumn('stylists', 'basic_monthly_pay', 'REAL DEFAULT 0');
    await ensureColumn('services', 'commission_rate', 'REAL');

    // Pricelist import columns (cost_price, supplier for services and products)
    await ensureColumn('services', 'cost_price', 'REAL');
    await ensureColumn('services', 'supplier', 'TEXT');
    await ensureColumn('products', 'cost_price', 'REAL');
    await ensureColumn('products', 'supplier', 'TEXT');
    await ensureColumn('products', 'commission_rate', 'REAL');
    await ensureColumn('products', 'is_service_product', 'INTEGER DEFAULT 0');

    // ============================================
    // SERVICE TYPES AND CATEGORIES (for configurable dropdowns)
    // ============================================
    await ensureTable('service_types', `
        CREATE TABLE IF NOT EXISTS service_types (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    await ensureTable('service_categories', `
        CREATE TABLE IF NOT EXISTS service_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            service_type_id TEXT NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(name, service_type_id)
        )
    `);

    // Seed default service types if empty
    await seedDefaultServiceTypes();

    // Ensure referrals table exists (for older databases)
    await ensureTable('referrals', `
        CREATE TABLE IF NOT EXISTS referrals (
            id TEXT PRIMARY KEY,
            referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            referee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            referral_code TEXT NOT NULL,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired')),
            referee_first_booking_value REAL,
            reward_issued INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT,
            UNIQUE(referee_id)
        )
    `);

    // Referral rewards tracking columns (for databases created before these were in schema)
    await ensureColumn('referrals', 'referee_first_booking_value', 'REAL');
    await ensureColumn('referrals', 'reward_issued', 'INTEGER DEFAULT 0');

    // Migration: Recreate payment_transactions table to add 'eft' to payment_provider CHECK constraint
    await migratePaymentTransactionsTable();

    // ============================================
    // REWARDS PROGRAMME TABLES (migration for existing databases)
    // ============================================
    await ensureTable('rewards_config', `
        CREATE TABLE IF NOT EXISTS rewards_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            programme_enabled INTEGER DEFAULT 1,
            programme_name TEXT DEFAULT 'Salon Rewards',
            terms_conditions TEXT,
            terms_version TEXT DEFAULT '1.0',
            nails_enabled INTEGER DEFAULT 1,
            nails_milestone_1_count INTEGER DEFAULT 6,
            nails_milestone_1_discount REAL DEFAULT 10,
            nails_milestone_2_count INTEGER DEFAULT 12,
            nails_milestone_2_discount REAL DEFAULT 50,
            nails_reward_expiry_days INTEGER DEFAULT 90,
            maintenance_enabled INTEGER DEFAULT 1,
            maintenance_milestone_count INTEGER DEFAULT 6,
            maintenance_discount REAL DEFAULT 10,
            maintenance_reward_expiry_days INTEGER DEFAULT 90,
            spend_enabled INTEGER DEFAULT 1,
            spend_threshold REAL DEFAULT 10000,
            spend_discount REAL DEFAULT 20,
            spend_reward_expiry_days INTEGER DEFAULT 90,
            referral_enabled INTEGER DEFAULT 1,
            referral_min_booking_value REAL DEFAULT 1000,
            referral_reward_service_id TEXT,
            referral_reward_description TEXT DEFAULT 'Complimentary wash & blow-dry',
            packages_enabled INTEGER DEFAULT 1,
            wash_blowdry_package_sessions INTEGER DEFAULT 4,
            wash_blowdry_package_discount REAL DEFAULT 20,
            wash_blowdry_service_id TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);
    // Insert default config if empty
    await dbRun('INSERT OR IGNORE INTO rewards_config (id) VALUES (1)');

    await ensureTable('reward_tracks', `
        CREATE TABLE IF NOT EXISTS reward_tracks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_type TEXT NOT NULL CHECK(track_type IN ('nails', 'maintenance', 'spend')),
            current_count INTEGER DEFAULT 0,
            current_amount REAL DEFAULT 0,
            lifetime_count INTEGER DEFAULT 0,
            lifetime_amount REAL DEFAULT 0,
            last_milestone_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, track_type)
        )
    `);
    await ensureIndex('idx_reward_tracks_user', 'reward_tracks', 'user_id');
    await ensureIndex('idx_reward_tracks_type', 'reward_tracks', 'track_type');

    await ensureTable('user_rewards', `
        CREATE TABLE IF NOT EXISTS user_rewards (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reward_type TEXT NOT NULL CHECK(reward_type IN ('percentage_discount', 'fixed_discount', 'free_service')),
            reward_value REAL NOT NULL,
            applicable_to TEXT,
            description TEXT NOT NULL,
            source_track TEXT NOT NULL,
            source_milestone TEXT,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'redeemed', 'expired', 'voided')),
            expires_at TEXT,
            redeemed_at TEXT,
            redeemed_booking_id TEXT REFERENCES bookings(id),
            voided_by TEXT REFERENCES users(id),
            voided_reason TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_user_rewards_user', 'user_rewards', 'user_id');
    await ensureIndex('idx_user_rewards_status', 'user_rewards', 'status');
    await ensureIndex('idx_user_rewards_expires', 'user_rewards', 'expires_at');

    await ensureTable('service_packages', `
        CREATE TABLE IF NOT EXISTS service_packages (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            service_type TEXT NOT NULL,
            applicable_service_id TEXT REFERENCES services(id),
            total_sessions INTEGER NOT NULL,
            base_price REAL NOT NULL,
            discount_percent REAL NOT NULL,
            final_price REAL NOT NULL,
            validity_type TEXT DEFAULT 'calendar_month' CHECK(validity_type IN ('calendar_month', 'days_from_purchase')),
            validity_days INTEGER,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_service_packages_active', 'service_packages', 'active');

    await ensureTable('user_packages', `
        CREATE TABLE IF NOT EXISTS user_packages (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            package_id TEXT NOT NULL REFERENCES service_packages(id),
            package_name TEXT NOT NULL,
            total_sessions INTEGER NOT NULL,
            sessions_used INTEGER DEFAULT 0,
            purchase_price REAL NOT NULL,
            valid_from TEXT NOT NULL,
            valid_until TEXT NOT NULL,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'fully_used', 'expired')),
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_user_packages_user', 'user_packages', 'user_id');
    await ensureIndex('idx_user_packages_status', 'user_packages', 'status');

    await ensureTable('package_sessions', `
        CREATE TABLE IF NOT EXISTS package_sessions (
            id TEXT PRIMARY KEY,
            user_package_id TEXT NOT NULL REFERENCES user_packages(id) ON DELETE CASCADE,
            booking_id TEXT REFERENCES bookings(id),
            used_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_package_sessions_package', 'package_sessions', 'user_package_id');

    // ============================================
    // INVOICE TABLES (migration for existing databases)
    // ============================================
    await ensureTable('invoice_settings', `
        CREATE TABLE IF NOT EXISTS invoice_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            tax_enabled INTEGER DEFAULT 1,
            tax_rate REAL DEFAULT 0.15,
            tax_name TEXT DEFAULT 'VAT',
            tax_inclusive INTEGER DEFAULT 0,
            default_service_commission_rate REAL DEFAULT 0.30,
            default_product_commission_rate REAL DEFAULT 0.10,
            default_service_product_commission_rate REAL DEFAULT 0.05,
            invoice_number_prefix TEXT DEFAULT 'INV',
            invoice_number_format TEXT DEFAULT '{PREFIX}-{YEAR}-{NUMBER}',
            next_invoice_number INTEGER DEFAULT 1,
            allow_partial_payments INTEGER DEFAULT 1,
            payment_due_days INTEGER DEFAULT 0,
            max_discount_percentage REAL DEFAULT 100,
            require_discount_reason INTEGER DEFAULT 1,
            deduct_stock_on_finalize INTEGER DEFAULT 1,
            allow_negative_stock INTEGER DEFAULT 0,
            auto_create_invoice_on_completion INTEGER DEFAULT 0,
            require_booking_for_invoice INTEGER DEFAULT 0,
            auto_approve_commission_on_payment INTEGER DEFAULT 1,
            require_admin_commission_approval INTEGER DEFAULT 0,
            auto_send_invoice_email INTEGER DEFAULT 0,
            invoice_email_template TEXT DEFAULT 'default',
            updated_by TEXT REFERENCES users(id),
            updated_at TEXT DEFAULT (datetime('now')),
            CHECK(tax_rate >= 0 AND tax_rate <= 1),
            CHECK(default_service_commission_rate >= 0 AND default_service_commission_rate <= 1),
            CHECK(default_product_commission_rate >= 0 AND default_product_commission_rate <= 1)
        )
    `);
    // Insert default settings if empty
    await dbRun('INSERT OR IGNORE INTO invoice_settings (id) VALUES (1)');

    await ensureTable('invoices', `
        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            invoice_number TEXT UNIQUE,
            booking_id TEXT REFERENCES bookings(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            stylist_id TEXT NOT NULL REFERENCES stylists(id),
            services_subtotal REAL DEFAULT 0,
            products_subtotal REAL DEFAULT 0,
            subtotal REAL NOT NULL,
            discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'loyalty_points', 'promo_code', 'manual')),
            discount_value REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            discount_reason TEXT,
            tax_rate REAL DEFAULT 0.15,
            tax_amount REAL DEFAULT 0,
            total REAL NOT NULL,
            payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'partial', 'paid', 'refunded', 'written_off')),
            amount_paid REAL DEFAULT 0,
            amount_due REAL DEFAULT 0,
            commission_total REAL DEFAULT 0,
            commission_paid INTEGER DEFAULT 0,
            commission_paid_date TEXT,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'finalized', 'sent', 'cancelled', 'void')),
            service_date TEXT NOT NULL,
            invoice_date TEXT DEFAULT (date('now')),
            due_date TEXT,
            finalized_at TEXT,
            internal_notes TEXT,
            client_notes TEXT,
            created_by TEXT REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT,
            FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (stylist_id) REFERENCES stylists(id)
        )
    `);
    await ensureIndex('idx_invoices_booking', 'invoices', 'booking_id');
    await ensureIndex('idx_invoices_user', 'invoices', 'user_id');
    await ensureIndex('idx_invoices_stylist', 'invoices', 'stylist_id');
    await ensureIndex('idx_invoices_status', 'invoices', 'status');
    await ensureIndex('idx_invoices_payment_status', 'invoices', 'payment_status');
    await ensureIndex('idx_invoices_service_date', 'invoices', 'service_date');
    await ensureIndex('idx_invoices_invoice_number', 'invoices', 'invoice_number');

    await ensureTable('invoice_services', `
        CREATE TABLE IF NOT EXISTS invoice_services (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            service_id TEXT REFERENCES services(id),
            service_name TEXT NOT NULL,
            service_description TEXT,
            service_category TEXT,
            unit_price REAL NOT NULL,
            quantity REAL DEFAULT 1,
            discount REAL DEFAULT 0,
            total REAL NOT NULL,
            commission_rate REAL,
            commission_amount REAL,
            duration_minutes INTEGER,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
        )
    `);
    await ensureIndex('idx_invoice_services_invoice', 'invoice_services', 'invoice_id');
    await ensureIndex('idx_invoice_services_service', 'invoice_services', 'service_id');

    await ensureTable('invoice_products', `
        CREATE TABLE IF NOT EXISTS invoice_products (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            product_id TEXT REFERENCES products(id),
            product_name TEXT NOT NULL,
            product_category TEXT,
            product_type TEXT CHECK(product_type IN ('service_product', 'retail')),
            unit_price REAL NOT NULL,
            quantity REAL NOT NULL,
            discount REAL DEFAULT 0,
            total REAL NOT NULL,
            commission_rate REAL,
            commission_amount REAL,
            deducted_from_stock INTEGER DEFAULT 0,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        )
    `);
    await ensureIndex('idx_invoice_products_invoice', 'invoice_products', 'invoice_id');
    await ensureIndex('idx_invoice_products_product', 'invoice_products', 'product_id');
    await ensureIndex('idx_invoice_products_type', 'invoice_products', 'product_type');

    await ensureTable('invoice_payments', `
        CREATE TABLE IF NOT EXISTS invoice_payments (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL CHECK(payment_method IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft', 'loyalty_points')),
            payment_reference TEXT,
            payment_date TEXT DEFAULT (datetime('now')),
            processor_transaction_id TEXT,
            processor_status TEXT,
            processor_response TEXT,
            notes TEXT,
            processed_by TEXT REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
            FOREIGN KEY (processed_by) REFERENCES users(id)
        )
    `);
    await ensureIndex('idx_invoice_payments_invoice', 'invoice_payments', 'invoice_id');
    await ensureIndex('idx_invoice_payments_date', 'invoice_payments', 'payment_date');
    await ensureIndex('idx_invoice_payments_method', 'invoice_payments', 'payment_method');

    await ensureTable('invoice_commissions', `
        CREATE TABLE IF NOT EXISTS invoice_commissions (
            id TEXT PRIMARY KEY,
            invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            stylist_id TEXT NOT NULL REFERENCES stylists(id),
            services_commission REAL DEFAULT 0,
            products_commission REAL DEFAULT 0,
            total_commission REAL NOT NULL,
            payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'approved', 'paid', 'cancelled')),
            payment_date TEXT,
            payment_reference TEXT,
            approved_by TEXT REFERENCES users(id),
            approved_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            FOREIGN KEY (stylist_id) REFERENCES stylists(id),
            FOREIGN KEY (approved_by) REFERENCES users(id)
        )
    `);
    await ensureIndex('idx_invoice_commissions_invoice', 'invoice_commissions', 'invoice_id');
    await ensureIndex('idx_invoice_commissions_stylist', 'invoice_commissions', 'stylist_id');
    await ensureIndex('idx_invoice_commissions_status', 'invoice_commissions', 'payment_status');
    await ensureIndex('idx_invoice_commissions_date', 'invoice_commissions', 'payment_date');

    await ensureTable('payment_methods', `
        CREATE TABLE IF NOT EXISTS payment_methods (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            enabled INTEGER DEFAULT 1,
            transaction_fee_type TEXT DEFAULT 'none' CHECK(transaction_fee_type IN ('none', 'percentage', 'fixed')),
            transaction_fee_value REAL DEFAULT 0,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_payment_methods_enabled', 'payment_methods', 'enabled');
    // Insert default payment methods if empty
    const paymentMethodsExist = await dbGet('SELECT COUNT(*) as count FROM payment_methods');
    if (!paymentMethodsExist || paymentMethodsExist.count === 0) {
        await dbRun(`INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES ('cash', 'Cash', 'Cash payment at reception', 1)`);
        await dbRun(`INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES ('card_on_site', 'Card (On Site)', 'Card payment at salon using card machine', 2)`);
        await dbRun(`INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES ('eft', 'EFT', 'Electronic Funds Transfer', 3)`);
        await dbRun(`INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES ('payfast', 'PayFast', 'Online payment via PayFast', 4)`);
        await dbRun(`INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES ('yoco', 'Yoco', 'Online payment via Yoco', 5)`);
        await dbRun(`INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES ('loyalty_points', 'Loyalty Points', 'Pay using loyalty points', 6)`);
    }

    await ensureTable('discount_presets', `
        CREATE TABLE IF NOT EXISTS discount_presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage', 'fixed')),
            discount_value REAL NOT NULL,
            enabled INTEGER DEFAULT 1,
            requires_approval INTEGER DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    await ensureIndex('idx_discount_presets_enabled', 'discount_presets', 'enabled');
    // Insert default discount presets if empty
    const discountPresetsExist = await dbGet('SELECT COUNT(*) as count FROM discount_presets');
    if (!discountPresetsExist || discountPresetsExist.count === 0) {
        await dbRun(`INSERT OR IGNORE INTO discount_presets (id, name, description, discount_type, discount_value, display_order) VALUES ('vip-10', 'VIP Client (10%)', '10% discount for VIP clients', 'percentage', 10, 1)`);
        await dbRun(`INSERT OR IGNORE INTO discount_presets (id, name, description, discount_type, discount_value, display_order) VALUES ('vip-15', 'VIP Client (15%)', '15% discount for VIP clients', 'percentage', 15, 2)`);
        await dbRun(`INSERT OR IGNORE INTO discount_presets (id, name, description, discount_type, discount_value, display_order) VALUES ('first-time', 'First Time Client', 'R50 off for first-time clients', 'fixed', 50, 3)`);
        await dbRun(`INSERT OR IGNORE INTO discount_presets (id, name, description, discount_type, discount_value, display_order) VALUES ('staff-discount', 'Staff Discount (20%)', '20% discount for staff members', 'percentage', 20, 4)`);
        await dbRun(`INSERT OR IGNORE INTO discount_presets (id, name, description, discount_type, discount_value, display_order) VALUES ('loyalty-reward', 'Loyalty Reward', 'Reward for loyal customers', 'percentage', 5, 5)`);
    }

    // Booking columns for invoice integration
    await ensureColumn('bookings', 'invoice_id', 'TEXT REFERENCES invoices(id)');
    await ensureColumn('bookings', 'invoiced', 'INTEGER DEFAULT 0');
    await ensureIndex('idx_bookings_invoice', 'bookings', 'invoice_id');
    await ensureIndex('idx_bookings_invoiced', 'bookings', 'invoiced');
}

// Migration to set bookable=0 for non-bookable service categories
async function migrateServiceBookableFlag() {
    try {
        // Check if migration is already done (any service has bookable=0)
        const hasNonBookable = await dbGet('SELECT 1 FROM services WHERE bookable = 0 LIMIT 1');
        if (hasNonBookable) {
            return; // Migration already done
        }

        console.log('Migrating services to set bookable flag for non-bookable categories...');

        // Categories that are NOT bookable (invoice/admin only)
        const nonBookableCategories = [
            'MK Retail',           // Retail products
            'Wella Professional',  // Retail products
            'Session Redemptions', // Internal tracking
            'TRAINING',            // Staff training
            'Professional Basin'   // Internal resource
        ];

        let totalUpdated = 0;
        for (const category of nonBookableCategories) {
            const result = await dbRun(
                'UPDATE services SET bookable = 0 WHERE category = ? AND bookable = 1',
                [category]
            );
            if (result.changes > 0) {
                console.log(`  Set ${result.changes} services in "${category}" as non-bookable`);
                totalUpdated += result.changes;
            }
        }

        // Also mark General category items that are likely internal
        const generalResult = await dbRun(`
            UPDATE services SET bookable = 0
            WHERE category = 'General' AND bookable = 1 AND (
                name LIKE '%Tip%' OR
                name LIKE '%Gift%' OR
                name LIKE '%Voucher%' OR
                name LIKE '%Credit%' OR
                name LIKE '%Discount%' OR
                name LIKE '%Adjustment%'
            )
        `);
        if (generalResult.changes > 0) {
            console.log(`  Set ${generalResult.changes} internal services in "General" as non-bookable`);
            totalUpdated += generalResult.changes;
        }

        console.log(`Bookable flag migration complete. ${totalUpdated} services marked as non-bookable.`);
    } catch (error) {
        console.error('Error migrating service bookable flag:', error.message);
    }
}

// Migration to add 'eft' to payment_provider CHECK constraint
async function migratePaymentTransactionsTable() {
    try {
        // Check if the table needs migration by trying to insert an 'eft' value
        // If it fails with constraint error, we need to migrate
        const testId = '__migration_test__';
        try {
            await dbRun(`INSERT INTO payment_transactions (id, user_id, amount, payment_provider, status) VALUES (?, 'test', 0, 'eft', 'pending')`, [testId]);
            // If successful, delete the test row and return - no migration needed
            await dbRun(`DELETE FROM payment_transactions WHERE id = ?`, [testId]);
            return;
        } catch (e) {
            if (!e.message.includes('CHECK constraint failed') && !e.message.includes('FOREIGN KEY constraint failed')) {
                // Different error, might be foreign key - try another approach
                // Check table schema directly
                const tableInfo = await dbGet(`SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_transactions'`);
                if (tableInfo && tableInfo.sql && tableInfo.sql.includes("'eft'")) {
                    return; // Already has 'eft', no migration needed
                }
            }
        }

        console.log('Migrating payment_transactions table to add eft payment provider...');

        // Backup existing data
        const existingData = await dbAll('SELECT * FROM payment_transactions');

        // Drop and recreate table with new constraint
        await dbRun('DROP TABLE IF EXISTS payment_transactions');
        await dbRun(`
            CREATE TABLE payment_transactions (
                id TEXT PRIMARY KEY,
                order_id TEXT REFERENCES orders(id),
                booking_id TEXT REFERENCES bookings(id),
                user_id TEXT NOT NULL REFERENCES users(id),
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'ZAR',
                payment_provider TEXT NOT NULL CHECK(payment_provider IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft')),
                provider_transaction_id TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
                metadata TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT
            )
        `);

        // Recreate indexes
        await dbRun('CREATE INDEX IF NOT EXISTS idx_payments_order ON payment_transactions(order_id)');
        await dbRun('CREATE INDEX IF NOT EXISTS idx_payments_user ON payment_transactions(user_id)');
        await dbRun('CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_transactions(status)');

        // Restore data
        for (const row of existingData) {
            await dbRun(`
                INSERT INTO payment_transactions (id, order_id, booking_id, user_id, amount, currency, payment_provider, provider_transaction_id, status, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [row.id, row.order_id, row.booking_id, row.user_id, row.amount, row.currency, row.payment_provider, row.provider_transaction_id, row.status, row.metadata, row.created_at, row.updated_at]);
        }

        console.log(`Payment transactions table migrated successfully. ${existingData.length} records restored.`);
    } catch (error) {
        console.error('Error migrating payment_transactions table:', error.message);
    }
}

// Utilities for lightweight migrations (add missing columns safely)
async function ensureColumn(table, column, definition) {
    const info = await dbAll(`PRAGMA table_info(${table})`);
    const hasColumn = info.some(col => col.name === column);
    if (!hasColumn) {
        await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`Added missing column ${column} to ${table}`);
    }
}

// Ensure a table exists (for migrations)
async function ensureTable(tableName, createStatement) {
    const result = await dbGet(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        [tableName]
    );
    if (!result) {
        await dbRun(createStatement);
        console.log(`Created missing table: ${tableName}`);
    }
}

// Seed default service types and categories if tables are empty
async function seedDefaultServiceTypes() {
    const existingTypes = await dbGet('SELECT COUNT(*) as count FROM service_types');
    if (existingTypes && existingTypes.count > 0) {
        return; // Already has types, don't seed
    }

    const { v4: uuidv4 } = require('uuid');

    // Default service types
    const types = [
        { id: 'type_hair', name: 'hair', description: 'Hair services including extensions, styling, and treatments', display_order: 1 },
        { id: 'type_beauty', name: 'beauty', description: 'Beauty services including nails, makeup, and skincare', display_order: 2 },
        { id: 'type_spa', name: 'spa', description: 'Spa and wellness treatments', display_order: 3 }
    ];

    for (const type of types) {
        await dbRun(
            `INSERT OR IGNORE INTO service_types (id, name, description, display_order) VALUES (?, ?, ?, ?)`,
            [type.id, type.name, type.description, type.display_order]
        );
    }

    // Default categories for hair
    const hairCategories = [
        { name: 'Extensions', description: 'Hair extension services' },
        { name: 'Maintenance', description: 'Extension maintenance and tightening' },
        { name: 'Styling', description: 'Hair styling services' },
        { name: 'Treatments', description: 'Hair treatments and conditioning' },
        { name: 'Consultation', description: 'Color matching and consultations' }
    ];

    for (let i = 0; i < hairCategories.length; i++) {
        const cat = hairCategories[i];
        await dbRun(
            `INSERT OR IGNORE INTO service_categories (id, name, service_type_id, description, display_order) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), cat.name, 'type_hair', cat.description, i + 1]
        );
    }

    // Default categories for beauty
    const beautyCategories = [
        { name: 'Nails', description: 'Nail services' },
        { name: 'Brows & Lashes', description: 'Eyebrow and lash services' },
        { name: 'Makeup', description: 'Makeup application services' },
        { name: 'Skincare', description: 'Facial and skincare treatments' },
        { name: 'Waxing', description: 'Hair removal services' }
    ];

    for (let i = 0; i < beautyCategories.length; i++) {
        const cat = beautyCategories[i];
        await dbRun(
            `INSERT OR IGNORE INTO service_categories (id, name, service_type_id, description, display_order) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), cat.name, 'type_beauty', cat.description, i + 1]
        );
    }

    // Default categories for spa
    const spaCategories = [
        { name: 'Massage', description: 'Massage therapies' },
        { name: 'Body Treatments', description: 'Body wraps and scrubs' },
        { name: 'Wellness', description: 'Wellness and relaxation services' }
    ];

    for (let i = 0; i < spaCategories.length; i++) {
        const cat = spaCategories[i];
        await dbRun(
            `INSERT OR IGNORE INTO service_categories (id, name, service_type_id, description, display_order) VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), cat.name, 'type_spa', cat.description, i + 1]
        );
    }

    console.log('Seeded default service types and categories');
}

// Ensure an index exists (for migrations)
async function ensureIndex(indexName, tableName, column) {
    const result = await dbGet(
        `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
        [indexName]
    );
    if (!result) {
        await dbRun(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${column})`);
        console.log(`Created missing index: ${indexName}`);
    }
}

// Close database connection
function closeDb() {
    if (db) {
        db.close((err) => {
            if (err) console.error('Error closing database:', err.message);
            else console.log('Database connection closed');
        });
        db = null;
    }
}

// ============================================
// USER REPOSITORY
// ============================================
const UserRepository = {
    async findById(id) {
        return dbGet('SELECT * FROM users WHERE id = ?', [id]);
    },

    async findByEmail(email) {
        return dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    },

    async findByReferralCode(code) {
        return dbGet('SELECT * FROM users WHERE UPPER(referral_code) = UPPER(?)', [code]);
    },

    async findByRole(role) {
        return dbAll('SELECT * FROM users WHERE role = ?', [role]);
    },

    async create(user) {
        const sql = `
            INSERT INTO users (id, email, password_hash, name, phone, role, points, tier, referral_code, referred_by, must_change_password, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `;
        await dbRun(sql, [
            user.id, user.email, user.passwordHash, user.name, user.phone || null,
            user.role || 'customer', user.points || 0, user.tier || 'bronze',
            user.referralCode, user.referredBy || null, user.mustChangePassword ? 1 : 0
        ]);
        return this.findById(user.id);
    },

    async findAll() {
        return dbAll('SELECT * FROM users ORDER BY created_at DESC');
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            name: 'name', phone: 'phone', points: 'points', tier: 'tier',
            referredBy: 'referred_by', referralCode: 'referral_code',
            mustChangePassword: 'must_change_password',
            passwordHash: 'password_hash',
            hairProfile: 'hair_profile',
            notificationPrefs: 'notification_prefs'
        };

        // Fields that need JSON serialization
        const jsonFields = ['hairProfile', 'notificationPrefs'];

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                let value = updates[key];
                if (key === 'mustChangePassword') {
                    value = updates[key] ? 1 : 0;
                } else if (jsonFields.includes(key) && typeof value === 'object') {
                    value = JSON.stringify(value);
                }
                values.push(value);
            }
        }

        if (fields.length === 0) return this.findById(id);

        fields.push("updated_at = datetime('now')");
        values.push(id);

        await dbRun(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    // Get hair profile for a user (parses JSON)
    async getHairProfile(userId) {
        const user = await this.findById(userId);
        if (!user) return null;
        return user.hair_profile ? JSON.parse(user.hair_profile) : null;
    },

    // Update hair profile for a user
    async updateHairProfile(userId, profileData) {
        const existing = await this.getHairProfile(userId) || {};
        const merged = { ...existing, ...profileData };
        await this.update(userId, { hairProfile: merged });
        return merged;
    },

    // Get notification preferences for a user (parses JSON)
    async getNotificationPrefs(userId) {
        const user = await this.findById(userId);
        if (!user) return null;
        return user.notification_prefs ? JSON.parse(user.notification_prefs) : null;
    },

    // Update notification preferences for a user
    async updateNotificationPrefs(userId, prefs) {
        const existing = await this.getNotificationPrefs(userId) || {};
        const merged = { ...existing, ...prefs };
        await this.update(userId, { notificationPrefs: merged });
        return merged;
    },

    // Alias for update() to match server.js usage
    async updateById(id, updates) {
        return this.update(id, updates);
    },

    async addPoints(id, pointsToAdd) {
        const user = await this.findById(id);
        if (!user) return null;
        const newPoints = (user.points || 0) + pointsToAdd;
        const newTier = loyaltyHelper.calculateTier(newPoints);
        await dbRun(
            `UPDATE users SET points = ?, tier = ?, updated_at = datetime('now') WHERE id = ?`,
            [newPoints, newTier, id]
        );
        return this.findById(id);
    },

    async deductPoints(id, pointsToDeduct) {
        const user = await this.findById(id);
        if (!user) return null;
        const newPoints = Math.max(0, (user.points || 0) - Math.abs(pointsToDeduct));
        const newTier = loyaltyHelper.calculateTier(newPoints);
        await dbRun(
            `UPDATE users SET points = ?, tier = ?, updated_at = datetime('now') WHERE id = ?`,
            [newPoints, newTier, id]
        );
        return this.findById(id);
    },

    async getHairTracker(userId) {
        const row = await dbGet('SELECT * FROM hair_tracker WHERE user_id = ?', [userId]);
        if (!row) return null;

        // Convert snake_case DB columns to camelCase and parse JSON fields
        return {
            lastInstallDate: row.last_install_date,
            extensionType: row.extension_type,
            maintenanceIntervalDays: row.maintenance_interval_days,
            nextMaintenanceDate: row.next_maintenance_date,
            lastDeepConditionDate: row.last_deep_condition_date,
            lastWashDate: row.last_wash_date,
            hairHealthScore: row.hair_health_score,
            washHistory: row.wash_history ? JSON.parse(row.wash_history) : [],
            productsUsed: row.products_used ? JSON.parse(row.products_used) : [],
            updatedAt: row.updated_at
        };
    },

    async updateHairTracker(userId, data) {
        const existing = await this.getHairTracker(userId);

        // Merge with existing data
        const merged = {
            lastInstallDate: data.lastInstallDate !== undefined ? data.lastInstallDate : (existing?.lastInstallDate || null),
            extensionType: data.extensionType !== undefined ? data.extensionType : (existing?.extensionType || null),
            maintenanceIntervalDays: data.maintenanceIntervalDays !== undefined ? data.maintenanceIntervalDays : (existing?.maintenanceIntervalDays || 42),
            nextMaintenanceDate: data.nextMaintenanceDate !== undefined ? data.nextMaintenanceDate : (existing?.nextMaintenanceDate || null),
            lastDeepConditionDate: data.lastDeepConditionDate !== undefined ? data.lastDeepConditionDate : (existing?.lastDeepConditionDate || null),
            lastWashDate: data.lastWashDate !== undefined ? data.lastWashDate : (existing?.lastWashDate || null),
            hairHealthScore: data.hairHealthScore !== undefined ? data.hairHealthScore : (existing?.hairHealthScore || 100),
            washHistory: data.washHistory !== undefined ? data.washHistory : (existing?.washHistory || []),
            productsUsed: data.productsUsed !== undefined ? data.productsUsed : (existing?.productsUsed || [])
        };

        // Serialize JSON fields
        const washHistoryJson = JSON.stringify(merged.washHistory);
        const productsUsedJson = JSON.stringify(merged.productsUsed);

        if (existing) {
            await dbRun(
                `UPDATE hair_tracker SET
                    last_install_date = ?,
                    extension_type = ?,
                    maintenance_interval_days = ?,
                    next_maintenance_date = ?,
                    last_deep_condition_date = ?,
                    last_wash_date = ?,
                    hair_health_score = ?,
                    wash_history = ?,
                    products_used = ?,
                    updated_at = datetime('now')
                WHERE user_id = ?`,
                [
                    merged.lastInstallDate,
                    merged.extensionType,
                    merged.maintenanceIntervalDays,
                    merged.nextMaintenanceDate,
                    merged.lastDeepConditionDate,
                    merged.lastWashDate,
                    merged.hairHealthScore,
                    washHistoryJson,
                    productsUsedJson,
                    userId
                ]
            );
        } else {
            await dbRun(
                `INSERT INTO hair_tracker (
                    user_id, last_install_date, extension_type, maintenance_interval_days,
                    next_maintenance_date, last_deep_condition_date, last_wash_date,
                    hair_health_score, wash_history, products_used
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    merged.lastInstallDate,
                    merged.extensionType,
                    merged.maintenanceIntervalDays,
                    merged.nextMaintenanceDate,
                    merged.lastDeepConditionDate,
                    merged.lastWashDate,
                    merged.hairHealthScore,
                    washHistoryJson,
                    productsUsedJson
                ]
            );
        }
        return await this.getHairTracker(userId);
    },

    async getAllCustomersWithStats() {
        const sql = `
            SELECT
                u.*,
                COUNT(DISTINCT b.id) as total_bookings,
                COUNT(DISTINCT o.id) as total_orders,
                COALESCE(SUM(o.total), 0) as total_spent
            FROM users u
            LEFT JOIN bookings b ON b.user_id = u.id
            LEFT JOIN orders o ON o.user_id = u.id
            WHERE u.role = 'customer'
            GROUP BY u.id
        `;
        return dbAll(sql);
    },

    async findReferrals(referrerId) {
        return dbAll(
            `SELECT id, name, email, created_at FROM users WHERE referred_by = ? ORDER BY created_at DESC`,
            [referrerId]
        );
    }
};

// ============================================
// STYLIST REPOSITORY
// ============================================
const StylistRepository = {
    async findAll(includeInactive = true) {
        if (includeInactive) {
            return dbAll('SELECT * FROM stylists ORDER BY name');
        }
        return dbAll('SELECT * FROM stylists WHERE available = 1 ORDER BY name');
    },

    async findById(id) {
        return dbGet('SELECT * FROM stylists WHERE id = ?', [id]);
    },

    async findAvailable() {
        return dbAll('SELECT * FROM stylists WHERE available = 1 ORDER BY name');
    },

    async create(stylist) {
        const sql = `
            INSERT INTO stylists (id, name, specialty, tagline, clients_count, years_experience, instagram, color, available, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            stylist.id, stylist.name, stylist.specialty, stylist.tagline || '',
            stylist.clientsCount || 0, stylist.yearsExperience || 0,
            stylist.instagram || '', stylist.color || '#FF6B9D',
            stylist.available !== false ? 1 : 0, stylist.imageUrl || ''
        ]);
        return this.findById(stylist.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            name: 'name', specialty: 'specialty', tagline: 'tagline',
            clientsCount: 'clients_count', yearsExperience: 'years_experience',
            instagram: 'instagram', color: 'color', available: 'available',
            imageUrl: 'image_url', basicMonthlyPay: 'basic_monthly_pay',
            commissionRate: 'commission_rate'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(key === 'available' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);
        values.push(id);

        await dbRun(`UPDATE stylists SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async delete(id) {
        return dbRun('DELETE FROM stylists WHERE id = ?', [id]);
    },

    async archive(id) {
        return dbRun('UPDATE stylists SET available = 0 WHERE id = ?', [id]);
    }
};

// ============================================
// SERVICE REPOSITORY
// ============================================
const ServiceRepository = {
    async findAll(filters = {}) {
        let sql = 'SELECT * FROM services WHERE 1=1';
        const params = [];

        if (filters.serviceType) {
            sql += ' AND service_type = ?';
            params.push(filters.serviceType);
        }

        if (filters.category) {
            sql += ' AND category = ?';
            params.push(filters.category);
        }

        if (filters.active !== undefined) {
            sql += ' AND active = ?';
            params.push(filters.active ? 1 : 0);
        } else {
            // By default, only return active services
            sql += ' AND active = 1';
        }

        // Filter by bookable status (for client booking vs invoice-only services)
        if (filters.bookable !== undefined) {
            sql += ' AND bookable = ?';
            params.push(filters.bookable ? 1 : 0);
        }

        sql += ' ORDER BY category, name';
        return dbAll(sql, params);
    },

    async findByType(type) {
        return dbAll('SELECT * FROM services WHERE service_type = ? AND active = 1', [type]);
    },

    // Find only bookable services (for client appointment booking)
    async findBookable(filters = {}) {
        return this.findAll({ ...filters, bookable: true });
    },

    // Find bookable services by type
    async findBookableByType(type) {
        return dbAll('SELECT * FROM services WHERE service_type = ? AND active = 1 AND bookable = 1 ORDER BY category, name', [type]);
    },

    async findById(id) {
        return dbGet('SELECT * FROM services WHERE id = ?', [id]);
    },

    async findHairServices() {
        return this.findByType('hair');
    },

    async findBeautyServices() {
        return this.findByType('beauty');
    },

    async create(service) {
        const sql = `
            INSERT INTO services (id, name, description, price, duration, service_type, category, image_url, display_order, commission_rate, active, bookable)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            service.id,
            service.name,
            service.description || '',
            service.price,
            service.duration || null,
            service.service_type || service.serviceType,  // Support both snake_case and camelCase
            service.category || null,
            service.image_url || service.imageUrl || null,  // Support both snake_case and camelCase
            service.display_order || 0,
            service.commission_rate !== undefined ? service.commission_rate : null,
            service.active !== undefined ? service.active : 1,
            service.bookable !== undefined ? service.bookable : 1  // Default to bookable
        ]);
        return this.findById(service.id);
    },

    async update(id, service) {
        const sql = `
            UPDATE services
            SET name = ?, description = ?, price = ?, duration = ?,
                service_type = ?, category = ?, image_url = ?, display_order = ?,
                commission_rate = ?, active = ?, bookable = ?
            WHERE id = ?
        `;
        await dbRun(sql, [
            service.name,
            service.description || '',
            service.price,
            service.duration || null,
            service.service_type || service.serviceType,  // Support both snake_case and camelCase
            service.category || null,
            service.image_url || service.imageUrl || null,  // Support both snake_case and camelCase
            service.display_order || 0,
            service.commission_rate !== undefined ? service.commission_rate : null,
            service.active !== undefined ? service.active : 1,
            service.bookable !== undefined ? service.bookable : 1,  // Default to bookable
            id
        ]);
        return this.findById(id);
    },

    async delete(id) {
        await dbRun('DELETE FROM services WHERE id = ?', [id]);
    }
};

// ============================================
// BOOKING REPOSITORY
// ============================================
const BookingRepository = {
    async findById(id) {
        return dbGet('SELECT * FROM bookings WHERE id = ?', [id]);
    },

    async findByUserId(userId) {
        return dbAll('SELECT * FROM bookings WHERE user_id = ? ORDER BY requested_date DESC', [userId]);
    },

    async findByDate(date) {
        return dbAll('SELECT * FROM bookings WHERE requested_date = ?', [date]);
    },

    async findConflict(stylistId, assignedStartTime, assignedEndTime, excludeId = null) {
        // Check for overlapping time slots using the new assigned_start_time and assigned_end_time fields
        let sql = `
            SELECT * FROM bookings
            WHERE stylist_id = ?
            AND status IN ('CONFIRMED', 'REQUESTED')
            AND assigned_start_time IS NOT NULL
            AND assigned_end_time IS NOT NULL
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
    },

    async findAll(filters = {}) {
        let sql = `
            SELECT b.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email,
                   s.name as stylist_name, srv.name as actual_service_name
            FROM bookings b
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN stylists s ON s.id = b.stylist_id
            LEFT JOIN services srv ON srv.id = b.service_id
            WHERE 1=1
        `;
        const params = [];

        // Status filter
        if (filters.status && filters.status !== 'all') {
            sql += ' AND b.status = ?';
            params.push(filters.status);
        }

        // Date filter (exact match)
        if (filters.date) {
            sql += ' AND b.requested_date = ?';
            params.push(filters.date);
        }

        // Date range filter
        if (filters.dateFrom) {
            sql += ' AND b.requested_date >= ?';
            params.push(filters.dateFrom);
        }
        if (filters.dateTo) {
            sql += ' AND b.requested_date <= ?';
            params.push(filters.dateTo);
        }

        // Stylist filter
        if (filters.stylistId) {
            sql += ' AND b.stylist_id = ?';
            params.push(filters.stylistId);
        }

        // Service filter
        if (filters.serviceId) {
            sql += ' AND b.service_id = ?';
            params.push(filters.serviceId);
        }

        // Time of day filter (supports both new time windows and legacy preferred_time_of_day)
        if (filters.timeOfDay && filters.timeOfDay !== 'all') {
            sql += ' AND (b.requested_time_window = ? OR b.preferred_time_of_day = ?)';
            params.push(filters.timeOfDay, filters.timeOfDay);
        }

        // Booking type filter
        if (filters.bookingType) {
            sql += ' AND b.booking_type = ?';
            params.push(filters.bookingType);
        }

        // Search across multiple fields
        if (filters.search) {
            sql += ` AND (
                u.name LIKE ? OR
                u.email LIKE ? OR
                u.phone LIKE ? OR
                b.id LIKE ? OR
                b.service_name LIKE ? OR
                b.notes LIKE ? OR
                s.name LIKE ?
            )`;
            const searchTerm = `%${filters.search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // Sorting
        const validSortFields = {
            'date': 'b.requested_date',
            'time': 'b.assigned_start_time',
            'customer': 'u.name',
            'stylist': 's.name',
            'service': 'b.service_name',
            'status': 'b.status',
            'created': 'b.created_at'
        };
        const sortBy = filters.sortBy && validSortFields[filters.sortBy] ? validSortFields[filters.sortBy] : 'b.requested_date';
        const sortDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC';
        sql += ` ORDER BY ${sortBy} ${sortDir}, b.assigned_start_time ${sortDir}`;

        return dbAll(sql, params);
    },

    async create(booking) {
        const sql = `
            INSERT INTO bookings (
                id, user_id, booking_type, stylist_id, service_id, service_name, service_price,
                requested_date, requested_time_window, assigned_start_time, assigned_end_time,
                status, notes,
                date, preferred_time_of_day, time, confirmed_time
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            booking.id,
            booking.userId,
            booking.type || booking.bookingType,
            booking.stylistId || null,
            booking.serviceId,
            booking.serviceName,
            booking.servicePrice,
            // New two-step booking fields
            booking.requestedDate,
            booking.requestedTimeWindow,
            booking.assignedStartTime || null,
            booking.assignedEndTime || null,
            booking.status || 'REQUESTED',
            booking.notes || null,
            // Legacy fields (for backward compatibility)
            booking.date || booking.requestedDate,
            booking.preferredTimeOfDay || booking.requestedTimeWindow,
            booking.time || null,
            booking.confirmedTime || booking.assignedStartTime
        ]);
        return this.findById(booking.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            // New two-step booking fields
            status: 'status',
            requestedDate: 'requested_date',
            requestedTimeWindow: 'requested_time_window',
            assignedStartTime: 'assigned_start_time',
            assignedEndTime: 'assigned_end_time',
            stylistId: 'stylist_id',
            notes: 'notes',
            // Legacy fields (for backward compatibility)
            date: 'date',
            preferredTimeOfDay: 'preferred_time_of_day',
            time: 'time',
            confirmedTime: 'confirmed_time',
            // Payment tracking fields
            paymentStatus: 'payment_status',
            paymentMethod: 'payment_method',
            paymentReference: 'payment_reference',
            paymentDate: 'payment_date',
            paymentAmount: 'payment_amount',
            // Commission fields
            commissionRate: 'commission_rate',
            commissionAmount: 'commission_amount',
            // Timestamps
            updatedAt: 'updated_at',
            completedAt: 'completed_at'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);

        // Only add auto-update for updated_at if not explicitly provided
        if (updates.updatedAt === undefined) {
            fields.push("updated_at = datetime('now')");
        }
        values.push(id);

        await dbRun(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async updateById(id, updates) {
        return this.update(id, updates);
    },

    // New method for admin time assignment
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
            throw new Error(`Time slot conflict with booking ${conflict.id} for ${conflict.customer_name || 'a customer'}`);
        }

        // Update booking with assigned time and CONFIRMED status
        const sql = `
            UPDATE bookings
            SET stylist_id = ?,
                assigned_start_time = ?,
                assigned_end_time = ?,
                confirmed_time = ?,
                status = 'CONFIRMED',
                updated_at = datetime('now')
            WHERE id = ?
        `;

        await dbRun(sql, [
            assignment.stylistId,
            assignment.assignedStartTime,
            assignment.assignedEndTime,
            assignment.assignedStartTime, // Update legacy field too
            bookingId
        ]);

        return this.findById(bookingId);
    },

    // Record payment for a booking
    async recordPayment(bookingId, paymentData) {
        const sql = `
            UPDATE bookings SET
                payment_status = ?,
                payment_method = ?,
                payment_reference = ?,
                payment_date = ?,
                payment_amount = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `;

        await dbRun(sql, [
            paymentData.status || 'paid',
            paymentData.method,
            paymentData.reference || null,
            paymentData.date || new Date().toISOString(),
            paymentData.amount,
            bookingId
        ]);

        return this.findById(bookingId);
    },

    // Find bookings with payment filters
    async findWithPaymentStatus(filters = {}) {
        let sql = `
            SELECT b.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email,
                   s.name as stylist_name
            FROM bookings b
            LEFT JOIN users u ON u.id = b.user_id
            LEFT JOIN stylists s ON s.id = b.stylist_id
            WHERE 1=1
        `;
        const params = [];

        if (filters.paymentStatus) {
            sql += ' AND b.payment_status = ?';
            params.push(filters.paymentStatus);
        }

        if (filters.stylistId) {
            sql += ' AND b.stylist_id = ?';
            params.push(filters.stylistId);
        }

        if (filters.status) {
            sql += ' AND b.status = ?';
            params.push(filters.status);
        }

        if (filters.dateFrom) {
            sql += ' AND b.requested_date >= ?';
            params.push(filters.dateFrom);
        }

        if (filters.dateTo) {
            sql += ' AND b.requested_date <= ?';
            params.push(filters.dateTo);
        }

        sql += ' ORDER BY b.requested_date DESC, b.assigned_start_time DESC';
        return dbAll(sql, params);
    }
};

// ============================================
// PRODUCT REPOSITORY
// ============================================
const ProductRepository = {
    async findAll(filters = {}) {
        let sql = 'SELECT * FROM products WHERE active = 1';
        const params = [];

        if (filters.category) {
            sql += ' AND category = ?';
            params.push(filters.category);
        }
        if (filters.onSale) {
            sql += ' AND on_sale = 1';
        }

        return dbAll(sql, params);
    },

    async findById(id) {
        return dbGet('SELECT * FROM products WHERE id = ?', [id]);
    },

    async create(product) {
        const sql = `
            INSERT INTO products (id, name, category, description, price, sale_price, on_sale, stock, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            product.id, product.name, product.category, product.description || '',
            product.price, product.salePrice || null, product.onSale ? 1 : 0,
            product.stock || 0, product.imageUrl || ''
        ]);
        return this.findById(product.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            name: 'name', category: 'category', description: 'description',
            price: 'price', salePrice: 'sale_price', onSale: 'on_sale',
            stock: 'stock', imageUrl: 'image_url'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(key === 'onSale' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);
        values.push(id);

        await dbRun(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    // Alias for consistency with other repos
    async updateById(id, updates) {
        return this.update(id, updates);
    },

    async updateStock(id, quantity) {
        await dbRun('UPDATE products SET stock = stock + ? WHERE id = ?', [quantity, id]);
        return this.findById(id);
    },

    async delete(id) {
        return dbRun('UPDATE products SET active = 0 WHERE id = ?', [id]);
    }
};

// ============================================
// ORDER REPOSITORY
// ============================================
const OrderRepository = {
    async findById(id) {
        const order = await dbGet('SELECT * FROM orders WHERE id = ?', [id]);
        if (order) {
            order.items = await dbAll('SELECT * FROM order_items WHERE order_id = ?', [id]);
            if (order.delivery_address) {
                try { order.deliveryAddress = JSON.parse(order.delivery_address); }
                catch (e) { order.deliveryAddress = order.delivery_address; }
            }
            order.paymentStatus = order.payment_status || order.paymentStatus || 'unpaid';
            order.deliveryMethod = order.deliveryMethod || order.delivery_method;
            order.createdAt = order.createdAt || order.created_at;
            order.updatedAt = order.updatedAt || order.updated_at;
        }
        return order;
    },

    async findByUserId(userId) {
        const orders = await dbAll('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        for (const order of orders) {
            order.items = await dbAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
            order.paymentStatus = order.payment_status || order.paymentStatus || 'unpaid';
            order.deliveryMethod = order.deliveryMethod || order.delivery_method;
            order.createdAt = order.createdAt || order.created_at;
            order.updatedAt = order.updatedAt || order.updated_at;
        }
        return orders;
    },

    async findAll(filters = {}) {
        let sql = `
            SELECT o.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            WHERE 1=1
        `;
        const params = [];

        if (filters.status) {
            sql += ' AND o.status = ?';
            params.push(filters.status);
        }

        if (filters.deliveryMethod) {
            sql += ' AND LOWER(o.delivery_method) = LOWER(?)';
            params.push(filters.deliveryMethod);
        }

        if (filters.date) {
            sql += ' AND DATE(o.created_at) = DATE(?)';
            params.push(filters.date);
        }

        if (filters.dateFrom) {
            sql += ' AND DATE(o.created_at) >= DATE(?)';
            params.push(filters.dateFrom);
        }

        if (filters.dateTo) {
            sql += ' AND DATE(o.created_at) <= DATE(?)';
            params.push(filters.dateTo);
        }

        sql += ' ORDER BY o.created_at DESC';
        const orders = await dbAll(sql, params);

        for (const order of orders) {
            order.items = await dbAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
            order.userId = order.userId || order.user_id;
            order.paymentStatus = order.payment_status || order.paymentStatus || 'unpaid';
            order.deliveryMethod = order.deliveryMethod || order.delivery_method;
            order.createdAt = order.createdAt || order.created_at;
            order.updatedAt = order.updatedAt || order.updated_at;
            order.customerName = order.customerName || order.customer_name;
            order.customerEmail = order.customerEmail || order.customer_email;
        }
        return orders;
    },

    async create(order) {
        const sql = `
            INSERT INTO orders (id, user_id, subtotal, delivery_method, delivery_fee, delivery_address, promo_code, discount, total, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            order.id, order.userId, order.subtotal, order.deliveryMethod || 'pickup',
            order.deliveryFee || 0, order.deliveryAddress ? JSON.stringify(order.deliveryAddress) : null,
            order.promoCode || null, order.discount || 0, order.total, order.status || 'pending'
        ]);

        // Insert order items
        for (const item of order.items) {
            await dbRun(
                `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)`,
                [order.id, item.productId, item.productName, item.quantity, item.unitPrice]
            );
        }

        return this.findById(order.id);
    },

    async updateStatus(id, status) {
        await dbRun(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, id]);
        return this.findById(id);
    },

    async updatePaymentStatus(id, paymentStatus) {
        await dbRun(`UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`, [paymentStatus, id]);
        return this.findById(id);
    }
};

// ============================================
// PROMO REPOSITORY
// ============================================
const PromoRepository = {
    async findAll() {
        return dbAll('SELECT * FROM promos ORDER BY created_at DESC');
    },

    async findById(id) {
        return dbGet('SELECT * FROM promos WHERE id = ?', [id]);
    },

    async findByCode(code) {
        return dbGet('SELECT * FROM promos WHERE UPPER(code) = UPPER(?) AND active = 1', [code]);
    },

    async create(promo) {
        const sql = `
            INSERT INTO promos (id, code, description, discount_type, discount_value, min_order, expires_at, usage_limit, times_used, active, highlighted, badge, title, subtitle, priority)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            promo.id, promo.code.toUpperCase(), promo.description || '',
            promo.discountType, promo.discountValue, promo.minOrder || 0,
            promo.expiresAt || null, promo.usageLimit || null, promo.timesUsed || 0,
            promo.active !== false ? 1 : 0,
            promo.highlighted ? 1 : 0,
            promo.badge || '',
            promo.title || '',
            promo.subtitle || '',
            promo.priority || 0
        ]);
        return this.findById(promo.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            description: 'description', discountType: 'discount_type',
            discountValue: 'discount_value', minOrder: 'min_order',
            expiresAt: 'expires_at', usageLimit: 'usage_limit', active: 'active',
            highlighted: 'highlighted', badge: 'badge', title: 'title', subtitle: 'subtitle', priority: 'priority', timesUsed: 'times_used'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(key === 'active' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);
        values.push(id);

        await dbRun(`UPDATE promos SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async incrementUsage(id) {
        await dbRun('UPDATE promos SET times_used = times_used + 1 WHERE id = ?', [id]);
    },

    async delete(id) {
        return dbRun('DELETE FROM promos WHERE id = ?', [id]);
    }
};

// ============================================
// GALLERY REPOSITORY
// ============================================
const GalleryRepository = {
    mapRow(row) {
        if (!row) return null;
        return {
            id: row.id,
            imageUrl: row.image_url,
            altText: row.alt_text,
            label: row.label,
            category: row.category,
            order: row.order_num,
            active: !!row.active,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    },

    async findAll({ includeInactive = true } = {}) {
        let sql = 'SELECT * FROM gallery_items';
        const params = [];
        if (!includeInactive) {
            sql += ' WHERE active = 1';
        }
        sql += ' ORDER BY order_num ASC';
        const rows = await dbAll(sql, params);
        return rows.map(this.mapRow);
    },

    async findById(id) {
        const row = await dbGet('SELECT * FROM gallery_items WHERE id = ?', [id]);
        return this.mapRow(row);
    },

    async create(item) {
        const sql = `
            INSERT INTO gallery_items (id, image_url, alt_text, label, category, order_num, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `;
        await dbRun(sql, [
            item.id,
            item.imageUrl,
            item.altText || null,
            item.label || null,
            item.category || null,
            item.order || 0,
            item.active ? 1 : 0
        ]);
        return this.findById(item.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];
        const map = {
            imageUrl: 'image_url',
            altText: 'alt_text',
            label: 'label',
            category: 'category',
            order: 'order_num',
            active: 'active'
        };
        for (const [key, column] of Object.entries(map)) {
            if (updates[key] !== undefined) {
                fields.push(`${column} = ?`);
                values.push(key === 'active' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }
        if (fields.length === 0) return this.findById(id);

        fields.push("updated_at = datetime('now')");
        values.push(id);

        await dbRun(`UPDATE gallery_items SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async delete(id) {
        await dbRun('DELETE FROM gallery_items WHERE id = ?', [id]);
    },

    async reorder(orderedIds) {
        const tasks = orderedIds.map((id, idx) =>
            dbRun('UPDATE gallery_items SET order_num = ?, updated_at = datetime(\'now\') WHERE id = ?', [idx + 1, id])
        );
        await Promise.all(tasks);
    },

    async getInstagram() {
        const row = await dbGet('SELECT value FROM gallery_settings WHERE key = ?', ['instagram']);
        if (!row || !row.value) return null;
        try {
            return JSON.parse(row.value);
        } catch (err) {
            return null;
        }
    },

    async setInstagram(config) {
        const payload = JSON.stringify(config || {});
        await dbRun('INSERT OR REPLACE INTO gallery_settings (key, value) VALUES (?, ?)', ['instagram', payload]);
        return await this.getInstagram();
    }
};

// ============================================
// LOYALTY REPOSITORY
// ============================================
const LoyaltyRepository = {
    async getSettings() {
        const rows = await dbAll('SELECT * FROM loyalty_settings');
        const settings = {};
        for (const row of rows) {
            settings[row.key] = isNaN(row.value) ? row.value : parseFloat(row.value);
        }
        return {
            tierThresholds: {
                bronze: settings.tier_bronze || 0,
                silver: settings.tier_silver || 500,
                gold: settings.tier_gold || 1500,
                platinum: settings.tier_platinum || 5000
            },
            pointsRules: {
                spendRand: settings.spend_rand || 10,
                bookingPoints: settings.booking_points || 50,
                reviewPoints: settings.review_points || 25,
                referralPoints: settings.referral_points || 100
            }
        };
    },

    async saveSettings(config) {
        const settingsMap = {
            'tier_bronze': config.tierThresholds?.bronze ?? 0,
            'tier_silver': config.tierThresholds?.silver ?? 500,
            'tier_gold': config.tierThresholds?.gold ?? 1500,
            'tier_platinum': config.tierThresholds?.platinum ?? 5000,
            'spend_rand': config.pointsRules?.spendRand ?? 10,
            'booking_points': config.pointsRules?.bookingPoints ?? 50,
            'review_points': config.pointsRules?.reviewPoints ?? 25,
            'referral_points': config.pointsRules?.referralPoints ?? 100
        };

        for (const [key, value] of Object.entries(settingsMap)) {
            await dbRun(
                'INSERT OR REPLACE INTO loyalty_settings (key, value) VALUES (?, ?)',
                [key, String(value)]
            );
        }

        return this.getSettings();
    },

    async resetToDefaults() {
        const defaults = {
            tierThresholds: { bronze: 0, silver: 500, gold: 1500, platinum: 5000 },
            pointsRules: { spendRand: 10, bookingPoints: 50, reviewPoints: 25, referralPoints: 100 }
        };
        return this.saveSettings(defaults);
    },

    async getTransactionsByUser(userId) {
        return dbAll('SELECT * FROM loyalty_transactions WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    },

    async getTransactionsByUserId(userId) {
        return this.getTransactionsByUser(userId);
    },

    async createTransaction(transaction) {
        const sql = `
            INSERT INTO loyalty_transactions (id, user_id, points, transaction_type, description)
            VALUES (?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            transaction.id, transaction.userId, transaction.points,
            transaction.type, transaction.description || ''
        ]);
    },

    async addTransaction(transaction) {
        return this.createTransaction(transaction);
    },

    calculateTier(points, thresholds) {
        if (points >= thresholds.platinum) return 'platinum';
        if (points >= thresholds.gold) return 'gold';
        if (points >= thresholds.silver) return 'silver';
        return 'bronze';
    }
};

// ============================================
// NOTIFICATION REPOSITORY
// ============================================
const NotificationRepository = {
    async findAll() {
        return dbAll('SELECT * FROM notifications ORDER BY created_at DESC');
    },

    async findById(id) {
        return dbGet('SELECT * FROM notifications WHERE id = ?', [id]);
    },

    async findActive() {
        const sql = `
            SELECT * FROM notifications
            WHERE active = 1
            AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
            AND datetime(starts_at) <= datetime('now')
            ORDER BY created_at DESC
        `;
        return dbAll(sql);
    },

    async create(notification) {
        const sql = `
            INSERT INTO notifications (id, title, message, type, action, action_text, active, starts_at, expires_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            notification.id, notification.title, notification.message,
            notification.type || 'promo', notification.action || null,
            notification.actionText || 'View', notification.active !== false ? 1 : 0,
            notification.startsAt || new Date().toISOString(),
            notification.expiresAt || null, notification.createdBy || null
        ]);
        return this.findById(notification.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            title: 'title', message: 'message', type: 'type',
            action: 'action', actionText: 'action_text', active: 'active',
            startsAt: 'starts_at', expiresAt: 'expires_at'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(key === 'active' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);

        fields.push("updated_at = datetime('now')");
        values.push(id);

        await dbRun(`UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async toggleActive(id) {
        await dbRun(`UPDATE notifications SET active = NOT active, updated_at = datetime('now') WHERE id = ?`, [id]);
        return this.findById(id);
    },

    async delete(id) {
        return dbRun('DELETE FROM notifications WHERE id = ?', [id]);
    }
};

// ============================================
// HAIR TIP REPOSITORY
// ============================================
const HairTipRepository = {
    async findAll(includeInactive = true) {
        const where = includeInactive ? '' : 'WHERE active = 1';
        return dbAll(`SELECT * FROM hair_tips ${where} ORDER BY priority DESC, created_at DESC`);
    },

    async findById(id) {
        return dbGet('SELECT * FROM hair_tips WHERE id = ?', [id]);
    },

    async create(tip) {
        const id = tip.id || `tip_${Date.now()}`;
        await dbRun(
            `INSERT INTO hair_tips (id, text, category, priority, active, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`, [
                id,
                tip.text,
                tip.category || 'general',
                tip.priority || 1,
                tip.active !== undefined ? (tip.active ? 1 : 0) : 1,
                tip.createdAt || null
            ]
        );
        return this.findById(id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];
        const map = {
            text: 'text',
            category: 'category',
            priority: 'priority',
            active: 'active'
        };

        for (const [key, column] of Object.entries(map)) {
            if (updates[key] !== undefined) {
                fields.push(`${column} = ?`);
                values.push(key === 'active' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);

        fields.push("updated_at = datetime('now')");
        values.push(id);
        await dbRun(`UPDATE hair_tips SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async toggle(id) {
        const tip = await this.findById(id);
        if (!tip) return null;
        await dbRun(`UPDATE hair_tips SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?`, [id]);
        return this.findById(id);
    },

    async delete(id) {
        return dbRun('DELETE FROM hair_tips WHERE id = ?', [id]);
    }
};

// ============================================
// PUSH SUBSCRIPTION REPOSITORY
// ============================================
const PushSubscriptionRepository = {
    async findByUserId(userId) {
        return dbAll('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
    },

    async findByEndpoint(endpoint) {
        return dbGet('SELECT * FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    },

    async create(subscription) {
        const sql = `
            INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
            VALUES (?, ?, ?, ?)
        `;
        await dbRun(sql, [
            subscription.userId, subscription.endpoint,
            subscription.keys.p256dh, subscription.keys.auth
        ]);
    },

    async deleteByEndpoint(endpoint) {
        return dbRun('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    },

    async deleteByUserId(userId) {
        return dbRun('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
    }
};

// ============================================
// PAYMENT SETTINGS REPOSITORY
// ============================================
const PaymentSettingsRepository = {
    async getConfig() {
        const rows = await dbAll('SELECT key, value FROM payment_settings');
        if (!rows || rows.length === 0) return null;

        const config = {
            appUrl: null,
            apiBaseUrl: null,
            payfast: {},
            yoco: {}
        };

        for (const row of rows) {
            switch (row.key) {
                case 'app_url': config.appUrl = row.value; break;
                case 'api_base_url': config.apiBaseUrl = row.value; break;
                case 'payfast_merchant_id': config.payfast.merchantId = row.value; break;
                case 'payfast_merchant_key': config.payfast.merchantKey = row.value; break;
                case 'payfast_passphrase': config.payfast.passphrase = row.value; break;
                case 'payfast_sandbox': config.payfast.sandbox = row.value === 'true'; break;
                case 'yoco_secret_key': config.yoco.secretKey = row.value; break;
                case 'yoco_public_key': config.yoco.publicKey = row.value; break;
                case 'yoco_webhook_secret': config.yoco.webhookSecret = row.value; break;
                default: break;
            }
        }
        return config;
    },

    async saveConfig(config) {
        const entries = [];
        if (config.appUrl !== undefined) entries.push(['app_url', config.appUrl]);
        if (config.apiBaseUrl !== undefined) entries.push(['api_base_url', config.apiBaseUrl]);

        if (config.payfast) {
            if (config.payfast.merchantId !== undefined) entries.push(['payfast_merchant_id', config.payfast.merchantId]);
            if (config.payfast.merchantKey !== undefined) entries.push(['payfast_merchant_key', config.payfast.merchantKey]);
            if (config.payfast.passphrase !== undefined) entries.push(['payfast_passphrase', config.payfast.passphrase]);
            if (config.payfast.sandbox !== undefined) entries.push(['payfast_sandbox', String(!!config.payfast.sandbox)]);
        }

        if (config.yoco) {
            if (config.yoco.secretKey !== undefined) entries.push(['yoco_secret_key', config.yoco.secretKey]);
            if (config.yoco.publicKey !== undefined) entries.push(['yoco_public_key', config.yoco.publicKey]);
            if (config.yoco.webhookSecret !== undefined) entries.push(['yoco_webhook_secret', config.yoco.webhookSecret]);
        }

        for (const [key, value] of entries) {
            await dbRun(
                'INSERT OR REPLACE INTO payment_settings (key, value) VALUES (?, ?)',
                [key, value == null ? '' : String(value)]
            );
        }

        return this.getConfig();
    }
};

// ============================================
// PAYMENT REPOSITORY
// ============================================
const PaymentRepository = {
    async findById(id) {
        return dbGet('SELECT * FROM payment_transactions WHERE id = ?', [id]);
    },

    async findByOrderId(orderId) {
        return dbAll('SELECT * FROM payment_transactions WHERE order_id = ?', [orderId]);
    },

    async findByBookingId(bookingId) {
        return dbAll('SELECT * FROM payment_transactions WHERE booking_id = ? ORDER BY created_at DESC', [bookingId]);
    },

    async findByProviderId(providerId) {
        return dbGet('SELECT * FROM payment_transactions WHERE provider_transaction_id = ?', [providerId]);
    },

    async create(payment) {
        const sql = `
            INSERT INTO payment_transactions (id, order_id, booking_id, user_id, amount, currency, payment_provider, provider_transaction_id, status, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            payment.id, payment.orderId || null, payment.bookingId || null,
            payment.userId, payment.amount, payment.currency || 'ZAR',
            payment.provider, payment.providerTransactionId || null,
            payment.status || 'pending', payment.metadata ? JSON.stringify(payment.metadata) : null
        ]);
        return this.findById(payment.id);
    },

    async updateStatus(id, status, providerTransactionId = null, metadata = null) {
        let sql = `UPDATE payment_transactions SET status = ?, updated_at = datetime('now')`;
        const params = [status];

        if (providerTransactionId) {
            sql += ', provider_transaction_id = ?';
            params.push(providerTransactionId);
        }

        if (metadata !== null) {
            sql += ', metadata = ?';
            params.push(JSON.stringify(metadata));
        }

        sql += ' WHERE id = ?';
        params.push(id);

        await dbRun(sql, params);
        return this.findById(id);
    }
};

// ============================================
// CHAT REPOSITORY
// ============================================
const ChatRepository = {
    // Create a new conversation
    async createConversation(conversation) {
        const sql = `
            INSERT INTO chat_conversations (
                id, user_id, guest_id, user_name, user_email, source, status,
                assigned_to, unread_by_agent, unread_by_user, created_at, updated_at, last_message_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            conversation.id,
            conversation.userId || null,
            conversation.guestId || null,
            conversation.userName,
            conversation.userEmail || null,
            conversation.source || 'general',
            conversation.status || 'open',
            conversation.assignedTo || null,
            conversation.unreadByAgent || 0,
            conversation.unreadByUser || 0,
            conversation.createdAt || new Date().toISOString(),
            conversation.updatedAt || new Date().toISOString(),
            conversation.lastMessageAt || new Date().toISOString()
        ]);
        return this.findConversationById(conversation.id);
    },

    // Find conversation by ID
    async findConversationById(id) {
        const sql = 'SELECT * FROM chat_conversations WHERE id = ?';
        return await dbGet(sql, [id]);
    },

    // Find latest conversation for user/guest
    async findLatestConversation(userId, guestId) {
        let sql, params;
        if (userId) {
            sql = 'SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY last_message_at DESC LIMIT 1';
            params = [userId];
        } else if (guestId) {
            sql = 'SELECT * FROM chat_conversations WHERE guest_id = ? ORDER BY last_message_at DESC LIMIT 1';
            params = [guestId];
        } else {
            return null;
        }
        return await dbGet(sql, params);
    },

    // Get all conversations (for admin)
    async findAllConversations(filters = {}) {
        let sql = 'SELECT * FROM chat_conversations WHERE 1=1';
        const params = [];

        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        if (filters.assignedTo) {
            sql += ' AND assigned_to = ?';
            params.push(filters.assignedTo);
        }

        sql += ' ORDER BY last_message_at DESC';

        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(filters.limit);
        }

        return await dbAll(sql, params);
    },

    // Update conversation
    async updateConversation(id, updates) {
        const fields = [];
        const params = [];

        const map = {
            status: 'status',
            assignedTo: 'assigned_to',
            unreadByAgent: 'unread_by_agent',
            unreadByUser: 'unread_by_user',
            lastMessageAt: 'last_message_at',
            userName: 'user_name',
            userEmail: 'user_email'
        };

        for (const [key, column] of Object.entries(map)) {
            if (updates[key] !== undefined) {
                fields.push(`${column} = ?`);
                params.push(updates[key]);
            }
        }

        if (fields.length === 0) return this.findConversationById(id);

        fields.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(id);

        const sql = `UPDATE chat_conversations SET ${fields.join(', ')} WHERE id = ?`;
        await dbRun(sql, params);
        return this.findConversationById(id);
    },

    // Increment unread count
    async incrementUnread(conversationId, byAgent = false) {
        const field = byAgent ? 'unread_by_user' : 'unread_by_agent';
        const sql = `UPDATE chat_conversations SET ${field} = ${field} + 1, updated_at = ? WHERE id = ?`;
        await dbRun(sql, [new Date().toISOString(), conversationId]);
    },

    // Reset unread count
    async resetUnread(conversationId, byAgent = false) {
        const field = byAgent ? 'unread_by_agent' : 'unread_by_user';
        const sql = `UPDATE chat_conversations SET ${field} = 0, updated_at = ? WHERE id = ?`;
        await dbRun(sql, [new Date().toISOString(), conversationId]);
    },

    // Create a message
    async createMessage(message) {
        const sql = `
            INSERT INTO chat_messages (
                id, conversation_id, from_type, text, agent_id, read_by_agent, read_by_user, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            message.id,
            message.conversationId,
            message.fromType,
            message.text,
            message.agentId || null,
            message.readByAgent || 0,
            message.readByUser || 0,
            message.createdAt || new Date().toISOString()
        ]);

        // Update conversation's last_message_at
        await this.updateConversation(message.conversationId, {
            lastMessageAt: message.createdAt || new Date().toISOString()
        });

        return this.findMessageById(message.id);
    },

    // Find message by ID
    async findMessageById(id) {
        const sql = 'SELECT * FROM chat_messages WHERE id = ?';
        return await dbGet(sql, [id]);
    },

    // Get messages for a conversation
    async findMessagesByConversation(conversationId, limit = 100) {
        const sql = `
            SELECT * FROM chat_messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
            LIMIT ?
        `;
        return await dbAll(sql, [conversationId, limit]);
    },

    // Mark messages as read
    async markMessagesAsRead(conversationId, byAgent = false) {
        const field = byAgent ? 'read_by_agent' : 'read_by_user';
        const sql = `UPDATE chat_messages SET ${field} = 1 WHERE conversation_id = ? AND ${field} = 0`;
        await dbRun(sql, [conversationId]);

        // Reset unread count
        await this.resetUnread(conversationId, byAgent);
    },

    // Get total unread count for admin
    async getTotalUnreadCount() {
        const sql = 'SELECT SUM(unread_by_agent) as total FROM chat_conversations WHERE status = ?';
        const result = await dbGet(sql, ['open']);
        return result?.total || 0;
    }
};

// ============================================
// PAYROLL REPOSITORY
// ============================================
const PayrollRepository = {
    VAT_RATE: 0.15,

    async findById(id) {
        return dbGet('SELECT * FROM payroll_records WHERE id = ?', [id]);
    },

    async findByPeriod(year, month) {
        return dbAll(
            'SELECT * FROM payroll_records WHERE period_year = ? AND period_month = ? ORDER BY created_at DESC',
            [year, month]
        );
    },

    async findByStylistAndPeriod(stylistId, year, month) {
        return dbGet(
            'SELECT * FROM payroll_records WHERE stylist_id = ? AND period_year = ? AND period_month = ?',
            [stylistId, year, month]
        );
    },

    async findAll(filters = {}) {
        let sql = 'SELECT * FROM payroll_records WHERE 1=1';
        const params = [];

        if (filters.stylistId) {
            sql += ' AND stylist_id = ?';
            params.push(filters.stylistId);
        }
        if (filters.year) {
            sql += ' AND period_year = ?';
            params.push(filters.year);
        }
        if (filters.month) {
            sql += ' AND period_month = ?';
            params.push(filters.month);
        }
        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }

        sql += ' ORDER BY period_year DESC, period_month DESC, created_at DESC';
        return dbAll(sql, params);
    },

    // Calculate payroll for a stylist for a given month
    // Commission priority: booking.commission_rate > service.commission_rate (no stylist default)
    async calculatePayroll(stylistId, year, month) {
        // Get stylist info
        const stylist = await StylistRepository.findById(stylistId);
        if (!stylist) {
            throw new Error('Stylist not found');
        }

        // Get completed bookings for this stylist in the period
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = month === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(month + 1).padStart(2, '0')}-01`;

        // Join with services to get service-level commission rate
        // Include payment status for tracking (bookings are included regardless of payment status)
        const bookings = await dbAll(`
            SELECT b.*, s.commission_rate as service_commission_rate,
                   b.payment_status, b.payment_method, b.payment_date, b.payment_amount
            FROM bookings b
            LEFT JOIN services s ON b.service_id = s.id
            WHERE b.stylist_id = ?
            AND b.status = 'COMPLETED'
            AND (
                (b.requested_date >= ? AND b.requested_date < ?)
                OR (b.date >= ? AND b.date < ?)
            )
        `, [stylistId, startDate, endDate, startDate, endDate]);

        // Calculate totals with per-booking commission
        const totalBookings = bookings.length;
        const totalServiceRevenue = bookings.reduce((sum, b) => sum + (b.service_price || 0), 0);
        const totalServiceRevenueExVat = totalServiceRevenue / (1 + this.VAT_RATE);

        // Calculate commission for each booking based on priority
        let totalCommission = 0;
        const bookingDetails = bookings.map(b => {
            const priceExVat = (b.service_price || 0) / (1 + this.VAT_RATE);

            // Priority: booking override > service rate (no stylist default - commission must be set on service)
            let effectiveRate;
            let rateSource;
            if (b.commission_rate !== null && b.commission_rate !== undefined) {
                effectiveRate = b.commission_rate;
                rateSource = 'booking';
            } else if (b.service_commission_rate !== null && b.service_commission_rate !== undefined) {
                effectiveRate = b.service_commission_rate;
                rateSource = 'service';
            } else {
                // No commission configured for this service - default to 0
                effectiveRate = 0;
                rateSource = 'none';
            }

            const bookingCommission = priceExVat * effectiveRate;
            totalCommission += bookingCommission;

            return {
                id: b.id,
                serviceName: b.service_name,
                servicePrice: b.service_price,
                priceExVat: priceExVat,
                date: b.requested_date || b.date,
                commissionRate: effectiveRate,
                commissionAmount: bookingCommission,
                rateSource: rateSource,
                // Payment tracking
                paymentStatus: b.payment_status || 'unpaid',
                paymentMethod: b.payment_method,
                paymentDate: b.payment_date,
                paymentAmount: b.payment_amount
            };
        });

        // Calculate payment statistics
        const paidBookings = bookingDetails.filter(b => b.paymentStatus === 'paid').length;
        const unpaidBookings = bookingDetails.filter(b => b.paymentStatus !== 'paid').length;
        const paidRevenue = bookingDetails
            .filter(b => b.paymentStatus === 'paid')
            .reduce((sum, b) => sum + b.servicePrice, 0);
        const unpaidRevenue = bookingDetails
            .filter(b => b.paymentStatus !== 'paid')
            .reduce((sum, b) => sum + b.servicePrice, 0);

        const basicPay = stylist.basic_monthly_pay || 0;
        const grossPay = basicPay + totalCommission;

        // Calculate average commission rate for display (weighted by revenue)
        const avgCommissionRate = totalServiceRevenueExVat > 0
            ? totalCommission / totalServiceRevenueExVat
            : 0;

        return {
            stylistId,
            stylistName: stylist.name,
            periodYear: year,
            periodMonth: month,
            basicPay,
            commissionRate: avgCommissionRate, // weighted average for display
            totalBookings,
            totalServiceRevenue,
            totalServiceRevenueExVat,
            commissionAmount: totalCommission,
            grossPay,
            bookings: bookingDetails,
            // Payment statistics
            paymentStats: {
                paidBookings,
                unpaidBookings,
                paidRevenue,
                unpaidRevenue,
                percentPaid: totalBookings > 0 ? Math.round((paidBookings / totalBookings) * 100) : 0
            }
        };
    },

    // Create or update payroll record
    async upsert(record) {
        const existing = await this.findByStylistAndPeriod(
            record.stylistId,
            record.periodYear,
            record.periodMonth
        );

        if (existing) {
            // Don't update if already paid
            if (existing.status === 'paid') {
                throw new Error('Cannot update a paid payroll record');
            }

            await dbRun(`
                UPDATE payroll_records SET
                    basic_pay = ?,
                    commission_rate = ?,
                    total_bookings = ?,
                    total_service_revenue = ?,
                    total_service_revenue_ex_vat = ?,
                    commission_amount = ?,
                    gross_pay = ?,
                    status = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `, [
                record.basicPay,
                record.commissionRate,
                record.totalBookings,
                record.totalServiceRevenue,
                record.totalServiceRevenueExVat,
                record.commissionAmount,
                record.grossPay,
                record.status || existing.status,
                existing.id
            ]);

            return this.findById(existing.id);
        } else {
            const id = require('uuid').v4();
            await dbRun(`
                INSERT INTO payroll_records (
                    id, stylist_id, period_year, period_month,
                    basic_pay, commission_rate, total_bookings,
                    total_service_revenue, total_service_revenue_ex_vat,
                    commission_amount, gross_pay, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                record.stylistId,
                record.periodYear,
                record.periodMonth,
                record.basicPay,
                record.commissionRate,
                record.totalBookings,
                record.totalServiceRevenue,
                record.totalServiceRevenueExVat,
                record.commissionAmount,
                record.grossPay,
                record.status || 'draft'
            ]);

            return this.findById(id);
        }
    },

    async finalize(id) {
        const record = await this.findById(id);
        if (!record) {
            throw new Error('Payroll record not found');
        }
        if (record.status === 'paid') {
            throw new Error('Cannot finalize a paid record');
        }
        if (record.status === 'finalized') {
            throw new Error('Record is already finalized');
        }

        await dbRun(`
            UPDATE payroll_records SET
                status = 'finalized',
                finalized_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [id]);

        return this.findById(id);
    },

    async markAsPaid(id, notes = null) {
        const record = await this.findById(id);
        if (!record) {
            throw new Error('Payroll record not found');
        }

        await dbRun(`
            UPDATE payroll_records SET
                status = 'paid',
                paid_at = datetime('now'),
                notes = COALESCE(?, notes),
                updated_at = datetime('now')
            WHERE id = ?
        `, [notes, id]);

        return this.findById(id);
    },

    async delete(id) {
        const record = await this.findById(id);
        if (!record) {
            throw new Error('Payroll record not found');
        }
        if (record.status === 'paid') {
            throw new Error('Cannot delete a paid payroll record');
        }

        await dbRun('DELETE FROM payroll_records WHERE id = ?', [id]);
        return { success: true };
    },

    // Get summary for a period (all stylists)
    async getPeriodSummary(year, month) {
        const records = await this.findByPeriod(year, month);
        const stylists = await StylistRepository.findAll();

        const summary = {
            period: { year, month },
            totalBasicPay: 0,
            totalCommission: 0,
            totalGrossPay: 0,
            stylistCount: 0,
            records: []
        };

        for (const stylist of stylists) {
            const record = records.find(r => r.stylist_id === stylist.id);
            if (record) {
                summary.totalBasicPay += record.basic_pay || 0;
                summary.totalCommission += record.commission_amount || 0;
                summary.totalGrossPay += record.gross_pay || 0;
                summary.stylistCount++;
                summary.records.push({
                    ...record,
                    stylistName: stylist.name
                });
            }
        }

        return summary;
    }
};

// ============================================
// PASSWORD RESET REPOSITORY
// ============================================
const PasswordResetRepository = {
    async createToken(userId, token, expiresAt) {
        // Invalidate any existing tokens for this user
        await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [userId]);

        const sql = `
            INSERT INTO password_reset_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
        `;
        await dbRun(sql, [userId, token, expiresAt]);
        return { userId, token, expiresAt };
    },

    async findByToken(token) {
        return dbGet(`
            SELECT * FROM password_reset_tokens
            WHERE token = ? AND used = 0 AND datetime(expires_at) > datetime('now')
        `, [token]);
    },

    async markUsed(token) {
        await dbRun('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [token]);
    },

    async deleteExpired() {
        await dbRun("DELETE FROM password_reset_tokens WHERE datetime(expires_at) < datetime('now') OR used = 1");
    }
};

// ============================================
// REWARDS PROGRAMME REPOSITORIES
// ============================================

const RewardsConfigRepository = {
    async get() {
        let config = await dbGet('SELECT * FROM rewards_config WHERE id = 1');
        if (!config) {
            await dbRun('INSERT OR IGNORE INTO rewards_config (id) VALUES (1)');
            config = await dbGet('SELECT * FROM rewards_config WHERE id = 1');
        }
        return config;
    },

    async update(updates) {
        const fields = [];
        const values = [];
        const allowedFields = [
            'programme_enabled', 'programme_name', 'terms_conditions', 'terms_version',
            'nails_enabled', 'nails_milestone_1_count', 'nails_milestone_1_discount',
            'nails_milestone_2_count', 'nails_milestone_2_discount', 'nails_reward_expiry_days',
            'maintenance_enabled', 'maintenance_milestone_count', 'maintenance_discount',
            'maintenance_reward_expiry_days', 'spend_enabled', 'spend_threshold',
            'spend_discount', 'spend_reward_expiry_days', 'referral_enabled',
            'referral_min_booking_value', 'referral_reward_service_id',
            'referral_reward_description', 'packages_enabled',
            'wash_blowdry_package_sessions', 'wash_blowdry_package_discount', 'wash_blowdry_service_id'
        ];

        // Convert camelCase to snake_case and build update query
        for (const [key, value] of Object.entries(updates)) {
            const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
            if (allowedFields.includes(snakeKey)) {
                fields.push(`${snakeKey} = ?`);
                values.push(value);
            }
        }

        if (fields.length === 0) return this.get();

        fields.push("updated_at = datetime('now')");
        values.push(1);

        await dbRun(`UPDATE rewards_config SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.get();
    }
};

const RewardTrackRepository = {
    async getOrCreate(userId, trackType) {
        let track = await dbGet(
            'SELECT * FROM reward_tracks WHERE user_id = ? AND track_type = ?',
            [userId, trackType]
        );

        if (!track) {
            const id = require('uuid').v4();
            await dbRun(
                `INSERT INTO reward_tracks (id, user_id, track_type) VALUES (?, ?, ?)`,
                [id, userId, trackType]
            );
            track = await dbGet('SELECT * FROM reward_tracks WHERE id = ?', [id]);
        }

        return track;
    },

    async increment(userId, trackType, countIncrement = 1, amountIncrement = 0) {
        const track = await this.getOrCreate(userId, trackType);

        await dbRun(`
            UPDATE reward_tracks
            SET current_count = current_count + ?,
                current_amount = current_amount + ?,
                lifetime_count = lifetime_count + ?,
                lifetime_amount = lifetime_amount + ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [countIncrement, amountIncrement, countIncrement, amountIncrement, track.id]);

        return this.getOrCreate(userId, trackType);
    },

    async updateMilestone(userId, trackType, milestoneCount) {
        await dbRun(`
            UPDATE reward_tracks
            SET last_milestone_count = ?,
                updated_at = datetime('now')
            WHERE user_id = ? AND track_type = ?
        `, [milestoneCount, userId, trackType]);
    },

    async getAllForUser(userId) {
        return dbAll('SELECT * FROM reward_tracks WHERE user_id = ?', [userId]);
    },

    async resetCycleCount(userId, trackType) {
        await dbRun(`
            UPDATE reward_tracks
            SET current_count = 0,
                last_milestone_count = 0,
                updated_at = datetime('now')
            WHERE user_id = ? AND track_type = ?
        `, [userId, trackType]);
    }
};

const UserRewardRepository = {
    async create(reward) {
        const id = reward.id || require('uuid').v4();
        await dbRun(`
            INSERT INTO user_rewards
            (id, user_id, reward_type, reward_value, applicable_to, description,
             source_track, source_milestone, status, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `, [
            id, reward.userId, reward.rewardType, reward.rewardValue,
            reward.applicableTo || null, reward.description,
            reward.sourceTrack, reward.sourceMilestone || null,
            reward.expiresAt || null
        ]);
        return this.findById(id);
    },

    async findById(id) {
        return dbGet('SELECT * FROM user_rewards WHERE id = ?', [id]);
    },

    async findActiveForUser(userId) {
        return dbAll(`
            SELECT * FROM user_rewards
            WHERE user_id = ?
              AND status = 'active'
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
            ORDER BY created_at DESC
        `, [userId]);
    },

    async findApplicableForBooking(userId, serviceCategory, serviceId) {
        return dbAll(`
            SELECT * FROM user_rewards
            WHERE user_id = ?
              AND status = 'active'
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
              AND (applicable_to IS NULL
                   OR applicable_to = ?
                   OR applicable_to = ?)
            ORDER BY reward_value DESC
        `, [userId, serviceCategory || '', serviceId || '']);
    },

    async redeem(rewardId, bookingId) {
        await dbRun(`
            UPDATE user_rewards
            SET status = 'redeemed',
                redeemed_at = datetime('now'),
                redeemed_booking_id = ?
            WHERE id = ?
        `, [bookingId, rewardId]);
        return this.findById(rewardId);
    },

    async void(rewardId, voidedBy, reason) {
        await dbRun(`
            UPDATE user_rewards
            SET status = 'voided',
                voided_by = ?,
                voided_reason = ?
            WHERE id = ?
        `, [voidedBy, reason, rewardId]);
    },

    async updateStatus(rewardId, status) {
        await dbRun(`
            UPDATE user_rewards
            SET status = ?
            WHERE id = ?
        `, [status, rewardId]);
        return this.findById(rewardId);
    },

    async expireOld() {
        return dbRun(`
            UPDATE user_rewards
            SET status = 'expired'
            WHERE status = 'active'
              AND expires_at IS NOT NULL
              AND datetime(expires_at) < datetime('now')
        `);
    },

    async getHistory(userId, limit = 50) {
        return dbAll(`
            SELECT ur.*, b.service_name as redeemed_service
            FROM user_rewards ur
            LEFT JOIN bookings b ON ur.redeemed_booking_id = b.id
            WHERE ur.user_id = ?
            ORDER BY ur.created_at DESC
            LIMIT ?
        `, [userId, limit]);
    },

    async getAllAdmin(filters = {}) {
        let query = `
            SELECT ur.*, u.name as user_name, u.email as user_email
            FROM user_rewards ur
            JOIN users u ON ur.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.status) {
            query += ' AND ur.status = ?';
            params.push(filters.status);
        }
        if (filters.sourceTrack) {
            query += ' AND ur.source_track = ?';
            params.push(filters.sourceTrack);
        }
        if (filters.userId) {
            query += ' AND ur.user_id = ?';
            params.push(filters.userId);
        }

        query += ' ORDER BY ur.created_at DESC LIMIT 500';

        return dbAll(query, params);
    },

    async getStats() {
        const stats = await dbGet(`
            SELECT
                COUNT(*) as total_issued,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
                SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) as redeemed_count,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_count,
                SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END) as voided_count
            FROM user_rewards
        `);
        return stats;
    }
};

const ServicePackageRepository = {
    async create(pkg) {
        const id = pkg.id || require('uuid').v4();
        await dbRun(`
            INSERT INTO service_packages
            (id, name, description, service_type, applicable_service_id, total_sessions,
             base_price, discount_percent, final_price, validity_type, validity_days, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, pkg.name, pkg.description || null, pkg.serviceType,
            pkg.applicableServiceId || null, pkg.totalSessions,
            pkg.basePrice, pkg.discountPercent, pkg.finalPrice,
            pkg.validityType || 'calendar_month', pkg.validityDays || null,
            pkg.active !== false ? 1 : 0
        ]);
        return this.findById(id);
    },

    async findById(id) {
        return dbGet('SELECT * FROM service_packages WHERE id = ?', [id]);
    },

    async findAll() {
        return dbAll('SELECT * FROM service_packages ORDER BY name');
    },

    async findActive() {
        return dbAll('SELECT * FROM service_packages WHERE active = 1 ORDER BY name');
    },

    async update(id, updates) {
        const fields = [];
        const values = [];
        const fieldMap = {
            name: 'name',
            description: 'description',
            serviceType: 'service_type',
            applicableServiceId: 'applicable_service_id',
            totalSessions: 'total_sessions',
            basePrice: 'base_price',
            discountPercent: 'discount_percent',
            finalPrice: 'final_price',
            validityType: 'validity_type',
            validityDays: 'validity_days',
            active: 'active'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);

        values.push(id);
        await dbRun(`UPDATE service_packages SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async delete(id) {
        await dbRun('DELETE FROM service_packages WHERE id = ?', [id]);
    }
};

const UserPackageRepository = {
    async create(pkg) {
        const id = require('uuid').v4();
        await dbRun(`
            INSERT INTO user_packages
            (id, user_id, package_id, package_name, total_sessions,
             purchase_price, valid_from, valid_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, pkg.userId, pkg.packageId, pkg.packageName,
            pkg.totalSessions, pkg.purchasePrice, pkg.validFrom, pkg.validUntil
        ]);
        return this.findById(id);
    },

    async findById(id) {
        const pkg = await dbGet('SELECT * FROM user_packages WHERE id = ?', [id]);
        if (pkg) {
            pkg.sessions_remaining = pkg.total_sessions - pkg.sessions_used;
        }
        return pkg;
    },

    async findActiveForUser(userId) {
        const packages = await dbAll(`
            SELECT *,
                   (total_sessions - sessions_used) as sessions_remaining
            FROM user_packages
            WHERE user_id = ?
              AND status = 'active'
              AND date(valid_until) >= date('now')
            ORDER BY valid_until ASC
        `, [userId]);
        return packages;
    },

    async findAllForUser(userId) {
        return dbAll(`
            SELECT *,
                   (total_sessions - sessions_used) as sessions_remaining
            FROM user_packages
            WHERE user_id = ?
            ORDER BY created_at DESC
        `, [userId]);
    },

    async useSession(packageId, bookingId) {
        const pkg = await this.findById(packageId);
        if (!pkg || pkg.status !== 'active') {
            throw new Error('Package not found or inactive');
        }
        if (pkg.sessions_used >= pkg.total_sessions) {
            throw new Error('No sessions remaining');
        }
        if (new Date(pkg.valid_until) < new Date()) {
            throw new Error('Package has expired');
        }

        // Record session use
        const sessionId = require('uuid').v4();
        await dbRun(`
            INSERT INTO package_sessions (id, user_package_id, booking_id)
            VALUES (?, ?, ?)
        `, [sessionId, packageId, bookingId]);

        // Update package
        const newUsed = pkg.sessions_used + 1;
        const newStatus = newUsed >= pkg.total_sessions ? 'fully_used' : 'active';

        await dbRun(`
            UPDATE user_packages
            SET sessions_used = ?,
                status = ?
            WHERE id = ?
        `, [newUsed, newStatus, packageId]);

        return this.findById(packageId);
    },

    async expireOld() {
        return dbRun(`
            UPDATE user_packages
            SET status = 'expired'
            WHERE status = 'active'
              AND date(valid_until) < date('now')
        `);
    },

    async updateStatus(packageId, status) {
        await dbRun(`
            UPDATE user_packages
            SET status = ?
            WHERE id = ?
        `, [status, packageId]);
        return this.findById(packageId);
    },

    async getSessionHistory(packageId) {
        return dbAll(`
            SELECT ps.*, b.service_name, b.requested_date
            FROM package_sessions ps
            LEFT JOIN bookings b ON ps.booking_id = b.id
            WHERE ps.user_package_id = ?
            ORDER BY ps.used_at DESC
        `, [packageId]);
    }
};

// ============================================
// REWARD TRACK DEFINITIONS REPOSITORY
// Admin-configurable reward tracks
// ============================================
const RewardTrackDefinitionRepository = {
    async findAll(includeInactive = false) {
        const sql = includeInactive
            ? 'SELECT * FROM reward_track_definitions ORDER BY display_order, name'
            : 'SELECT * FROM reward_track_definitions WHERE active = 1 ORDER BY display_order, name';
        const tracks = await dbAll(sql);
        return tracks.map(t => ({
            ...t,
            milestones: JSON.parse(t.milestones || '[]')
        }));
    },

    async findById(id) {
        const track = await dbGet('SELECT * FROM reward_track_definitions WHERE id = ?', [id]);
        if (track) {
            track.milestones = JSON.parse(track.milestones || '[]');
        }
        return track;
    },

    async findByName(name) {
        const track = await dbGet('SELECT * FROM reward_track_definitions WHERE name = ?', [name]);
        if (track) {
            track.milestones = JSON.parse(track.milestones || '[]');
        }
        return track;
    },

    async create(track) {
        const id = track.id || require('uuid').v4();
        await dbRun(`
            INSERT INTO reward_track_definitions
            (id, name, display_name, description, track_type, icon, milestones, reward_expiry_days, reward_applicable_to, active, display_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            track.name,
            track.display_name,
            track.description || null,
            track.track_type,
            track.icon || '🎁',
            JSON.stringify(track.milestones || []),
            track.reward_expiry_days || 90,
            track.reward_applicable_to || null,
            track.active !== false ? 1 : 0,
            track.display_order || 0
        ]);
        return this.findById(id);
    },

    async update(id, updates) {
        const allowed = ['display_name', 'description', 'icon', 'milestones', 'reward_expiry_days', 'reward_applicable_to', 'active', 'display_order'];
        const sets = [];
        const params = [];

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                sets.push(`${key} = ?`);
                params.push(key === 'milestones' ? JSON.stringify(updates[key]) : updates[key]);
            }
        }

        if (sets.length === 0) return this.findById(id);

        sets.push('updated_at = datetime("now")');
        params.push(id);

        await dbRun(`UPDATE reward_track_definitions SET ${sets.join(', ')} WHERE id = ?`, params);
        return this.findById(id);
    },

    async delete(id) {
        await dbRun('DELETE FROM reward_track_definitions WHERE id = ?', [id]);
    }
};

// ============================================
// SERVICE REWARD MAPPINGS REPOSITORY
// Links services to reward tracks
// ============================================
const ServiceRewardMappingRepository = {
    async findAll(filters = {}) {
        let sql = `
            SELECT m.*, s.name as service_name, s.category as service_category, t.display_name as track_name
            FROM service_reward_mappings m
            JOIN services s ON m.service_id = s.id
            JOIN reward_track_definitions t ON m.track_id = t.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.serviceId) {
            sql += ' AND m.service_id = ?';
            params.push(filters.serviceId);
        }
        if (filters.trackId) {
            sql += ' AND m.track_id = ?';
            params.push(filters.trackId);
        }
        if (filters.active !== undefined) {
            sql += ' AND m.active = ?';
            params.push(filters.active ? 1 : 0);
        }

        sql += ' ORDER BY s.name, t.display_name';
        return dbAll(sql, params);
    },

    async findByServiceId(serviceId) {
        return dbAll(`
            SELECT m.*, t.name as track_name, t.display_name, t.track_type, t.milestones
            FROM service_reward_mappings m
            JOIN reward_track_definitions t ON m.track_id = t.id
            WHERE m.service_id = ? AND m.active = 1 AND t.active = 1
        `, [serviceId]);
    },

    async findByTrackId(trackId) {
        return dbAll(`
            SELECT m.*, s.name as service_name, s.category, s.price
            FROM service_reward_mappings m
            JOIN services s ON m.service_id = s.id
            WHERE m.track_id = ? AND m.active = 1
        `, [trackId]);
    },

    async create(mapping) {
        const id = require('uuid').v4();
        await dbRun(`
            INSERT INTO service_reward_mappings (id, service_id, track_id, points_multiplier, require_payment, active)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            id,
            mapping.service_id,
            mapping.track_id,
            mapping.points_multiplier || 1.0,
            mapping.require_payment !== false ? 1 : 0,
            mapping.active !== false ? 1 : 0
        ]);
        return this.findById(id);
    },

    async findById(id) {
        return dbGet('SELECT * FROM service_reward_mappings WHERE id = ?', [id]);
    },

    async update(id, updates) {
        const allowed = ['points_multiplier', 'require_payment', 'active'];
        const sets = [];
        const params = [];

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                sets.push(`${key} = ?`);
                params.push(updates[key]);
            }
        }

        if (sets.length === 0) return this.findById(id);

        params.push(id);
        await dbRun(`UPDATE service_reward_mappings SET ${sets.join(', ')} WHERE id = ?`, params);
        return this.findById(id);
    },

    async delete(id) {
        await dbRun('DELETE FROM service_reward_mappings WHERE id = ?', [id]);
    },

    async deleteByServiceAndTrack(serviceId, trackId) {
        await dbRun('DELETE FROM service_reward_mappings WHERE service_id = ? AND track_id = ?', [serviceId, trackId]);
    },

    async bulkAssign(serviceIds, trackId) {
        const results = [];
        for (const serviceId of serviceIds) {
            try {
                const existing = await dbGet(
                    'SELECT id FROM service_reward_mappings WHERE service_id = ? AND track_id = ?',
                    [serviceId, trackId]
                );
                if (!existing) {
                    const mapping = await this.create({ service_id: serviceId, track_id: trackId });
                    results.push(mapping);
                }
            } catch (e) {
                // Ignore duplicate errors
            }
        }
        return results;
    }
};

// ============================================
// CATEGORY REWARD MAPPINGS REPOSITORY
// Bulk assignment by category
// ============================================
const CategoryRewardMappingRepository = {
    async findAll() {
        return dbAll(`
            SELECT m.*, t.display_name as track_name
            FROM category_reward_mappings m
            JOIN reward_track_definitions t ON m.track_id = t.id
            WHERE m.active = 1
            ORDER BY m.category_name, t.display_name
        `);
    },

    async findByCategory(categoryName) {
        return dbAll(`
            SELECT m.*, t.name as track_name, t.display_name, t.track_type, t.milestones
            FROM category_reward_mappings m
            JOIN reward_track_definitions t ON m.track_id = t.id
            WHERE m.category_name = ? AND m.active = 1 AND t.active = 1
        `, [categoryName]);
    },

    async findByTrackId(trackId) {
        return dbAll(`
            SELECT * FROM category_reward_mappings
            WHERE track_id = ? AND active = 1
        `, [trackId]);
    },

    async create(mapping) {
        const id = require('uuid').v4();
        await dbRun(`
            INSERT OR IGNORE INTO category_reward_mappings (id, category_name, track_id, active)
            VALUES (?, ?, ?, ?)
        `, [id, mapping.category_name, mapping.track_id, 1]);
        return this.findById(id);
    },

    async findById(id) {
        return dbGet('SELECT * FROM category_reward_mappings WHERE id = ?', [id]);
    },

    async delete(id) {
        await dbRun('DELETE FROM category_reward_mappings WHERE id = ?', [id]);
    },

    async deleteByCategoryAndTrack(categoryName, trackId) {
        await dbRun('DELETE FROM category_reward_mappings WHERE category_name = ? AND track_id = ?', [categoryName, trackId]);
    },

    // Get all tracks applicable to a service (via service mapping or category mapping)
    async getTracksForService(serviceId, serviceCategory) {
        // First check direct service mappings
        const serviceMappings = await ServiceRewardMappingRepository.findByServiceId(serviceId);

        // Then check category mappings
        const categoryMappings = serviceCategory
            ? await this.findByCategory(serviceCategory)
            : [];

        // Combine and deduplicate by track_id
        const trackMap = new Map();

        for (const m of serviceMappings) {
            trackMap.set(m.track_id, {
                track_id: m.track_id,
                track_name: m.track_name,
                track_type: m.track_type,
                milestones: typeof m.milestones === 'string' ? JSON.parse(m.milestones) : m.milestones,
                points_multiplier: m.points_multiplier,
                require_payment: m.require_payment,
                source: 'service'
            });
        }

        for (const m of categoryMappings) {
            if (!trackMap.has(m.track_id)) {
                trackMap.set(m.track_id, {
                    track_id: m.track_id,
                    track_name: m.track_name,
                    track_type: m.track_type,
                    milestones: typeof m.milestones === 'string' ? JSON.parse(m.milestones) : m.milestones,
                    points_multiplier: 1.0,
                    require_payment: 1,
                    source: 'category'
                });
            }
        }

        return Array.from(trackMap.values());
    }
};

// Initialize Invoice Repository
const InvoiceRepository = new InvoiceRepositoryClass(getDb());

module.exports = {
    getDb,
    dbRun,
    dbGet,
    dbAll,
    initializeDatabase,
    closeDb,
    UserRepository,
    StylistRepository,
    ServiceRepository,
    BookingRepository,
    ProductRepository,
    OrderRepository,
    PromoRepository,
    GalleryRepository,
    LoyaltyRepository,
    NotificationRepository,
    HairTipRepository,
    PushSubscriptionRepository,
    PaymentRepository,
    PaymentSettingsRepository,
    ChatRepository,
    PayrollRepository,
    PasswordResetRepository,
    // Rewards Programme
    RewardsConfigRepository,
    RewardTrackRepository,
    UserRewardRepository,
    ServicePackageRepository,
    UserPackageRepository,
    // Service-to-Reward Track Mappings
    RewardTrackDefinitionRepository,
    ServiceRewardMappingRepository,
    CategoryRewardMappingRepository,
    // Invoicing System
    InvoiceRepository
};
