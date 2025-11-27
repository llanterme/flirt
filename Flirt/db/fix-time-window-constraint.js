/**
 * Migration Script: Fix requested_time_window CHECK constraint to allow NULL
 *
 * The current constraint: CHECK(requested_time_window IN ('MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'))
 * Rejects NULL values, which breaks beauty bookings.
 *
 * New constraint: CHECK(requested_time_window IS NULL OR requested_time_window IN (...))
 * Allows NULL for beauty bookings while still validating non-NULL values.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'flirt.db');

function runMigration() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('🔧 Starting migration: Fix requested_time_window CHECK constraint...\n');

            // Step 1: Create new table with corrected CHECK constraint
            db.run(`
                CREATE TABLE IF NOT EXISTS bookings_new (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    booking_type TEXT NOT NULL CHECK(booking_type IN ('hair', 'beauty')),
                    stylist_id TEXT REFERENCES stylists(id),
                    service_id TEXT NOT NULL REFERENCES services(id),
                    service_name TEXT NOT NULL,
                    service_price REAL NOT NULL,

                    -- New two-step booking fields (requested_time_window is nullable with proper constraint)
                    requested_date TEXT NOT NULL,
                    requested_time_window TEXT CHECK(requested_time_window IS NULL OR requested_time_window IN ('MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING')),
                    assigned_start_time TEXT,
                    assigned_end_time TEXT,
                    status TEXT DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),

                    -- Legacy fields
                    date TEXT,
                    preferred_time_of_day TEXT,
                    time TEXT,
                    confirmed_time TEXT,

                    notes TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating new table:', err);
                    return reject(err);
                }
                console.log('✅ Created bookings_new table with corrected constraint');

                // Step 2: Copy all data from old table
                db.run(`
                    INSERT INTO bookings_new
                    SELECT * FROM bookings
                `, (err) => {
                    if (err) {
                        console.error('❌ Error copying data:', err);
                        return reject(err);
                    }
                    console.log('✅ Copied all data to new table');

                    // Step 3: Drop old table
                    db.run(`DROP TABLE bookings`, (err) => {
                        if (err) {
                            console.error('❌ Error dropping old table:', err);
                            return reject(err);
                        }
                        console.log('✅ Dropped old bookings table');

                        // Step 4: Rename new table
                        db.run(`ALTER TABLE bookings_new RENAME TO bookings`, (err) => {
                            if (err) {
                                console.error('❌ Error renaming table:', err);
                                return reject(err);
                            }
                            console.log('✅ Renamed bookings_new to bookings');

                            // Step 5: Recreate indexes
                            const indexes = [
                                `CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)`,
                                `CREATE INDEX IF NOT EXISTS idx_bookings_requested_date ON bookings(requested_date)`,
                                `CREATE INDEX IF NOT EXISTS idx_bookings_requested_time_window ON bookings(requested_time_window)`,
                                `CREATE INDEX IF NOT EXISTS idx_bookings_assigned_start_time ON bookings(assigned_start_time)`,
                                `CREATE INDEX IF NOT EXISTS idx_bookings_stylist ON bookings(stylist_id)`,
                                `CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`,
                                `CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)`
                            ];

                            let completed = 0;
                            indexes.forEach((indexSql, i) => {
                                db.run(indexSql, (err) => {
                                    if (err) {
                                        console.error(`❌ Error creating index ${i}:`, err);
                                    }
                                    completed++;
                                    if (completed === indexes.length) {
                                        console.log('✅ Recreated all indexes');

                                        // Verify the migration
                                        db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'`, (err, row) => {
                                            if (err) {
                                                console.error('❌ Error verifying migration:', err);
                                                return reject(err);
                                            }

                                            console.log('\n📋 New Table Schema:');
                                            console.log('===================');
                                            console.log(row.sql);
                                            console.log('');

                                            // Test NULL constraint
                                            console.log('🧪 Testing NULL constraint...');
                                            const testId = 'test-null-' + Date.now();
                                            db.run(`
                                                INSERT INTO bookings (
                                                    id, user_id, booking_type, service_id, service_name, service_price,
                                                    requested_date, requested_time_window, status
                                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                            `, [testId, 'test-user', 'beauty', 'test-service', 'Test', 100, '2025-12-01', null, 'REQUESTED'], (err) => {
                                                if (err) {
                                                    console.error('❌ NULL constraint test FAILED:', err.message);
                                                    return reject(err);
                                                }
                                                console.log('✅ NULL constraint test PASSED - can insert NULL time window');

                                                // Clean up test record
                                                db.run(`DELETE FROM bookings WHERE id = ?`, [testId], (err) => {
                                                    if (err) {
                                                        console.error('⚠️  Warning: Could not delete test record');
                                                    }

                                                    console.log('\n✅ Migration completed successfully!');
                                                    console.log('✅ requested_time_window now properly allows NULL values');

                                                    db.close((err) => {
                                                        if (err) reject(err);
                                                        else resolve();
                                                    });
                                                });
                                            });
                                        });
                                    }
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

// Run the migration
runMigration()
    .then(() => {
        console.log('\n🎉 All done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Migration failed:', err);
        process.exit(1);
    });
