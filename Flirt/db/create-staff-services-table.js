/**
 * Migration: Create staff_services junction table
 *
 * This table links staff members to services they offer with custom pricing
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'flirt.db');

function createStaffServicesTable() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('📋 Creating staff_services junction table...\n');

            // Create staff_services table
            db.run(`
                CREATE TABLE IF NOT EXISTS staff_services (
                    id TEXT PRIMARY KEY,
                    staff_id TEXT NOT NULL,
                    service_id TEXT NOT NULL,
                    custom_price REAL,
                    custom_duration INTEGER,
                    active INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (staff_id) REFERENCES stylists(id) ON DELETE CASCADE,
                    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
                    UNIQUE(staff_id, service_id)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating staff_services table:', err);
                    return reject(err);
                }
                console.log('✅ staff_services table created successfully');

                // Create index for faster lookups
                db.run(`
                    CREATE INDEX IF NOT EXISTS idx_staff_services_staff
                    ON staff_services(staff_id)
                `, (err) => {
                    if (err) {
                        console.error('❌ Error creating staff index:', err);
                        return reject(err);
                    }
                    console.log('✅ Index on staff_id created');

                    db.run(`
                        CREATE INDEX IF NOT EXISTS idx_staff_services_service
                        ON staff_services(service_id)
                    `, (err) => {
                        if (err) {
                            console.error('❌ Error creating service index:', err);
                            return reject(err);
                        }
                        console.log('✅ Index on service_id created');

                        db.close((err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                });
            });
        });
    });
}

// Run the migration
createStaffServicesTable()
    .then(() => {
        console.log('\n🎉 Migration complete!');
        console.log('\nStaff can now be linked to services with custom pricing.');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Migration failed:', err);
        process.exit(1);
    });
