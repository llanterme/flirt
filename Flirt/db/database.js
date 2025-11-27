// Flirt Hair & Beauty - Database Module
// SQLite3 Database Access Layer

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const loyaltyHelper = require('../helpers/loyalty');

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
    await ensureColumn('promos', 'highlighted', 'INTEGER DEFAULT 0');
    await ensureColumn('promos', 'badge', 'TEXT');
    await ensureColumn('promos', 'title', 'TEXT');
    await ensureColumn('promos', 'subtitle', 'TEXT');
    await ensureColumn('promos', 'priority', 'INTEGER DEFAULT 0');

    // Booking table migrations for two-step booking flow
    await ensureColumn('bookings', 'requested_date', "TEXT DEFAULT '2024-01-01'");
    await ensureColumn('bookings', 'requested_time_window', "TEXT DEFAULT 'MORNING' CHECK(requested_time_window IN ('MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'))");
    await ensureColumn('bookings', 'assigned_start_time', 'TEXT');
    await ensureColumn('bookings', 'assigned_end_time', 'TEXT');

    // Update existing bookings to have proper status values
    await ensureColumnWithUpdate('bookings', 'status',
        "TEXT DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'))",
        "'REQUESTED'"
    );

    // Migrate existing booking data to new fields
    try {
        // Update requested_date from legacy date field where available
        await dbRun(`
            UPDATE bookings
            SET requested_date = COALESCE(date, '2024-01-01')
            WHERE requested_date = '2024-01-01' AND date IS NOT NULL
        `);

        // Update requested_time_window from legacy preferred_time_of_day
        await dbRun(`
            UPDATE bookings
            SET requested_time_window = CASE
                WHEN preferred_time_of_day = 'morning' THEN 'MORNING'
                WHEN preferred_time_of_day = 'afternoon' THEN 'AFTERNOON'
                WHEN preferred_time_of_day = 'evening' THEN 'EVENING'
                ELSE 'MORNING'
            END
            WHERE requested_time_window = 'MORNING' AND preferred_time_of_day IS NOT NULL
        `);

        console.log('Migrated legacy booking data to new fields');
    } catch (error) {
        console.log('Legacy booking migration skipped (table may not exist yet):', error.message);
    }

    // Migrate booking status values to uppercase format
    try {
        // Update existing status values from lowercase to uppercase
        await dbRun(`
            UPDATE bookings
            SET status = CASE
                WHEN status = 'pending' THEN 'REQUESTED'
                WHEN status = 'confirmed' THEN 'CONFIRMED'
                WHEN status = 'completed' THEN 'COMPLETED'
                WHEN status = 'cancelled' THEN 'CANCELLED'
                ELSE 'REQUESTED'
            END
            WHERE status IN ('pending', 'confirmed', 'completed', 'cancelled')
        `);
        console.log('Migrated booking status values to uppercase format');
    } catch (error) {
        console.log('Status migration skipped:', error.message);
    }

    // Create indexes for new booking columns (only after columns exist)
    try {
        await dbRun('CREATE INDEX IF NOT EXISTS idx_bookings_requested_date ON bookings(requested_date)');
        await dbRun('CREATE INDEX IF NOT EXISTS idx_bookings_requested_time_window ON bookings(requested_time_window)');
        await dbRun('CREATE INDEX IF NOT EXISTS idx_bookings_assigned_start_time ON bookings(assigned_start_time)');
        await dbRun('CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)');
        console.log('Created indexes for new booking columns');
    } catch (error) {
        console.log('Index creation skipped:', error.message);
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

// Ensure column exists and update existing records if needed
async function ensureColumnWithUpdate(table, column, definition, defaultValue) {
    const info = await dbAll(`PRAGMA table_info(${table})`);
    const hasColumn = info.some(col => col.name === column);
    if (!hasColumn) {
        await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`Added missing column ${column} to ${table}`);

        // Update existing records with the default value
        if (defaultValue) {
            await dbRun(`UPDATE ${table} SET ${column} = ${defaultValue} WHERE ${column} IS NULL`);
            console.log(`Updated existing ${table} records with default ${column} value`);
        }
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
            rating: 'rating', reviewCount: 'review_count', clientsCount: 'clients_count',
            yearsExperience: 'years_experience', instagram: 'instagram',
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

        sql += ' ORDER BY category, name';
        return dbAll(sql, params);
    },

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
            INSERT INTO services (id, name, description, price, duration, service_type, category, image_url, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            service.active !== undefined ? service.active : 1
        ]);
        return this.findById(service.id);
    },

    async update(id, service) {
        const sql = `
            UPDATE services
            SET name = ?, description = ?, price = ?, duration = ?,
                service_type = ?, category = ?, image_url = ?, active = ?,
                updated_at = datetime('now')
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
            service.active !== undefined ? service.active : 1,
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
            confirmedTime: 'confirmed_time'
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
        return this.getInstagram();
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
    ChatRepository
};
