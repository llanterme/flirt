const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const https = require('https');
const http = require('http');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://flirt-production-7578.up.railway.app';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
    console.error('Error: ADMIN_TOKEN environment variable is required');
    process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function makeRequest(endpoint, method, body) {
    const url = new URL(PRODUCTION_URL + endpoint);
    const payload = body ? JSON.stringify(body) : null;

    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADMIN_TOKEN}`,
        }
    };

    if (payload) {
        options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const httpModule = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function syncMergedCustomers() {
    console.log('Reading local database:', DB_PATH);

    // Get all customer IDs from local database (these are the ones to keep)
    const localCustomers = await dbAll(`
        SELECT id FROM users WHERE role = 'customer'
    `);
    const localIds = new Set(localCustomers.map(c => c.id));
    console.log(`Local customers: ${localIds.size}`);

    // Get all customer IDs from production
    console.log('\nFetching production customers...');
    const prodResponse = await makeRequest('/api/admin/customers', 'GET');

    if (prodResponse.status !== 200) {
        console.error('Failed to fetch production customers:', prodResponse);
        process.exit(1);
    }

    const prodCustomers = prodResponse.data.customers || [];
    console.log(`Production customers: ${prodCustomers.length}`);

    // Find customers in production that are NOT in local (these are duplicates that were deleted)
    const toDelete = prodCustomers.filter(c => !localIds.has(c.id));
    console.log(`Customers to delete from production: ${toDelete.length}`);

    if (toDelete.length === 0) {
        console.log('No duplicates to delete from production.');
        db.close();
        return;
    }

    console.log('\nDeleting duplicates from production using bulk delete...');
    const idsToDelete = toDelete.map(c => c.id);
    const deleteResponse = await makeRequest('/api/admin/customers/bulk-delete', 'POST', { ids: idsToDelete });
    if (deleteResponse.status === 200) {
        console.log(`  Deleted: ${deleteResponse.data.deleted}, Skipped: ${deleteResponse.data.skipped}`);
    } else {
        console.log(`  Warning: Bulk delete failed: ${JSON.stringify(deleteResponse.data)}`);
    }

    // Also update the merged customers with their new points/tier
    const mergedCustomers = await dbAll(`
        SELECT id, email, name, phone, points, tier
        FROM users
        WHERE role = 'customer'
    `);

    console.log('\nUpdating merged customers on production...');
    let updated = 0;
    for (const customer of mergedCustomers) {
        // Find matching production customer
        const prodCustomer = prodCustomers.find(p => p.id === customer.id);
        if (prodCustomer && (prodCustomer.points !== customer.points || prodCustomer.tier !== customer.tier)) {
            const updateResponse = await makeRequest(`/api/admin/users/${customer.id}`, 'PUT', {
                points: customer.points,
                tier: customer.tier
            });
            if (updateResponse.status === 200) {
                updated++;
            }
        }
    }
    console.log(`Updated ${updated} customers with merged points/tier`);

    db.close();
    console.log('\nSync complete!');
}

syncMergedCustomers().catch(err => {
    console.error('Error:', err);
    db.close();
    process.exit(1);
});
