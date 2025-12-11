/**
 * Migration: Update product images using flirthair.co.za URLs
 * Based on existing image patterns found in the codebase
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'flirt.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Failed to connect to database:', err.message);
        process.exit(1);
    }
    console.log('Connected to database:', DB_PATH);
});

// Flirthair.co.za product image mappings
// Based on actual URLs found in the codebase
const flirtHairImages = {
    // ==================== KEVIN MURPHY ====================
    // From flirthair.co.za/wp-content/uploads/2023/03/
    'Kevin Murphy – Doo.Over': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU387_DOO.OVER_250ml-02-300x300.png',
    'DOO.OVER 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU387_DOO.OVER_250ml-02-300x300.png',
    'DOO OVER 100ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU387_DOO.OVER_250ml-02-300x300.png',

    'Kevin Murphy – Plumping Wash': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU249_PLUMPING.WASH_250ml-03-300x300.png',
    'PLUMPING . WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU249_PLUMPING.WASH_250ml-03-300x300.png',
    'PLUMPING .RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU251_PLUMPING.RINSE_250ml-300x300.png',

    'Kevin Murphy – Session Spray Flex': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU491_SESSION.SPRAY_FLEX_400ML_EU-02-300x300.png',
    'SESSION SPRAY FLEX 400ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU491_SESSION.SPRAY_FLEX_400ML_EU-02-300x300.png',
    'SESSION SPRAY 400ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU490_SESSION.SPRAY_400ml-300x300.png',
    'Session Spray 100ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU490_SESSION.SPRAY_400ml-300x300.png',

    'Kevin Murphy – Stimulate-Me Wash': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU291_STIMULATE-ME.WASH_250ml-03-300x300.png',
    'STIMULATE- WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU291_STIMULATE-ME.WASH_250ml-03-300x300.png',
    'STIMULATE-ME- RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU295_STIMULATE-ME.RINSE_250ml-300x300.png',

    'Kevin Murphy – Hydrate-Me Wash': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.WASH_250ml-300x300.png',
    'HYDRATE-ME.WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.WASH_250ml-300x300.png',
    'HYDRATE .WASH 500ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.WASH_250ml-300x300.png',

    'Kevin Murphy – Hydrate-Me Rinse': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.RINSE_250ml-300x300.png',
    'HYDRATE-ME.RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.RINSE_250ml-300x300.png',
    'HYDRATE.RINSE 500ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.RINSE_250ml-300x300.png',
    'Hydrate Me Wash Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.WASH_250ml-300x300.png',
    'Hydrate Me Rinse Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.RINSE_250ml-300x300.png',
    'HYDRATE-ME- MASQUE 200ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.MASQUE_200ml-300x300.png',
    'Hydrate Me Masque Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.MASQUE_200ml-300x300.png',

    // Angel range
    'ANGEL.WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-Angel-300x300.png',
    'ANGEL.WASH 500ML': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-Angel-300x300.png',
    'Angel Wash Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-Angel-300x300.png',
    'ANGEL.RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/ANGEL.RINSE_250ml-300x300.png',
    'ANGEL.RINSE 500ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/ANGEL.RINSE_250ml-300x300.png',
    'Angel Rinse Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/ANGEL.RINSE_250ml-300x300.png',
    'ANGEL. MASQUE 200ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/ANGEL.MASQUE_200ml-300x300.png',
    'Angel Masque Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/ANGEL.MASQUE_200ml-300x300.png',

    // Blonde Angel range
    'BLONDE.ANGEL.WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLONDE.ANGEL.WASH_250ml-300x300.png',
    'BLONDE.ANGEL TREAT 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLONDE.ANGEL.TREATMENT_250ml-300x300.png',
    'Blonde Angel Treatment Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLONDE.ANGEL.TREATMENT_250ml-300x300.png',
    'COOL . ANGEL . TREATMENT': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/COOL.ANGEL.TREATMENT_250ml-300x300.png',

    // Repair range
    'REPAIR. ME WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/REPAIR-ME.WASH_250ml-300x300.png',
    'Repair Me Wash Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/REPAIR-ME.WASH_250ml-300x300.png',
    'REPAIR. ME RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/REPAIR-ME.RINSE_250ml-300x300.png',
    'Repair Me Rinse Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/REPAIR-ME.RINSE_250ml-300x300.png',
    'RESTORE MASK 200ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/RESTORE_200ml-300x300.png',

    // Young Again range
    'YOUNG AGAIN WASH 250ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/YOUNG.AGAIN.WASH_250ml-300x300.png',
    'YOUNG AGAIN RINSE 250ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/YOUNG.AGAIN.RINSE_250ml-300x300.png',
    'YOUNG AGAIN TREATMENT 100ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/YOUNG.AGAIN_100ml-300x300.png',
    'YOUNG AGAIN DRY CONDITIONER 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/YOUNG.AGAIN.DRY.CONDITIONER_250ml-300x300.png',

    // Blow Dry range
    'BLOW DRY WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.WASH_250ml-300x300.png',
    'Blow-Dry Wash Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.WASH_250ml-300x300.png',
    'BLOW DRY RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.RINSE_250ml-300x300.png',
    'Blow-Dry Rinse Mini 40ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.RINSE_250ml-300x300.png',
    'BLOW DRY EVER SMOOTH 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.EVER.SMOOTH_150ml-300x300.png',
    'BLOW DRY EVER LIFT 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.EVER.LIFT_150ml-300x300.png',
    'BLOW DRY EVER BOUNCE 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.EVER.BOUNCE_150ml-300x300.png',
    'BLOW DRY EVER THICKEN 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BLOW.DRY.EVER.THICKEN_150ml-300x300.png',

    // Everlasting Colour range
    'EVERLASTING COLOUR WASH 250ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/EVERLASTING.COLOUR.WASH_250ml-300x300.png',
    'EVERLASTING COLOUR RINSE 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/EVERLASTING.COLOUR.RINSE_250ml-300x300.png',
    'EVERLASTING COLOUR LEAVE-IN 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/EVERLASTING.COLOUR.LEAVE-IN_150ml-300x300.png',

    // Styling products
    'HAIR RESORT SPRAY 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HAIR.RESORT.SPRAY_150ml-300x300.png',
    'HEATED DEFENSE 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HEATED.DEFENSE_150ml-300x300.png',
    'STAYING. ALIVE 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/STAYING.ALIVE_150ml-300x300.png',
    'UN.TANGLED 150ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/UN.TANGLED_150ml-300x300.png',
    'SHIMMER SHINE SPRAY 100ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/SHIMMER.SHINE_100ml-300x300.png',
    'SHIMMER.ME BLONDE 100ml': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/SHIMMER.ME.BLONDE_100ml-300x300.png',
    'FRESH HAIR 100ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/FRESH.HAIR_100ml-300x300.png',
    'FRESH HAIR AEROSOL 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/FRESH.HAIR_250ml-300x300.png',
    'POWDER PUFF 14G': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/POWDER.PUFF_14g-300x300.png',
    'BODY MASS 100ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/BODY.MASS_100ml-300x300.png',
    'Bedroom Hair 100ml': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-09-300x300.png',
    'Bedroom Hair 250ml': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-09-300x300.png',

    // Scalp Spa range
    'SCALP . SPA . WASH 40ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/SCALP.SPA.WASH_250ml-300x300.png',
    'SCALP . SPA . SCRUB 180ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/SCALP.SPA.SCRUB_180ml-300x300.png',
    'SCALP SPA SERUM 40ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/SCALP.SPA.SERUM_100ml-300x300.png',
    'SCALP SPA TREATMENT 170ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/SCALP.SPA.TREATMENT_170ml-300x300.png',

    // Maxi Wash
    'MAXI.WASH 250ML': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/MAXI.WASH_250ml-300x300.png',

    // De-Static Brush
    'De-Static Brush': 'https://www.flirthair.co.za/wp-content/uploads/2023/03/DE-STATIC-BRUSH-300x300.png',
};

// Default images by category for products not in the mapping
const categoryDefaults = {
    'Kevin Murphy': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-Angel-300x300.png',
    'Kevin Murphy Retail': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-Angel-300x300.png',
    'Wella Retail': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories5.jpg',
    'Heliocare Retail': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories7.jpg',
    'Kalahari Retail': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories7.jpg',
    'MK Retail': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images3.jpg',
};

async function updateImages() {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, name, category FROM products WHERE available_online = 1', [], async (err, products) => {
            if (err) {
                reject(err);
                return;
            }

            console.log(`Found ${products.length} products to update`);
            let updated = 0;
            let usedDefault = 0;

            for (const product of products) {
                // Try exact match first
                let imageUrl = flirtHairImages[product.name];

                // If no exact match, try partial match
                if (!imageUrl) {
                    for (const [key, url] of Object.entries(flirtHairImages)) {
                        if (product.name.includes(key) || key.includes(product.name)) {
                            imageUrl = url;
                            break;
                        }
                    }
                }

                // Fall back to category default
                if (!imageUrl) {
                    imageUrl = categoryDefaults[product.category] || 'https://www.flirthair.co.za/wp-content/uploads/2022/03/KEVIN-MURPHY-Angel-300x300.png';
                    usedDefault++;
                }

                await new Promise((res, rej) => {
                    db.run('UPDATE products SET image_url = ? WHERE id = ?', [imageUrl, product.id], function(err) {
                        if (err) {
                            console.error(`Error updating ${product.name}:`, err.message);
                            rej(err);
                        } else {
                            updated++;
                            res();
                        }
                    });
                });
            }

            console.log(`\nUpdated ${updated} products`);
            console.log(`Products with specific images: ${updated - usedDefault}`);
            console.log(`Products using category defaults: ${usedDefault}`);

            // Checkpoint WAL
            db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
                if (err) console.error('WAL checkpoint error:', err);
                else console.log('WAL checkpoint complete');
                db.close();
                resolve();
            });
        });
    });
}

updateImages().catch(console.error);
