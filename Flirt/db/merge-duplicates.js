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
            // Ignore "no such table" errors for optional tables
            if (err && err.message.includes('no such table')) {
                resolve({ lastID: null, changes: 0 });
            } else if (err) {
                reject(err);
            } else {
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function findDuplicates() {
    console.log('Finding duplicate customers by name...\n');

    // Find all customers grouped by lowercase name
    const duplicates = await dbAll(`
        SELECT LOWER(name) as name_lower, COUNT(*) as count
        FROM users
        WHERE role = 'customer'
        GROUP BY LOWER(name)
        HAVING COUNT(*) > 1
        ORDER BY count DESC
    `);

    console.log(`Found ${duplicates.length} names with duplicates\n`);
    return duplicates;
}

async function mergeDuplicates(dryRun = false) {
    const duplicateNames = await findDuplicates();

    let totalMerged = 0;
    let totalDeleted = 0;

    for (const dup of duplicateNames) {
        // Get all records with this name
        const records = await dbAll(`
            SELECT id, email, name, phone, points, tier, referral_code, created_at
            FROM users
            WHERE LOWER(name) = ? AND role = 'customer'
            ORDER BY
                CASE WHEN email NOT LIKE '%@flirt.placeholder' THEN 0 ELSE 1 END,
                points DESC,
                created_at ASC
        `, [dup.name_lower]);

        if (records.length < 2) continue;

        // Keep the first record (best email, most points)
        const keeper = records[0];
        const toDelete = records.slice(1);

        // Merge points and upgrade tier if needed
        let totalPoints = records.reduce((sum, r) => sum + (r.points || 0), 0);

        // Determine best tier
        const tierRank = { platinum: 4, gold: 3, silver: 2, bronze: 1 };
        let bestTier = records.reduce((best, r) => {
            return (tierRank[r.tier] || 0) > (tierRank[best] || 0) ? r.tier : best;
        }, 'bronze');

        // Get best phone (non-null)
        let bestPhone = records.find(r => r.phone && !r.phone.includes('placeholder'))?.phone || keeper.phone;

        // Get best email (non-placeholder)
        let bestEmail = records.find(r => r.email && !r.email.includes('@flirt.placeholder'))?.email || keeper.email;

        console.log(`\n${'='.repeat(60)}`);
        console.log(`Merging: ${keeper.name} (${records.length} records)`);
        console.log(`  Keeper: ${keeper.email}`);
        console.log(`  Deleting: ${toDelete.map(r => r.email).join(', ')}`);
        console.log(`  Combined points: ${totalPoints}, Tier: ${bestTier}`);

        if (!dryRun) {
            // Update the keeper with merged data
            await dbRun(`
                UPDATE users SET
                    email = ?,
                    phone = ?,
                    points = ?,
                    tier = ?
                WHERE id = ?
            `, [bestEmail, bestPhone, totalPoints, bestTier, keeper.id]);

            // Delete the duplicates
            for (const record of toDelete) {
                // First, update any bookings to point to the keeper
                await dbRun(`UPDATE bookings SET user_id = ? WHERE user_id = ?`, [keeper.id, record.id]);
                // Update orders
                await dbRun(`UPDATE orders SET user_id = ? WHERE user_id = ?`, [keeper.id, record.id]);
                // Update loyalty_points
                await dbRun(`UPDATE loyalty_points SET user_id = ? WHERE user_id = ?`, [keeper.id, record.id]);
                // Update referrals (both referrer and referee)
                await dbRun(`UPDATE referrals SET referrer_id = ? WHERE referrer_id = ?`, [keeper.id, record.id]);
                await dbRun(`UPDATE referrals SET referee_id = ? WHERE referee_id = ?`, [keeper.id, record.id]);
                // Update chat conversations
                await dbRun(`UPDATE chat_conversations SET user_id = ? WHERE user_id = ?`, [keeper.id, record.id]);

                // Now delete the duplicate
                await dbRun(`DELETE FROM users WHERE id = ?`, [record.id]);
                totalDeleted++;
            }
        }

        totalMerged++;
    }

    return { merged: totalMerged, deleted: totalDeleted };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    console.log('Database:', DB_PATH);
    console.log('Mode:', dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify database)');
    console.log('');

    // Get initial count
    const beforeCount = await dbGet(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`);
    console.log(`Customers before: ${beforeCount.count}`);

    const results = await mergeDuplicates(dryRun);

    // Get final count
    const afterCount = await dbGet(`SELECT COUNT(*) as count FROM users WHERE role = 'customer'`);

    console.log('\n' + '='.repeat(60));
    console.log('MERGE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Names merged: ${results.merged}`);
    console.log(`Records deleted: ${results.deleted}`);
    console.log(`Customers before: ${beforeCount.count}`);
    console.log(`Customers after: ${afterCount.count}`);
    console.log('='.repeat(60));

    db.close();
}

main().catch(err => {
    console.error('Error:', err);
    db.close();
    process.exit(1);
});
