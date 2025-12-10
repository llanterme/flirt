/**
 * Migration: Normalize service categories
 *
 * Fixes case-sensitivity issues in service categories where the same
 * category was entered with different casings (e.g., "nails" vs "Nails").
 *
 * Run with: node db/normalize-service-categories.js
 * Dry run:  node db/normalize-service-categories.js --dry-run
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');
const db = new sqlite3.Database(DB_PATH);

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

// Define category normalizations: lowercase -> ProperCase
const CATEGORY_NORMALIZATIONS = {
    'nails': 'Nails',
    'consultation': 'Consultation',
    'extensions': 'Extensions',
    'maintenance': 'Maintenance',
    'training': 'Training',
};

async function findCategoryDuplicates() {
    console.log('Finding category case duplicates...\n');

    const categories = await dbAll(`
        SELECT category, COUNT(*) as count
        FROM services
        WHERE active = 1
        GROUP BY category
        ORDER BY category COLLATE NOCASE
    `);

    // Group by lowercase to find duplicates
    const grouped = {};
    for (const cat of categories) {
        const lower = (cat.category || '').toLowerCase();
        if (!grouped[lower]) grouped[lower] = [];
        grouped[lower].push({ name: cat.category, count: cat.count });
    }

    // Filter to only those with case variations
    const duplicates = Object.entries(grouped)
        .filter(([_, variants]) => variants.length > 1)
        .map(([lower, variants]) => ({ lower, variants }));

    return { categories, duplicates };
}

async function normalizeCategories(dryRun = false) {
    const { categories, duplicates } = await findCategoryDuplicates();

    console.log('Current categories:');
    categories.forEach(c => console.log(`  ${c.category}: ${c.count} services`));

    if (duplicates.length > 0) {
        console.log('\nFound case duplicates:');
        duplicates.forEach(d => {
            console.log(`  "${d.lower}": ${d.variants.map(v => `"${v.name}" (${v.count})`).join(', ')}`);
        });
    }

    let totalUpdated = 0;

    // Apply normalizations
    console.log('\nApplying normalizations...');
    for (const [from, to] of Object.entries(CATEGORY_NORMALIZATIONS)) {
        // Check if there are any services with this lowercase category
        const existing = await dbAll(
            `SELECT COUNT(*) as count FROM services WHERE category = ?`,
            [from]
        );

        if (existing[0].count > 0) {
            console.log(`  "${from}" -> "${to}" (${existing[0].count} services)`);

            if (!dryRun) {
                const result = await dbRun(
                    `UPDATE services SET category = ? WHERE category = ?`,
                    [to, from]
                );
                totalUpdated += result.changes;
            }
        }
    }

    return totalUpdated;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    console.log('='.repeat(60));
    console.log('SERVICE CATEGORY NORMALIZATION');
    console.log('='.repeat(60));
    console.log('Database:', DB_PATH);
    console.log('Mode:', dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify database)');
    console.log('');

    const updated = await normalizeCategories(dryRun);

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Services updated: ${dryRun ? '(dry run)' : updated}`);
    console.log('='.repeat(60));

    db.close();
}

main().catch(err => {
    console.error('Error:', err);
    db.close();
    process.exit(1);
});
