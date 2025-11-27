/**
 * Seed Script: Populate services table with default services
 *
 * Seeds the database with the services currently hardcoded in the client.
 * Run this after the migration to add image_url column.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'flirt.db');

const DEFAULT_SERVICES = [
    // Hair Extension Services
    {
        id: uuidv4(),
        name: 'Tape Extensions',
        description: 'Premium tape-in hair extensions for a natural, seamless look',
        price: 2500,
        duration: 150, // 2-3 hours avg = 150 min
        service_type: 'hair',
        category: 'Extensions',
        image_url: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories1.jpg',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Weft Installation',
        description: 'Sew-in weft extensions for long-lasting volume and length',
        price: 3200,
        duration: 210, // 3-4 hours avg = 210 min
        service_type: 'hair',
        category: 'Extensions',
        image_url: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories3.jpg',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Color Matching',
        description: 'Expert color matching for perfect extension blending',
        price: 0,
        duration: 30,
        service_type: 'hair',
        category: 'Consultation',
        image_url: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories5.jpg',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Maintenance',
        description: 'Extension maintenance, repositioning, and care',
        price: 800,
        duration: 90, // 1-2 hours avg = 90 min
        service_type: 'hair',
        category: 'Maintenance',
        image_url: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories7.jpg',
        active: 1
    },

    // Beauty Services
    {
        id: uuidv4(),
        name: 'Facial Treatment',
        description: 'Rejuvenating facial treatment for glowing skin',
        price: 450,
        duration: 60,
        service_type: 'beauty',
        category: 'Skincare',
        image_url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400&h=300&fit=crop',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Manicure',
        description: 'Professional nail care and polish application',
        price: 250,
        duration: 45,
        service_type: 'beauty',
        category: 'Nails',
        image_url: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=400&h=300&fit=crop',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Pedicure',
        description: 'Relaxing foot care and nail treatment',
        price: 300,
        duration: 60,
        service_type: 'beauty',
        category: 'Nails',
        image_url: 'https://images.unsplash.com/photo-1519491050282-cf00c82424b4?w=400&h=300&fit=crop',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Waxing',
        description: 'Professional hair removal services',
        price: 150,
        duration: 45, // 30-60 min avg = 45 min
        service_type: 'beauty',
        category: 'Hair Removal',
        image_url: 'https://images.unsplash.com/photo-1457972729786-0411a3b2b626?w=400&h=300&fit=crop',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Eyebrow Threading',
        description: 'Precise eyebrow shaping using threading technique',
        price: 80,
        duration: 15,
        service_type: 'beauty',
        category: 'Hair Removal',
        image_url: 'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=400&h=300&fit=crop',
        active: 1
    },
    {
        id: uuidv4(),
        name: 'Massage Therapy',
        description: 'Relaxing therapeutic massage',
        price: 500,
        duration: 60,
        service_type: 'beauty',
        category: 'Wellness',
        image_url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop',
        active: 1
    }
];

function seedServices() {
    const db = new sqlite3.Database(DB_PATH);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log('🌱 Starting service seeding...\n');

            // Check if services already exist
            db.get('SELECT COUNT(*) as count FROM services', (err, row) => {
                if (err) {
                    console.error('❌ Error checking existing services:', err);
                    return reject(err);
                }

                if (row.count > 0) {
                    console.log(`ℹ️  Database already has ${row.count} service(s).`);
                    console.log('⏭️  Skipping seed - delete existing services first if you want to re-seed.\n');
                    db.close();
                    return resolve();
                }

                console.log('📝 Inserting default services...\n');

                const stmt = db.prepare(`
                    INSERT INTO services (id, name, description, price, duration, service_type, category, image_url, active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                let inserted = 0;
                DEFAULT_SERVICES.forEach((service, index) => {
                    stmt.run([
                        service.id,
                        service.name,
                        service.description,
                        service.price,
                        service.duration,
                        service.service_type,
                        service.category,
                        service.image_url,
                        service.active
                    ], (err) => {
                        if (err) {
                            console.error(`❌ Error inserting ${service.name}:`, err);
                        } else {
                            inserted++;
                            console.log(`✅ ${service.service_type.toUpperCase().padEnd(6)} | ${service.name.padEnd(20)} | R${service.price.toString().padStart(4)} | ${service.duration}min`);
                        }

                        if (index === DEFAULT_SERVICES.length - 1) {
                            stmt.finalize();

                            // Verify the seed
                            db.all('SELECT service_type, COUNT(*) as count FROM services GROUP BY service_type', (err, rows) => {
                                if (err) {
                                    console.error('❌ Error verifying seed:', err);
                                    return reject(err);
                                }

                                console.log('\n📊 Services by Type:');
                                console.log('===================');
                                rows.forEach(row => {
                                    console.log(`${row.service_type}: ${row.count} service(s)`);
                                });

                                console.log(`\n✅ Successfully seeded ${inserted} services!`);

                                db.close((err) => {
                                    if (err) reject(err);
                                    else resolve();
                                });
                            });
                        }
                    });
                });
            });
        });
    });
}

// Run the seed
seedServices()
    .then(() => {
        console.log('\n🎉 Seeding complete!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n💥 Seeding failed:', err);
        process.exit(1);
    });
