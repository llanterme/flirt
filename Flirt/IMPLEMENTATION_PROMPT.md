# Implementation Prompt: Invoice System with Product Price List Import

---

## Context

You are working on **Flirt Hair & Beauty**, a comprehensive salon booking and e-commerce PWA built with Node.js, Express, and SQLite. The system currently handles bookings with upfront payment, but the business requires a post-treatment invoicing system because final service prices cannot be determined until after treatment completion.

### Current System State
- **Database:** SQLite3 at `./db/flirt.db`
- **Backend:** `server.js` (7,765 lines) - Express server with repository pattern
- **Database Layer:** `./db/database.js` (108KB) - All repositories
- **Schema:** `./db/schema.sql` - Current database schema
- **Existing Tables:** users, bookings, services, products, stylists, orders, loyalty_points, etc.
- **Current Products:** 50 products (45 Kevin Murphy, 5 Moyoko) with outdated prices

### Design Documents Available
1. `INVOICING_SYSTEM_DESIGN.md` - Complete system architecture (60+ pages)
2. `INVOICING_PRODUCT_CATALOG_INTEGRATION.md` - Product integration details

---

## Your Task

Implement the complete invoicing system as specified in the design documents, including:

1. ✅ **Database Schema Migration** - Create 5 new tables for invoicing
2. ✅ **Product Price List Import** - Import updated Kevin Murphy prices from provided file
3. ✅ **Backend Repositories** - Implement invoice data access layer
4. ✅ **API Endpoints** - Create 15+ invoice management endpoints
5. ✅ **Business Logic** - Commission calculations, payment tracking
6. ✅ **Admin UI** - Invoice management interface in admin console

---

## Step-by-Step Implementation Instructions

### Phase 1: Database Schema Migration

#### Step 1.1: Enhance Products Table

First, add new columns to the existing `products` table to support invoicing:

```sql
-- Add to products table
ALTER TABLE products ADD COLUMN commission_rate REAL DEFAULT 0.10;
ALTER TABLE products ADD COLUMN is_service_product INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN supplier TEXT;
```

**Create migration file:** `./db/migrations/001-add-product-invoice-fields.js`

```javascript
// Migration to add invoice-related fields to products table
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../flirt.db');

async function migrate() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Add new columns
            const alterations = [
                'ALTER TABLE products ADD COLUMN commission_rate REAL DEFAULT 0.10',
                'ALTER TABLE products ADD COLUMN is_service_product INTEGER DEFAULT 0',
                'ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0',
                'ALTER TABLE products ADD COLUMN sku TEXT',
                'ALTER TABLE products ADD COLUMN supplier TEXT'
            ];

            alterations.forEach(sql => {
                db.run(sql, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error('Migration error:', err.message);
                    }
                });
            });

            // Set default commission rates by category
            db.run(`
                UPDATE products
                SET commission_rate = 0.10,
                    supplier = 'Kevin Murphy'
                WHERE category = 'Kevin Murphy'
            `, (err) => {
                if (err) reject(err);
                else {
                    console.log('✅ Products table migration complete');
                    resolve();
                }
            });
        });

        db.close();
    });
}

migrate().catch(console.error);
```

#### Step 1.2: Create Invoice Tables

**Create migration file:** `./db/migrations/002-create-invoice-tables.sql`

