/**
 * Import Clients from CSV (Legacy Salon Software Export)
 *
 * This script imports client data from the italo_client_data_set.csv file
 * into the Flirt database.
 *
 * Prerequisites:
 *   1. Run migration: node db/run-migration.js
 *   2. Seed stylists: node db/seed-stylists-from-csv.js
 *
 * Run: node db/import-clients-from-csv.js [path-to-csv]
 *
 * Options:
 *   --dry-run    Preview import without writing to database
 *   --force      Overwrite existing users (by email)
 *   --skip-duplicates  Skip duplicate emails silently
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { dbRun, dbGet, dbAll, initializeDatabase, closeDb } = require('./database');
const { staffNameMapping } = require('./seed-stylists-from-csv');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Default password for imported users (they should reset on first login)
    defaultPassword: 'FlirtHair2024!',

    // Placeholder surnames to filter out
    placeholderSurnames: [
        'flirt', 'new', 'walk in', 'verde', 'flirt staff', 'staff',
        'walk', 'in', 'model', 'training', 'test', 'quotation', 'bridal'
    ],

    // Placeholder names to filter out
    placeholderNames: [
        'walk', 'training', 'wella', 'model', 'quotation', 'flirt'
    ],

    // Minimum visits to import (set to 0 to import all)
    minVisits: 0,

    // Generate placeholder email for missing emails
    generatePlaceholderEmail: true,
    placeholderEmailDomain: 'import.flirt.local',
};

// ============================================
// CSV PARSING
// ============================================

function parseCSV(content) {
    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    // Parse header - handle special characters in column names
    const headerLine = lines[0];
    const headers = headerLine.split(';').map(h =>
        h.trim()
            .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII
            .replace(/\s+/g, '_')
            .toLowerCase()
    );

    // Map known column variations
    const columnMap = {
        'client_no.': 'client_no',
        'clientno.': 'client_no',
        'client_no': 'client_no',
        'last_visit': 'last_visit',
        'lastvisit': 'last_visit',
        'first_visit': 'first_visit',
        'firstvisit': 'first_visit',
        'birtddate': 'birthday',
        'birthdate': 'birthday',
        'client_source': 'client_source',
        'clientsource': 'client_source',
        'loyalty_type': 'loyalty_type',
        'loyaltytype': 'loyalty_type',
        'discount_:s': 'discount_service',
        'discount:s': 'discount_service',
        'discount_:r': 'discount_retail',
        'discount:r': 'discount_retail',
    };

    const normalizedHeaders = headers.map(h => columnMap[h] || h);

    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], ';');
        if (values.length === 0) continue;

        const record = {};
        for (let j = 0; j < normalizedHeaders.length && j < values.length; j++) {
            record[normalizedHeaders[j]] = values[j]?.trim() || '';
        }
        records.push(record);
    }

    return records;
}

function parseCSVLine(line, delimiter = ';') {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current);

    return values;
}

// ============================================
// DATA CLEANING FUNCTIONS
// ============================================

function normalizePhone(phone) {
    if (!phone) return null;

    // Remove all non-digit characters
    let digits = phone.replace(/[^\d]/g, '');

    // Handle various formats
    if (digits.length === 0) return null;
    if (digits.length < 9) return null; // Too short to be valid

    // Remove country code if present
    if (digits.startsWith('27') && digits.length >= 11) {
        digits = '0' + digits.slice(2);
    } else if (digits.startsWith('0027')) {
        digits = '0' + digits.slice(4);
    }

    // Add leading 0 if missing
    if (digits.length === 9 && !digits.startsWith('0')) {
        digits = '0' + digits;
    }

    // Validate SA mobile number format
    if (digits.length === 10 && digits.startsWith('0')) {
        return digits;
    }

    // Return as-is if we can't normalize
    return digits.length >= 9 ? digits : null;
}

function normalizeEmail(email) {
    if (!email) return null;

    email = email.trim().toLowerCase();

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return null;
    }

    // Fix common typos
    email = email.replace(/,/g, '.');

    return email;
}

function parseDate(dateStr) {
    if (!dateStr || dateStr === '0000-00-00') return null;

    // Handle DD/MM/YY format
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        let year = parseInt(match[3], 10);

        // Assume 20xx for years 00-50, 19xx for 51-99
        year = year <= 50 ? 2000 + year : 1900 + year;

        // Validate
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    return null;
}

function parseBirthday(birthdayStr) {
    if (!birthdayStr) return null;

    // Handle "DD-Mon" format (e.g., "28-Oct", "17-Mar")
    const months = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };

    const match = birthdayStr.match(/^(\d{1,2})[-\/](\w{3})$/i);
    if (match) {
        const day = match[1].padStart(2, '0');
        const monthStr = match[2].toLowerCase();
        const month = months[monthStr];

        if (month) {
            // Return as MM-DD (no year)
            return `${month}-${day}`;
        }
    }

    return null;
}

function parseNumber(numStr) {
    if (!numStr) return 0;
    const num = parseFloat(numStr.replace(/[^\d.-]/g, ''));
    return isNaN(num) ? 0 : num;
}

function calculateTier(points) {
    points = parseInt(points, 10) || 0;
    if (points >= 5000) return 'platinum';
    if (points >= 1500) return 'gold';
    if (points >= 500) return 'silver';
    return 'bronze';
}

function generateReferralCode(name) {
    const prefix = name.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${random}`;
}

function isPlaceholderRecord(record) {
    const surname = (record.surname || '').toLowerCase().trim();
    const name = (record.name || '').toLowerCase().trim();

    // Check placeholder surnames
    if (CONFIG.placeholderSurnames.includes(surname)) {
        return true;
    }

    // Check placeholder names
    if (CONFIG.placeholderNames.includes(name)) {
        return true;
    }

    // Check for empty essential data
    if (!name && !surname) {
        return true;
    }

    // Check for numeric-only names (often test data)
    if (/^\d+$/.test(name) || /^\d+$/.test(surname)) {
        return true;
    }

    return false;
}

// ============================================
// IMPORT LOGIC
// ============================================

async function findStylistId(staffName) {
    if (!staffName) return null;

    // Normalize the staff name
    const normalizedName = staffNameMapping[staffName] || staffName;

    // Look up in database
    const stylist = await dbGet(
        'SELECT id FROM stylists WHERE LOWER(name) = LOWER(?)',
        [normalizedName]
    );

    return stylist?.id || null;
}

async function importClients(csvPath, options = {}) {
    const { dryRun = false, force = false, skipDuplicates = false } = options;

    console.log('='.repeat(60));
    console.log('FLIRT CLIENT IMPORT');
    console.log('='.repeat(60));
    console.log(`CSV File: ${csvPath}`);
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE IMPORT'}`);
    console.log(`Force overwrite: ${force}`);
    console.log(`Skip duplicates: ${skipDuplicates}`);
    console.log('');

    // Read CSV file
    if (!fs.existsSync(csvPath)) {
        throw new Error(`CSV file not found: ${csvPath}`);
    }

    const content = fs.readFileSync(csvPath, 'utf8');
    const records = parseCSV(content);

    console.log(`Total records in CSV: ${records.length}`);
    console.log('');

    // Initialize database
    if (!dryRun) {
        await initializeDatabase();
    }

    // Hash default password once
    const passwordHash = await bcrypt.hash(CONFIG.defaultPassword, 10);

    // Statistics
    const stats = {
        total: records.length,
        filtered: 0,
        noEmail: 0,
        duplicates: 0,
        created: 0,
        updated: 0,
        errors: 0,
    };

    // Track emails to detect duplicates within CSV
    const seenEmails = new Map(); // email -> record with highest turnover

    // First pass: filter and deduplicate
    const validRecords = [];

    for (const record of records) {
        // Filter placeholder records
        if (isPlaceholderRecord(record)) {
            stats.filtered++;
            continue;
        }

        // Filter by minimum visits if configured
        const visits = parseInt(record.visits, 10) || 0;
        if (visits < CONFIG.minVisits) {
            stats.filtered++;
            continue;
        }

        // Normalize email
        let email = normalizeEmail(record.email);

        // Generate placeholder email if missing and configured
        if (!email && CONFIG.generatePlaceholderEmail) {
            const clientNo = record.client_no || Date.now();
            email = `client${clientNo}@${CONFIG.placeholderEmailDomain}`;
            stats.noEmail++;
        }

        if (!email) {
            stats.noEmail++;
            stats.filtered++;
            continue;
        }

        record._normalizedEmail = email;
        record._turnover = parseNumber(record.turnover);

        // Deduplicate by email (keep record with highest turnover)
        if (seenEmails.has(email)) {
            const existing = seenEmails.get(email);
            if (record._turnover > existing._turnover) {
                seenEmails.set(email, record);
            }
            stats.duplicates++;
        } else {
            seenEmails.set(email, record);
        }
    }

    // Get deduplicated records
    for (const record of seenEmails.values()) {
        validRecords.push(record);
    }

    console.log(`After filtering: ${validRecords.length} records`);
    console.log(`  - Filtered out: ${stats.filtered} (placeholders/low visits)`);
    console.log(`  - Missing emails: ${stats.noEmail} (generated placeholders)`);
    console.log(`  - Duplicates merged: ${stats.duplicates}`);
    console.log('');

    // Second pass: import records
    console.log('Importing records...');
    console.log('-'.repeat(60));

    for (let i = 0; i < validRecords.length; i++) {
        const record = validRecords[i];

        try {
            const email = record._normalizedEmail;
            const name = [record.name, record.surname].filter(Boolean).join(' ').trim() || 'Unknown';
            const phone = normalizePhone(record.cell) || normalizePhone(record.tel);

            // Check if user exists
            let existingUser = null;
            if (!dryRun) {
                existingUser = await dbGet(
                    'SELECT id FROM users WHERE LOWER(email) = LOWER(?)',
                    [email]
                );
            }

            if (existingUser) {
                if (skipDuplicates) {
                    continue;
                }

                if (!force) {
                    console.log(`[SKIP] User exists: ${email}`);
                    stats.duplicates++;
                    continue;
                }

                // Update existing user
                if (!dryRun) {
                    const stylistId = await findStylistId(record.staff);

                    await dbRun(`
                        UPDATE users SET
                            name = ?,
                            phone = COALESCE(?, phone),
                            points = ?,
                            tier = ?,
                            birthday = ?,
                            client_source = ?,
                            preferred_stylist_id = ?,
                            legacy_client_no = ?,
                            total_service_revenue = ?,
                            total_retail_revenue = ?,
                            first_visit = ?,
                            last_visit = ?,
                            total_visits = ?,
                            service_discount_pct = ?,
                            retail_discount_pct = ?,
                            updated_at = datetime('now')
                        WHERE id = ?
                    `, [
                        name,
                        phone,
                        parseInt(record.loyalty, 10) || 0,
                        calculateTier(record.loyalty),
                        parseBirthday(record.birthday),
                        record.client_source || null,
                        stylistId,
                        parseInt(record.client_no, 10) || null,
                        parseNumber(record.service),
                        parseNumber(record.retail),
                        parseDate(record.first_visit),
                        parseDate(record.last_visit),
                        parseInt(record.visits, 10) || 0,
                        parseNumber(record.discount_service),
                        parseNumber(record.discount_retail),
                        existingUser.id
                    ]);
                }

                console.log(`[UPDATE] ${name} <${email}>`);
                stats.updated++;
                continue;
            }

            // Create new user
            const userId = uuidv4();
            const referralCode = generateReferralCode(name);
            const stylistId = !dryRun ? await findStylistId(record.staff) : null;

            if (!dryRun) {
                await dbRun(`
                    INSERT INTO users (
                        id, email, password_hash, name, phone, role,
                        points, tier, referral_code, must_change_password,
                        birthday, client_source, preferred_stylist_id,
                        legacy_client_no, total_service_revenue, total_retail_revenue,
                        first_visit, last_visit, total_visits,
                        service_discount_pct, retail_discount_pct,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `, [
                    userId,
                    email,
                    passwordHash,
                    name,
                    phone,
                    'customer',
                    parseInt(record.loyalty, 10) || 0,
                    calculateTier(record.loyalty),
                    referralCode,
                    1, // must_change_password = true
                    parseBirthday(record.birthday),
                    record.client_source || null,
                    stylistId,
                    parseInt(record.client_no, 10) || null,
                    parseNumber(record.service),
                    parseNumber(record.retail),
                    parseDate(record.first_visit),
                    parseDate(record.last_visit),
                    parseInt(record.visits, 10) || 0,
                    parseNumber(record.discount_service),
                    parseNumber(record.discount_retail),
                ]);
            }

            console.log(`[CREATE] ${name} <${email}> (${record.visits} visits, R${record._turnover.toFixed(2)} turnover)`);
            stats.created++;

        } catch (error) {
            console.error(`[ERROR] Record ${i + 1}: ${error.message}`);
            stats.errors++;
        }

        // Progress indicator
        if ((i + 1) % 100 === 0) {
            console.log(`... processed ${i + 1}/${validRecords.length}`);
        }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('IMPORT COMPLETE');
    console.log('='.repeat(60));
    console.log(`  Total in CSV:     ${stats.total}`);
    console.log(`  Filtered out:     ${stats.filtered}`);
    console.log(`  Duplicates:       ${stats.duplicates}`);
    console.log(`  Created:          ${stats.created}`);
    console.log(`  Updated:          ${stats.updated}`);
    console.log(`  Errors:           ${stats.errors}`);
    console.log('');

    if (dryRun) {
        console.log('NOTE: This was a DRY RUN. No changes were made to the database.');
        console.log('Run without --dry-run to perform the actual import.');
    }

    if (!dryRun) {
        // Update stylist client counts
        console.log('Updating stylist client counts...');
        await dbRun(`
            UPDATE stylists SET clients_count = (
                SELECT COUNT(*) FROM users
                WHERE preferred_stylist_id = stylists.id
            )
        `);

        closeDb();
    }

    return stats;
}

// ============================================
// CLI
// ============================================

async function main() {
    const args = process.argv.slice(2);

    // Parse options
    const options = {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        skipDuplicates: args.includes('--skip-duplicates'),
    };

    // Get CSV path
    let csvPath = args.find(arg => !arg.startsWith('--'));

    if (!csvPath) {
        // Default path - check multiple locations
        const possiblePaths = [
            path.join(__dirname, '..', 'data', 'italo_client_data_set.csv'),
            path.join(__dirname, '..', '..', 'italo_client_data_set.csv'),
            path.join(__dirname, '..', 'italo_client_data_set.csv'),
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                csvPath = p;
                break;
            }
        }

        if (!csvPath) {
            csvPath = possiblePaths[0]; // Will show error with first path
        }
    }

    // Resolve to absolute path
    if (!path.isAbsolute(csvPath)) {
        csvPath = path.resolve(process.cwd(), csvPath);
    }

    try {
        await importClients(csvPath, options);
        process.exit(0);
    } catch (error) {
        console.error('Import failed:', error);
        process.exit(1);
    }
}

// Export for programmatic use
module.exports = { importClients, parseCSV, CONFIG };

// Run if called directly
if (require.main === module) {
    main();
}
