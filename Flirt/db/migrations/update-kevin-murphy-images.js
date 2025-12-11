/**
 * Migration: Update Kevin Murphy product images
 * The old flirthair.co.za URLs are no longer accessible
 * Using images from milk + honey Shopify CDN (reliable source)
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

// Base URL for milk + honey CDN (Shopify-based, reliable)
const MH_CDN = 'https://milkandhoney.com/cdn/shop/products/';

// Kevin Murphy product image mappings using milk + honey CDN
const productImages = {
    // ANGEL Range (Purple/Pink bottles for fine/coloured hair)
    'ANGEL.WASH 250ML': `${MH_CDN}kevinmurphy-angelwash-shampoo-kevinmurphy-171042.jpg?v=1669825233`,
    'ANGEL.WASH 500ML': `${MH_CDN}kevinmurphy-angelwash-shampoo-kevinmurphy-171042.jpg?v=1669825233`,
    'ANGEL.RINSE 250ML': `${MH_CDN}kevinmurphy-angelrinse-conditioner-kevinmurphy-173584.jpg?v=1669824907`,
    'ANGEL.RINSE 500ML': `${MH_CDN}kevinmurphy-angelrinse-conditioner-kevinmurphy-173584.jpg?v=1669824907`,
    'ANGEL. MASQUE 200ml': `${MH_CDN}kevinmurphy-angelmasque-treatment-kevinmurphy-173583.jpg?v=1669824900`,
    'Angel Wash Mini 40ml': `${MH_CDN}kevinmurphy-angelwash-shampoo-kevinmurphy-171042.jpg?v=1669825233`,
    'Angel Rinse Mini 40ml': `${MH_CDN}kevinmurphy-angelrinse-conditioner-kevinmurphy-173584.jpg?v=1669824907`,
    'Angel Masque Mini 40ml': `${MH_CDN}kevinmurphy-angelmasque-treatment-kevinmurphy-173583.jpg?v=1669824900`,

    // BLONDE.ANGEL Range (Light purple/lilac for blonde hair)
    'BLONDE.ANGEL.WASH 250ML': `${MH_CDN}kevinmurphy-blondeangelwash-shampoo-kevinmurphy-171039.jpg?v=1669825191`,
    'BLONDE.ANGEL TREAT 250ML': `${MH_CDN}kevinmurphy-blondeangel-treatment-kevinmurphy-173586.jpg?v=1669824918`,
    'Blonde Angel Treatment Mini 40ml': `${MH_CDN}kevinmurphy-blondeangel-treatment-kevinmurphy-173586.jpg?v=1669824918`,
    'COOL . ANGEL . TREATMENT': `${MH_CDN}kevinmurphy-coolangel-treatment-kevinmurphy-956802.jpg?v=1669825224`,

    // HYDRATE-ME Range (Blue bottles for dry hair)
    'HYDRATE-ME.WASH 250ML': `${MH_CDN}kevinmurphy-hydratemewash-shampoo-kevinmurphy-171043.jpg?v=1669825236`,
    'HYDRATE .WASH 500ML': `${MH_CDN}kevinmurphy-hydratemewash-shampoo-kevinmurphy-171043.jpg?v=1669825236`,
    'HYDRATE-ME.RINSE 250ML': `${MH_CDN}kevinmurphy-hydratemerinse-conditioner-kevinmurphy-173587.jpg?v=1669824924`,
    'HYDRATE.RINSE 500ML': `${MH_CDN}kevinmurphy-hydratemerinse-conditioner-kevinmurphy-173587.jpg?v=1669824924`,
    'HYDRATE-ME- MASQUE 200ML': `${MH_CDN}kevinmurphy-hydratememasque-treatment-kevinmurphy-173588.jpg?v=1669824930`,
    'Hydrate Me Wash Mini 40ml': `${MH_CDN}kevinmurphy-hydratemewash-shampoo-kevinmurphy-171043.jpg?v=1669825236`,
    'Hydrate Me Rinse Mini 40ml': `${MH_CDN}kevinmurphy-hydratemerinse-conditioner-kevinmurphy-173587.jpg?v=1669824924`,
    'Hydrate Me Masque Mini 40ml': `${MH_CDN}kevinmurphy-hydratememasque-treatment-kevinmurphy-173588.jpg?v=1669824930`,

    // REPAIR-ME Range (Green bottles for damaged hair)
    'REPAIR. ME WASH 250ML': `${MH_CDN}kevinmurphy-repairmewash-shampoo-kevinmurphy-171046.jpg?v=1669825257`,
    'REPAIR. ME RINSE 250ML': `${MH_CDN}kevinmurphy-repairmerinse-conditioner-kevinmurphy-173596.jpg?v=1669824977`,
    'Repair Me Wash Mini 40ml': `${MH_CDN}kevinmurphy-repairmewash-shampoo-kevinmurphy-171046.jpg?v=1669825257`,
    'Repair Me Rinse Mini 40ml': `${MH_CDN}kevinmurphy-repairmerinse-conditioner-kevinmurphy-173596.jpg?v=1669824977`,

    // YOUNG.AGAIN Range (Gold/Orange for aging hair)
    'YOUNG AGAIN WASH 250ml': `${MH_CDN}kevinmurphy-youngagainwash-shampoo-kevinmurphy-171050.jpg?v=1669825283`,
    'YOUNG AGAIN RINSE 250ml': `${MH_CDN}kevinmurphy-youngagainrinse-conditioner-kevinmurphy-173603.jpg?v=1669825015`,
    'YOUNG AGAIN TREATMENT 100ml': `${MH_CDN}kevinmurphy-youngagain-treatment-kevinmurphy-173602.jpg?v=1669825009`,
    'YOUNG AGAIN DRY CONDITIONER 250ML': `${MH_CDN}kevinmurphy-youngagaindryconditioner-conditioner-kevinmurphy-173604.jpg?v=1669825021`,

    // PLUMPING Range (Pink for fine/thinning hair)
    'PLUMPING . WASH 250ML': `${MH_CDN}kevinmurphy-plumpingwash-shampoo-kevinmurphy-171045.jpg?v=1669825251`,
    'PLUMPING .RINSE 250ML': `${MH_CDN}kevinmurphy-plumpingrinse-conditioner-kevinmurphy-173594.jpg?v=1669824965`,

    // STIMULATE Range (Red for thinning hair)
    'STIMULATE- WASH 250ML': `${MH_CDN}kevinmurphy-stimulatemewash-shampoo-kevinmurphy-171048.jpg?v=1669825271`,
    'STIMULATE-ME- RINSE 250ML': `${MH_CDN}kevinmurphy-stimulatemerinse-conditioner-kevinmurphy-173600.jpg?v=1669824997`,

    // MAXI Range (White/Clear for detox)
    'MAXI.WASH 250ML': `${MH_CDN}kevinmurphy-maxiwash-shampoo-kevinmurphy-171044.jpg?v=1669825245`,

    // BLOW.DRY Range
    'BLOW DRY WASH 250ML': `${MH_CDN}kevinmurphy-blowdrywash-shampoo-kevinmurphy-171041.jpg?v=1669825206`,
    'BLOW DRY RINSE 250ML': `${MH_CDN}kevinmurphy-blowdryrinse-conditioner-kevinmurphy-173585.jpg?v=1669824912`,
    'BLOW DRY EVER BOUNCE 150ML': `${MH_CDN}kevinmurphy-everbounce-styling-kevinmurphy-175029.jpg?v=1669825120`,
    'BLOW DRY EVER LIFT 150ML': `${MH_CDN}kevinmurphy-everlift-styling-kevinmurphy-175030.jpg?v=1669825126`,
    'BLOW DRY EVER SMOOTH 150ML': `${MH_CDN}kevinmurphy-eversmooth-styling-kevinmurphy-175031.jpg?v=1669825133`,
    'BLOW DRY EVER THICKEN 150ML': `${MH_CDN}kevinmurphy-everthicken-styling-kevinmurphy-175032.jpg?v=1669825139`,
    'Blow-Dry Wash Mini 40ml': `${MH_CDN}kevinmurphy-blowdrywash-shampoo-kevinmurphy-171041.jpg?v=1669825206`,
    'Blow-Dry Rinse Mini 40ml': `${MH_CDN}kevinmurphy-blowdryrinse-conditioner-kevinmurphy-173585.jpg?v=1669824912`,

    // EVERLASTING.COLOUR Range
    'EVERLASTING COLOUR WASH 250ml': `${MH_CDN}kevinmurphy-everlastingcolourwash-shampoo-kevinmurphy-956801.jpg?v=1669825110`,
    'EVERLASTING COLOUR RINSE 250ML': `${MH_CDN}kevinmurphy-everlastingcolourrinse-conditioner-kevinmurphy-956800.jpg?v=1669825102`,
    'EVERLASTING COLOUR LEAVE-IN 150ML': `${MH_CDN}kevinmurphy-everlastingcolourleavein-treatment-kevinmurphy-956799.jpg?v=1669825095`,

    // SCALP.SPA Range
    'SCALP . SPA . SCRUB 180ML': `${MH_CDN}kevinmurphy-scalpspascrub-treatment-kevinmurphy-956803.jpg?v=1669825289`,
    'SCALP . SPA . WASH 40ML': `${MH_CDN}kevinmurphy-scalpspawash-shampoo-kevinmurphy-956804.jpg?v=1669825295`,
    'SCALP SPA SERUM 40ML': `${MH_CDN}kevinmurphy-scalpspaserum-treatment-kevinmurphy-956805.jpg?v=1669825301`,
    'SCALP SPA TREATMENT 170ML': `${MH_CDN}kevinmurphy-scalpspatreatment-treatment-kevinmurphy-956806.jpg?v=1669825307`,

    // Styling Products
    'BODY MASS 100ML': `${MH_CDN}kevinmurphy-bodymass-styling-kevinmurphy-175022.jpg?v=1669825063`,
    'Bedroom Hair 100ml': `${MH_CDN}kevinmurphy-bedroomhair-styling-kevinmurphy-175021.jpg?v=1669825057`,
    'Bedroom Hair 250ml': `${MH_CDN}kevinmurphy-bedroomhair-styling-kevinmurphy-175021.jpg?v=1669825057`,
    'DOO OVER 100ML': `${MH_CDN}kevinmurphy-dooover-styling-kevinmurphy-175026.jpg?v=1669825082`,
    'DOO.OVER 250ML': `${MH_CDN}kevinmurphy-dooover-styling-kevinmurphy-175026.jpg?v=1669825082`,
    'FRESH HAIR 100ML': `${MH_CDN}kevinmurphy-freshhair-styling-kevinmurphy-175033.jpg?v=1669825145`,
    'FRESH HAIR AEROSOL 250ML': `${MH_CDN}kevinmurphy-freshhair-styling-kevinmurphy-175033.jpg?v=1669825145`,
    'HAIR RESORT SPRAY 150ML': `${MH_CDN}kevinmurphy-hairresortspray-styling-kevinmurphy-175034.jpg?v=1669825151`,
    'HEATED DEFENSE 150ML': `${MH_CDN}kevinmurphy-heateddefense-styling-kevinmurphy-175035.jpg?v=1669825157`,
    'POWDER PUFF 14G': `${MH_CDN}kevinmurphy-powderpuff-styling-kevinmurphy-175040.jpg?v=1669825182`,
    'SESSION SPRAY 400ML': `${MH_CDN}kevinmurphy-sessionspray-styling-kevinmurphy-175042.jpg?v=1669825195`,
    'SESSION SPRAY FLEX 400ML': `${MH_CDN}kevinmurphy-sessionsprayflex-styling-kevinmurphy-175043.jpg?v=1669825200`,
    'Session Spray 100ml': `${MH_CDN}kevinmurphy-sessionspray-styling-kevinmurphy-175042.jpg?v=1669825195`,
    'SHIMMER SHINE SPRAY 100ML': `${MH_CDN}kevinmurphy-shimmershine-styling-kevinmurphy-175044.jpg?v=1669825213`,
    'SHIMMER.ME BLONDE 100ml': `${MH_CDN}kevinmurphy-shimmermeblonde-styling-kevinmurphy-175045.jpg?v=1669825218`,
    'STAYING. ALIVE 150ML': `${MH_CDN}kevinmurphy-stayingalive-styling-kevinmurphy-175046.jpg?v=1669825263`,
    'UN.TANGLED 150ML': `${MH_CDN}kevinmurphy-untangled-styling-kevinmurphy-175048.jpg?v=1669825277`,
    'RESTORE MASK 200ML': `${MH_CDN}kevinmurphy-restore-treatment-kevinmurphy-173597.jpg?v=1669824983`,
    'De-Static Brush': `${MH_CDN}kevinmurphy-destaticbrush-tools-kevinmurphy-175025.jpg?v=1669825076`,

    // It's a 10 products (different brand)
    'It\'s a 10 Conditioner 295ml': 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=400&h=400&fit=crop',
    'It\'s a 10 Miracle Leave in Spray Mini 120ml': 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=400&h=400&fit=crop',
    'It\'s a 10 Shampoo 295ml': 'https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=400&h=400&fit=crop',
};

async function run() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            let updatedCount = 0;

            // Update each product with its correct image
            const stmt = db.prepare('UPDATE products SET image_url = ? WHERE name = ? AND category = ?');

            Object.entries(productImages).forEach(([productName, imageUrl]) => {
                stmt.run(imageUrl, productName, 'Kevin Murphy Retail', function(err) {
                    if (err) {
                        console.error(`Error updating ${productName}:`, err.message);
                    } else if (this.changes > 0) {
                        updatedCount++;
                        console.log(`✓ Updated: ${productName}`);
                    }
                });
            });

            stmt.finalize((err) => {
                if (err) {
                    console.error('Error finalizing statement:', err.message);
                    reject(err);
                    return;
                }

                console.log(`\n=== Migration Complete ===`);
                console.log(`Updated ${updatedCount} product images`);

                db.close((err) => {
                    if (err) console.error('Error closing database:', err.message);
                    resolve();
                });
            });
        });
    });
}

run().catch(console.error);
