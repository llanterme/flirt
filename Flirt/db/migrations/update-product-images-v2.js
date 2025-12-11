/**
 * Migration: Update product images with working URLs
 * Using reliable CDN sources (Unsplash for placeholders, brand official images where available)
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

// Generate professional product image URLs using Unsplash/Pexels style images
// These are reliable CDN-hosted images that will always load

const brandImages = {
    // Kevin Murphy - Black/dark packaging with elegant styling
    'Kevin Murphy': 'https://images.unsplash.com/photo-1522338140262-f46f5913618a?w=600&h=600&fit=crop&q=80',
    'Kevin Murphy Retail': 'https://images.unsplash.com/photo-1522338140262-f46f5913618a?w=600&h=600&fit=crop&q=80',

    // Wella - Professional red/burgundy styling
    'Wella Retail': 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600&h=600&fit=crop&q=80',

    // Heliocare - Sun protection/skincare
    'Heliocare Retail': 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&h=600&fit=crop&q=80',

    // Kalahari - Natural/organic skincare
    'Kalahari Retail': 'https://images.unsplash.com/photo-1570194065650-d99fb4b38b9f?w=600&h=600&fit=crop&q=80',

    // MK Retail - Modern styling tools and products
    'MK Retail': 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?w=600&h=600&fit=crop&q=80',
};

// Specific product type images
const productTypeImages = {
    // Shampoos
    'shampoo': 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=600&h=600&fit=crop&q=80',
    'wash': 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=600&h=600&fit=crop&q=80',

    // Conditioners
    'conditioner': 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600&h=600&fit=crop&q=80',
    'rinse': 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=600&h=600&fit=crop&q=80',

    // Masks/Treatments
    'mask': 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&h=600&fit=crop&q=80',
    'masque': 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&h=600&fit=crop&q=80',
    'treatment': 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&h=600&fit=crop&q=80',

    // Sprays/Styling
    'spray': 'https://images.unsplash.com/photo-1626015365107-aa6f2f0c5f0d?w=600&h=600&fit=crop&q=80',
    'session': 'https://images.unsplash.com/photo-1626015365107-aa6f2f0c5f0d?w=600&h=600&fit=crop&q=80',

    // Serums/Oils
    'serum': 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600&h=600&fit=crop&q=80',
    'oil': 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600&h=600&fit=crop&q=80',

    // Hair tools - straighteners, dryers
    'straightener': 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=600&fit=crop&q=80',
    'hairdryer': 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=600&fit=crop&q=80',
    'dryer': 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=600&fit=crop&q=80',
    'wand': 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=600&fit=crop&q=80',
    'curling': 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=600&fit=crop&q=80',

    // Brushes
    'brush': 'https://images.unsplash.com/photo-1590159763121-7c9fd312190d?w=600&h=600&fit=crop&q=80',

    // SPF/Sunscreen
    'spf': 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&h=600&fit=crop&q=80',
    'heliocare': 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&h=600&fit=crop&q=80',

    // Skincare
    'moisturiser': 'https://images.unsplash.com/photo-1570194065650-d99fb4b38b9f?w=600&h=600&fit=crop&q=80',
    'moisturizer': 'https://images.unsplash.com/photo-1570194065650-d99fb4b38b9f?w=600&h=600&fit=crop&q=80',
    'cleanser': 'https://images.unsplash.com/photo-1556228841-a3c527ebefe5?w=600&h=600&fit=crop&q=80',
    'gel': 'https://images.unsplash.com/photo-1556228841-a3c527ebefe5?w=600&h=600&fit=crop&q=80',

    // Powder/Styling products
    'powder': 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&h=600&fit=crop&q=80',
    'pomade': 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&h=600&fit=crop&q=80',

    // Default hair product
    'default': 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?w=600&h=600&fit=crop&q=80'
};

function getImageForProduct(name, category) {
    const nameLower = name.toLowerCase();

    // Check product type keywords
    for (const [keyword, url] of Object.entries(productTypeImages)) {
        if (nameLower.includes(keyword)) {
            return url;
        }
    }

    // Fall back to brand image
    if (brandImages[category]) {
        return brandImages[category];
    }

    // Default
    return productTypeImages.default;
}

async function updateImages() {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, name, category FROM products WHERE available_online = 1', [], (err, products) => {
            if (err) {
                reject(err);
                return;
            }

            console.log(`Found ${products.length} products to update`);

            let updated = 0;
            let pending = products.length;

            products.forEach(product => {
                const imageUrl = getImageForProduct(product.name, product.category);

                db.run('UPDATE products SET image_url = ? WHERE id = ?', [imageUrl, product.id], function(err) {
                    if (err) {
                        console.error(`Error updating ${product.name}:`, err.message);
                    } else {
                        updated++;
                    }

                    pending--;
                    if (pending === 0) {
                        console.log(`\nUpdated ${updated} products with working images`);

                        // Checkpoint WAL
                        db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
                            if (err) console.error('WAL checkpoint error:', err);
                            else console.log('WAL checkpoint complete');
                            db.close();
                            resolve();
                        });
                    }
                });
            });
        });
    });
}

updateImages().catch(console.error);
