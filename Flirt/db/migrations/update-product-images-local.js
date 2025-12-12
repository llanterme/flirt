/**
 * Migration: Update product images to use local paths
 * Converts flirthair.co.za URLs to /images/products/ local paths
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Support both local and Railway database paths
function getDatabasePath() {
    if (process.env.DATABASE_PATH) {
        return process.env.DATABASE_PATH;
    }
    if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
        return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'flirt.db');
    }
    if (fs.existsSync('/app/data')) {
        return '/app/data/flirt.db';
    }
    return path.join(__dirname, '..', 'flirt.db');
}

const DB_PATH = getDatabasePath();
console.log('Using database:', DB_PATH);

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Failed to connect to database:', err.message);
        process.exit(1);
    }
    console.log('Connected to database');
});

// Map flirthair.co.za URLs to local paths
// These are the files copied to /images/products/
function convertUrl(oldUrl) {
    if (!oldUrl) return null;

    // Extract filename from URL
    // e.g., https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU387_DOO.OVER_250ml-02-300x300.png
    // -> /images/products/KMU387_DOO.OVER_250ml-02-300x300.png

    const match = oldUrl.match(/\/([^\/]+\.(?:png|jpg|jpeg|gif|webp))$/i);
    if (match) {
        return `/images/products/${match[1]}`;
    }
    return oldUrl;
}

async function updateImages() {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, name, image_url FROM products', [], async (err, products) => {
            if (err) {
                reject(err);
                return;
            }

            console.log(`Found ${products.length} products`);
            let updated = 0;
            let skipped = 0;

            for (const product of products) {
                const oldUrl = product.image_url;

                // Skip if already local or null
                if (!oldUrl || oldUrl.startsWith('/images/')) {
                    skipped++;
                    continue;
                }

                // Only convert flirthair.co.za URLs
                if (!oldUrl.includes('flirthair.co.za')) {
                    skipped++;
                    continue;
                }

                const newUrl = convertUrl(oldUrl);

                await new Promise((res, rej) => {
                    db.run('UPDATE products SET image_url = ? WHERE id = ?', [newUrl, product.id], function(err) {
                        if (err) {
                            console.error(`Error updating ${product.name}:`, err.message);
                            rej(err);
                        } else {
                            if (this.changes > 0) {
                                console.log(`Updated: ${product.name}`);
                                console.log(`  Old: ${oldUrl}`);
                                console.log(`  New: ${newUrl}`);
                                updated++;
                            }
                            res();
                        }
                    });
                });
            }

            console.log(`\nMigration complete:`);
            console.log(`  Updated: ${updated}`);
            console.log(`  Skipped: ${skipped}`);

            // Checkpoint WAL
            db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
                if (err) console.error('WAL checkpoint error:', err);
                else console.log('WAL checkpoint complete');
                db.close();
                resolve();
            });
        });
    });
}

updateImages().catch(console.error);
