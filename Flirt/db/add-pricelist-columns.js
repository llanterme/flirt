const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');
const db = new sqlite3.Database(DB_PATH);

// Add missing columns to services table
const serviceColumns = [
    'ALTER TABLE services ADD COLUMN cost_price REAL',
    'ALTER TABLE services ADD COLUMN supplier TEXT'
];

// Add missing columns to products table
const productColumns = [
    'ALTER TABLE products ADD COLUMN cost_price REAL',
    'ALTER TABLE products ADD COLUMN supplier TEXT',
    'ALTER TABLE products ADD COLUMN commission_rate REAL',
    'ALTER TABLE products ADD COLUMN is_service_product INTEGER DEFAULT 0'
];

function run(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.log('Warning:', err.message);
            } else if (!err) {
                console.log('Added column:', sql.split('ADD COLUMN ')[1]);
            } else {
                console.log('Column already exists:', sql.split('ADD COLUMN ')[1]);
            }
            resolve();
        });
    });
}

(async () => {
    console.log('Adding missing columns for pricelist import...\n');
    console.log('Database:', DB_PATH);

    console.log('\nServices table:');
    for (const sql of serviceColumns) {
        await run(sql);
    }

    console.log('\nProducts table:');
    for (const sql of productColumns) {
        await run(sql);
    }

    console.log('\nDone!');
    db.close();
})();