```sql
-- ============================================
-- INVOICES TABLE (Main invoice header)
-- ============================================
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE,
    booking_id TEXT REFERENCES bookings(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    stylist_id TEXT NOT NULL REFERENCES stylists(id),

    -- Financial totals
    services_subtotal REAL DEFAULT 0,
    products_subtotal REAL DEFAULT 0,
    subtotal REAL NOT NULL,

    -- Discounts & adjustments
    discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'loyalty_points', 'promo_code', 'manual')),
    discount_value REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_reason TEXT,

    -- Tax (SA VAT is 15%)
    tax_rate REAL DEFAULT 0.15,
    tax_amount REAL DEFAULT 0,

    -- Final total
    total REAL NOT NULL,

    -- Payment tracking
    payment_status TEXT DEFAULT 'unpaid' CHECK(
        payment_status IN ('unpaid', 'partial', 'paid', 'refunded', 'written_off')
    ),
    amount_paid REAL DEFAULT 0,
    amount_due REAL DEFAULT 0,

    -- Commission tracking
    commission_total REAL DEFAULT 0,
    commission_paid INTEGER DEFAULT 0,
    commission_paid_date TEXT,

    -- Status and workflow
    status TEXT DEFAULT 'draft' CHECK(
        status IN ('draft', 'finalized', 'sent', 'cancelled', 'void')
    ),

    -- Timestamps
    service_date TEXT NOT NULL,
    invoice_date TEXT DEFAULT (date('now')),
    due_date TEXT,
    finalized_at TEXT,

    -- Notes
    internal_notes TEXT,
    client_notes TEXT,

    -- Audit
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,

    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stylist ON invoices(stylist_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_service_date ON invoices(service_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);

-- ============================================
-- INVOICE_SERVICES TABLE (Service line items)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_services (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES services(id),

    -- Service details (snapshot at time of invoice)
    service_name TEXT NOT NULL,
    service_description TEXT,
    service_category TEXT,

    -- Pricing
    unit_price REAL NOT NULL,
    quantity REAL DEFAULT 1,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,

    -- Commission
    commission_rate REAL,
    commission_amount REAL,

    -- Duration tracking
    duration_minutes INTEGER,

    -- Notes
    notes TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_services_invoice ON invoice_services(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_services_service ON invoice_services(service_id);

-- ============================================
-- INVOICE_PRODUCTS TABLE (Product line items)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_products (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),

    -- Product details (snapshot at time of invoice)
    product_name TEXT NOT NULL,
    product_category TEXT,
    product_type TEXT CHECK(product_type IN ('service_product', 'retail')),

    -- Pricing
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,

    -- Commission
    commission_rate REAL,
    commission_amount REAL,

    -- Inventory tracking
    deducted_from_stock INTEGER DEFAULT 0,

    -- Notes
    notes TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_products_invoice ON invoice_products(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_products_product ON invoice_products(product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_products_type ON invoice_products(product_type);

-- ============================================
-- INVOICE_PAYMENTS TABLE (Payment transactions)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,

    -- Payment details
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(
        payment_method IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft', 'loyalty_points')
    ),
    payment_reference TEXT,
    payment_date TEXT DEFAULT (datetime('now')),

    -- Payment processor details
    processor_transaction_id TEXT,
    processor_status TEXT,
    processor_response TEXT,

    -- Notes
    notes TEXT,

    -- Audit
    processed_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
    FOREIGN KEY (processed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_date ON invoice_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_method ON invoice_payments(payment_method);

-- ============================================
-- INVOICE_COMMISSIONS TABLE (Commission tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_commissions (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    stylist_id TEXT NOT NULL REFERENCES stylists(id),

    -- Commission breakdown
    services_commission REAL DEFAULT 0,
    products_commission REAL DEFAULT 0,
    total_commission REAL NOT NULL,

    -- Payment tracking
    payment_status TEXT DEFAULT 'pending' CHECK(
        payment_status IN ('pending', 'approved', 'paid', 'cancelled')
    ),
    payment_date TEXT,
    payment_reference TEXT,

    -- Audit
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (stylist_id) REFERENCES stylists(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_commissions_invoice ON invoice_commissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_stylist ON invoice_commissions(stylist_id);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_status ON invoice_commissions(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_date ON invoice_commissions(payment_date);

-- ============================================
-- BOOKINGS TABLE UPDATES (Add invoice link)
-- ============================================
ALTER TABLE bookings ADD COLUMN invoice_id TEXT REFERENCES invoices(id);
ALTER TABLE bookings ADD COLUMN invoiced INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_invoice ON bookings(invoice_id);
CREATE INDEX IF NOT EXISTS idx_bookings_invoiced ON bookings(invoiced);
```

**Create migration runner:** `./db/migrations/002-create-invoice-tables.js`

```javascript
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../flirt.db');
const SQL_PATH = path.join(__dirname, '002-create-invoice-tables.sql');

async function migrate() {
    const db = new sqlite3.Database(DB_PATH);
    const sql = fs.readFileSync(SQL_PATH, 'utf8');

    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) {
                console.error('❌ Migration failed:', err.message);
                reject(err);
            } else {
                console.log('✅ Invoice tables created successfully');
                resolve();
            }
            db.close();
        });
    });
}

migrate().catch(console.error);
```

**Run migrations:**
```bash
node ./db/migrations/001-add-product-invoice-fields.js
node ./db/migrations/002-create-invoice-tables.js
```

---

### Phase 2: Import Product Price List

**CRITICAL:** User will provide a price list file. You need to:

1. Identify the file format (CSV, Excel, JSON)
2. Parse the price list
3. Update existing products or create new ones
4. Handle SKU/product matching logic

**Create import script:** `./db/import-product-pricelist.js`

