const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');
const db = new sqlite3.Database(DB_PATH);

// Categories that should be 'hair' type
const hairCategories = [
    'General',
    'Colour',
    'Treatment',
    'Extensions Service',
    'Bridal',
    'Male Grooming',
    'Wella Professional',
    'MK Retail',
    'Professional Basin',
    'TRAINING',
    'Session Redemptions'
];

// Categories that should stay as 'beauty' type
const beautyCategories = [
    'Make Up',
    'Facials',
    'Nails',
    'nails',
    'Brows and Lashes',
    'Spraytan',
    'Pedicure',
    'Waxing',
    'Lash Extensions'
];

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

(async () => {
    console.log('Fixing service types based on category...\n');
    console.log('Database:', DB_PATH);

    // Update hair categories to service_type = 'hair'
    console.log('\n📋 Updating hair-related services...');
    for (const category of hairCategories) {
        const result = await dbRun(
            `UPDATE services SET service_type = 'hair' WHERE category = ? AND service_type = 'beauty'`,
            [category]
        );
        if (result.changes > 0) {
            console.log(`  ✅ Updated ${result.changes} services in category: ${category}`);
        }
    }

    // Verify beauty categories stay as beauty (just for logging)
    console.log('\n📋 Verifying beauty services...');
    for (const category of beautyCategories) {
        const rows = await dbAll(
            `SELECT COUNT(*) as count FROM services WHERE category = ? AND service_type = 'beauty'`,
            [category]
        );
        if (rows[0].count > 0) {
            console.log(`  ✅ ${rows[0].count} services in category: ${category} (beauty)`);
        }
    }

    // Get final counts
    const hairCount = await dbAll(`SELECT COUNT(*) as count FROM services WHERE service_type = 'hair'`);
    const beautyCount = await dbAll(`SELECT COUNT(*) as count FROM services WHERE service_type = 'beauty'`);

    console.log('\n📊 Final counts:');
    console.log(`  Hair services: ${hairCount[0].count}`);
    console.log(`  Beauty services: ${beautyCount[0].count}`);

    console.log('\n✅ Done!');
    db.close();
})();
