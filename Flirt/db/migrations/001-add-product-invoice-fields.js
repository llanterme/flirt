const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../flirt.db');

async function migrate() {
    console.log('📋 Adding invoice-related fields to products table...');

    const db = new sqlite3.Database(DB_PATH);

    const alterations = [
        { sql: 'ALTER TABLE products ADD COLUMN commission_rate REAL DEFAULT 0.10', desc: 'commission_rate' },
        { sql: 'ALTER TABLE products ADD COLUMN is_service_product INTEGER DEFAULT 0', desc: 'is_service_product' },
        { sql: 'ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0', desc: 'cost_price' },
        { sql: 'ALTER TABLE products ADD COLUMN sku TEXT', desc: 'sku' },
        { sql: 'ALTER TABLE products ADD COLUMN supplier TEXT', desc: 'supplier' },
        { sql: 'ALTER TABLE services ADD COLUMN commission_rate REAL DEFAULT 0.30', desc: 'services.commission_rate' },
        { sql: 'ALTER TABLE services ADD COLUMN cost_price REAL DEFAULT 0', desc: 'services.cost_price' }
    ];

    return new Promise((resolve, reject) => {
        let completed = 0;
        let errors = [];

        alterations.forEach(({ sql, desc }) => {
            db.run(sql, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error(`⚠️  Error adding ${desc}:`, err.message);
                    errors.push({ desc, error: err.message });
                } else if (!err) {
                    console.log(`✅ Added column: ${desc}`);
                }

                completed++;

                if (completed === alterations.length) {
                    if (errors.length > 0 && errors.length === alterations.length) {
                        reject(new Error('All alterations failed'));
                    } else {
                        console.log('\n✅ Products table migration complete');
                        resolve();
                    }
                }
            });
        });
    }).finally(() => {
        db.close();
    });
}

if (require.main === module) {
    migrate()
        .then(() => {
            console.log('\n✅ Migration complete!');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migrate };