```javascript
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');

/**
 * Import product price list from CSV file
 *
 * Expected CSV format:
 * sku,name,category,price,cost_price,stock,commission_rate,is_service_product
 *
 * OR minimal format:
 * name,price
 *
 * The script will intelligently detect format and map columns
 */

function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    const products = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const values = lines[i].split(',').map(v => v.trim());
        const product = {};

        headers.forEach((header, index) => {
            product[header] = values[index];
        });

        products.push(product);
    }

    return { headers, products };
}

function normalizeProduct(product, headers) {
    // Map various possible column names to standard fields
    const fieldMappings = {
        name: ['name', 'product_name', 'product', 'title'],
        price: ['price', 'retail_price', 'selling_price', 'rrp'],
        cost_price: ['cost', 'cost_price', 'wholesale_price', 'cost_ex_vat'],
        sku: ['sku', 'code', 'product_code', 'item_code'],
        category: ['category', 'brand', 'supplier', 'range'],
        stock: ['stock', 'qty', 'quantity', 'stock_qty'],
        commission_rate: ['commission', 'commission_rate', 'comm_rate'],
        is_service_product: ['type', 'product_type', 'is_service']
    };

    const normalized = {
        id: uuidv4(),
        name: '',
        category: 'Uncategorized',
        price: 0,
        cost_price: 0,
        stock: 0,
        commission_rate: 0.10, // Default 10%
        is_service_product: 0,
        active: 1,
        supplier: 'Kevin Murphy'
    };

    // Find and map each field
    for (let [standardField, possibleNames] of Object.entries(fieldMappings)) {
        for (let possibleName of possibleNames) {
            if (product[possibleName] !== undefined) {
                let value = product[possibleName];

                // Clean and parse value
                if (standardField === 'price' || standardField === 'cost_price') {
                    // Remove currency symbols and parse as float
                    value = parseFloat(value.toString().replace(/[R$,\s]/g, '')) || 0;
                } else if (standardField === 'stock') {
                    value = parseInt(value) || 0;
                } else if (standardField === 'commission_rate') {
                    value = parseFloat(value) || 0.10;
                    // If value > 1, assume it's percentage (e.g., 10 instead of 0.10)
                    if (value > 1) value = value / 100;
                } else if (standardField === 'is_service_product') {
                    value = (value.toLowerCase() === 'service' || value === '1') ? 1 : 0;
                }

                normalized[standardField] = value;
                break;
            }
        }
    }

    return normalized;
}

async function importProducts(filePath, options = {}) {
    const {
        updateExisting = true,  // Update existing products by name
        skipDuplicates = false, // Skip if product exists
        dryRun = false          // Preview without importing
    } = options;

    const db = new sqlite3.Database(DB_PATH);

    // Read and parse file
    const content = fs.readFileSync(filePath, 'utf8');
    const { headers, products } = parseCSV(content);

    console.log(`📄 Found ${products.length} products in file`);
    console.log(`📋 Detected columns: ${headers.join(', ')}`);

    const results = {
        total: products.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: []
    };

    for (let rawProduct of products) {
        try {
            const product = normalizeProduct(rawProduct, headers);

            if (!product.name) {
                console.warn('⚠️  Skipping product with no name:', rawProduct);
                results.skipped++;
                continue;
            }

            if (dryRun) {
                console.log('🔍 [DRY RUN]', product);
                continue;
            }

            // Check if product exists by name
            const existing = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT id, price FROM products WHERE name = ? COLLATE NOCASE',
                    [product.name],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (existing) {
                if (skipDuplicates) {
                    console.log(`⏭️  Skipping existing: ${product.name}`);
                    results.skipped++;
                } else if (updateExisting) {
                    // Update existing product
                    await new Promise((resolve, reject) => {
                        db.run(`
                            UPDATE products
                            SET price = ?,
                                cost_price = ?,
                                stock = ?,
                                commission_rate = ?,
                                is_service_product = ?,
                                supplier = ?,
                                sku = ?,
                                category = ?,
                                updated_at = datetime('now')
                            WHERE id = ?
                        `, [
                            product.price,
                            product.cost_price,
                            product.stock,
                            product.commission_rate,
                            product.is_service_product,
                            product.supplier,
                            product.sku,
                            product.category,
                            existing.id
                        ], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    console.log(`✏️  Updated: ${product.name} (R${existing.price} → R${product.price})`);
                    results.updated++;
                } else {
                    results.skipped++;
                }
            } else {
                // Create new product
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO products (
                            id, name, category, description, price,
                            cost_price, stock, commission_rate, is_service_product,
                            supplier, sku, active, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `, [
                        product.id || `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        product.name,
                        product.category,
                        '',
                        product.price,
                        product.cost_price,
                        product.stock,
                        product.commission_rate,
                        product.is_service_product,
                        product.supplier,
                        product.sku,
                        product.active
                    ], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                console.log(`➕ Created: ${product.name} (R${product.price})`);
                results.created++;
            }

        } catch (error) {
            console.error(`❌ Error processing product:`, error.message);
            results.errors.push({ product: rawProduct, error: error.message });
        }
    }

    db.close();

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total products in file: ${results.total}`);
    console.log(`✅ Created:            ${results.created}`);
    console.log(`✏️  Updated:            ${results.updated}`);
    console.log(`⏭️  Skipped:            ${results.skipped}`);
    console.log(`❌ Errors:             ${results.errors.length}`);
    console.log('='.repeat(60));

    if (results.errors.length > 0) {
        console.log('\n⚠️  ERRORS:');
        results.errors.forEach(({ product, error }) => {
            console.log(`  - ${product.name || 'Unknown'}: ${error}`);
        });
    }

    return results;
}

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
Usage: node import-product-pricelist.js <file.csv> [options]

