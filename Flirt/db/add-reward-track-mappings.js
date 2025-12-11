/**
 * Migration: Add Service-to-Reward-Track Mappings
 *
 * This migration adds tables and data to allow admins to configure
 * which services trigger which reward tracks, replacing hardcoded keyword matching.
 *
 * Run with: node db/add-reward-track-mappings.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');
const db = new sqlite3.Database(DB_PATH);

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

async function migrate() {
    console.log('='.repeat(60));
    console.log('MIGRATION: Add Service-to-Reward-Track Mappings');
    console.log('='.repeat(60));
    console.log('Database:', DB_PATH);
    console.log('');

    try {
        // 1. Create reward_track_definitions table
        console.log('Creating reward_track_definitions table...');
        await dbRun(`
            CREATE TABLE IF NOT EXISTS reward_track_definitions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                description TEXT,
                track_type TEXT NOT NULL CHECK(track_type IN ('visit_count', 'spend_amount')),
                icon TEXT DEFAULT '🎁',
                milestones TEXT NOT NULL DEFAULT '[]',
                reward_expiry_days INTEGER DEFAULT 90,
                reward_applicable_to TEXT,
                active INTEGER DEFAULT 1,
                display_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        console.log('  ✓ reward_track_definitions created');

        await dbRun(`CREATE INDEX IF NOT EXISTS idx_reward_track_defs_active ON reward_track_definitions(active)`);

        // 2. Create service_reward_mappings table
        console.log('Creating service_reward_mappings table...');
        await dbRun(`
            CREATE TABLE IF NOT EXISTS service_reward_mappings (
                id TEXT PRIMARY KEY,
                service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL REFERENCES reward_track_definitions(id) ON DELETE CASCADE,
                points_multiplier REAL DEFAULT 1.0,
                require_payment INTEGER DEFAULT 1,
                active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(service_id, track_id)
            )
        `);
        console.log('  ✓ service_reward_mappings created');

        await dbRun(`CREATE INDEX IF NOT EXISTS idx_service_reward_map_service ON service_reward_mappings(service_id)`);
        await dbRun(`CREATE INDEX IF NOT EXISTS idx_service_reward_map_track ON service_reward_mappings(track_id)`);

        // 3. Create category_reward_mappings table
        console.log('Creating category_reward_mappings table...');
        await dbRun(`
            CREATE TABLE IF NOT EXISTS category_reward_mappings (
                id TEXT PRIMARY KEY,
                category_name TEXT NOT NULL,
                track_id TEXT NOT NULL REFERENCES reward_track_definitions(id) ON DELETE CASCADE,
                active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(category_name, track_id)
            )
        `);
        console.log('  ✓ category_reward_mappings created');

        await dbRun(`CREATE INDEX IF NOT EXISTS idx_category_reward_map_category ON category_reward_mappings(category_name)`);

        // 4. Seed default track definitions
        console.log('\nSeeding default track definitions...');

        // Nails track
        await dbRun(`
            INSERT OR IGNORE INTO reward_track_definitions (id, name, display_name, description, track_type, icon, milestones, reward_expiry_days, reward_applicable_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'track_nails',
            'nails',
            'Nails Rewards',
            'Earn discounts on nail services by visiting regularly',
            'visit_count',
            '💅',
            JSON.stringify([
                { count: 6, reward_type: 'percentage_discount', reward_value: 10, description: '10% off your next nail service' },
                { count: 12, reward_type: 'percentage_discount', reward_value: 50, description: '50% off your next nail service' }
            ]),
            90,
            'same_category'
        ]);
        console.log('  ✓ Nails track created');

        // Maintenance track
        await dbRun(`
            INSERT OR IGNORE INTO reward_track_definitions (id, name, display_name, description, track_type, icon, milestones, reward_expiry_days, reward_applicable_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'track_maintenance',
            'maintenance',
            'Extensions Maintenance',
            'Earn rewards for regular hair extension maintenance',
            'visit_count',
            '✨',
            JSON.stringify([
                { count: 6, reward_type: 'percentage_discount', reward_value: 10, description: '10% off your next maintenance service', repeating: true }
            ]),
            90,
            'same_category'
        ]);
        console.log('  ✓ Maintenance track created');

        // Spend track
        await dbRun(`
            INSERT OR IGNORE INTO reward_track_definitions (id, name, display_name, description, track_type, icon, milestones, reward_expiry_days, reward_applicable_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'track_spend',
            'spend',
            'Spend & Save',
            'Earn rewards based on total spend across all services',
            'spend_amount',
            '💰',
            JSON.stringify([
                { amount: 10000, reward_type: 'percentage_discount', reward_value: 20, description: '20% off any service', repeating: true }
            ]),
            90,
            null
        ]);
        console.log('  ✓ Spend track created');

        // 5. Seed category mappings based on existing categories
        console.log('\nSeeding category mappings...');

        // Get unique categories from services
        const categories = await dbAll(`SELECT DISTINCT category FROM services WHERE active = 1 AND category IS NOT NULL`);

        let nailsMapped = 0;
        let maintenanceMapped = 0;

        for (const cat of categories) {
            const catLower = cat.category.toLowerCase();
            const catId = catLower.replace(/[^a-z0-9]/g, '_');

            // Nails keywords
            if (['nail', 'nails', 'manicure', 'pedicure', 'gel', 'acrylic'].some(kw => catLower.includes(kw))) {
                try {
                    await dbRun(`
                        INSERT OR IGNORE INTO category_reward_mappings (id, category_name, track_id)
                        VALUES (?, ?, ?)
                    `, [`catmap_${catId}_nails`, cat.category, 'track_nails']);
                    nailsMapped++;
                } catch (e) { /* ignore duplicates */ }
            }

            // Maintenance keywords
            if (['maintenance', 'extension', 'weave', 'tape', 'keratin', 'weft'].some(kw => catLower.includes(kw))) {
                try {
                    await dbRun(`
                        INSERT OR IGNORE INTO category_reward_mappings (id, category_name, track_id)
                        VALUES (?, ?, ?)
                    `, [`catmap_${catId}_maintenance`, cat.category, 'track_maintenance']);
                    maintenanceMapped++;
                } catch (e) { /* ignore duplicates */ }
            }
        }

        console.log(`  ✓ Nails category mappings: ${nailsMapped}`);
        console.log(`  ✓ Maintenance category mappings: ${maintenanceMapped}`);

        // Verify
        console.log('\n' + '-'.repeat(40));
        console.log('VERIFICATION');
        console.log('-'.repeat(40));

        const tracks = await dbAll('SELECT id, name, display_name FROM reward_track_definitions');
        console.log(`Track definitions: ${tracks.length}`);
        tracks.forEach(t => console.log(`  - ${t.name}: ${t.display_name}`));

        const catMaps = await dbAll('SELECT category_name, track_id FROM category_reward_mappings');
        console.log(`\nCategory mappings: ${catMaps.length}`);
        catMaps.forEach(m => console.log(`  - "${m.category_name}" → ${m.track_id.replace('track_', '')}`));

        console.log('\n' + '='.repeat(60));
        console.log('MIGRATION COMPLETE');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

migrate();
