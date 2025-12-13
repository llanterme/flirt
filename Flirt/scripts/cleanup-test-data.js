#!/usr/bin/env node
/**
 * Cleanup script to remove all orders, invoices, and related data
 * Run this on the server: node scripts/cleanup-test-data.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'flirt.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Failed to connect to database:', err.message);
        process.exit(1);
    }
    console.log('Connected to database\n');
});

const queries = [
    { sql: 'DELETE FROM invoice_payments', name: 'Invoice Payments' },
    { sql: 'DELETE FROM invoice_commissions', name: 'Invoice Commissions' },
    { sql: 'DELETE FROM invoice_services', name: 'Invoice Services' },
    { sql: 'DELETE FROM invoice_products', name: 'Invoice Products' },
    { sql: 'DELETE FROM invoices', name: 'Invoices' },
    { sql: 'DELETE FROM order_items', name: 'Order Items' },
    { sql: 'DELETE FROM orders', name: 'Orders' },
    { sql: 'DELETE FROM payroll_records', name: 'Payroll Records' },
    { sql: 'UPDATE invoice_settings SET next_invoice_number = 1 WHERE id = 1', name: 'Reset Invoice Counter' }
];

db.serialize(() => {
    queries.forEach(({ sql, name }) => {
        db.run(sql, function(err) {
            if (err) {
                console.log(`❌ ${name}: ERROR - ${err.message}`);
            } else {
                console.log(`✅ ${name}: ${this.changes} rows affected`);
            }
        });
    });
});

db.close((err) => {
    if (err) {
        console.error('\nError closing database:', err.message);
    } else {
        console.log('\n✅ Cleanup complete! Database ready for fresh testing.');
    }
});