Options:
  --dry-run              Preview import without making changes
  --skip-duplicates      Skip existing products (don't update)
  --no-update            Don't update existing products

Examples:
  node import-product-pricelist.js kevin-murphy-2025.csv
  node import-product-pricelist.js pricelist.csv --dry-run
  node import-product-pricelist.js products.csv --skip-duplicates
        `);
        process.exit(1);
    }

    const filePath = args[0];
    const options = {
        dryRun: args.includes('--dry-run'),
        skipDuplicates: args.includes('--skip-duplicates'),
        updateExisting: !args.includes('--no-update')
    };

    if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
    }

    importProducts(filePath, options)
        .then(() => {
            console.log('\n✅ Import complete!');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Import failed:', err);
            process.exit(1);
        });
}

module.exports = { importProducts };
```

**Usage:**
```bash
# Dry run first to preview
node ./db/import-product-pricelist.js kevin-murphy-pricelist.csv --dry-run

# Actually import
node ./db/import-product-pricelist.js kevin-murphy-pricelist.csv
```

---

### Phase 3: Backend Implementation

#### Step 3.1: Create Invoice Repository

**Add to `./db/database.js`:**

```javascript
// ============================================
// INVOICE REPOSITORY
// ============================================

const InvoiceRepository = {

    /**
     * Generate next invoice number
     * Format: INV-YYYY-NNNNN (e.g., INV-2025-00001)
     */
    async generateInvoiceNumber() {
        const year = new Date().getFullYear();
        const prefix = `INV-${year}-`;

        const lastInvoice = await dbGet(`
            SELECT invoice_number
            FROM invoices
            WHERE invoice_number LIKE ?
            ORDER BY invoice_number DESC
            LIMIT 1
        `, [`${prefix}%`]);

        if (!lastInvoice) {
            return `${prefix}00001`;
        }

        const lastNumber = parseInt(lastInvoice.invoice_number.split('-')[2]);
        const nextNumber = (lastNumber + 1).toString().padStart(5, '0');
        return `${prefix}${nextNumber}`;
    },

    /**
     * Create new invoice (draft)
     */
    async create(invoiceData) {
        const {
            booking_id,
            user_id,
            stylist_id,
            service_date,
            services = [],
            products = [],
            discount_type,
            discount_value,
            discount_reason,
            client_notes,
            internal_notes,
            created_by
        } = invoiceData;

        const invoice_id = uuidv4();

        // Calculate totals
        const services_subtotal = services.reduce((sum, s) =>
            sum + (s.unit_price * s.quantity) - (s.discount || 0), 0
        );

        const products_subtotal = products.reduce((sum, p) =>
            sum + (p.unit_price * p.quantity) - (p.discount || 0), 0
        );

        const subtotal = services_subtotal + products_subtotal;

        // Calculate discount
        let discount_amount = 0;
        if (discount_type === 'percentage') {
            discount_amount = subtotal * (discount_value / 100);
        } else if (discount_type === 'fixed') {
            discount_amount = discount_value || 0;
        }

        // Calculate tax (15% VAT on (subtotal - discount))
        const taxable_amount = subtotal - discount_amount;
        const tax_amount = taxable_amount * 0.15;

        const total = taxable_amount + tax_amount;
        const amount_due = total;

        // Insert invoice header
        await dbRun(`
            INSERT INTO invoices (
                id, booking_id, user_id, stylist_id,
                services_subtotal, products_subtotal, subtotal,
                discount_type, discount_value, discount_amount, discount_reason,
                tax_rate, tax_amount, total,
                payment_status, amount_paid, amount_due,
                status, service_date, client_notes, internal_notes,
                created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            invoice_id, booking_id, user_id, stylist_id,
            services_subtotal, products_subtotal, subtotal,
            discount_type, discount_value, discount_amount, discount_reason,
            0.15, tax_amount, total,
            'unpaid', 0, amount_due,
            'draft', service_date, client_notes, internal_notes,
            created_by
        ]);

        // Insert service line items
        let commission_total = 0;

        for (let service of services) {
            const service_id = uuidv4();
            const line_total = (service.unit_price * service.quantity) - (service.discount || 0);

            // Get commission rate (hierarchy: service override > catalog > stylist > default)
            let commission_rate = service.commission_rate;
            if (!commission_rate) {
                const catalogService = await dbGet('SELECT commission_rate FROM services WHERE id = ?', [service.service_id]);
                commission_rate = catalogService?.commission_rate;
            }
            if (!commission_rate) {
                const stylist = await dbGet('SELECT commission_rate FROM stylists WHERE id = ?', [stylist_id]);
                commission_rate = stylist?.commission_rate || 0.30; // Default 30%
            }

            const commission_amount = line_total * commission_rate;
            commission_total += commission_amount;

            await dbRun(`
                INSERT INTO invoice_services (
                    id, invoice_id, service_id,
                    service_name, service_description, service_category,
                    unit_price, quantity, discount, total,
                    commission_rate, commission_amount,
                    duration_minutes, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                service_id, invoice_id, service.service_id,
                service.service_name, service.service_description, service.service_category,
                service.unit_price, service.quantity, service.discount || 0, line_total,
                commission_rate, commission_amount,
                service.duration_minutes, service.notes
            ]);
        }

        // Insert product line items
        for (let product of products) {
            const product_id = uuidv4();
            const line_total = (product.unit_price * product.quantity) - (product.discount || 0);

            // Get commission rate for products (usually lower than services)
            let commission_rate = product.commission_rate;
            if (!commission_rate) {
                const catalogProduct = await dbGet('SELECT commission_rate FROM products WHERE id = ?', [product.product_id]);
                commission_rate = catalogProduct?.commission_rate || 0.10; // Default 10% for products
            }

            const commission_amount = line_total * commission_rate;
            commission_total += commission_amount;

            await dbRun(`
                INSERT INTO invoice_products (
                    id, invoice_id, product_id,
                    product_name, product_category, product_type,
                    unit_price, quantity, discount, total,
                    commission_rate, commission_amount,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                product_id, invoice_id, product.product_id,
                product.product_name, product.product_category, product.product_type,
                product.unit_price, product.quantity, product.discount || 0, line_total,
                commission_rate, commission_amount,
                product.notes
            ]);
        }

        // Update commission total in invoice
        await dbRun('UPDATE invoices SET commission_total = ? WHERE id = ?', [commission_total, invoice_id]);

        return this.getById(invoice_id);
    },

    /**
     * Finalize invoice (lock it and generate invoice number)
     */
    async finalize(invoice_id) {
        const invoice = await this.getById(invoice_id);

        if (!invoice) {
            throw new Error('Invoice not found');
        }

        if (invoice.status !== 'draft') {
            throw new Error('Only draft invoices can be finalized');
        }

        const invoice_number = await this.generateInvoiceNumber();

        await dbRun(`
            UPDATE invoices
            SET status = 'finalized',
                invoice_number = ?,
                finalized_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [invoice_number, invoice_id]);

        // Create commission record
        await dbRun(`
            INSERT INTO invoice_commissions (
                id, invoice_id, stylist_id,
                services_commission, products_commission, total_commission,
                payment_status
            )
            SELECT
                ?,
                id,
                stylist_id,
                (SELECT COALESCE(SUM(commission_amount), 0) FROM invoice_services WHERE invoice_id = ?),
                (SELECT COALESCE(SUM(commission_amount), 0) FROM invoice_products WHERE invoice_id = ?),
                commission_total,
                'pending'
            FROM invoices
            WHERE id = ?
        `, [uuidv4(), invoice_id, invoice_id, invoice_id]);

        // If linked to booking, update booking
        if (invoice.booking_id) {
            await dbRun(`
                UPDATE bookings
                SET invoice_id = ?,
                    invoiced = 1,
                    updated_at = datetime('now')
                WHERE id = ?
            `, [invoice_id, invoice.booking_id]);
        }

        // Deduct retail products from stock
        const products = await dbAll('SELECT * FROM invoice_products WHERE invoice_id = ?', [invoice_id]);

        for (let product of products) {
            if (product.product_type === 'retail' && !product.deducted_from_stock) {
                await dbRun(`
                    UPDATE products
                    SET stock = stock - ?
                    WHERE id = ?
                `, [product.quantity, product.product_id]);

                await dbRun(`
                    UPDATE invoice_products
                    SET deducted_from_stock = 1
                    WHERE id = ?
                `, [product.id]);
            }
        }

        return this.getById(invoice_id);
    },

    /**
     * Get invoice by ID with all line items
     */
    async getById(invoice_id) {
        const invoice = await dbGet('SELECT * FROM invoices WHERE id = ?', [invoice_id]);

        if (!invoice) return null;

        // Get line items
        invoice.services = await dbAll('SELECT * FROM invoice_services WHERE invoice_id = ?', [invoice_id]);
        invoice.products = await dbAll('SELECT * FROM invoice_products WHERE invoice_id = ?', [invoice_id]);
        invoice.payments = await dbAll('SELECT * FROM invoice_payments WHERE invoice_id = ?', [invoice_id]);

        // Get user, stylist details
        invoice.customer = await dbGet('SELECT id, name, email, phone FROM users WHERE id = ?', [invoice.user_id]);
        invoice.stylist = await dbGet('SELECT id, name, specialty FROM stylists WHERE id = ?', [invoice.stylist_id]);

        if (invoice.booking_id) {
            invoice.booking = await dbGet('SELECT * FROM bookings WHERE id = ?', [invoice.booking_id]);
        }

        return invoice;
    },

    /**
     * List invoices with filters
     */
    async list(filters = {}) {
        const {
            status,
            payment_status,
            stylist_id,
            user_id,
            start_date,
            end_date,
            search,
            limit = 50,
            offset = 0
        } = filters;

        let whereClauses = [];
        let params = [];

        if (status) {
            whereClauses.push('i.status = ?');
            params.push(status);
        }

        if (payment_status) {
            whereClauses.push('i.payment_status = ?');
            params.push(payment_status);
        }

        if (stylist_id) {
            whereClauses.push('i.stylist_id = ?');
            params.push(stylist_id);
        }

        if (user_id) {
            whereClauses.push('i.user_id = ?');
            params.push(user_id);
        }

        if (start_date) {
            whereClauses.push('i.service_date >= ?');
            params.push(start_date);
        }

        if (end_date) {
            whereClauses.push('i.service_date <= ?');
            params.push(end_date);
        }

        if (search) {
            whereClauses.push('(i.invoice_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        const invoices = await dbAll(`
            SELECT
                i.*,
                u.name as customer_name,
                u.email as customer_email,
                s.name as stylist_name
            FROM invoices i
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN stylists s ON i.stylist_id = s.id
            ${whereSQL}
            ORDER BY i.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        return invoices;
    },

    /**
     * Record payment against invoice
     */
    async recordPayment(invoice_id, paymentData) {
        const { amount, payment_method, payment_reference, notes, processed_by } = paymentData;

        const invoice = await this.getById(invoice_id);

        if (!invoice) {
            throw new Error('Invoice not found');
        }

        if (invoice.status === 'cancelled' || invoice.status === 'void') {
            throw new Error('Cannot record payment on cancelled/void invoice');
        }

        const payment_id = uuidv4();

        // Insert payment record
        await dbRun(`
            INSERT INTO invoice_payments (
                id, invoice_id, amount, payment_method,
                payment_reference, notes, processed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [payment_id, invoice_id, amount, payment_method, payment_reference, notes, processed_by]);

        // Update invoice payment status
        const new_amount_paid = invoice.amount_paid + amount;
        const new_amount_due = invoice.total - new_amount_paid;

        let new_payment_status = 'unpaid';
        if (new_amount_paid >= invoice.total) {
            new_payment_status = 'paid';
        } else if (new_amount_paid > 0) {
            new_payment_status = 'partial';
        }

        await dbRun(`
            UPDATE invoices
            SET amount_paid = ?,
                amount_due = ?,
                payment_status = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [new_amount_paid, new_amount_due, new_payment_status, invoice_id]);

        // If fully paid, approve commission
        if (new_payment_status === 'paid') {
            await dbRun(`
                UPDATE invoice_commissions
                SET payment_status = 'approved',
                    approved_at = datetime('now')
                WHERE invoice_id = ?
            `, [invoice_id]);

            // Update booking payment status if linked
            if (invoice.booking_id) {
                await dbRun(`
                    UPDATE bookings
                    SET payment_status = 'paid',
                        payment_date = datetime('now'),
                        updated_at = datetime('now')
                    WHERE id = ?
                `, [invoice.booking_id]);
            }
        }

        return this.getById(invoice_id);
    },

    /**
     * Get commission report for stylist
     */
    async getCommissionReport(stylist_id, start_date, end_date) {
        const commissions = await dbAll(`
            SELECT
                ic.*,
                i.invoice_number,
                i.service_date,
                i.total as invoice_total,
                i.payment_status,
                u.name as customer_name
            FROM invoice_commissions ic
            LEFT JOIN invoices i ON ic.invoice_id = i.id
            LEFT JOIN users u ON i.user_id = u.id
            WHERE ic.stylist_id = ?
            AND i.service_date BETWEEN ? AND ?
            AND i.status = 'finalized'
            ORDER BY i.service_date DESC
        `, [stylist_id, start_date, end_date]);

        const summary = {
            total_invoices: commissions.length,
            total_sales: commissions.reduce((sum, c) => sum + c.invoice_total, 0),
            services_commission: commissions.reduce((sum, c) => sum + c.services_commission, 0),
            products_commission: commissions.reduce((sum, c) => sum + c.products_commission, 0),
            total_commission: commissions.reduce((sum, c) => sum + c.total_commission, 0),
            paid_commission: commissions.filter(c => c.payment_status === 'paid')
                .reduce((sum, c) => sum + c.total_commission, 0),
            pending_commission: commissions.filter(c => c.payment_status === 'pending' || c.payment_status === 'approved')
                .reduce((sum, c) => sum + c.total_commission, 0)
        };

        return { summary, commissions };
    }
};

