const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');

/**
 * Import complete pricelist from Excel file
 * Handles both Services and Products from Pricelist-3.xlsx
 *
 * Column mapping:
 * - Description → name
 * - RSP (Recommended Selling Price) → price
 * - NETT Cost → cost_price
 * - ServiceType → 'Service' goes to services table, 'Product' goes to products table
 * - Department → category
 * - Supplier → supplier
 * - QOH (Quantity On Hand) → stock
 */

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function importPricelist(filePath, options = {}) {
    const {
        updateExisting = true,  // Update existing items by name
        skipDuplicates = false, // Skip if item exists
        dryRun = false,         // Preview without importing
        importServices = true,  // Import services
        importProducts = true   // Import products
    } = options;

    console.log('📄 Reading Excel file:', filePath);

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // First sheet
    const items = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`📊 Found ${items.length} items in sheet: ${sheetName}`);

    const db = new sqlite3.Database(DB_PATH);

    // Get invoice settings for default commission rates
    const invoiceSettings = await dbGet(db, 'SELECT * FROM invoice_settings WHERE id = 1');
    const defaultServiceCommission = invoiceSettings?.default_service_commission_rate || 0.30;
    const defaultProductCommission = invoiceSettings?.default_product_commission_rate || 0.10;
    const defaultServiceProductCommission = invoiceSettings?.default_service_product_commission_rate || 0.05;

    const results = {
        total: items.length,
        services: { created: 0, updated: 0, skipped: 0, errors: [] },
        products: { created: 0, updated: 0, skipped: 0, errors: [] }
    };

    for (let item of items) {
        try {
            // Parse item
            const name = (item.Description || '').trim();
            const serviceType = (item.ServiceType || '').trim();
            const price = parseFloat(item.RSP) || 0;
            const costPrice = parseFloat(item['NETT Cost']) || 0;
            const category = (item.Department || 'General').trim();
            const supplier = (item.Supplier || 'Flirt Hair').trim();
            const stock = parseInt(item.QOH) || 0;

            if (!name) {
                console.warn('⚠️  Skipping item with no description:', item);
                continue;
            }

            // Determine if this is a Service or Product
            const isService = serviceType.toLowerCase() === 'service';

            if (isService && !importServices) continue;
            if (!isService && !importProducts) continue;

            if (dryRun) {
                console.log(`🔍 [DRY RUN] ${isService ? 'Service' : 'Product'}: ${name} - R${price}`);
                continue;
            }

            // Determine commission rate based on type
            let commissionRate = defaultServiceCommission;
            if (!isService) {
                // For products, check if it's a service product (used during treatment)
                const isServiceProduct = supplier.toLowerCase() !== 'kevin murphy' && supplier.toLowerCase() !== 'moyoko';
                commissionRate = isServiceProduct ? defaultServiceProductCommission : defaultProductCommission;
            }

            if (isService) {
                // Import as SERVICE
                const existing = await dbGet(db,
                    'SELECT id, price FROM services WHERE name = ? COLLATE NOCASE',
                    [name]
                );

                if (existing) {
                    if (skipDuplicates) {
                        console.log(`⏭️  Skipping existing service: ${name}`);
                        results.services.skipped++;
                    } else if (updateExisting) {
                        await dbRun(db, `
                            UPDATE services
                            SET price = ?,
                                cost_price = ?,
                                commission_rate = ?,
                                category = ?,
                                active = 1,
                                service_type = ?
                            WHERE id = ?
                        `, [price, costPrice, commissionRate, category, 'beauty', existing.id]);

                        console.log(`✏️  Updated service: ${name} (R${existing.price} → R${price})`);
                        results.services.updated++;
                    } else {
                        results.services.skipped++;
                    }
                } else {
                    // Create new service
                    const serviceId = `svc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                    await dbRun(db, `
                        INSERT INTO services (
                            id, name, description, price, duration,
                            service_type, category, commission_rate, cost_price,
                            display_order, active, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `, [
                        serviceId,
                        name,
                        `${name} - ${supplier}`,
                        price,
                        null, // duration
                        'beauty',
                        category,
                        commissionRate,
                        costPrice,
                        0,
                        1
                    ]);

                    console.log(`➕ Created service: ${name} (R${price})`);
                    results.services.created++;
                }
            } else {
                // Import as PRODUCT
                const existing = await dbGet(db,
                    'SELECT id, price FROM products WHERE name = ? COLLATE NOCASE',
                    [name]
                );

                const isServiceProduct = supplier.toLowerCase() !== 'kevin murphy' && supplier.toLowerCase() !== 'moyoko';

                if (existing) {
                    if (skipDuplicates) {
                        console.log(`⏭️  Skipping existing product: ${name}`);
                        results.products.skipped++;
                    } else if (updateExisting) {
                        await dbRun(db, `
                            UPDATE products
                            SET price = ?,
                                cost_price = ?,
                                stock = ?,
                                commission_rate = ?,
                                is_service_product = ?,
                                supplier = ?,
                                category = ?,
                                active = 1
                            WHERE id = ?
                        `, [
                            price,
                            costPrice,
                            stock,
                            commissionRate,
                            isServiceProduct ? 1 : 0,
                            supplier,
                            category,
                            existing.id
                        ]);

                        console.log(`✏️  Updated product: ${name} (R${existing.price} → R${price})`);
                        results.products.updated++;
                    } else {
                        results.products.skipped++;
                    }
                } else {
                    // Create new product
                    const productId = `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                    await dbRun(db, `
                        INSERT INTO products (
                            id, name, category, description, price,
                            cost_price, stock, commission_rate, is_service_product,
                            supplier, active, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `, [
                        productId,
                        name,
                        category,
                        `${name} - ${supplier}`,
                        price,
                        costPrice,
                        stock,
                        commissionRate,
                        isServiceProduct ? 1 : 0,
                        supplier,
                        1
                    ]);

                    console.log(`➕ Created product: ${name} (R${price})`);
                    results.products.created++;
                }
            }

        } catch (error) {
            console.error(`❌ Error processing item:`, error.message);
            const target = item.ServiceType?.toLowerCase() === 'service' ? results.services : results.products;
            target.errors.push({ item, error: error.message });
        }
    }

    db.close();

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(70));
    console.log(`\n📋 SERVICES:`);
    console.log(`  ✅ Created:  ${results.services.created}`);
    console.log(`  ✏️  Updated:  ${results.services.updated}`);
    console.log(`  ⏭️  Skipped:  ${results.services.skipped}`);
    console.log(`  ❌ Errors:   ${results.services.errors.length}`);

    console.log(`\n📦 PRODUCTS:`);
    console.log(`  ✅ Created:  ${results.products.created}`);
    console.log(`  ✏️  Updated:  ${results.products.updated}`);
    console.log(`  ⏭️  Skipped:  ${results.products.skipped}`);
    console.log(`  ❌ Errors:   ${results.products.errors.length}`);

    console.log(`\n📈 TOTALS:`);
    console.log(`  Total items processed: ${results.total}`);
    console.log(`  Total created:         ${results.services.created + results.products.created}`);
    console.log(`  Total updated:         ${results.services.updated + results.products.updated}`);
    console.log('='.repeat(70));

    if (results.services.errors.length > 0 || results.products.errors.length > 0) {
        console.log('\n⚠️  ERRORS:');
        [...results.services.errors, ...results.products.errors].forEach(({ item, error }) => {
            console.log(`  - ${item.Description || 'Unknown'}: ${error}`);
        });
    }

    return results;
}

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
Usage: node import-pricelist.js <file.xlsx> [options]

Options:
  --dry-run              Preview import without making changes
  --skip-duplicates      Skip existing items (don't update)
  --no-update            Don't update existing items
  --services-only        Only import services
  --products-only        Only import products

Examples:
  node import-pricelist.js ~/Downloads/Pricelist-3.xlsx
  node import-pricelist.js pricelist.xlsx --dry-run
  node import-pricelist.js pricelist.xlsx --services-only
        `);
        process.exit(1);
    }

    const filePath = args[0];
    const options = {
        dryRun: args.includes('--dry-run'),
        skipDuplicates: args.includes('--skip-duplicates'),
        updateExisting: !args.includes('--no-update'),
        importServices: !args.includes('--products-only'),
        importProducts: !args.includes('--services-only')
    };

    importPricelist(filePath, options)
        .then(() => {
            console.log('\n✅ Import complete!');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Import failed:', err);
            process.exit(1);
        });
}

module.exports = { importPricelist };
