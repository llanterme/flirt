/**
 * Migration Script: Add image_url to services table and remove service_type constraint
 *
 * Changes:
 * 1. Add image_url column for service images
 * 2. Remove CHECK constraint on service_type to allow any type (not just 'hair' and 'beauty')
 * 3. Allows admin to create custom service categories beyond hair and beauty
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'flirt.db');

function runMigration() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('🔧 Starting migration: Add image_url and flexible service types...\n');

            // Step 1: Create new services table with updated schema
            db.run(`
                CREATE TABLE IF NOT EXISTS services_new (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    price REAL NOT NULL,
                    duration INTEGER,
                    service_type TEXT NOT NULL,
                    category TEXT,
                    image_url TEXT,
                    active INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating new table:', err);
                    return reject(err);
                }
                console.log('✅ Created services_new table with image_url and flexible service_type');

                // Step 2: Copy all data from old table
                db.run(`
                    INSERT INTO services_new (id, name, description, price, duration, service_type, category, active, created_at)
                    SELECT id, name, description, price, duration, service_type, category, active, created_at
                    FROM services
                `, (err) => {
                    if (err) {
                        console.error('❌ Error copying data:', err);
                        return reject(err);
                    }
                    console.log('✅ Copied all data to new table');

                    // Step 3: Drop old table
                    db.run(`DROP TABLE services`, (err) => {
                        if (err) {
                            console.error('❌ Error dropping old table:', err);
                            return reject(err);
                        }
                        console.log('✅ Dropped old services table');

                        // Step 4: Rename new table
                        db.run(`ALTER TABLE services_new RENAME TO services`, (err) => {
                            if (err) {
                                console.error('❌ Error renaming table:', err);
                                return reject(err);
                            }
                            console.log('✅ Renamed services_new to services');

                            // Step 5: Recreate index
                            db.run(`CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type)`, (err) => {
                                if (err) {
                                    console.error('❌ Error creating index:', err);
                                    return reject(err);
                                }
                                console.log('✅ Recreated index on service_type');

                                // Verify the migration
                                db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='services'`, (err, row) => {
                                    if (err) {
                                        console.error('❌ Error verifying migration:', err);
                                        return reject(err);
                                    }

                                    console.log('\n📋 New Table Schema:');
                                    console.log('===================');
                                    console.log(row.sql);
                                    console.log('');

                                    console.log('✅ Migration completed successfully!');
                                    console.log('✅ services table now has image_url column');
                                    console.log('✅ service_type field now accepts any custom type');

                                    db.close((err) => {
                                        if (err) reject(err);
                                        else resolve();
                                    });
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