// Export new repository
module.exports.InvoiceRepository = InvoiceRepository;
```

---

### Phase 4: API Endpoints

**Add to `server.js` after existing routes:**

```javascript
// ============================================
// INVOICE MANAGEMENT API ENDPOINTS
// ============================================

// Create new invoice
app.post('/api/admin/invoices', authenticateToken, adminOnly, async (req, res) => {
    try {
        const invoiceData = {
            ...req.body,
            created_by: req.user.id
        };

        const invoice = await InvoiceRepository.create(invoiceData);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List invoices
app.get('/api/admin/invoices', authenticateToken, adminOnly, async (req, res) => {
    try {
        const filters = {
            status: req.query.status,
            payment_status: req.query.payment_status,
            stylist_id: req.query.stylist_id,
            user_id: req.query.user_id,
            start_date: req.query.start_date,
            end_date: req.query.end_date,
            search: req.query.search,
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0
        };

        const invoices = await InvoiceRepository.list(filters);
        res.json({ success: true, invoices });
    } catch (error) {
        console.error('List invoices error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single invoice
app.get('/api/admin/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Allow user to view their own invoice, or admin to view any
        if (invoice.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Finalize invoice
app.put('/api/admin/invoices/:id/finalize', authenticateToken, adminOnly, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.finalize(req.params.id);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Finalize invoice error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Record payment
app.post('/api/admin/invoices/:id/payments', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const paymentData = {
            ...req.body,
            processed_by: req.user.id
        };

        const invoice = await InvoiceRepository.recordPayment(req.params.id, paymentData);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get commission report
app.get('/api/admin/commissions', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { stylist_id, start_date, end_date } = req.query;

        if (!stylist_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'stylist_id, start_date, and end_date are required' });
        }

        const report = await InvoiceRepository.getCommissionReport(stylist_id, start_date, end_date);
        res.json({ success: true, ...report });
    } catch (error) {
        console.error('Commission report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Customer-facing: Get my invoices
app.get('/api/invoices/my-invoices', authenticateToken, async (req, res) => {
    try {
        const invoices = await InvoiceRepository.list({
            user_id: req.user.id,
            status: 'finalized' // Only show finalized invoices to customers
        });

        res.json({ success: true, invoices });
    } catch (error) {
        console.error('Get my invoices error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper middleware for admin or staff
function adminOrStaff(req, res, next) {
    if (req.user.role === 'admin' || req.user.role === 'staff') {
        next();
    } else {
        res.status(403).json({ error: 'Admin or staff access required' });
    }
}
```

---

### Phase 5: Admin UI Implementation

**Add to `flirt-admin-console.html`:**

This is a large section. Key components to add:

1. **Invoice List View** (in admin navigation)
2. **Invoice Creation Form**
3. **Invoice Detail View**
4. **Payment Recording Modal**
5. **Commission Report View**

I'll provide the core structure - you'll integrate it into the existing admin console:

```html
<!-- Add to navigation menu -->
<div class="nav-item" onclick="showSection('invoices')">
    <i class="fas fa-file-invoice"></i>
    <span>Invoices</span>
</div>

<!-- Invoice Management Section -->
<div id="invoices-section" class="section" style="display: none;">
    <div class="section-header">
        <h2>Invoice Management</h2>
        <button class="btn btn-primary" onclick="showCreateInvoice()">
            <i class="fas fa-plus"></i> Create Invoice
        </button>
    </div>

    <!-- Filters -->
    <div class="filters-bar">
        <select id="invoice-status-filter" onchange="loadInvoices()">
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
            <option value="sent">Sent</option>
        </select>

        <select id="invoice-payment-filter" onchange="loadInvoices()">
            <option value="">All Payment Status</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
        </select>

        <input type="text" id="invoice-search" placeholder="Search invoices..." onkeyup="loadInvoices()">
    </div>

    <!-- Invoice List -->
    <div id="invoice-list" class="data-table">
        <!-- Populated by JavaScript -->
    </div>
</div>

<script>
// Invoice Management Functions

async function loadInvoices() {
    const status = document.getElementById('invoice-status-filter').value;
    const payment_status = document.getElementById('invoice-payment-filter').value;
    const search = document.getElementById('invoice-search').value;

    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (payment_status) params.append('payment_status', payment_status);
    if (search) params.append('search', search);

    const response = await fetch(`/api/admin/invoices?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });

    const data = await response.json();

    if (data.success) {
        renderInvoiceList(data.invoices);
    }
}

function renderInvoiceList(invoices) {
    const container = document.getElementById('invoice-list');

    if (invoices.length === 0) {
        container.innerHTML = '<p class="no-data">No invoices found</p>';
        return;
    }

    const html = `
        <table>
            <thead>
                <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Stylist</th>
                    <th>Total</th>
                    <th>Payment Status</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${invoices.map(inv => `
                    <tr>
                        <td>${inv.invoice_number || 'DRAFT'}</td>
                        <td>${formatDate(inv.service_date)}</td>
                        <td>${inv.customer_name}</td>
                        <td>${inv.stylist_name}</td>
                        <td>R${inv.total.toFixed(2)}</td>
                        <td>
                            <span class="badge badge-${getPaymentStatusColor(inv.payment_status)}">
                                ${inv.payment_status.toUpperCase()}
                            </span>
                        </td>
                        <td>
                            <span class="badge badge-${getStatusColor(inv.status)}">
                                ${inv.status.toUpperCase()}
                            </span>
                        </td>
                        <td>
                            <button onclick="viewInvoice('${inv.id}')" class="btn-icon" title="View">
                                <i class="fas fa-eye"></i>
                            </button>
                            ${inv.status === 'draft' ? `
                                <button onclick="finalizeInvoice('${inv.id}')" class="btn-icon" title="Finalize">
                                    <i class="fas fa-check"></i>
                                </button>
                            ` : ''}
                            ${inv.payment_status !== 'paid' ? `
                                <button onclick="recordPayment('${inv.id}')" class="btn-icon" title="Record Payment">
                                    <i class="fas fa-dollar-sign"></i>
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function getPaymentStatusColor(status) {
    const colors = {
        'unpaid': 'danger',
        'partial': 'warning',
        'paid': 'success',
        'refunded': 'secondary'
    };
    return colors[status] || 'secondary';
}

function getStatusColor(status) {
    const colors = {
        'draft': 'secondary',
        'finalized': 'primary',
        'sent': 'info',
        'cancelled': 'danger'
    };
    return colors[status] || 'secondary';
}

// Initialize when section shown
function showInvoicesSection() {
    showSection('invoices');
    loadInvoices();
}
</script>
```

---

## Testing Checklist

After implementation, test these scenarios:

1. ✅ **Database Migration**
   - [ ] All tables created successfully
   - [ ] Indexes created
   - [ ] Foreign key constraints working
   - [ ] Products table has new columns

2. ✅ **Product Import**
   - [ ] CSV import works (dry-run)
   - [ ] Products created/updated correctly
   - [ ] Prices parsed correctly (handles R symbol)
   - [ ] Commission rates set

3. ✅ **Invoice Creation**
   - [ ] Create draft invoice with services
   - [ ] Create invoice with products
   - [ ] Create invoice with both
   - [ ] Totals calculate correctly
   - [ ] Commission calculates correctly
   - [ ] Discount applies correctly
   - [ ] Tax (15% VAT) calculates correctly

4. ✅ **Invoice Finalization**
   - [ ] Draft → Finalized works
   - [ ] Invoice number generated (INV-YYYY-NNNNN)
   - [ ] Cannot edit after finalization
   - [ ] Stock deducted for retail products
   - [ ] Booking updated with invoice_id

5. ✅ **Payment Recording**
   - [ ] Record full payment
   - [ ] Record partial payment
   - [ ] Payment status updates correctly
   - [ ] Commission auto-approved when paid
   - [ ] Booking payment_status updated

6. ✅ **Commission Reports**
   - [ ] Generate report by stylist
   - [ ] Filter by date range
   - [ ] Totals calculate correctly
   - [ ] Breakdown by services vs products

7. ✅ **UI Testing**
   - [ ] Invoice list loads
   - [ ] Filters work
   - [ ] Search works
   - [ ] Create invoice form works
   - [ ] Payment modal works

---

## Success Criteria

You will know implementation is complete when:

1. ✅ All 5 invoice tables exist in database
2. ✅ Products table has commission_rate, cost_price columns
3. ✅ Product price list imported successfully (all 45+ Kevin Murphy products updated)
4. ✅ Can create draft invoice from admin console
5. ✅ Can finalize invoice and generate invoice number
6. ✅ Can record payment and see payment status update
7. ✅ Can view commission report for stylist
8. ✅ Customer can view their invoices
9. ✅ All API endpoints return correct data
10. ✅ No errors in browser console or server logs

---

## File Checklist

Create/modify these files:

- [ ] `./db/migrations/001-add-product-invoice-fields.js`
- [ ] `./db/migrations/002-create-invoice-tables.sql`
- [ ] `./db/migrations/002-create-invoice-tables.js`
- [ ] `./db/import-product-pricelist.js`
- [ ] `./db/database.js` (add InvoiceRepository)
- [ ] `server.js` (add invoice API endpoints)
- [ ] `flirt-admin-console.html` (add invoice UI)

---

## Questions to Ask User

Before starting implementation:

1. **Where is the product price list file?**
   - What format? (CSV, Excel, JSON)
   - What columns does it have?
   - Can you share a sample?

2. **Commission rates:**
   - What % for services? (default 30%?)
   - What % for retail products? (default 10%?)
   - What % for service products? (default 5%?)

3. **Should we migrate historical bookings to invoices?**
   - Or only create invoices going forward?

4. **Tax handling:**
   - Is 15% VAT correct for South Africa?
   - Should tax be shown separately or inclusive?

---

## Notes & Best Practices

- Use **transactions** for invoice creation (atomic operations)
- Always **snapshot** product/service data to invoice line items
- Never delete invoices - use status 'void' instead
- Commission only approved when invoice is **paid** (not just finalized)
- Maintain **audit trail** (created_by, updated_at)
- Use **UUIDs** for all invoice-related IDs
- Invoice numbers are **sequential** and **unique**
- Stock deduction happens on **finalize**, not on draft

---

**END OF IMPLEMENTATION PROMPT**
