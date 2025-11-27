/**
 * Seed Stylists from CSV Staff Column
 *
 * This script extracts unique stylist names from the CSV data and creates
 * stylist records in the database.
 *
 * Run: node db/seed-stylists-from-csv.js
 */

const { v4: uuidv4 } = require('uuid');
const { dbRun, dbGet, dbAll, initializeDatabase, closeDb } = require('./database');

// Stylists extracted from CSV Staff column with metadata
const stylistsFromCSV = [
    { name: 'Inge', specialty: 'Hair Extensions', color: '#FF6B9D' },
    { name: 'Simone', specialty: 'Hair Extensions', color: '#9B59B6', alias: '2 Simone' },
    { name: 'Danielle', specialty: 'Hair Extensions', color: '#3498DB', alias: '3 Danielle' },
    { name: 'Chantelle', specialty: 'Hair & Beauty', color: '#E74C3C', alias: '4 Chantelle' },
    { name: 'Ilke', specialty: 'Hair Extensions', color: '#2ECC71', alias: '5 Ilke' },
    { name: 'Rialize', specialty: 'Hair Extensions', color: '#F39C12', alias: '6 Rialize' },
    { name: 'Magnolia', specialty: 'Hair Extensions', color: '#1ABC9C', alias: '7 Magnolia' },
    { name: 'Mariska Oosthuizen', specialty: 'Hair Extensions', color: '#E91E63' },
    { name: 'Alex Grobbelaar', specialty: 'Hair Extensions', color: '#673AB7' },
    { name: 'Cara Human', specialty: 'Hair Extensions', color: '#00BCD4', alias: '88 Cara Human' },
    { name: 'Hannah', specialty: 'Hair Extensions', color: '#795548', alias: '91 Hannah' },
    { name: 'Chani', specialty: 'Hair Extensions', color: '#607D8B', alias: '92 Chani' },
    { name: 'Leane', specialty: 'Hair Extensions', color: '#FF5722', alias: '1 Leane' },
];

// Mapping from CSV Staff values to normalized stylist names
const staffNameMapping = {
    'Inge': 'Inge',
    '2 Simone': 'Simone',
    '3 Danielle': 'Danielle',
    '4 Chantelle': 'Chantelle',
    '5 Ilke': 'Ilke',
    '6 Rialize': 'Rialize',
    '7 Magnolia': 'Magnolia',
    'Mariska Oosthuizen': 'Mariska Oosthuizen',
    'Alex Grobbelaar': 'Alex Grobbelaar',
    '88 Cara Human': 'Cara Human',
    '91 Hannah': 'Hannah',
    '92 Chani': 'Chani',
    '1 Leane': 'Leane',
    'Alex': 'Alex Grobbelaar',
};

async function seedStylists() {
    console.log('='.repeat(60));
    console.log('SEEDING STYLISTS FROM CSV DATA');
    console.log('='.repeat(60));

    try {
        await initializeDatabase();

        let created = 0;
        let skipped = 0;

        for (const stylist of stylistsFromCSV) {
            // Check if stylist already exists by name
            const existing = await dbGet(
                'SELECT * FROM stylists WHERE LOWER(name) = LOWER(?)',
                [stylist.name]
            );

            if (existing) {
                console.log(`[SKIP] Stylist already exists: ${stylist.name}`);
                skipped++;
                continue;
            }

            // Create new stylist
            const id = `stylist_${stylist.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

            await dbRun(`
                INSERT INTO stylists (
                    id, name, specialty, tagline, rating, review_count,
                    clients_count, years_experience, instagram, color, available, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `, [
                id,
                stylist.name,
                stylist.specialty,
                `Expert in ${stylist.specialty}`,
                5.0,  // Default rating
                0,    // review_count
                0,    // clients_count (will be updated after client import)
                3,    // years_experience default
                '',   // instagram
                stylist.color,
                1     // available
            ]);

            console.log(`[CREATE] Created stylist: ${stylist.name} (${stylist.specialty})`);
            created++;
        }

        console.log('');
        console.log('='.repeat(60));
        console.log('STYLIST SEEDING COMPLETE');
        console.log(`  Created: ${created}`);
        console.log(`  Skipped: ${skipped}`);
        console.log('='.repeat(60));

        // Display all stylists
        const allStylists = await dbAll('SELECT id, name, specialty, color FROM stylists ORDER BY name');
        console.log('\nAll stylists in database:');
        allStylists.forEach(s => {
            console.log(`  - ${s.name} (${s.specialty}) [${s.color}]`);
        });

    } catch (error) {
        console.error('Error seeding stylists:', error);
        throw error;
    } finally {
        closeDb();
    }
}

// Export mapping for use by import script
module.exports = {
    stylistsFromCSV,
    staffNameMapping,
    seedStylists
};

// Run if called directly
if (require.main === module) {
    seedStylists()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
