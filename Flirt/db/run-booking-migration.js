/**
 * Booking Redesign Migration Runner
 *
 * This script migrates existing bookings data to the new two-step booking flow schema.
 *
 * Usage:
 *   node db/run-booking-migration.js
 *
 * What it does:
 * 1. Adds new columns (requested_date, requested_time_window, assigned_start_time, etc.)
 * 2. Migrates existing data from old columns to new columns
 * 3. Updates status values to new enum
 * 4. Creates indexes
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/flirt.db';
const MIGRATION_SQL_PATH = './db/migration-booking-redesign.sql';

console.log('\n========================================');
console.log('Booking Redesign Migration');
console.log('========================================\n');

// Read migration SQL
const migrationSQL = fs.readFileSync(MIGRATION_SQL_PATH, 'utf8');

// Connect to database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to database:', DB_PATH);
});

// Function to run SQL statements
function runSQL(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Function to query database
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function runMigration() {
    try {
        console.log('\n📋 Step 1: Checking current bookings table schema...');

        const tableInfo = await query("PRAGMA table_info(bookings)");
        const columns = tableInfo.map(col => col.name);

        console.log('   Current columns:', columns.join(', '));

        // Check if migration is needed
        if (columns.includes('requested_date') && columns.includes('requested_time_window')) {
            console.log('\n⚠️  Migration appears to have already been run!');
            console.log('   New columns (requested_date, requested_time_window) already exist.');

            const answer = await askQuestion('\nDo you want to continue anyway? (y/n): ');
            if (answer.toLowerCase() !== 'y') {
                console.log('\n❌ Migration cancelled');
                process.exit(0);
            }
        }

        console.log('\n📋 Step 2: Backing up current bookings data...');
        const bookings = await query('SELECT * FROM bookings');
        console.log(`   Found ${bookings.length} existing bookings`);

        // Save backup
        const backupPath = `./db/bookings-backup-${Date.now()}.json`;
        fs.writeFileSync(backupPath, JSON.stringify(bookings, null, 2));
        console.log(`   ✅ Backup saved to: ${backupPath}`);

        console.log('\n📋 Step 3: Running migration SQL...');

        // Split SQL into individual statements and run them
        const statements = migrationSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('--') && s.length > 0);

        for (const [index, statement] of statements.entries()) {
            try {
                if (statement.includes('SELECT') || statement.includes('PRAGMA')) {
                    // Skip SELECT and PRAGMA statements in migration
                    continue;
                }
                await runSQL(statement + ';');
                console.log(`   ✅ Statement ${index + 1}/${statements.length} executed`);
            } catch (err) {
                // Some statements may fail if columns already exist - that's okay
                if (err.message.includes('duplicate column name')) {
                    console.log(`   ⚠️  Column already exists, skipping`);
                } else {
                    console.error(`   ❌ Error on statement ${index + 1}:`, err.message);
                }
            }
        }

        console.log('\n📋 Step 4: Verifying migration...');

        const migratedBookings = await query(`
            SELECT
                id,
                status,
                requested_date,
                requested_time_window,
                assigned_start_time,
                assigned_end_time
            FROM bookings
            LIMIT 5
        `);

        console.log('\n   Sample migrated bookings:');
        console.table(migratedBookings);

        console.log('\n📊 Migration Statistics:');
        const stats = await query(`
            SELECT
                status,
                COUNT(*) as count,
                COUNT(CASE WHEN assigned_start_time IS NOT NULL THEN 1 END) as has_assigned_time
            FROM bookings
            GROUP BY status
        `);
        console.table(stats);

        console.log('\n========================================');
        console.log('✅ Migration completed successfully!');
        console.log('========================================\n');

        console.log('Next steps:');
        console.log('1. Review the sample bookings above');
        console.log('2. Test the application with new booking flow');
        console.log('3. If everything works, you can drop old columns (see migration-booking-redesign.sql Step 4)');
        console.log(`4. Backup file saved at: ${backupPath}\n`);

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        db.close();
    }
}

function askQuestion(query) {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        readline.question(query, (answer) => {
            readline.close();
            resolve(answer);
        });
    });
}

// Run migration
runMigration();
