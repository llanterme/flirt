/**
 * Migration Script: Add user_inspo_photos table
 *
 * Creates a table to store user-uploaded inspiration photos
 * with a maximum of 5 photos per user.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'flirt.db');

function runMigration() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('🔧 Starting migration: Add user_inspo_photos table...\n');

            // Create user_inspo_photos table
            db.run(`
                CREATE TABLE IF NOT EXISTS user_inspo_photos (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    image_data TEXT NOT NULL,
                    label TEXT,
                    notes TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(user_id, id)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Error creating user_inspo_photos table:', err);
                    return reject(err);
                }
                console.log('✅ Created user_inspo_photos table');

                // Create index on user_id for faster queries
                db.run(`CREATE INDEX IF NOT EXISTS idx_inspo_photos_user ON user_inspo_photos(user_id)`, (err) => {
                    if (err) {
                        console.error('❌ Error creating index:', err);
                        return reject(err);
                    }
                    console.log('✅ Created index on user_id');

                    // Verify the migration
                    db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='user_inspo_photos'`, (err, row) => {
                        if (err) {
                            console.error('❌ Error verifying migration:', err);
                            return reject(err);
                        }

                        console.log('\n📋 New Table Schema:');
                        console.log('===================');
                        console.log(row.sql);
                        console.log('');

                        console.log('✅ Migration completed successfully!');
                        console.log('✅ user_inspo_photos table created');

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
runMigration()
    .then(() => {
        console.log('\n🎉 All done!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Migration failed:', err);
        process.exit(1);
    });
