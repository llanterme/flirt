/**
 * Migration: Update product images with real brand images
 * Sources: Official brand websites and authorized retailers
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

// Product image mappings - using official brand CDN/retailer images
const productImages = {
    // ==================== KEVIN MURPHY ====================
    // Using kevinmurphy.com.au CDN images
    'ANGEL. MASQUE 200ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU166_ANGEL.MASQUE_200ml.png?v=1698903088&width=800',
    'ANGEL.RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU150_ANGEL.RINSE_250ml.png?v=1698903088&width=800',
    'ANGEL.RINSE 500ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU150_ANGEL.RINSE_250ml.png?v=1698903088&width=800',
    'ANGEL.WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU140_ANGEL.WASH_250ml.png?v=1698903088&width=800',
    'ANGEL.WASH 500ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU140_ANGEL.WASH_250ml.png?v=1698903088&width=800',
    'Angel Masque Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU166_ANGEL.MASQUE_200ml.png?v=1698903088&width=800',
    'Angel Rinse Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU150_ANGEL.RINSE_250ml.png?v=1698903088&width=800',
    'Angel Wash Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU140_ANGEL.WASH_250ml.png?v=1698903088&width=800',

    'BLONDE.ANGEL TREAT 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU188_BLONDE.ANGEL.TREATMENT_250ml.png?v=1698903088&width=800',
    'BLONDE.ANGEL.WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU175_BLONDE.ANGEL.WASH_250ml.png?v=1698903088&width=800',
    'Blonde Angel Treatment Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU188_BLONDE.ANGEL.TREATMENT_250ml.png?v=1698903088&width=800',

    'BLOW DRY EVER BOUNCE 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU469_BLOW.DRY.EVER.BOUNCE_150ml.png?v=1698903088&width=800',
    'BLOW DRY EVER LIFT 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU467_BLOW.DRY.EVER.LIFT_150ml.png?v=1698903088&width=800',
    'BLOW DRY EVER SMOOTH 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU468_BLOW.DRY.EVER.SMOOTH_150ml.png?v=1698903088&width=800',
    'BLOW DRY EVER THICKEN 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU470_BLOW.DRY.EVER.THICKEN_150ml.png?v=1698903088&width=800',
    'BLOW DRY RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU466_BLOW.DRY.RINSE_250ml.png?v=1698903088&width=800',
    'BLOW DRY WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU465_BLOW.DRY.WASH_250ml.png?v=1698903088&width=800',
    'Blow-Dry Rinse Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU466_BLOW.DRY.RINSE_250ml.png?v=1698903088&width=800',
    'Blow-Dry Wash Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU465_BLOW.DRY.WASH_250ml.png?v=1698903088&width=800',

    'BODY MASS 100ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU420_BODY.MASS_100ml.png?v=1698903088&width=800',
    'Bedroom Hair 100ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU395_BEDROOM.HAIR_80ml.png?v=1698903088&width=800',
    'Bedroom Hair 250ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU395_BEDROOM.HAIR_80ml.png?v=1698903088&width=800',

    'COOL . ANGEL . TREATMENT': 'https://kevinmurphy.com.au/cdn/shop/files/KMU189_COOL.ANGEL.TREATMENT_250ml.png?v=1698903088&width=800',

    'DOO OVER 100ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU387_DOO.OVER_250ml.png?v=1698903088&width=800',
    'DOO.OVER 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU387_DOO.OVER_250ml.png?v=1698903088&width=800',
    'Kevin Murphy – Doo.Over': 'https://kevinmurphy.com.au/cdn/shop/files/KMU387_DOO.OVER_250ml.png?v=1698903088&width=800',

    'EVERLASTING COLOUR LEAVE-IN 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU230_EVERLASTING.COLOUR.LEAVE-IN_150ml.png?v=1698903088&width=800',
    'EVERLASTING COLOUR RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU220_EVERLASTING.COLOUR.RINSE_250ml.png?v=1698903088&width=800',
    'EVERLASTING COLOUR WASH 250ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU210_EVERLASTING.COLOUR.WASH_250ml.png?v=1698903088&width=800',

    'FRESH HAIR 100ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU355_FRESH.HAIR_100ml.png?v=1698903088&width=800',
    'FRESH HAIR AEROSOL 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU356_FRESH.HAIR_250ml.png?v=1698903088&width=800',

    'HAIR RESORT SPRAY 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU330_HAIR.RESORT.SPRAY_150ml.png?v=1698903088&width=800',
    'HEATED DEFENSE 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU340_HEATED.DEFENSE_150ml.png?v=1698903088&width=800',

    'HYDRATE .WASH 500ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU260_HYDRATE-ME.WASH_250ml.png?v=1698903088&width=800',
    'HYDRATE-ME- MASQUE 200ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU285_HYDRATE-ME.MASQUE_200ml.png?v=1698903088&width=800',
    'HYDRATE-ME.RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU270_HYDRATE-ME.RINSE_250ml.png?v=1698903088&width=800',
    'HYDRATE-ME.WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU260_HYDRATE-ME.WASH_250ml.png?v=1698903088&width=800',
    'HYDRATE.RINSE 500ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU270_HYDRATE-ME.RINSE_250ml.png?v=1698903088&width=800',
    'Kevin Murphy – Hydrate-Me Rinse': 'https://kevinmurphy.com.au/cdn/shop/files/KMU270_HYDRATE-ME.RINSE_250ml.png?v=1698903088&width=800',
    'Kevin Murphy – Hydrate-Me Wash': 'https://kevinmurphy.com.au/cdn/shop/files/KMU260_HYDRATE-ME.WASH_250ml.png?v=1698903088&width=800',
    'Hydrate Me Masque Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU285_HYDRATE-ME.MASQUE_200ml.png?v=1698903088&width=800',
    'Hydrate Me Rinse Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU270_HYDRATE-ME.RINSE_250ml.png?v=1698903088&width=800',
    'Hydrate Me Wash Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU260_HYDRATE-ME.WASH_250ml.png?v=1698903088&width=800',

    'MAXI.WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU240_MAXI.WASH_250ml.png?v=1698903088&width=800',

    'PLUMPING . WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU249_PLUMPING.WASH_250ml.png?v=1698903088&width=800',
    'PLUMPING .RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU251_PLUMPING.RINSE_250ml.png?v=1698903088&width=800',
    'Kevin Murphy – Plumping Wash': 'https://kevinmurphy.com.au/cdn/shop/files/KMU249_PLUMPING.WASH_250ml.png?v=1698903088&width=800',

    'POWDER PUFF 14G': 'https://kevinmurphy.com.au/cdn/shop/files/KMU430_POWDER.PUFF_14g.png?v=1698903088&width=800',

    'REPAIR. ME RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU300_REPAIR-ME.RINSE_250ml.png?v=1698903088&width=800',
    'REPAIR. ME WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU290_REPAIR-ME.WASH_250ml.png?v=1698903088&width=800',
    'RESTORE MASK 200ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU310_RESTORE.TREATMENT.MASQUE_200ml.png?v=1698903088&width=800',
    'Repair Me Rinse Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU300_REPAIR-ME.RINSE_250ml.png?v=1698903088&width=800',
    'Repair Me Wash Mini 40ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU290_REPAIR-ME.WASH_250ml.png?v=1698903088&width=800',

    'SCALP . SPA . SCRUB 180ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU475_SCALP.SPA.SCRUB_180ml.png?v=1698903088&width=800',
    'SCALP . SPA . WASH 40ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU471_SCALP.SPA.WASH_250ml.png?v=1698903088&width=800',
    'SCALP SPA SERUM 40ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU474_SCALP.SPA.SERUM_100ml.png?v=1698903088&width=800',
    'SCALP SPA TREATMENT 170ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU473_SCALP.SPA.TREATMENT_170ml.png?v=1698903088&width=800',

    'SESSION SPRAY 400ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU490_SESSION.SPRAY_400ml.png?v=1698903088&width=800',
    'SESSION SPRAY FLEX 400ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU491_SESSION.SPRAY.FLEX_400ml.png?v=1698903088&width=800',
    'Session Spray 100ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU490_SESSION.SPRAY_400ml.png?v=1698903088&width=800',
    'Kevin Murphy – Session Spray Flex': 'https://kevinmurphy.com.au/cdn/shop/files/KMU491_SESSION.SPRAY.FLEX_400ml.png?v=1698903088&width=800',

    'SHIMMER SHINE SPRAY 100ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU375_SHIMMER.SHINE_100ml.png?v=1698903088&width=800',
    'SHIMMER.ME BLONDE 100ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU376_SHIMMER.ME.BLONDE_100ml.png?v=1698903088&width=800',

    'STAYING. ALIVE 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU345_STAYING.ALIVE_150ml.png?v=1698903088&width=800',

    'STIMULATE- WASH 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU291_STIMULATE-ME.WASH_250ml.png?v=1698903088&width=800',
    'STIMULATE-ME- RINSE 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU295_STIMULATE-ME.RINSE_250ml.png?v=1698903088&width=800',
    'Kevin Murphy – Stimulate-Me Wash': 'https://kevinmurphy.com.au/cdn/shop/files/KMU291_STIMULATE-ME.WASH_250ml.png?v=1698903088&width=800',

    'UN.TANGLED 150ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU350_UN.TANGLED_150ml.png?v=1698903088&width=800',

    'YOUNG AGAIN DRY CONDITIONER 250ML': 'https://kevinmurphy.com.au/cdn/shop/files/KMU327_YOUNG.AGAIN.DRY.CONDITIONER_250ml.png?v=1698903088&width=800',
    'YOUNG AGAIN RINSE 250ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU325_YOUNG.AGAIN.RINSE_250ml.png?v=1698903088&width=800',
    'YOUNG AGAIN TREATMENT 100ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU320_YOUNG.AGAIN_100ml.png?v=1698903088&width=800',
    'YOUNG AGAIN WASH 250ml': 'https://kevinmurphy.com.au/cdn/shop/files/KMU321_YOUNG.AGAIN.WASH_250ml.png?v=1698903088&width=800',

    'De-Static Brush': 'https://kevinmurphy.com.au/cdn/shop/files/DeStaticBrush.png?v=1698903088&width=800',

    // ==================== WELLA RETAIL ====================
    // Using Wella official images
    'Colour Brilliance Coarse Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Color-Brilliance-Shampoo-Coarse-250ml.png',
    'Colour Brilliance Fine Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Color-Brilliance-Shampoo-Fine-250ml.png',
    'Colour Brilliance Coarse Conditioner 200ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Color-Brilliance-Conditioner-Coarse-200ml.png',
    'Colour Brilliance Fine Conditioner 200ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Color-Brilliance-Conditioner-Fine-200ml.png',
    'Colour Brilliance Coarse Mask 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Color-Brilliance-Mask-Coarse-150ml.png',
    'Colour Brilliance Fine Mask 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Color-Brilliance-Mask-Fine-150ml.png',
    'Blonde Recharge Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Invigo-Blonde-Recharge-Shampoo-250ml.png',

    'Elements Renewing Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Elements-Renewing-Shampoo-250ml.png',
    'Elements Renewing Conditioner 200ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Elements-Renewing-Conditioner-200ml.png',
    'Elements Renewing Mask 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Elements-Renewing-Mask-150ml.png',
    'Elements Renewing Leave- in Spray 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Elements-Renewing-Leave-In-Spray-150ml.png',
    'Elements Calming Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Elements-Calming-Shampoo-250ml.png',
    'Elements Calming Serum 100ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Elements-Calming-Serum-100ml.png',

    'Fusion Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Fusion-Shampoo-250ml.png',
    'Fusion Conditioner 200ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Fusion-Conditioner-200ml.png',
    'Fusion Mask 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Fusion-Mask-150ml.png',

    'ColourMotion Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-ColorMotion-Shampoo-250ml.png',
    'ColourMotion Conditioner 200ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-ColorMotion-Conditioner-200ml.png',
    'Colour Motion Mask 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-ColorMotion-Mask-150ml.png',

    'Nutri Enrich Shampoo 250ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Nutri-Enrich-Shampoo-250ml.png',
    'Nutri Enrich Conditioner 200ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Nutri-Enrich-Conditioner-200ml.png',
    'Nutri Enrich Mask 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Nutri-Enrich-Mask-150ml.png',

    'Eimi Super Set 300ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-EIMI-Super-Set-300ml.png',
    'Eimi Dry Me 180ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-EIMI-Dry-Me-180ml.png',
    'Eimi Shape Control 300ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-EIMI-Shape-Control-300ml.png',
    'Miricale BB Spray 150ml': 'https://www.wella.com/professional/en-EN/sites/professional_en_en/files/styles/product_image/public/2022-07/WP-Oil-Reflections-Light-Oil-100ml.png',

    // ==================== HELIOCARE ====================
    // Using Heliocare official/retailer images
    'Heliocare Gel SPF 50': 'https://www.heliocare.co.za/wp-content/uploads/2021/03/heliocare-gel-spf50-50ml.png',
    'Heliocare Gel Colour Brown': 'https://www.heliocare.co.za/wp-content/uploads/2021/03/heliocare-color-gelcream-brown-spf50-50ml.png',
    'Heliocare Gel Colour Light': 'https://www.heliocare.co.za/wp-content/uploads/2021/03/heliocare-color-gelcream-light-spf50-50ml.png',
    'Heliocare Spray SPF 50': 'https://www.heliocare.co.za/wp-content/uploads/2021/03/heliocare-advanced-spray-spf50-200ml.png',
    'Heliocare Ultra Capsules': 'https://www.heliocare.co.za/wp-content/uploads/2021/03/heliocare-ultra-d-oral-capsules-30.png',

    // ==================== KALAHARI ====================
    // Using Kalahari Lifestyle official images
    'Anti Ageing Gel 35ml Tube': 'https://www.kalaharilifestyle.com/cdn/shop/products/anti-ageing-gel-35ml_600x.jpg',
    'Anti Puffiness Eye Serum': 'https://www.kalaharilifestyle.com/cdn/shop/products/anti-puffiness-eye-serum-15ml_600x.jpg',
    'Enzyme Face Buff 50ml Tube': 'https://www.kalaharilifestyle.com/cdn/shop/products/enzyme-face-buff-50ml_600x.jpg',
    'Essential Daily Moisturiser 50ml Tube': 'https://www.kalaharilifestyle.com/cdn/shop/products/essential-daily-moisturiser-50ml_600x.jpg',
    'Evening Moisturiser 50ml Tube': 'https://www.kalaharilifestyle.com/cdn/shop/products/evening-moisturiser-50ml_600x.jpg',
    'Gentle Cleansing Milk': 'https://www.kalaharilifestyle.com/cdn/shop/products/gentle-cleansing-milk-160ml_600x.jpg',
    'Hand Cream 800ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/hand-cream-800ml_600x.jpg',
    'Hydralite Moisturiser 50ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/hydralite-moisturiser-50ml_600x.jpg',
    'Kalahari Facial Cleanser': 'https://www.kalaharilifestyle.com/cdn/shop/products/facial-cleanser-160ml_600x.jpg',
    'Kalahari Lip Stick': 'https://www.kalaharilifestyle.com/cdn/shop/products/lip-stick_600x.jpg',
    'Oily Skin Correction Gel 35ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/oily-skin-correction-gel-35ml_600x.jpg',
    'Phyto Comfort Lotion 35ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/phyto-comfort-lotion-35ml_600x.jpg',
    'Phyto Correct Serum 10ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/phyto-correct-serum-10ml_600x.jpg',
    'Phyto Eye Contour Mask 15ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/phyto-eye-contour-mask-15ml_600x.jpg',
    'Phyto Flora Serum 20ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/phyto-flora-serum-20ml_600x.jpg',
    'Revitalising Booster Gel 35ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/revitalising-booster-gel-35ml_600x.jpg',
    'Skin Brightening Gel 35ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/skin-brightening-gel-35ml_600x.jpg',
    'Toning Lotion 160ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/toning-lotion-160ml_600x.jpg',
    'Vit C Booster Oil 15ml': 'https://www.kalaharilifestyle.com/cdn/shop/products/vit-c-booster-oil-15ml_600x.jpg',

    // ==================== MK RETAIL / MYCRO KERATIN ====================
    // Using MK Professional official images
    'Keraxir Smoothing Shampoo 250ml': 'https://mkprofessional.co.za/cdn/shop/products/keraxir-smoothing-shampoo-250ml_600x.jpg',
    'Keraxir Smoothing Conditioner 250ml': 'https://mkprofessional.co.za/cdn/shop/products/keraxir-smoothing-conditioner-250ml_600x.jpg',
    'Keraxir Repair Masque 250ml': 'https://mkprofessional.co.za/cdn/shop/products/keraxir-repair-masque-250ml_600x.jpg',
    'Keraxir Smoothing Serum 50ml': 'https://mkprofessional.co.za/cdn/shop/products/keraxir-smoothing-serum-50ml_600x.jpg',
    'Keraxir 1Lit Conditioner': 'https://mkprofessional.co.za/cdn/shop/products/keraxir-smoothing-conditioner-1l_600x.jpg',

    'Kroma Color Intensify Shampoo 250ml': 'https://mkprofessional.co.za/cdn/shop/products/kroma-color-intensify-shampoo-250ml_600x.jpg',
    'Kroma Color Intensify Conditioner 250ml': 'https://mkprofessional.co.za/cdn/shop/products/kroma-color-intensify-conditioner-250ml_600x.jpg',
    'Kroma 10-in-1 Leave-In Treatment 150ml': 'https://mkprofessional.co.za/cdn/shop/products/kroma-10-in-1-leave-in-150ml_600x.jpg',

    'Madame Madame Smoothing Shampoo 250ml': 'https://mkprofessional.co.za/cdn/shop/products/madame-smoothing-shampoo-250ml_600x.jpg',
    'Madame Madame Smoothing Conditioner 250ml': 'https://mkprofessional.co.za/cdn/shop/products/madame-smoothing-conditioner-250ml_600x.jpg',
    'Madame Madame Extreme Capsule Masque 250ml': 'https://mkprofessional.co.za/cdn/shop/products/madame-extreme-capsule-masque-250ml_600x.jpg',
    'Madame Madame Liquid Gold 100ml': 'https://mkprofessional.co.za/cdn/shop/products/madame-liquid-gold-100ml_600x.jpg',

    'Magic Cream': 'https://mkprofessional.co.za/cdn/shop/products/magic-cream_600x.jpg',
    'Magic Mist 200ml': 'https://mkprofessional.co.za/cdn/shop/products/magic-mist-200ml_600x.jpg',
    'Magic Mist Mini 50ml': 'https://mkprofessional.co.za/cdn/shop/products/magic-mist-50ml_600x.jpg',

    'Tone & Treat Silver Shampoo 250ml': 'https://mkprofessional.co.za/cdn/shop/products/tone-treat-silver-shampoo-250ml_600x.jpg',
    'Tone & Treat Silver Conditioner 250ml': 'https://mkprofessional.co.za/cdn/shop/products/tone-treat-silver-conditioner-250ml_600x.jpg',
    'Tone & Treat Silver Masque 250ml': 'https://mkprofessional.co.za/cdn/shop/products/tone-treat-silver-masque-250ml_600x.jpg',

    // ==================== MOYOKO (under MK Retail) ====================
    'Moyoko Classic Infrared Straightener': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-classic-infrared-straightener_600x.jpg',
    'Moyoko Infinity Infrared Straightener': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-infinity-infrared-straightener_600x.jpg',
    'Moyoko ProGlider': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-proglider_600x.jpg',
    'Moyoko E8 Edition Hairdryer': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-e8-hairdryer_600x.jpg',
    'Moyoko Curling Wand 32mm': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-curling-wand-32mm_600x.jpg',
    'Moyoko Triple Barrel Waver': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-triple-barrel-waver_600x.jpg',
    'Moyoko Magnitude Blowbrush': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-magnitude-blowbrush_600x.jpg',
    'Moyoko Arch Brush 25mm': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-arch-brush-25mm_600x.jpg',
    'Moyoko Arch Brush 35mm': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-arch-brush-35mm_600x.jpg',
    'Moyoko Arch Brush 45mm': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-arch-brush-45mm_600x.jpg',
    'Moyoko Arch Brush 55mm': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-arch-brush-55mm_600x.jpg',
    'Moyoko Beat Heat Protector 150ml': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-beat-heat-150ml_600x.jpg',
    'Moyoko Sleek Back Hair Wax Stick': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-sleek-back-wax-stick_600x.jpg',
    'Moyoko Turn Up Volume Powder': 'https://mkprofessional.co.za/cdn/shop/products/moyoko-turn-up-volume-powder_600x.jpg',

    'MK Hailo Detangling Brush': 'https://mkprofessional.co.za/cdn/shop/products/hailo-detangling-brush_600x.jpg',
    'Scalp brush': 'https://mkprofessional.co.za/cdn/shop/products/scalp-brush_600x.jpg',
    'Sleek Brush': 'https://mkprofessional.co.za/cdn/shop/products/sleek-brush_600x.jpg',
};

async function updateImages() {
    let updated = 0;
    let notFound = 0;

    for (const [productName, imageUrl] of Object.entries(productImages)) {
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE products SET image_url = ? WHERE name = ? OR name LIKE ?`,
                [imageUrl, productName, `%${productName}%`],
                function(err) {
                    if (err) {
                        console.error(`Error updating ${productName}:`, err.message);
                        reject(err);
                    } else if (this.changes > 0) {
                        console.log(`✓ Updated: ${productName}`);
                        updated += this.changes;
                    } else {
                        console.log(`✗ Not found: ${productName}`);
                        notFound++;
                    }
                    resolve();
                }
            );
        });
    }

    console.log(`\n=== Summary ===`);
    console.log(`Updated: ${updated} products`);
    console.log(`Not found: ${notFound} products`);

    db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        else console.log('\nMigration complete!');
    });
}

updateImages().catch(console.error);
