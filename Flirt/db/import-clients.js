const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'flirt.db');

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Convert Excel serial date to JS Date
function excelDateToJS(serial) {
    if (!serial || serial === '0000-00-00' || typeof serial === 'string') return null;
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    return new Date(utc_value * 1000);
}

// Format phone number to South African format
function formatPhone(cell, tel) {
    let phone = cell || tel;
    if (!phone) return null;
    phone = String(phone).replace(/\D/g, '');
    if (phone.length === 9) {
        phone = '0' + phone;
    }
    if (phone.length === 10 && phone.startsWith('0')) {
        return '+27' + phone.slice(1);
    }
    return phone || null;
}

// Determine tier based on turnover/loyalty
function determineTier(turnover, loyalty) {
    const total = parseFloat(turnover) || 0;
    if (total >= 20000) return 'platinum';
    if (total >= 10000) return 'gold';
    if (total >= 5000) return 'silver';
    return 'bronze';
}

// Generate referral code from name
function generateReferralCode(name, surname) {
    const base = ((name || '') + (surname || '')).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return base + suffix || 'FLIRT' + suffix;
}

async function importClients(filePath, options = {}) {
    const { dryRun = false, skipExisting = true } = options;

    console.log('Reading client list:', filePath);
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const clients = XLSX.utils.sheet_to_json(sheet);

    console.log(`Found ${clients.length} clients in spreadsheet`);

    const db = new sqlite3.Database(DB_PATH);
    const results = { created: 0, skipped: 0, errors: [] };

    // Generate a default password hash for imported clients
    const defaultPasswordHash = await bcrypt.hash('FlirtWelcome2024!', 10);

    for (const client of clients) {
        try {
            const name = [(client.Name || '').trim(), (client.Surname || '').trim()].filter(Boolean).join(' ');
            const email = (client.Email || '').trim().toLowerCase();
            const phone = formatPhone(client.Cell, client.Tel);
            const turnover = parseFloat(client.Turnover) || 0;
            const loyaltyPoints = Math.floor(parseFloat(client.Loyalty) || 0);
            const tier = determineTier(turnover, loyaltyPoints);

            // Skip clients without name or email
            if (!name && !email) {
                console.log(`Skipping client #${client['Client No.']} - no name or email`);
                results.skipped++;
                continue;
            }

            // Generate email if missing (use phone or client number)
            let finalEmail = email;
            if (!finalEmail) {
                if (phone) {
                    finalEmail = `client_${phone.replace(/\D/g, '')}@flirt.placeholder`;
                } else {
                    finalEmail = `client_${client['Client No.'] || uuidv4().slice(0, 8)}@flirt.placeholder`;
                }
            }

            if (dryRun) {
                console.log(`[DRY RUN] Would import: ${name} <${finalEmail}> - ${tier} tier, ${loyaltyPoints} points`);
                results.created++;
                continue;
            }

            // Check if email already exists
            const existing = await dbGet(db, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE', [finalEmail]);
            if (existing) {
                if (skipExisting) {
                    results.skipped++;
                    continue;
                }
            }

            const userId = uuidv4();
            const referralCode = generateReferralCode(client.Name, client.Surname);

            await dbRun(db, `
                INSERT INTO users (
                    id, email, password_hash, name, phone, role,
                    points, tier, referral_code, must_change_password, created_at
                ) VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, 1, datetime('now'))
            `, [
                userId,
                finalEmail,
                defaultPasswordHash,
                name || 'Client',
                phone,
                loyaltyPoints,
                tier,
                referralCode
            ]);

            console.log(`Created: ${name} <${finalEmail}> - ${tier} tier`);
            results.created++;

        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                results.skipped++;
            } else {
                console.error(`Error importing client #${client['Client No.']}:`, error.message);
                results.errors.push({ client: client['Client No.'], error: error.message });
            }
        }
    }

    db.close();

    console.log('\n' + '='.repeat(60));
    console.log('IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Created:  ${results.created}`);
    console.log(`Skipped:  ${results.skipped}`);
    console.log(`Errors:   ${results.errors.length}`);
    console.log('='.repeat(60));

    if (results.errors.length > 0) {
        console.log('\nErrors:');
        results.errors.slice(0, 10).forEach(e => console.log(`  Client #${e.client}: ${e.error}`));
        if (results.errors.length > 10) {
            console.log(`  ... and ${results.errors.length - 10} more`);
        }
    }

    return results;
}

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const filePath = args[0] || 'c:/Users/ItaloOlivier/OneDrive - Outsourced CTO/clientlist.xlsx';
    const dryRun = args.includes('--dry-run');

    importClients(filePath, { dryRun })
        .then(() => {
            console.log('\nImport complete!');
            process.exit(0);
        })
        .catch(err => {
            console.error('Import failed:', err);
            process.exit(1);
        });
}

module.exports = { importClients };
