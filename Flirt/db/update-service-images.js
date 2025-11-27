/**
 * Update Script: Add image URLs to existing services
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'flirt.db');

function updateServices() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('📸 Updating service images...\n');

            // First, let's see what we have
            db.all('SELECT id, name, service_type, image_url FROM services', (err, services) => {
                if (err) {
                    console.error('❌ Error fetching services:', err);
                    return reject(err);
                }

                console.log('Current services:');
                services.forEach(s => {
                    console.log(`  - ${s.name} (${s.service_type}) - ${s.image_url || 'NO IMAGE'}`);
                });

                console.log('\n📝 Adding image URLs...\n');

                // Image URL mappings
                const imageUrls = {
                    'Tape Extensions': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories1.jpg',
                    'Weft Installation': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories3.jpg',
                    'Color Matching': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories5.jpg',
                    'Maintenance': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories7.jpg',
                    'Facial Treatment': 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400&h=300&fit=crop',
                    'Manicure': 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=300&fit=crop',
                    'Pedicure': 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?w=400&h=300&fit=crop',
                    'Waxing': 'https://images.unsplash.com/photo-1457972729786-0411a3b2b626?w=400&h=300&fit=crop',
                    'Eyebrow Threading': 'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=400&h=300&fit=crop',
                    'Massage Therapy': 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop'
                };

                let updated = 0;
                const promises = services.map(service => {
                    return new Promise((resolve) => {
                        const imageUrl = imageUrls[service.name];
                        if (imageUrl && !service.image_url) {
                            db.run('UPDATE services SET image_url = ? WHERE id = ?', [imageUrl, service.id], (err) => {
                                if (err) {
                                    console.error(`❌ Error updating ${service.name}:`, err);
                                } else {
                                    console.log(`✅ Updated ${service.name}`);
                                    updated++;
                                }
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                });

                Promise.all(promises).then(() => {
                    console.log(`\n✅ Updated ${updated} services with image URLs`);

                    db.close((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });
        });
    });
}

// Run the update
updateServices()
    .then(() => {
        console.log('\n🎉 Update complete!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Update failed:', err);
        process.exit(1);
    });
