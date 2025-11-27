/**
 * Migration: Add shop_banner column to promos table
 *
 * Adds show_in_shop_banner field to allow one promo to be displayed
 * as the flash sale banner in the shop section
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'flirt.db');

function addShopBannerColumn() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('📋 Adding shop_banner column to promos table...\n');

            // Add show_in_shop_banner column (0 or 1, default 0)
            db.run(`
                ALTER TABLE promos
                ADD COLUMN show_in_shop_banner INTEGER DEFAULT 0
            `, (err) => {
                if (err) {
                    if (err.message.includes('duplicate column')) {
                        console.log('⏭️  Column already exists, skipping...');
                        db.close((err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    } else {
                        console.error('❌ Error adding column:', err);
                        reject(err);
                    }
                } else {
                    console.log('✅ show_in_shop_banner column added successfully');

                    db.close((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                }
            });
        });
    });
}

// Run the migration
addShopBannerColumn()
    .then(() => {
        console.log('\n🎉 Migration complete!');
        console.log('\nAdmins can now designate one promo to show as the shop banner.');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Migration failed:', err);
        process.exit(1);
    });
