/**
 * Migration: Add available_online column to products table
 * Only these brands should be sold online:
 * - Kevin Murphy
 * - Mycro Keratin (MK Retail)
 * - Moyoko
 * - Wella
 * - Kalahari
 * - Heliocare
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'flirt.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Failed to connect to database:', err.message);
        process.exit(1);
    }
    console.log('Connected to database:', DB_PATH);
});

// Brands that should be available for online sale
const ONLINE_BRANDS = [
    'Kevin Murphy',
    'Kevin Murphy Retail',
    'MK Retail',           // Mycro Keratin
    'Moyoko',
    'Wella Professional',
    'Kalahari Retail',
    'Heliocare Retail'
];

async function run() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Step 1: Add the available_online column if it doesn't exist
            db.run(`ALTER TABLE products ADD COLUMN available_online INTEGER DEFAULT 0`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Error adding column:', err.message);
                } else {
                    console.log('Added available_online column (or already exists)');
                }
            });

            // Step 2: Set all products to not available online by default
            db.run(`UPDATE products SET available_online = 0`, (err) => {
                if (err) {
                    console.error('Error resetting available_online:', err.message);
                } else {
                    console.log('Reset all products to not available online');
                }
            });

            // Step 3: Enable online availability for specific brand categories
            const placeholders = ONLINE_BRANDS.map(() => '?').join(', ');
            db.run(
                `UPDATE products SET available_online = 1 WHERE category IN (${placeholders})`,
                ONLINE_BRANDS,
                function(err) {
                    if (err) {
                        console.error('Error enabling online brands:', err.message);
                        reject(err);
                    } else {
                        console.log(`Enabled ${this.changes} products for online sale`);
                    }
                }
            );

            // Step 4: Also catch products with brand name in the product name
            db.run(
                `UPDATE products SET available_online = 1
                 WHERE name LIKE '%Kevin Murphy%'
                    OR name LIKE '%Moyoko%'
                    OR name LIKE '%Wella%'
                    OR name LIKE '%Kalahari%'
                    OR name LIKE '%Heliocare%'
                    OR name LIKE '%Mycro Keratin%'
                    OR name LIKE '%MK %'`,
                function(err) {
                    if (err) {
                        console.error('Error enabling products by name:', err.message);
                    } else {
                        console.log(`Updated ${this.changes} additional products by name match`);
                    }
                }
            );

            // Step 5: Show summary
            db.all(
                `SELECT category, COUNT(*) as total, SUM(available_online) as online
                 FROM products
                 GROUP BY category
                 ORDER BY category`,
                (err, rows) => {
                    if (err) {
                        console.error('Error getting summary:', err.message);
                    } else {
                        console.log('\n=== Product Online Availability Summary ===');
                        rows.forEach(row => {
                            const status = row.online > 0 ? '✓' : '✗';
                            console.log(`${status} ${row.category}: ${row.online}/${row.total} available online`);
                        });
                    }

                    db.close((err) => {
                        if (err) console.error('Error closing database:', err.message);
                        else console.log('\nMigration complete!');
                        resolve();
                    });
                }
            );
        });
    });
}

run().catch(console.error);
