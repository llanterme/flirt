/**
 * Migration: Update hair service categories to match price list
 *
 * Reorganizes services into proper categories:
 * - Consultation
 * - Cut & Styling
 * - Colour Services
 * - Lightening Services
 * - Balayage
 * - Treatments
 * - Extension Maintenance
 *
 * Run with: node db/migrations/update-hair-service-categories.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'flirt.db');
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

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// New services from price list that need to be added
const NEW_SERVICES = [
    // Consultation
    { name: 'Consultation', category: 'Consultation', price: 0, description: 'A personalised session to discuss your hair goals, assess your hair, recommend the best options, and provide a customised quote before your appointment.' },

    // Cut & Styling
    { name: 'Short Blow Dry', category: 'Cut & Styling', price: 220, description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'Medium Blow Dry', category: 'Cut & Styling', price: 290, description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'Long Blow Dry', category: 'Cut & Styling', price: 360, description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'XL Blow Dry', category: 'Cut & Styling', price: 430, description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'Cut & Style Short', category: 'Cut & Styling', price: 295, description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Cut & Style Medium', category: 'Cut & Styling', price: 395, description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Cut & Style Long', category: 'Cut & Styling', price: 495, description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Cut & Style XL', category: 'Cut & Styling', price: 595, description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Ladies Wash Only', category: 'Cut & Styling', price: 100, description: 'Enjoy a refreshing hair wash and head massage.' },
    { name: 'Gents Cut', category: 'Cut & Styling', price: 200, description: 'A fresh cut and salon-quality style for hair that looks effortless and perfectly shaped.' },

    // Colour Services
    { name: 'Root Refresh', category: 'Colour Services', price: 625, description: 'Covers regrowth to keep your colour looking seamless. Prices from R625-R825. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Full Colour Service', category: 'Colour Services', price: 950, description: 'Transform your look with a vibrant, all-over colour tailored to you. Prices from R950-R1850. Price excludes gloss, cut, and blow-dry.' },

    // Lightening Services
    { name: 'Face Frame', category: 'Lightening Services', price: 420, description: "Foils around the hairline, creating a 'money piece' for a pop of brightness. Prices from R420-R550. Price excludes gloss, cut, and blow-dry." },
    { name: 'T-Section Lightening', category: 'Lightening Services', price: 625, description: 'Targeted lightening applied to the top and front sections of your hair for added brightness and dimension. Prices from R625-835. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Half Head Lightening', category: 'Lightening Services', price: 750, description: 'Touch up focused on the top half of your hair, framing the hairline without compromising health. Prices from R750-R950. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Full Head Lightening', category: 'Lightening Services', price: 1000, description: 'Create a bold, luminous look with highlights applied throughout your entire head, adding depth, dimension, and a radiant finish. Prices from R1000-1800. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Highlight & Lowlights', category: 'Lightening Services', price: 1400, description: 'Add dimension and depth to your hair with a combination of highlights and lowlights, creating a natural, multi-tonal, and beautifully blended look. Prices from R1400-R1800. Price excludes gloss, cut, and blow-dry.' },

    // Balayage
    { name: 'Partial Balayage', category: 'Balayage', price: 1500, description: 'A hand-painted colour technique applied to select sections of your hair for a natural, sun-kissed look with subtle dimension and brightness. Prices from R1500-R2385. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Full Balayage', category: 'Balayage', price: 1750, description: 'A hand-painted colour technique applied throughout the entire head for a seamless, sun-kissed, and dimensional look. Perfect for a natural, luminous finish. Prices from R1750-R1900. Price excludes gloss, cut, and blow-dry.' },

    // Treatments
    { name: 'Inoar Brazilian Treatment', category: 'Treatments', price: 850, description: 'A smoothing treatment that reduces frizz, adds shine, and leaves hair soft, sleek, and manageable. Ideal for all hair types and a long-lasting, polished finish. Prices from R850-R1400.' },
    { name: 'MK Treatment', category: 'Treatments', price: 1100, description: 'A nourishing and restorative treatment designed to repair, strengthen, and revitalize damaged or stressed hair, leaving it soft, smooth, and healthy-looking. Prices from R1100-R3350' },
    { name: 'Davines Experience', category: 'Treatments', price: 550, description: "A personalised hair treatment tailored to your hair's unique needs." },
    { name: 'Wella Experience', category: 'Treatments', price: 300, description: 'A professional salon treatment that nourishes, repairs, and strengthens your hair.' },
    { name: 'Botox Treatment', category: 'Treatments', price: 600, description: 'A deep-repair treatment that smooths, strengthens, and restores hair from within. Ideal for damaged, frizzy, or aging hair, leaving it soft, shiny, and revitalised.' },

    // Extension Maintenance
    { name: 'Tape-In Maintenance', category: 'Extension Maintenance', price: 1000, description: 'Removal, retaping and reinstallation. Includes wash & blow-dry' },
    { name: 'Weft Maintenance', category: 'Extension Maintenance', price: 1600, description: 'Removal and reinstallation of wefts. Includes wash & blow-dry' },
    { name: 'Keratin Maintenance', category: 'Extension Maintenance', price: 1000, description: 'Removal, rebonding and reinstallation. Includes wash & blow-dry' },
    { name: 'Installation / Removal Only', category: 'Extension Maintenance', price: 450, description: 'Extension installation or removal service only.' },
];

// Category mapping for existing services
const CATEGORY_MAPPINGS = {
    // Map existing category names to new proper category names
    'consultation': 'Consultation',
    'General': null, // Will be mapped individually below
    'Colour': 'Colour Services',
    'Treatment': 'Treatments',
    'extensions': 'Extensions Service', // Keep as is for extensions
    'maintenance': 'Extension Maintenance',
    'Extensions Service': 'Extensions Service', // Keep as is
    'Bridal': 'Bridal', // Keep as is
    'Male Grooming': 'Male Grooming', // Keep as is
};

// Individual service name mappings to categories
const SERVICE_TO_CATEGORY = {
    // General -> Cut & Styling
    'Wash & Blow Dry Short': 'Cut & Styling',
    'Wash & Blow Dry Medium': 'Cut & Styling',
    'Wash & Blow Dry Long': 'Cut & Styling',
    'Wash & Blow Dry XL': 'Cut & Styling',
    'Cut & Blow dry Short': 'Cut & Styling',
    'Cut & Blow dry Medium': 'Cut & Styling',
    'Cut & Blow dry Long': 'Cut & Styling',
    'Cut & Blow dry XL': 'Cut & Styling',
    'Cut & Finish Short': 'Cut & Styling',
    'Cut & Finish Medium': 'Cut & Styling',
    'Cut & Finish Long hair': 'Cut & Styling',
    'Cut & Finish Long': 'Cut & Styling',
    'Gents Cut Short': 'Cut & Styling',
    'Gents Cut Medium': 'Cut & Styling',
    'Kids 12 and under': 'Cut & Styling',
    'Fringe Cut': 'Cut & Styling',
    'Curls': 'Cut & Styling',
    'Braids / Vlegsel': 'Cut & Styling',

    // General -> Consultation
    'Consultation': 'Consultation',

    // General -> keep as General (internal/misc)
    'Courier Fee': 'General',
    'Miscellaneous': 'General',

    // Colour -> Colour Services (root touch ups, full colour)
    'Root Touch Up': 'Colour Services',
    'Root Touch Up Med (60g)': 'Colour Services',
    'Full Colour Short': 'Colour Services',
    'Full Colour Medium': 'Colour Services',
    'Full Colour Long': 'Colour Services',
    'Full Colour XL': 'Colour Services',
    'Toner / Gloss Short': 'Colour Services',
    'Toner / Gloss Medium': 'Colour Services',
    'Toner / Gloss Long': 'Colour Services',
    'Toner / Gloss XL': 'Colour Services',
    'Root Melt/Smudge': 'Colour Services',
    'Colour Remover': 'Colour Services',
    'Colour Change Short': 'Colour Services',
    'Colour Change Medium': 'Colour Services',
    'Colour Change Long': 'Colour Services',
    'Colour Change XL': 'Colour Services',
    'Colour Correction': 'Colour Services',
    'Per Foil Short': 'Colour Services',
    'Per Foil Medium': 'Colour Services',
    'Per Foil Long': 'Colour Services',
    'Per Foil XL': 'Colour Services',

    // Colour -> Lightening Services
    'Custom Lightening Full Head Short': 'Lightening Services',
    'Custom Lightening Full Head Medium': 'Lightening Services',
    'Custom Lightening Full Head Long': 'Lightening Services',
    'Custom Lightening Full Head XL': 'Lightening Services',
    'Custom Lightening Half Head Short': 'Lightening Services',
    'Custom Lightening Half Head Medium': 'Lightening Services',
    'Custom Lightening Half Head Long': 'Lightening Services',
    'Custom Lightening Half Head XL': 'Lightening Services',
    'T-Zone (20g)': 'Lightening Services',
    'T-Zone Highlights Short': 'Lightening Services',
    'T-Zone Highlights Medium': 'Lightening Services',
    'T-Zone Highlights Long': 'Lightening Services',
    'Foils & Colour Roots Medium': 'Lightening Services',
    'Foils & Colour Roots Long': 'Lightening Services',
    'Foils & Colour Roots XL': 'Lightening Services',
    'Foils & Colour Medium': 'Lightening Services',
    'Foils & Colour Long': 'Lightening Services',
    'Foils & Colour XL': 'Lightening Services',

    // Colour -> Balayage
    'Balayage Hollywood': 'Balayage',
    'Balayage W/O Roots Medium': 'Balayage',
    'Balayage W/O Roots Long': 'Balayage',
    'Balayage W/O Roots XL': 'Balayage',
    'Balayage W/ Roots Medium': 'Balayage',
    'Balayage W/ Roots Long': 'Balayage',
    'Balayage W/ Roots  XL': 'Balayage',

    // Treatment -> Treatments
    'Inoar Brazilliian Fringe': 'Treatments',
    'Inoar Brazilliian Short': 'Treatments',
    'Inoar Brazilliian Medium': 'Treatments',
    'Inoar Brazilliian Long': 'Treatments',
    'Inoar Brazilliian XL': 'Treatments',
    'MK Express': 'Treatments',
    'MK Treatment Short': 'Treatments',
    'MK Treatment Medium': 'Treatments',
    'MK Treatment Long': 'Treatments',
    'MK Treatment XL': 'Treatments',
    'Davines Experience': 'Treatments',
    'Wella Experience': 'Treatments',
    'Botox': 'Treatments',
    'Wellaplex': 'Treatments',

    // Color Matching consultation
    'Color Matching': 'Consultation',
};

async function updateCategories() {
    console.log('='.repeat(60));
    console.log('UPDATING HAIR SERVICE CATEGORIES');
    console.log('='.repeat(60));
    console.log('Database:', DB_PATH);
    console.log('');

    // Get all hair services
    const services = await dbAll(`
        SELECT id, name, category, price, description
        FROM services
        WHERE service_type = 'hair' AND active = 1
        ORDER BY category, name
    `);

    console.log(`Found ${services.length} active hair services\n`);

    let updated = 0;
    let skipped = 0;

    // Update each service's category
    for (const service of services) {
        let newCategory = null;

        // First check individual service mapping
        if (SERVICE_TO_CATEGORY[service.name]) {
            newCategory = SERVICE_TO_CATEGORY[service.name];
        }
        // Then check category mapping
        else if (CATEGORY_MAPPINGS[service.category]) {
            newCategory = CATEGORY_MAPPINGS[service.category];
        }

        if (newCategory && newCategory !== service.category) {
            console.log(`  "${service.name}": "${service.category}" -> "${newCategory}"`);
            await dbRun(
                'UPDATE services SET category = ? WHERE id = ?',
                [newCategory, service.id]
            );
            updated++;
        } else if (!newCategory) {
            // Services we're not mapping - keep as is or mark as non-bookable
            skipped++;
        }
    }

    console.log(`\nUpdated ${updated} services, skipped ${skipped}`);
    return updated;
}

async function addNewServices() {
    console.log('\n' + '='.repeat(60));
    console.log('ADDING NEW SERVICES FROM PRICE LIST');
    console.log('='.repeat(60));

    let added = 0;

    for (const svc of NEW_SERVICES) {
        // Check if service already exists (by name)
        const existing = await dbGet(
            'SELECT id FROM services WHERE name = ? AND service_type = ?',
            [svc.name, 'hair']
        );

        if (!existing) {
            const id = `svc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await dbRun(`
                INSERT INTO services (id, name, description, price, duration, service_type, category, active, bookable)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
            `, [
                id,
                svc.name,
                svc.description || null,
                svc.price,
                svc.duration || 60,
                'hair',
                svc.category
            ]);
            console.log(`  Added: "${svc.name}" (${svc.category}) - R${svc.price}`);
            added++;
        } else {
            // Update existing service's category if needed
            await dbRun(
                'UPDATE services SET category = ?, description = COALESCE(?, description) WHERE id = ?',
                [svc.category, svc.description, existing.id]
            );
            console.log(`  Updated: "${svc.name}" -> ${svc.category}`);
        }
    }

    console.log(`\nAdded ${added} new services`);
    return added;
}

async function showFinalCategories() {
    console.log('\n' + '='.repeat(60));
    console.log('FINAL CATEGORY SUMMARY (Bookable Hair Services)');
    console.log('='.repeat(60));

    const categories = await dbAll(`
        SELECT category, COUNT(*) as count, MIN(price) as min_price, MAX(price) as max_price
        FROM services
        WHERE service_type = 'hair' AND active = 1 AND bookable = 1
        GROUP BY category
        ORDER BY
            CASE category
                WHEN 'Consultation' THEN 1
                WHEN 'Cut & Styling' THEN 2
                WHEN 'Colour Services' THEN 3
                WHEN 'Lightening Services' THEN 4
                WHEN 'Balayage' THEN 5
                WHEN 'Treatments' THEN 6
                WHEN 'Extension Maintenance' THEN 7
                WHEN 'Extensions Service' THEN 8
                WHEN 'Bridal' THEN 9
                WHEN 'Male Grooming' THEN 10
                ELSE 99
            END
    `);

    for (const cat of categories) {
        console.log(`  ${cat.category}: ${cat.count} services (R${cat.min_price} - R${cat.max_price})`);
    }
}

async function main() {
    try {
        await updateCategories();
        await addNewServices();
        await showFinalCategories();

        console.log('\n' + '='.repeat(60));
        console.log('MIGRATION COMPLETE');
        console.log('='.repeat(60));
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

main();
