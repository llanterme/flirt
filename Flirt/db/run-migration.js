/**
 * Run Database Migrations
 *
 * This script runs SQL migration files from the migrations/ directory.
 * Migrations are tracked in a migrations table to prevent re-running.
 *
 * Run: node db/run-migration.js [migration-name]
 *
 * Examples:
 *   node db/run-migration.js                    # Run all pending migrations
 *   node db/run-migration.js 001-add-client-import-fields  # Run specific migration
 */

const fs = require('fs');
const path = require('path');
const { dbRun, dbGet, dbAll, initializeDatabase, closeDb, getDb } = require('./database');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            executed_at TEXT DEFAULT (datetime('now'))
        )
    `);
}

async function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
        return [];
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

    return files;
}

async function isMigrationExecuted(name) {
    const row = await dbGet('SELECT * FROM migrations WHERE name = ?', [name]);
    return !!row;
}

async function markMigrationExecuted(name) {
    await dbRun('INSERT INTO migrations (name) VALUES (?)', [name]);
}

async function runMigration(filename) {
    const name = filename.replace('.sql', '');
    const filepath = path.join(MIGRATIONS_DIR, filename);

    console.log(`Running migration: ${name}`);

    const sql = fs.readFileSync(filepath, 'utf8');

    // Split into individual statements (simple split by semicolon)
    const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
        try {
            await dbRun(statement);
        } catch (error) {
            // Ignore "duplicate column" errors for ALTER TABLE
            if (error.message.includes('duplicate column name')) {
                console.log(`  [SKIP] Column already exists: ${error.message}`);
                continue;
            }
            throw error;
        }
    }

    await markMigrationExecuted(name);
    console.log(`  [DONE] ${name}`);
}

async function runAllMigrations(specificMigration = null) {
    console.log('='.repeat(60));
    console.log('DATABASE MIGRATIONS');
    console.log('='.repeat(60));

    try {
        await initializeDatabase();
        await ensureMigrationsTable();

        const files = await getMigrationFiles();

        if (files.length === 0) {
            console.log('No migration files found in migrations/ directory.');
            return;
        }

        console.log(`Found ${files.length} migration file(s)`);
        console.log('');

        let executed = 0;
        let skipped = 0;

        for (const file of files) {
            const name = file.replace('.sql', '');

            // If specific migration requested, skip others
            if (specificMigration && name !== specificMigration) {
                continue;
            }

            if (await isMigrationExecuted(name)) {
                console.log(`[SKIP] Already executed: ${name}`);
                skipped++;
                continue;
            }

            await runMigration(file);
            executed++;
        }

        console.log('');
        console.log('='.repeat(60));
        console.log('MIGRATION COMPLETE');
        console.log(`  Executed: ${executed}`);
        console.log(`  Skipped:  ${skipped}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    } finally {
        closeDb();
    }
}

// CLI
const args = process.argv.slice(2);
const specificMigration = args[0];

runAllMigrations(specificMigration)
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
