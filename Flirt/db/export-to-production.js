const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const https = require('https');
const http = require('http');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://flirt-production-7578.up.railway.app';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
    console.error('Error: ADMIN_TOKEN environment variable is required');
    console.log('Usage: ADMIN_TOKEN=<jwt-token> node export-to-production.js');
    console.log('\nTo get a token, login as admin and check the localStorage or network requests');
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

async function exportAndUpload() {
    console.log('Reading local database:', DB_PATH);

    // Export services
    const services = await dbAll(`
        SELECT id, name, description, price, cost_price, duration, service_type,
               category, commission_rate, display_order, active
        FROM services
        WHERE active = 1
    `);
    console.log(`Found ${services.length} services`);

    // Export products
    const products = await dbAll(`
        SELECT id, name, description, price, cost_price, category, stock,
               commission_rate, is_service_product, supplier, active
        FROM products
        WHERE active = 1
    `);
    console.log(`Found ${products.length} products`);

    db.close();

    // Prepare payload
    const payload = JSON.stringify({
        services,
        products,
        clearExisting: true
    });

    console.log(`\nPayload size: ${(payload.length / 1024).toFixed(2)} KB`);
    console.log(`Uploading to: ${PRODUCTION_URL}/api/admin/bulk-import`);

    // Send to production
    const url = new URL(PRODUCTION_URL + '/api/admin/bulk-import');
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADMIN_TOKEN}`,
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const httpModule = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`\nResponse status: ${res.statusCode}`);
                try {
                    const result = JSON.parse(data);
                    console.log('Response:', JSON.stringify(result, null, 2));
                    resolve(result);
                } catch (e) {
                    console.log('Response body:', data);
                    resolve(data);
                }
            });
        });

        req.on('error', (error) => {
            console.error('Request error:', error.message);
            reject(error);
        });

        req.write(payload);
        req.end();
    });
}

exportAndUpload()
    .then(() => {
        console.log('\nExport complete!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\nExport failed:', err);
        process.exit(1);
    });
