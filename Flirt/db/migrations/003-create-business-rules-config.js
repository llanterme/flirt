const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../flirt.db');
const SQL_PATH = path.join(__dirname, '003-create-business-rules-config.sql');

async function migrate() {
    console.log('📋 Creating business rules configuration tables...');

    const db = new sqlite3.Database(DB_PATH);
    const sql = fs.readFileSync(SQL_PATH, 'utf8');

    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) {
                console.error('❌ Migration failed:', err.message);
                reject(err);
            } else {
                console.log('✅ Business rules configuration tables created');
                console.log('✅ Default settings inserted');
                console.log('✅ Default payment methods configured');
                console.log('✅ Default discount presets created');
                resolve();
            }
            db.close();
        });
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
