/**
 * Booking Redesign Migration V2
 * SQLite-compatible version using CREATE TABLE and data copy approach
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/flirt.db';

console.log('\n========================================');
console.log('Booking Redesign Migration V2');
console.log('========================================\n');

const db = new sqlite3.Database(DB_PATH);

function runSQL(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function migrate() {
    try {
        console.log('✅ Connected to:', DB_PATH);
        console.log('\n📋 Step 1: Backing up bookings...');

        const bookings = await query('SELECT * FROM bookings');
        const backupPath = `./db/bookings-backup-${Date.now()}.json`;
        fs.writeFileSync(backupPath, JSON.stringify(bookings, null, 2));
        console.log(`   Backed up ${bookings.length} bookings to ${backupPath}`);

        console.log('\n📋 Step 2: Creating new bookings table...');

        // Drop the old table and create new one
        await runSQL('DROP TABLE IF EXISTS bookings_old');
        await runSQL('ALTER TABLE bookings RENAME TO bookings_old');

        // Create new table with updated schema
        await runSQL(`
            CREATE TABLE bookings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                booking_type TEXT NOT NULL CHECK(booking_type IN ('hair', 'beauty')),
                stylist_id TEXT REFERENCES stylists(id),
                service_id TEXT NOT NULL REFERENCES services(id),
                service_name TEXT NOT NULL,
                service_price REAL NOT NULL,
                requested_date TEXT NOT NULL,
                requested_time_window TEXT NOT NULL CHECK(requested_time_window IN ('MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING')),
                assigned_start_time TEXT,
                assigned_end_time TEXT,
                status TEXT DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT
            )
        `);

        console.log('   ✅ New table created');

        console.log('\n📋 Step 3: Migrating data...');

        // Migrate data with transformations
        await runSQL(`
            INSERT INTO bookings (
                id, user_id, booking_type, stylist_id, service_id, service_name, service_price,
                requested_date, requested_time_window, assigned_start_time, assigned_end_time,
                status, notes, created_at, updated_at
            )
            SELECT
                id, user_id, booking_type, stylist_id, service_id, service_name, service_price,
                -- Map old 'date' to 'requested_date'
                date as requested_date,
                -- Map old 'preferred_time_of_day' to 'requested_time_window'
                CASE
                    WHEN LOWER(COALESCE(preferred_time_of_day, '')) IN ('morning', 'am', 'early') THEN 'MORNING'
                    WHEN LOWER(COALESCE(preferred_time_of_day, '')) IN ('afternoon', 'pm', 'midday') THEN 'AFTERNOON'
                    WHEN LOWER(COALESCE(preferred_time_of_day, '')) IN ('late afternoon', 'late', 'late_afternoon') THEN 'LATE_AFTERNOON'
                    WHEN LOWER(COALESCE(preferred_time_of_day, '')) IN ('evening', 'night', 'late evening') THEN 'EVENING'
                    ELSE 'AFTERNOON'
                END as requested_time_window,
                -- Map old 'confirmed_time' or 'time' to 'assigned_start_time'
                CASE
                    WHEN confirmed_time LIKE '%-%-%T%:%' THEN confirmed_time
                    WHEN confirmed_time LIKE '__:__' THEN date || 'T' || confirmed_time || ':00.000Z'
                    WHEN time LIKE '__:__' THEN date || 'T' || time || ':00.000Z'
                    ELSE NULL
                END as assigned_start_time,
                -- Calculate 'assigned_end_time' (add 2 hours to start time)
                CASE
                    WHEN confirmed_time LIKE '%-%-%T%:%' THEN datetime(confirmed_time, '+2 hours')
                    WHEN confirmed_time LIKE '__:__' THEN datetime(date || 'T' || confirmed_time || ':00.000Z', '+2 hours')
                    WHEN time LIKE '__:__' THEN datetime(date || 'T' || time || ':00.000Z', '+2 hours')
                    ELSE NULL
                END as assigned_end_time,
                -- Map old status to new status
                CASE
                    WHEN status = 'pending' AND (confirmed_time IS NOT NULL OR time IS NOT NULL) THEN 'CONFIRMED'
                    WHEN status = 'pending' THEN 'REQUESTED'
                    WHEN status = 'confirmed' THEN 'CONFIRMED'
                    WHEN status = 'completed' THEN 'COMPLETED'
                    WHEN status = 'cancelled' THEN 'CANCELLED'
                    ELSE 'REQUESTED'
                END as status,
                notes, created_at, updated_at
            FROM bookings_old
        `);

        console.log('   ✅ Data migrated');

        console.log('\n📋 Step 4: Creating indexes...');

        await runSQL('CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)');
        await runSQL('CREATE INDEX IF NOT EXISTS idx_bookings_requested_date ON bookings(requested_date)');
        await runSQL('CREATE INDEX IF NOT EXISTS idx_bookings_requested_time_window ON bookings(requested_time_window)');
        await runSQL('CREATE INDEX IF NOT EXISTS idx_bookings_assigned_start_time ON bookings(assigned_start_time)');
        await runSQL('CREATE INDEX IF NOT EXISTS idx_bookings_stylist ON bookings(stylist_id)');
        await runSQL('CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)');

        console.log('   ✅ Indexes created');

        console.log('\n📋 Step 5: Verifying migration...');

        const migratedCount = await query('SELECT COUNT(*) as count FROM bookings');
        const oldCount = await query('SELECT COUNT(*) as count FROM bookings_old');

        console.log(`   Old table: ${oldCount[0].count} bookings`);
        console.log(`   New table: ${migratedCount[0].count} bookings`);

        if (migratedCount[0].count !== oldCount[0].count) {
            throw new Error('Migration count mismatch!');
        }

        const sample = await query(`
            SELECT id, status, requested_date, requested_time_window, assigned_start_time
            FROM bookings
            LIMIT 5
        `);

        console.log('\n   Sample migrated bookings:');
        console.table(sample);

        const stats = await query(`
            SELECT
                status,
                COUNT(*) as count,
                COUNT(CASE WHEN assigned_start_time IS NOT NULL THEN 1 END) as with_assigned_time
            FROM bookings
            GROUP BY status
        `);

        console.log('\n📊 Migration Statistics:');
        console.table(stats);

        console.log('\n========================================');
        console.log('✅ Migration completed successfully!');
        console.log('========================================\n');
        console.log(`Backup saved to: ${backupPath}`);
        console.log('Old table renamed to: bookings_old (can be dropped later)\n');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        db.close();
    }
}

migrate();
