// Flirt Hair & Beauty - Database Module
// SQLite3 Database Access Layer

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');

let db = null;

// Initialize database connection
function getDb() {
    if (!db) {
        // Ensure directory exists
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Failed to connect to database:', err.message);
                throw err;
            }
            console.log('Connected to SQLite database:', DB_PATH);
        });

        // Enable foreign keys
        db.run('PRAGMA foreign_keys = ON');
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

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            name: 'name', phone: 'phone', points: 'points', tier: 'tier',
            referredBy: 'referred_by', mustChangePassword: 'must_change_password',
            passwordHash: 'password_hash'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(key === 'mustChangePassword' ? (updates[key] ? 1 : 0) : updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);

        fields.push("updated_at = datetime('now')");
        values.push(id);

        await dbRun(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
    },

    async getHairTracker(userId) {
        return dbGet('SELECT * FROM hair_tracker WHERE user_id = ?', [userId]);
    },

    async updateHairTracker(userId, data) {
        const existing = this.getHairTracker(userId);
        if (existing) {
            await dbRun(
                `UPDATE hair_tracker SET last_install_date = ?, extension_type = ?, updated_at = datetime('now') WHERE user_id = ?`,
                [data.lastInstallDate || existing.last_install_date, data.extensionType || existing.extension_type, userId]
            );
        } else {
            await dbRun(
                `INSERT INTO hair_tracker (user_id, last_install_date, extension_type) VALUES (?, ?, ?)`,
                [userId, data.lastInstallDate, data.extensionType]
            );
        }
        return this.getHairTracker(userId);
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
    }
};

// ============================================
// STYLIST REPOSITORY
// ============================================
const StylistRepository = {
    async findAll() {
        return dbAll('SELECT * FROM stylists ORDER BY name');
    },

    async findById(id) {
        return dbGet('SELECT * FROM stylists WHERE id = ?', [id]);
    },

    async findAvailable() {
        return dbAll('SELECT * FROM stylists WHERE available = 1 ORDER BY name');
    },

    async create(stylist) {
        const sql = `
            INSERT INTO stylists (id, name, specialty, tagline, rating, review_count, clients_count, years_experience, instagram, color, available, image_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            stylist.id, stylist.name, stylist.specialty, stylist.tagline || '',
            stylist.rating || 5.0, stylist.reviewCount || 0, stylist.clientsCount || 0,
            stylist.yearsExperience || 0, stylist.instagram || '', stylist.color || '#FF6B9D',
            stylist.available !== false ? 1 : 0, stylist.imageUrl || ''
        ]);
        return this.findById(stylist.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            name: 'name', specialty: 'specialty', tagline: 'tagline',
            rating: 'rating', reviewCount: 'review_count', instagram: 'instagram',
            color: 'color', available: 'available', imageUrl: 'image_url'
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
    }
};

// ============================================
// SERVICE REPOSITORY
// ============================================
const ServiceRepository = {
    async findByType(type) {
        return dbAll('SELECT * FROM services WHERE service_type = ? AND active = 1', [type]);
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
            INSERT INTO services (id, name, description, price, duration, service_type, category)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            service.id, service.name, service.description || '', service.price,
            service.duration || null, service.serviceType, service.category || null
        ]);
        return this.findById(service.id);
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
        return dbAll('SELECT * FROM bookings WHERE user_id = ? ORDER BY date DESC', [userId]);
    },

    async findByDate(date) {
        return dbAll('SELECT * FROM bookings WHERE date = ?', [date]);
    },

    async findConflict(stylistId, date, time, excludeId = null) {
        let sql = `
            SELECT * FROM bookings
            WHERE stylist_id = ? AND date = ? AND status != 'cancelled'
            AND (confirmed_time = ? OR time = ?)
        `;
        const params = [stylistId, date, time, time];

        if (excludeId) {
            sql += ' AND id != ?';
            params.push(excludeId);
        }

        return dbGet(sql, params);
    },

    async findAll(filters = {}) {
        let sql = `
            SELECT b.*, u.name as customer_name, u.phone as customer_phone, u.email as customer_email
            FROM bookings b
            LEFT JOIN users u ON u.id = b.user_id
            WHERE 1=1
        `;
        const params = [];

        if (filters.status) {
            sql += ' AND b.status = ?';
            params.push(filters.status);
        }
        if (filters.date) {
            sql += ' AND b.date = ?';
            params.push(filters.date);
        }
        if (filters.stylistId) {
            sql += ' AND b.stylist_id = ?';
            params.push(filters.stylistId);
        }

        sql += ' ORDER BY b.created_at DESC';
        return dbAll(sql, params);
    },

    async create(booking) {
        const sql = `
            INSERT INTO bookings (id, user_id, booking_type, stylist_id, service_id, service_name, service_price, date, preferred_time_of_day, time, confirmed_time, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            booking.id, booking.userId, booking.type, booking.stylistId || null,
            booking.serviceId, booking.serviceName, booking.servicePrice, booking.date,
            booking.preferredTimeOfDay || null, booking.time || null,
            booking.confirmedTime || null, booking.status || 'pending', booking.notes || null
        ]);
        return this.findById(booking.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            status: 'status', date: 'date', preferredTimeOfDay: 'preferred_time_of_day',
            time: 'time', confirmedTime: 'confirmed_time', notes: 'notes'
        };

        for (const [key, dbField] of Object.entries(fieldMap)) {
            if (updates[key] !== undefined) {
                fields.push(`${dbField} = ?`);
                values.push(updates[key]);
            }
        }

        if (fields.length === 0) return this.findById(id);

        fields.push("updated_at = datetime('now')");
        values.push(id);

        await dbRun(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`, values);
        return this.findById(id);
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
        }
        return order;
    },

    async findByUserId(userId) {
        const orders = await dbAll('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        for (const order of orders) {
            order.items = await dbAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
            order.paymentStatus = order.payment_status || order.paymentStatus || 'unpaid';
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

        sql += ' ORDER BY o.created_at DESC';
        const orders = await dbAll(sql, params);

        for (const order of orders) {
            order.items = await dbAll('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
            order.paymentStatus = order.payment_status || order.paymentStatus || 'unpaid';
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
            INSERT INTO promos (id, code, description, discount_type, discount_value, min_order, expires_at, usage_limit, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await dbRun(sql, [
            promo.id, promo.code.toUpperCase(), promo.description || '',
            promo.discountType, promo.discountValue, promo.minOrder || 0,
            promo.expiresAt || null, promo.usageLimit || null, promo.active !== false ? 1 : 0
        ]);
        return this.findById(promo.id);
    },

    async update(id, updates) {
        const fields = [];
        const values = [];

        const fieldMap = {
            description: 'description', discountType: 'discount_type',
            discountValue: 'discount_value', minOrder: 'min_order',
            expiresAt: 'expires_at', usageLimit: 'usage_limit', active: 'active'
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
    LoyaltyRepository,
    NotificationRepository,
    PushSubscriptionRepository,
    PaymentRepository,
    PaymentSettingsRepository
};
