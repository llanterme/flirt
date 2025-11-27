/**
 * Import Script: Beauty Services
 *
 * Imports all beauty services from the Flirt Hair & Beauty service menu
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'flirt.db');

// Complete beauty services list from menu
const BEAUTY_SERVICES = [
    // LASH EXTENSIONS
    { name: 'Lash Extensions - New Set: Classic', category: 'Lash Extensions', duration: 60, price: 500, service_type: 'beauty' },
    { name: 'Lash Extensions - New Set: Hybrid', category: 'Lash Extensions', duration: 90, price: 550, service_type: 'beauty' },
    { name: 'Lash Extensions - New Set: Volume', category: 'Lash Extensions', duration: 120, price: 650, service_type: 'beauty' },
    { name: 'Lash Extensions - 30 Min Fill', category: 'Lash Extensions', duration: 30, price: 300, priceNote: 'From R300', service_type: 'beauty' },
    { name: 'Lash Extensions - 60 Min Fill', category: 'Lash Extensions', duration: 60, price: 400, priceNote: 'From R400', service_type: 'beauty' },
    { name: 'Lash Extensions - 90 Min Fill', category: 'Lash Extensions', duration: 90, price: 480, priceNote: 'From R480', service_type: 'beauty' },
    { name: 'Lash Extensions - Lash Removal', category: 'Lash Extensions', duration: 30, price: 100, service_type: 'beauty' },

    // DERMAPLANING
    { name: 'gFormula Dermatological Skin Resurfacing Treatment', category: 'Dermaplaning', duration: 30, price: 780, service_type: 'beauty' },
    { name: 'Dermaplaning - 60 Min', category: 'Dermaplaning', duration: 60, price: 1155, service_type: 'beauty' },
    { name: 'Dermaplaning - 90 Min', category: 'Dermaplaning', duration: 90, price: 1310, service_type: 'beauty' },

    // MICRO-NEEDLING
    { name: 'Micro-Needling - Face Only', category: 'Micro-Needling', duration: 60, price: 950, service_type: 'beauty' },
    { name: 'Micro-Needling - Face & Neck', category: 'Micro-Needling', duration: 75, price: 1200, service_type: 'beauty' },
    { name: 'Micro-Needling - Face, Neck & décolletage', category: 'Micro-Needling', duration: 90, price: 1350, service_type: 'beauty' },

    // FACIAL ADD-ONS
    { name: 'Facial Add-On - Micro-needling', category: 'Facial Add-Ons', duration: 30, price: 540, service_type: 'beauty' },
    { name: 'Facial Add-On - Nano-needling', category: 'Facial Add-Ons', duration: 30, price: 380, service_type: 'beauty' },
    { name: 'Facial Add-On - Dermaplaning', category: 'Facial Add-Ons', duration: 30, price: 350, service_type: 'beauty' },

    // BROWS & LASHES
    { name: 'Brow Lamination', category: 'Brows & Lashes', duration: 30, price: 400, service_type: 'beauty' },
    { name: 'Lash Lift', category: 'Brows & Lashes', duration: 30, price: 400, service_type: 'beauty' },
    { name: 'Brow Lamination & Lash Lift', category: 'Brows & Lashes', duration: 60, price: 800, service_type: 'beauty' },
    { name: 'Lash Tint', category: 'Brows & Lashes', duration: 15, price: 90, service_type: 'beauty' },
    { name: 'Brow Tint', category: 'Brows & Lashes', duration: 15, price: 100, service_type: 'beauty' },
    { name: 'Brow Tint & Wax', category: 'Brows & Lashes', duration: 15, price: 190, service_type: 'beauty' },
    { name: 'Brow & Lash Tint & Wax', category: 'Brows & Lashes', duration: 15, price: 290, service_type: 'beauty' },
    { name: 'Lash Lift & Tint', category: 'Brows & Lashes', duration: 30, price: 490, service_type: 'beauty' },

    // DERMAPLANING FACIAL
    { name: 'Dermaplaning Facial', category: 'Dermaplaning', duration: 60, price: 600, service_type: 'beauty' },

    // NAILS - Base Services
    { name: 'Nails - Nele\' Rubber Base Overlay 60min', category: 'Nails', duration: 60, price: 355, service_type: 'beauty' },
    { name: 'Nails - Nele\' Rubber Base Overlay 90min', category: 'Nails', duration: 90, price: 440, service_type: 'beauty' },
    { name: 'Nails - Nele\' Rubber Base Overlay 90min', category: 'Nails', duration: 90, price: 455, service_type: 'beauty' },

    // NAILS - Acrylic Overlay
    { name: 'Nails - Acrylic Overlay Natural', category: 'Nails - Acrylic', duration: 60, price: 355, service_type: 'beauty' },
    { name: 'Nails - Acrylic Overlay with Color', category: 'Nails - Acrylic', duration: 90, price: 440, service_type: 'beauty' },

    // NAILS - Acrylic Sculpture
    { name: 'Nails - Acrylic Sculpture Natural', category: 'Nails - Acrylic', duration: 120, price: 450, service_type: 'beauty' },
    { name: 'Nails - Acrylic Sculpture with Color', category: 'Nails - Acrylic', duration: 180, price: 530, service_type: 'beauty' },

    // NAILS - Polygel Overlay
    { name: 'Nails - Polygel Overlay Natural', category: 'Nails - Polygel', duration: 60, price: 355, service_type: 'beauty' },
    { name: 'Nails - Polygel Overlay with Color', category: 'Nails - Polygel', duration: 90, price: 440, service_type: 'beauty' },

    // NAILS - Polygel Sculpture
    { name: 'Nails - Polygel Sculpture Natural', category: 'Nails - Polygel', duration: 120, price: 450, service_type: 'beauty' },
    { name: 'Nails - Polygel Sculpture with Color', category: 'Nails - Polygel', duration: 180, price: 530, service_type: 'beauty' },

    // NAILS - Fill Services
    { name: 'Nails - Fill 2 Weeks', category: 'Nails', duration: 60, price: 310, service_type: 'beauty' },
    { name: 'Nails - Fill 3 Weeks', category: 'Nails', duration: 60, price: 350, service_type: 'beauty' },

    // NAILS - Toes
    { name: 'Nails - Nele\' Toes', category: 'Nails', duration: 60, price: 300, service_type: 'beauty' },

    // NAIL ADD-ONS
    { name: 'Nail Add-On - Nail Reshape', category: 'Nail Add-Ons', duration: 30, price: 50, service_type: 'beauty' },
    { name: 'Nail Add-On - Nail Repair (per nail)', category: 'Nail Add-Ons', duration: 15, price: 20, service_type: 'beauty' },
    { name: 'Nail Add-On - Soak Off with new set', category: 'Nail Add-Ons', duration: 30, price: 50, service_type: 'beauty' },
    { name: 'Nail Add-On - Soak Off Only', category: 'Nail Add-Ons', duration: 30, price: 80, service_type: 'beauty' },
    { name: 'Nail Add-On - Soak Off Only Acrylic', category: 'Nail Add-Ons', duration: 30, price: 100, service_type: 'beauty' },
    { name: 'Nail Add-On - Gel colour Overlay', category: 'Nail Add-Ons', duration: 30, price: 80, service_type: 'beauty' },
    { name: 'Nail Add-On - Minimal Nail Art', category: 'Nail Add-Ons', duration: 15, price: 10, priceNote: 'from 10', service_type: 'beauty' },
    { name: 'Nail Add-On - Freehand Nail Art', category: 'Nail Add-Ons', duration: 30, price: 30, priceNote: 'from 30', service_type: 'beauty' },
    { name: 'Nail Add-On - Extreme Nail Art', category: 'Nail Add-Ons', duration: 30, price: 30, priceNote: 'from 30', service_type: 'beauty' },
    { name: 'Nail Add-On - French/Faded French', category: 'Nail Add-Ons', duration: 30, price: 100, service_type: 'beauty' },

    // PEDICURE
    { name: 'Pedicure - Signature Pedicure', category: 'Pedicure', duration: 60, price: 290, service_type: 'beauty' },
    { name: 'Pedicure - MediHeel Peel', category: 'Pedicure', duration: 60, price: 350, service_type: 'beauty' },
    { name: 'Pedicure - MediHeel Peel (incl Gel)', category: 'Pedicure', duration: 60, price: 450, service_type: 'beauty' },

    // MALE GROOMING
    { name: 'Male Grooming - Traditional Pedicure', category: 'Male Grooming', duration: 60, price: 290, service_type: 'beauty' },
    { name: 'Male Grooming - Mani-cure', category: 'Male Grooming', duration: 60, price: 180, service_type: 'beauty' },
    { name: 'Male Grooming - Nail Cut, Buff and Shine', category: 'Male Grooming', duration: 60, price: 180, service_type: 'beauty' },

    // WAXING
    { name: 'Waxing - Brow', category: 'Waxing', duration: 15, price: 90, service_type: 'beauty' },
    { name: 'Waxing - Chin/Upper Lip', category: 'Waxing', duration: 15, price: 90, service_type: 'beauty' },
    { name: 'Waxing - Full Face', category: 'Waxing', duration: 45, price: 250, service_type: 'beauty' },
    { name: 'Waxing - Bikini', category: 'Waxing', duration: 30, price: 200, service_type: 'beauty' },
    { name: 'Waxing - Brazilian', category: 'Waxing', duration: 60, price: 300, service_type: 'beauty' },
    { name: 'Waxing - Underarm', category: 'Waxing', duration: 30, price: 130, service_type: 'beauty' },
    { name: 'Waxing - Full Arm', category: 'Waxing', duration: 30, price: 240, service_type: 'beauty' },
    { name: 'Waxing - Full Leg', category: 'Waxing', duration: 45, price: 290, service_type: 'beauty' },
    { name: 'Waxing - Full Leg', category: 'Waxing', duration: 60, price: 290, service_type: 'beauty' },
    { name: 'Waxing - Back', category: 'Waxing', duration: 60, price: 350, service_type: 'beauty' }
];

function importBeautyServices() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('💅 Importing Beauty Services...\n');
            console.log(`📋 Total services to import: ${BEAUTY_SERVICES.length}\n`);

            const stmt = db.prepare(`
                INSERT OR IGNORE INTO services (id, name, description, price, duration, service_type, category, active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `);

            let imported = 0;
            let skipped = 0;

            BEAUTY_SERVICES.forEach((service, index) => {
                const id = uuidv4();
                const description = service.priceNote ? `Price: ${service.priceNote}` : null;

                stmt.run([
                    id,
                    service.name,
                    description,
                    service.price,
                    service.duration,
                    service.service_type,
                    service.category,
                    1
                ], (err) => {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint')) {
                            skipped++;
                            console.log(`⏭️  Skipped (exists): ${service.name}`);
                        } else {
                            console.error(`❌ Error importing ${service.name}:`, err);
                        }
                    } else {
                        imported++;
                        console.log(`✅ ${service.category.padEnd(25)} | ${service.name.substring(0, 50).padEnd(50)} | R${service.price.toString().padStart(4)} | ${service.duration}min`);
                    }

                    if (index === BEAUTY_SERVICES.length - 1) {
                        stmt.finalize();

                        // Summary
                        db.all(`
                            SELECT category, COUNT(*) as count
                            FROM services
                            WHERE service_type = 'beauty'
                            GROUP BY category
                            ORDER BY category
                        `, (err, rows) => {
                            if (err) {
                                console.error('❌ Error getting summary:', err);
                            } else {
                                console.log('\n📊 Beauty Services by Category:');
                                console.log('================================');
                                rows.forEach(row => {
                                    console.log(`  ${row.category}: ${row.count} service(s)`);
                                });
                            }

                            console.log(`\n✅ Successfully imported ${imported} new services`);
                            if (skipped > 0) {
                                console.log(`⏭️  Skipped ${skipped} existing services`);
                            }

                            db.close((err) => {
                                if (err) reject(err);
                                else resolve({ imported, skipped });
                            });
                        });
                    }
                });
            });
        });
    });
}

// Run the import
importBeautyServices()
    .then(({ imported, skipped }) => {
        console.log('\n🎉 Import complete!');
        console.log(`\nImported: ${imported} | Skipped: ${skipped} | Total: ${BEAUTY_SERVICES.length}`);
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Import failed:', err);
        process.exit(1);
    });
