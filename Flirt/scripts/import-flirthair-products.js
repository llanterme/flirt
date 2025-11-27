/**
 * Import products from flirthair.co.za WooCommerce store into the local database.
 * Run with: node scripts/import-flirthair-products.js
 */

const https = require('https');
const path = require('path');
const {
    initializeDatabase,
    closeDb,
    ProductRepository
} = require('../db/database');

const BASE_URL = 'https://www.flirthair.co.za/wp-json/wc/store/products';
const PER_PAGE = 50;

const decodeEntities = (text = '') => {
    return text
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#x27;/gi, "'")
        .replace(/&#39;/gi, "'")
        .replace(/&#8211;/gi, '–')
        .replace(/&#8212;/gi, '—')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
};

const stripTags = (html = '') => html.replace(/<[^>]*>/g, ' ');

const normalizeWhitespace = (text = '') =>
    text.replace(/\s+/g, ' ').trim();

const toTitleCase = (text = '') => {
    return normalizeWhitespace(text)
        .split(' ')
        .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')
        .join(' ');
};

const sentenceCase = (text = '') => {
    const cleaned = normalizeWhitespace(text);
    if (!cleaned) return '';
    return cleaned[0].toUpperCase() + cleaned.slice(1);
};

function fetchPage(page) {
    const url = `${BASE_URL}?page=${page}&per_page=${PER_PAGE}`;
    return new Promise((resolve, reject) => {
        https.get(
            url,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Import Script)',
                },
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => (raw += chunk));
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const json = JSON.parse(raw || '[]');
                            resolve({ json, headers: res.headers });
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        reject(new Error(`Request failed (${res.statusCode}): ${raw.slice(0, 200)}`));
                    }
                });
            }
        ).on('error', reject);
    });
}

async function fetchAllProducts() {
    const first = await fetchPage(1);
    const totalPages = Number(first.headers['x-wp-totalpages'] || 1);
    let products = first.json;

    for (let page = 2; page <= totalPages; page++) {
        const { json } = await fetchPage(page);
        products = products.concat(json);
    }

    return products;
}

async function upsertProduct(remote) {
    const slug = (remote.slug || remote.id || '').toString();
    const id = `prod_${slug.replace(/[^a-z0-9_-]/gi, '') || remote.id}`;

    const priceCents = Number(remote.prices?.regular_price || remote.prices?.price || 0);
    const saleCents = remote.on_sale
        ? Number(remote.prices?.sale_price || remote.prices?.price || 0)
        : null;

    const price = priceCents ? priceCents / 100 : 0;
    const salePrice = saleCents ? saleCents / 100 : null;

    // Prefer the full description; fall back to short description
    const descriptionHtml = remote.description || remote.short_description || '';
    const description = sentenceCase(decodeEntities(stripTags(descriptionHtml)));

    const record = {
        id,
        name: toTitleCase(decodeEntities(remote.name || 'Unnamed Product')),
        category: toTitleCase(decodeEntities(remote.categories?.[0]?.name || 'Shop')),
        description,
        price,
        salePrice,
        onSale: !!salePrice,
        stock: remote.is_in_stock ? remote.low_stock_remaining || 20 : 0,
        imageUrl: remote.images?.[0]?.src || '',
    };

    const existing = await ProductRepository.findById(id);
    if (existing) {
        await ProductRepository.updateById(id, record);
        return 'updated';
    } else {
        await ProductRepository.create(record);
        return 'created';
    }
}

async function run() {
    await initializeDatabase();

    console.log('Fetching products from flirthair.co.za ...');
    const products = await fetchAllProducts();
    console.log(`Fetched ${products.length} products. Importing...`);

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const product of products) {
        try {
            const result = await upsertProduct(product);
            if (result === 'created') created++;
            if (result === 'updated') updated++;
        } catch (err) {
            failed++;
            console.error(`Failed to import ${product.name || product.id}:`, err.message);
        }
    }

    console.log(`Import complete. Created: ${created}, Updated: ${updated}, Failed: ${failed}`);
    await closeDb();
}

if (require.main === module) {
    run().catch((err) => {
        console.error('Import failed:', err);
        closeDb().then(() => process.exit(1));
    });
}
