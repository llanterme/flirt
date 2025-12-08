/**
 * Seed script for Hair Services
 * Run with: node db/seed-services.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'flirt.db');

const db = new sqlite3.Database(DB_PATH);

// All hair services from the provided list
const services = [
    // Consultation
    { name: 'Consultation', price: 0, category: 'Consultation', description: 'A personalised session to discuss your hair goals, assess your hair, recommend the best options, and provide a customised quote before your appointment.' },

    // Cut & Styling
    { name: 'Short Blow Dry', price: 220, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'Medium Blow Dry', price: 290, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'Long Blow Dry', price: 360, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'XL Blow Dry', price: 430, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
    { name: 'Cut & Style Short', price: 295, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Cut & Style Medium', price: 395, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Cut & Style Long', price: 495, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Cut & Style XL', price: 595, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
    { name: 'Ladies Wash Only', price: 100, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage.' },
    { name: 'Gents Cut', price: 200, category: 'Cut & Styling', description: 'A fresh cut and salon-quality style for hair that looks effortless and perfectly shaped.' },

    // Colour Services
    { name: 'Root Refresh', price: 625, category: 'Colour Services', description: 'Covers regrowth to keep your colour looking seamless. Prices from R625-R825. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Full Colour Service', price: 950, category: 'Colour Services', description: 'Transform your look with a vibrant, all-over colour tailored to you. Prices from R950-R1850. Price excludes gloss, cut, and blow-dry.' },

    // Lightening Services
    { name: 'Face Frame', price: 420, category: 'Lightening Services', description: 'Foils around the hairline, creating a \'money piece\' for a pop of brightness. Prices from R420-R550. Price excludes gloss, cut, and blow-dry.' },
    { name: 'T-Section Lightening', price: 625, category: 'Lightening Services', description: 'Targeted lightening applied to the top and front sections of your hair for added brightness and dimension. Prices from R625-835. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Half Head Lightening', price: 750, category: 'Lightening Services', description: 'Touch up focused on the top half of your hair, framing the hairline without compromising health. Prices from R750-R950. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Full Head Lightening', price: 1000, category: 'Lightening Services', description: 'Create a bold, luminous look with highlights applied throughout your entire head, adding depth, dimension, and a radiant finish. Prices from R1000-1800. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Highlight & Lowlights', price: 1400, category: 'Lightening Services', description: 'Add dimension and depth to your hair with a combination of highlights and lowlights, creating a natural, multi-tonal, and beautifully blended look. Prices from R1400-R1800. Price excludes gloss, cut, and blow-dry.' },

    // Balayage
    { name: 'Partial Balayage', price: 1500, category: 'Balayage', description: 'A hand-painted colour technique applied to select sections of your hair for a natural, sun-kissed look with subtle dimension and brightness. Prices from R1500-R2385. Price excludes gloss, cut, and blow-dry.' },
    { name: 'Full Balayage', price: 1750, category: 'Balayage', description: 'A hand-painted colour technique applied throughout the entire head for a seamless, sun-kissed, and dimensional look. Perfect for a natural, luminous finish. Prices from R1750-R1900. Price excludes gloss, cut, and blow-dry.' },

    // Treatments
    { name: 'Inoar Brazilian Treatment', price: 850, category: 'Treatments', description: 'A smoothing treatment that reduces frizz, adds shine, and leaves hair soft, sleek, and manageable. Ideal for all hair types and a long-lasting, polished finish. Prices from R850-R1400.' },
    { name: 'MK Treatment', price: 1100, category: 'Treatments', description: 'A nourishing and restorative treatment designed to repair, strengthen, and revitalize damaged or stressed hair, leaving it soft, smooth, and healthy-looking. Prices from R1100-R3350.' },
    { name: 'Davines Experience', price: 550, category: 'Treatments', description: 'A personalised hair treatment tailored to your hair\'s unique needs.' },
    { name: 'Wella Experience', price: 300, category: 'Treatments', description: 'A professional salon treatment that nourishes, repairs, and strengthens your hair.' },
    { name: 'Botox', price: 600, category: 'Treatments', description: 'A deep-repair treatment that smooths, strengthens, and restores hair from within. Ideal for damaged, frizzy, or aging hair, leaving it soft, shiny, and revitalised.' },

    // Extension Maintenance
    { name: 'Tape-In Maintenance', price: 1000, category: 'Extension Maintenance', description: 'Removal, retaping and reinstallation. Includes wash & blow-dry.' },
    { name: 'Weft Maintenance', price: 1600, category: 'Extension Maintenance', description: 'Removal and reinstallation of wefts. Includes wash & blow-dry.' },
    { name: 'Keratin Maintenance', price: 1000, category: 'Extension Maintenance', description: 'Removal, rebonding and reinstallation. Includes wash & blow-dry.' },
    { name: 'Installation / Removal Only', price: 450, category: 'Extension Maintenance', description: 'Extension installation or removal service only.' },
];

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function seedServices() {
    console.log('Starting service seed...');
    console.log(`Database: ${DB_PATH}`);

    try {
        // First, ensure the 'hair' service type exists
        const hairType = await getAll("SELECT id FROM service_types WHERE name = 'Hair'");
        let hairTypeId;

        if (hairType.length === 0) {
            hairTypeId = uuidv4();
            await runQuery(
                "INSERT INTO service_types (id, name, description, display_order, active) VALUES (?, ?, ?, ?, ?)",
                [hairTypeId, 'Hair', 'Hair services', 1, 1]
            );
            console.log('Created Hair service type');
        } else {
            hairTypeId = hairType[0].id;
            console.log('Hair service type already exists');
        }

        // Get unique categories from services
        const categories = [...new Set(services.map(s => s.category))];

        // Create/get category IDs
        const categoryMap = {};
        for (let i = 0; i < categories.length; i++) {
            const catName = categories[i];
            const existing = await getAll(
                "SELECT id FROM service_categories WHERE name = ? AND service_type_id = ?",
                [catName, hairTypeId]
            );

            if (existing.length === 0) {
                const catId = uuidv4();
                await runQuery(
                    "INSERT INTO service_categories (id, name, service_type_id, display_order, active) VALUES (?, ?, ?, ?, ?)",
                    [catId, catName, hairTypeId, i + 1, 1]
                );
                categoryMap[catName] = catId;
                console.log(`Created category: ${catName}`);
            } else {
                categoryMap[catName] = existing[0].id;
                console.log(`Category exists: ${catName}`);
            }
        }

        // Delete existing hair services
        const deleted = await runQuery("DELETE FROM services WHERE service_type = 'hair'");
        console.log(`Deleted ${deleted.changes} existing hair services`);

        // Insert all new services
        for (const service of services) {
            const id = uuidv4();
            await runQuery(
                `INSERT INTO services (id, name, description, price, duration, service_type, category, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, service.name, service.description, service.price, 60, 'hair', service.category, 1]
            );
        }

        console.log(`\nSuccessfully inserted ${services.length} hair services!`);

        // Verify
        const count = await getAll("SELECT COUNT(*) as count FROM services WHERE service_type = 'hair'");
        console.log(`Total hair services in database: ${count[0].count}`);

        // List categories
        const cats = await getAll("SELECT name, (SELECT COUNT(*) FROM services WHERE category = sc.name AND service_type = 'hair') as count FROM service_categories sc WHERE service_type_id = ?", [hairTypeId]);
        console.log('\nServices by category:');
        cats.forEach(c => console.log(`  ${c.name}: ${c.count} services`));

    } catch (err) {
        console.error('Error seeding services:', err);
        process.exit(1);
    } finally {
        db.close();
    }
}

seedServices();
