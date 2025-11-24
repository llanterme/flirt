const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const querystring = require('querystring');

// Optional: axios for OAuth - using native https if not available
let axios;
try {
    axios = require('axios');
} catch (e) {
    // Will use native https module as fallback
    axios = null;
}
const https = require('https');

// Database imports - conditionally use SQLite if DATABASE_PATH is set
let db = null;
let UserRepository = null;
let StylistRepository = null;
let ServiceRepository = null;
let BookingRepository = null;
let ProductRepository = null;
let OrderRepository = null;

const DATABASE_PATH = process.env.DATABASE_PATH;
const USE_DATABASE = !!DATABASE_PATH;

if (USE_DATABASE) {
    try {
        const dbModule = require('./db/database');
        db = dbModule;
        UserRepository = dbModule.UserRepository;
        StylistRepository = dbModule.StylistRepository;
        ServiceRepository = dbModule.ServiceRepository;
        BookingRepository = dbModule.BookingRepository;
        ProductRepository = dbModule.ProductRepository;
        OrderRepository = dbModule.OrderRepository;

        // Ensure database directory exists
        const dbDir = path.dirname(DATABASE_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log(`📁 Created database directory: ${dbDir}`);
        }

        console.log('✅ Using SQLite database at:', DATABASE_PATH);
    } catch (error) {
        console.error('❌ Failed to load database module:', error.message);
        console.error('🔍 Error type:', error.constructor.name);
        if (error.message.includes('invalid ELF header')) {
            console.error('🔧 SQLite3 native bindings are compiled for wrong architecture');
            console.error('💡 This usually happens when SQLite3 was compiled for different OS');
            console.error('🚀 Railway deployment should rebuild SQLite3 during postinstall');
        }
        console.log('📁 Falling back to JSON file storage');
    }
}

const app = express();
const PORT = process.env.PORT || 3001;

// Security: JWT secret from environment variable
// In production, ALWAYS set JWT_SECRET environment variable
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    console.warn('⚠️  WARNING: Using default JWT secret. Set JWT_SECRET env variable in production!');
    return 'flirt-hair-beauty-dev-secret-2025';
})();

// Admin seed password from environment
const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'admin123';

// OAuth configuration (set these in environment for production)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'GOOGLE_CLIENT_ID_HERE';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'GOOGLE_CLIENT_SECRET_HERE';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

const FACEBOOK_CLIENT_ID = process.env.FACEBOOK_CLIENT_ID || 'FACEBOOK_APP_ID_HERE';
const FACEBOOK_CLIENT_SECRET = process.env.FACEBOOK_CLIENT_SECRET || 'FACEBOOK_APP_SECRET_HERE';
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/api/auth/facebook/callback';

// Rate limiting tracking (simple in-memory)
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINS = 15;

function checkRateLimit(identifier) {
    const attempts = loginAttempts.get(identifier);
    if (!attempts) return { allowed: true };

    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
        const lockoutEnd = attempts.lastAttempt + (LOGIN_LOCKOUT_MINS * 60 * 1000);
        if (Date.now() < lockoutEnd) {
            const remainingMins = Math.ceil((lockoutEnd - Date.now()) / 60000);
            return { allowed: false, remainingMins };
        }
        // Lockout expired, reset
        loginAttempts.delete(identifier);
    }
    return { allowed: true };
}

function recordLoginAttempt(identifier, success) {
    if (success) {
        loginAttempts.delete(identifier);
        return;
    }

    const attempts = loginAttempts.get(identifier) || { count: 0, lastAttempt: 0 };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(identifier, attempts);
}

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const STYLISTS_FILE = path.join(DATA_DIR, 'stylists.json');
const SERVICES_FILE = path.join(DATA_DIR, 'services.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PROMOS_FILE = path.join(DATA_DIR, 'promos.json');
const LOYALTY_FILE = path.join(DATA_DIR, 'loyalty.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const HAIR_TIPS_FILE = path.join(DATA_DIR, 'hair_tips.json');
const HAIR_TRACKER_FILE = path.join(DATA_DIR, 'hair_tracker.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================
// SEED ADMIN USER
// ============================================
async function seedAdminUser() {
    if (USE_DATABASE && UserRepository) {
        try {
            // Initialize database first
            await db.initializeDatabase();

            // Check if admin already exists
            const adminExists = await UserRepository.findByRole('admin');
            if (!adminExists || adminExists.length === 0) {
                const passwordHash = await bcrypt.hash(ADMIN_SEED_PASSWORD, 10);
                await UserRepository.create({
                    id: 'admin-001',
                    email: 'admin@flirthair.co.za',
                    passwordHash,
                    name: 'Flirt Admin',
                    phone: '+27 11 123 4567',
                    role: 'admin',
                    mustChangePassword: true,
                    points: 0,
                    tier: 'platinum',
                    referralCode: 'FLIRTADMIN',
                    referredBy: null
                });
                console.log(`✅ Admin user created in SQLite: admin@flirthair.co.za`);
                console.log('⚠️  Admin must change password on first login');
            }
        } catch (error) {
            console.error('❌ Failed to seed admin user in database:', error.message);
        }
    } else {
        // Fallback to JSON files
        const usersData = loadJSON(USERS_FILE);
        if (!usersData) return;

        const adminExists = usersData.users.find(u => u.role === 'admin');
        if (!adminExists) {
            const passwordHash = await bcrypt.hash(ADMIN_SEED_PASSWORD, 10);
            usersData.users.push({
                id: 'admin-001',
                email: 'admin@flirthair.co.za',
                passwordHash,
                name: 'Flirt Admin',
                phone: '+27 11 123 4567',
                role: 'admin',
                mustChangePassword: true,
                points: 0,
                tier: 'platinum',
                referralCode: 'FLIRTADMIN',
                referredBy: null,
                hairTracker: { lastInstallDate: null, extensionType: null },
                createdAt: new Date().toISOString()
            });
            saveJSON(USERS_FILE, usersData);
            console.log(`✅ Admin user created in JSON: admin@flirthair.co.za`);
            console.log('⚠️  Admin must change password on first login');
        }
    }
}

// Run seed on startup
seedAdminUser();

// ============================================
// UTILITY FUNCTIONS WITH FILE LOCKING
// ============================================

// Simple file lock mechanism to prevent concurrent writes
const fileLocks = new Map();

async function acquireLock(filePath, timeout = 5000) {
    const startTime = Date.now();
    while (fileLocks.get(filePath)) {
        if (Date.now() - startTime > timeout) {
            throw new Error(`Lock timeout for ${filePath}`);
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    fileLocks.set(filePath, true);
}

function releaseLock(filePath) {
    fileLocks.delete(filePath);
}

function loadJSON(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error loading ${filePath}:`, error.message);
        return null;
    }
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error saving ${filePath}:`, error.message);
        return false;
    }
}

// Safe read-modify-write operation with locking
async function withFileLock(filePath, operation) {
    await acquireLock(filePath);
    try {
        const data = loadJSON(filePath);
        const result = await operation(data);
        if (result.save !== false && result.data) {
            saveJSON(filePath, result.data);
        }
        return result;
    } finally {
        releaseLock(filePath);
    }
}

// Validation helpers
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePhone(phone) {
    // South African phone format or general international
    const phoneRegex = /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;
    return !phone || phoneRegex.test(phone);
}

function sanitizeString(str, maxLength = 500) {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLength);
}

function generateReferralCode(name) {
    const prefix = name.substring(0, 3).toUpperCase();
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${suffix}`;
}

// Import loyalty helper at top level for use throughout
const loyaltyHelperModule = require('./helpers/loyalty');

function calculateTier(points) {
    return loyaltyHelperModule.calculateTier(points);
}

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// AUTH MIDDLEWARE
// ============================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

function authenticateAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        if (req.user.role !== 'admin' && req.user.role !== 'staff') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        next();
    });
}

// ============================================
// AUTH ROUTES
// ============================================

// Sign up
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name, phone } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ success: false, message: 'Email, password, and name are required' });
    }

    // Check if email exists
    let existingUser = null;
    if (USE_DATABASE && UserRepository) {
        try {
            existingUser = await UserRepository.findByEmail(email);
        } catch (error) {
            console.error('Database error during signup:', error.message);
            return res.status(500).json({ success: false, message: 'Server error' });
        }
    } else {
        const usersData = loadJSON(USERS_FILE);
        existingUser = usersData.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    }

    if (existingUser) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create new user
    const userData = {
        id: uuidv4(),
        email: email.toLowerCase().trim(),
        passwordHash,
        name: name.trim(),
        phone: phone || null,
        role: 'customer',
        points: 0,
        tier: 'bronze',
        referralCode: generateReferralCode(name),
        referredBy: null
    };

    let newUser;
    if (USE_DATABASE && UserRepository) {
        try {
            newUser = await UserRepository.create(userData);
        } catch (error) {
            console.error('Database error creating user:', error.message);
            return res.status(500).json({ success: false, message: 'Failed to create account' });
        }
    } else {
        const usersData = loadJSON(USERS_FILE);
        newUser = {
            ...userData,
            hairTracker: { lastInstallDate: null, extensionType: null },
            createdAt: new Date().toISOString()
        };
        usersData.users.push(newUser);
        saveJSON(USERS_FILE, usersData);
    }

    // Generate token
    const token = jwt.sign(
        { id: newUser.id, email: newUser.email, role: newUser.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    // Return user without password (handle both SQLite snake_case and JSON camelCase)
    const { passwordHash: _, password_hash: __, ...userResponse } = newUser;

    res.status(201).json({
        success: true,
        message: 'Account created successfully',
        token,
        user: userResponse
    });
});

// Login with rate limiting
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    // Check rate limit
    const rateCheck = checkRateLimit(email.toLowerCase());
    if (!rateCheck.allowed) {
        console.log(`Rate limited login attempt for: ${email}`);
        return res.status(429).json({
            success: false,
            message: `Too many login attempts. Please try again in ${rateCheck.remainingMins} minutes.`
        });
    }

    let user = null;

    if (USE_DATABASE && UserRepository) {
        try {
            user = await UserRepository.findByEmail(email);
        } catch (error) {
            console.error('Database error during login:', error.message);
            return res.status(500).json({ success: false, message: 'Server error' });
        }
    } else {
        const usersData = loadJSON(USERS_FILE);
        user = usersData.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    }

    if (!user) {
        recordLoginAttempt(email.toLowerCase(), false);
        console.log(`Failed login attempt for unknown user: ${email}`);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash || user.passwordHash);
    if (!validPassword) {
        recordLoginAttempt(email.toLowerCase(), false);
        console.log(`Failed login attempt for: ${email}`);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Success - clear rate limit
    recordLoginAttempt(email.toLowerCase(), true);

    // Generate token
    const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    // Return user without password (handle both SQLite snake_case and JSON camelCase)
    const { passwordHash: _, password_hash: __, ...userResponse } = user;

    res.json({
        success: true,
        message: 'Login successful',
        token,
        user: userResponse,
        mustChangePassword: user.must_change_password || user.mustChangePassword || false
    });
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
    const usersData = loadJSON(USERS_FILE);
    const user = usersData.users.find(u => u.id === req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { passwordHash: _, ...userResponse } = user;
    res.json({ success: true, user: userResponse });
});

// ============================================
// OAUTH HELPER FUNCTIONS
// ============================================

function renderSocialSuccess(res, token, user) {
    const html = `
<!DOCTYPE html>
<html>
<head><title>Flirt Login</title></head>
<body>
<script>
  (function() {
    if (window.opener && window.opener.postMessage) {
      window.opener.postMessage({ type: 'flirt_social_login', token: ${JSON.stringify(token)}, user: ${JSON.stringify(user)} }, '*');
    }
    window.close();
  })();
</script>
</body>
</html>`;
    res.send(html);
}

function renderSocialError(res, message) {
    const html = `
<!DOCTYPE html>
<html>
<head><title>Flirt Login</title></head>
<body>
<script>
  (function() {
    if (window.opener && window.opener.postMessage) {
      window.opener.postMessage({ type: 'flirt_social_error', message: ${JSON.stringify(message)} }, '*');
    }
    window.close();
  })();
</script>
</body>
</html>`;
    res.send(html);
}

// Helper to make HTTPS requests (fallback if axios not available)
function httpsRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// ============================================
// GOOGLE OAUTH ROUTES
// ============================================

// Start Google OAuth
app.get('/api/auth/google/start', (req, res) => {
    const params = {
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
        access_type: 'online'
    };
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify(params);
    res.redirect(url);
});

// Google callback
app.get('/api/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return renderSocialError(res, 'Google sign-in was cancelled or failed.');
    }

    try {
        let tokenData, profileData;

        if (axios) {
            // Use axios if available
            const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code'
            });
            tokenData = tokenRes.data;

            const profileRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            profileData = profileRes.data;
        } else {
            // Fallback to native https
            const tokenBody = JSON.stringify({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_REDIRECT_URI,
                grant_type: 'authorization_code'
            });

            tokenData = await httpsRequest({
                hostname: 'oauth2.googleapis.com',
                path: '/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(tokenBody)
                }
            }, tokenBody);

            profileData = await httpsRequest({
                hostname: 'www.googleapis.com',
                path: '/oauth2/v3/userinfo',
                method: 'GET',
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
        }

        const email = (profileData.email || '').toLowerCase();
        const name = profileData.name || profileData.given_name || 'Flirt User';

        if (!email) {
            return renderSocialError(res, 'No email address returned from Google.');
        }

        // Find or create local user
        const usersData = loadJSON(USERS_FILE);
        if (!usersData.users) usersData.users = [];

        let user = usersData.users.find(u => u.email.toLowerCase() === email);

        if (!user) {
            user = {
                id: uuidv4(),
                email,
                name,
                phone: '',
                role: 'customer',
                points: 0,
                tier: 'bronze',
                referralCode: generateReferralCode(name),
                referredBy: null,
                hairTracker: { lastInstallDate: null, extensionType: null },
                createdAt: new Date().toISOString(),
                authProvider: 'google'
            };
            usersData.users.push(user);
            saveJSON(USERS_FILE, usersData);
            console.log(`New user created via Google OAuth: ${email}`);
        }

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        const { passwordHash, ...userResponse } = user;

        return renderSocialSuccess(res, token, userResponse);
    } catch (err) {
        console.error('Google OAuth error:', err.response?.data || err.message || err);
        return renderSocialError(res, 'Google sign-in failed. Please try again.');
    }
});

// ============================================
// FACEBOOK OAUTH ROUTES
// ============================================

// Start Facebook OAuth
app.get('/api/auth/facebook/start', (req, res) => {
    const params = {
        client_id: FACEBOOK_CLIENT_ID,
        redirect_uri: FACEBOOK_REDIRECT_URI,
        response_type: 'code',
        scope: 'email,public_profile'
    };
    const url = 'https://www.facebook.com/v18.0/dialog/oauth?' + querystring.stringify(params);
    res.redirect(url);
});

// Facebook callback
app.get('/api/auth/facebook/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return renderSocialError(res, 'Facebook sign-in was cancelled or failed.');
    }

    try {
        let tokenData, profileData;

        if (axios) {
            // Use axios if available
            const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
                params: {
                    client_id: FACEBOOK_CLIENT_ID,
                    client_secret: FACEBOOK_CLIENT_SECRET,
                    redirect_uri: FACEBOOK_REDIRECT_URI,
                    code
                }
            });
            tokenData = tokenRes.data;

            const profileRes = await axios.get('https://graph.facebook.com/me', {
                params: { fields: 'id,name,email', access_token: tokenData.access_token }
            });
            profileData = profileRes.data;
        } else {
            // Fallback to native https
            const tokenParams = querystring.stringify({
                client_id: FACEBOOK_CLIENT_ID,
                client_secret: FACEBOOK_CLIENT_SECRET,
                redirect_uri: FACEBOOK_REDIRECT_URI,
                code
            });

            tokenData = await httpsRequest({
                hostname: 'graph.facebook.com',
                path: `/v18.0/oauth/access_token?${tokenParams}`,
                method: 'GET'
            });

            const profileParams = querystring.stringify({
                fields: 'id,name,email',
                access_token: tokenData.access_token
            });

            profileData = await httpsRequest({
                hostname: 'graph.facebook.com',
                path: `/me?${profileParams}`,
                method: 'GET'
            });
        }

        const email = (profileData.email || '').toLowerCase();
        const name = profileData.name || 'Flirt User';

        if (!email) {
            return renderSocialError(res, 'No email address returned from Facebook. Please ensure your Facebook account has a verified email.');
        }

        const usersData = loadJSON(USERS_FILE);
        if (!usersData.users) usersData.users = [];

        let user = usersData.users.find(u => u.email.toLowerCase() === email);

        if (!user) {
            user = {
                id: uuidv4(),
                email,
                name,
                phone: '',
                role: 'customer',
                points: 0,
                tier: 'bronze',
                referralCode: generateReferralCode(name),
                referredBy: null,
                hairTracker: { lastInstallDate: null, extensionType: null },
                createdAt: new Date().toISOString(),
                authProvider: 'facebook'
            };
            usersData.users.push(user);
            saveJSON(USERS_FILE, usersData);
            console.log(`New user created via Facebook OAuth: ${email}`);
        }

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        const { passwordHash, ...userResponse } = user;

        return renderSocialSuccess(res, token, userResponse);
    } catch (err) {
        console.error('Facebook OAuth error:', err.response?.data || err.message || err);
        return renderSocialError(res, 'Facebook sign-in failed. Please try again.');
    }
});

// Update profile
app.patch('/api/auth/me', authenticateToken, (req, res) => {
    const { name, phone } = req.body;
    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) usersData.users[userIndex].name = name.trim();
    if (phone) usersData.users[userIndex].phone = phone;

    saveJSON(USERS_FILE, usersData);

    const { passwordHash: _, ...userResponse } = usersData.users[userIndex];
    res.json({ success: true, user: userResponse });
});

// ============================================
// HAIR PROFILE ENDPOINTS
// ============================================

// Get hair profile for authenticated user
app.get('/api/hair-profile', authenticateToken, (req, res) => {
    const usersData = loadJSON(USERS_FILE);
    const user = usersData.users.find(u => u.id === req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Return hair profile or defaults
    const hairProfile = user.hairProfile || {
        hairType: null,
        extensionType: null,
        preferredStylist: null,
        notes: null
    };

    res.json({ success: true, hairProfile });
});

// Update hair profile for authenticated user
app.patch('/api/hair-profile', authenticateToken, (req, res) => {
    const { hairType, extensionType, preferredStylist, notes } = req.body;
    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Initialize hairProfile if it doesn't exist
    if (!usersData.users[userIndex].hairProfile) {
        usersData.users[userIndex].hairProfile = {};
    }

    // Merge updates
    const profile = usersData.users[userIndex].hairProfile;
    if (hairType !== undefined) profile.hairType = hairType;
    if (extensionType !== undefined) profile.extensionType = extensionType;
    if (preferredStylist !== undefined) profile.preferredStylist = preferredStylist;
    if (notes !== undefined) profile.notes = notes;

    usersData.users[userIndex].updatedAt = new Date().toISOString();
    saveJSON(USERS_FILE, usersData);

    res.json({ success: true, hairProfile: profile });
});

// ============================================
// NOTIFICATION PREFERENCES ENDPOINTS
// ============================================

// Get notification preferences for authenticated user
app.get('/api/notification-prefs', authenticateToken, (req, res) => {
    const usersData = loadJSON(USERS_FILE);
    const user = usersData.users.find(u => u.id === req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Return notification prefs or defaults
    const notificationPrefs = user.notificationPrefs || {
        promotions: true,
        appointmentReminders: true,
        loyaltyUpdates: true
    };

    res.json({ success: true, notificationPrefs });
});

// Update notification preferences for authenticated user
app.patch('/api/notification-prefs', authenticateToken, (req, res) => {
    const { promotions, appointmentReminders, loyaltyUpdates } = req.body;
    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Initialize notificationPrefs if it doesn't exist
    if (!usersData.users[userIndex].notificationPrefs) {
        usersData.users[userIndex].notificationPrefs = {
            promotions: true,
            appointmentReminders: true,
            loyaltyUpdates: true
        };
    }

    // Merge updates
    const prefs = usersData.users[userIndex].notificationPrefs;
    if (promotions !== undefined) prefs.promotions = promotions;
    if (appointmentReminders !== undefined) prefs.appointmentReminders = appointmentReminders;
    if (loyaltyUpdates !== undefined) prefs.loyaltyUpdates = loyaltyUpdates;

    usersData.users[userIndex].updatedAt = new Date().toISOString();
    saveJSON(USERS_FILE, usersData);

    res.json({ success: true, notificationPrefs: prefs });
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Current and new password are required' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
    }

    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = usersData.users[userIndex];

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Hash and save new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    usersData.users[userIndex].passwordHash = newPasswordHash;
    usersData.users[userIndex].mustChangePassword = false;
    usersData.users[userIndex].updatedAt = new Date().toISOString();

    saveJSON(USERS_FILE, usersData);

    console.log(`Password changed for user: ${user.email}`);

    res.json({ success: true, message: 'Password changed successfully' });
});

// ============================================
// STYLISTS ROUTES
// ============================================

app.get('/api/stylists', (req, res) => {
    const data = loadJSON(STYLISTS_FILE);
    res.json({ success: true, stylists: data.stylists });
});

app.get('/api/stylists/:id', (req, res) => {
    const data = loadJSON(STYLISTS_FILE);
    const stylist = data.stylists.find(s => s.id === req.params.id);

    if (!stylist) {
        return res.status(404).json({ success: false, message: 'Stylist not found' });
    }

    res.json({ success: true, stylist });
});

// ============================================
// SERVICES ROUTES
// ============================================

app.get('/api/services/hair', (req, res) => {
    const data = loadJSON(SERVICES_FILE);
    res.json({ success: true, services: data.hairServices });
});

app.get('/api/services/beauty', (req, res) => {
    const data = loadJSON(SERVICES_FILE);
    res.json({ success: true, services: data.beautyServices });
});

// ============================================
// BOOKINGS ROUTES
// ============================================

// Helper function to check for booking conflicts
function checkBookingConflict(bookingsData, stylistId, date, time, excludeBookingId = null) {
    if (!time) return null; // No conflict check needed for time-of-day preference bookings

    const conflictingBooking = bookingsData.bookings.find(b => {
        // Skip cancelled bookings and the booking being updated
        if (b.status === 'cancelled') return false;
        if (excludeBookingId && b.id === excludeBookingId) return false;

        // Check same stylist, same date, same time
        if (b.stylistId === stylistId && b.date === date) {
            // For confirmed bookings with exact time
            if (b.confirmedTime === time || b.time === time) {
                return true;
            }
        }
        return false;
    });

    return conflictingBooking;
}

// Create booking
app.post('/api/bookings', authenticateToken, (req, res) => {
    const { type, stylistId, serviceId, date, preferredTimeOfDay, time, notes } = req.body;

    if (!type || !serviceId || !date) {
        return res.status(400).json({ success: false, message: 'Type, service, and date are required' });
    }

    if (type === 'hair' && !stylistId) {
        return res.status(400).json({ success: false, message: 'Stylist is required for hair bookings' });
    }

    if (type === 'beauty' && !time) {
        return res.status(400).json({ success: false, message: 'Time is required for beauty bookings' });
    }

    // Validate date is in the future
    const bookingDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
        return res.status(400).json({ success: false, message: 'Booking date must be in the future' });
    }

    const bookingsData = loadJSON(BOOKINGS_FILE);
    const servicesData = loadJSON(SERVICES_FILE);

    // Check for booking conflicts (exact same stylist, date, time)
    if (time && stylistId) {
        const conflict = checkBookingConflict(bookingsData, stylistId, date, time);
        if (conflict) {
            return res.status(409).json({
                success: false,
                message: 'This time slot is already booked. Please select a different time.',
                conflict: {
                    date: conflict.date,
                    time: conflict.confirmedTime || conflict.time
                }
            });
        }
    }

    // Get service details
    let service;
    if (type === 'hair') {
        service = servicesData.hairServices.find(s => s.id === serviceId);
    } else {
        service = servicesData.beautyServices.find(s => s.id === serviceId);
    }

    if (!service) {
        return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const newBooking = {
        id: uuidv4(),
        userId: req.user.id,
        type,
        stylistId: stylistId || null,
        serviceId,
        serviceName: service.name,
        servicePrice: service.price,
        date,
        preferredTimeOfDay: type === 'hair' ? (preferredTimeOfDay || null) : null,
        time: type === 'beauty' ? time : null,
        confirmedTime: type === 'beauty' ? time : null,
        status: type === 'hair' ? 'pending' : 'confirmed',
        notes: notes || null,
        createdAt: new Date().toISOString()
    };

    bookingsData.bookings.push(newBooking);
    saveJSON(BOOKINGS_FILE, bookingsData);

    // Award loyalty points for booking (using centralized config)
    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);
    if (userIndex !== -1) {
        const pointsToAdd = loyaltyHelperModule.getBookingPoints();
        usersData.users[userIndex].points += pointsToAdd;
        usersData.users[userIndex].tier = calculateTier(usersData.users[userIndex].points);
        saveJSON(USERS_FILE, usersData);

        // Log transaction
        const loyaltyData = loadJSON(LOYALTY_FILE);
        loyaltyData.transactions.push({
            id: uuidv4(),
            userId: req.user.id,
            points: pointsToAdd,
            type: 'earned',
            description: `Booking: ${service.name}`,
            createdAt: new Date().toISOString()
        });
        saveJSON(LOYALTY_FILE, loyaltyData);
    }

    res.status(201).json({
        success: true,
        message: type === 'hair'
            ? 'Booking request submitted. We will contact you within 24 hours to confirm the time.'
            : 'Booking confirmed!',
        booking: newBooking
    });
});

// Get user's bookings
app.get('/api/bookings', authenticateToken, (req, res) => {
    const bookingsData = loadJSON(BOOKINGS_FILE);
    const userBookings = bookingsData.bookings.filter(b => b.userId === req.user.id);

    // Sort by date descending
    userBookings.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, bookings: userBookings });
});

// Cancel/reschedule booking
app.patch('/api/bookings/:id', authenticateToken, (req, res) => {
    const { status, date, preferredTimeOfDay, time, confirmedTime } = req.body;
    const bookingsData = loadJSON(BOOKINGS_FILE);

    const bookingIndex = bookingsData.bookings.findIndex(
        b => b.id === req.params.id && b.userId === req.user.id
    );

    if (bookingIndex === -1) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (status) bookingsData.bookings[bookingIndex].status = status;
    if (date) {
        bookingsData.bookings[bookingIndex].date = date;
        // Reset status to pending when rescheduling
        if (!status) bookingsData.bookings[bookingIndex].status = 'pending';
    }
    if (preferredTimeOfDay !== undefined) bookingsData.bookings[bookingIndex].preferredTimeOfDay = preferredTimeOfDay;
    if (time) bookingsData.bookings[bookingIndex].time = time;
    // Allow confirmedTime to be explicitly set to null (when rescheduling)
    if (confirmedTime !== undefined) bookingsData.bookings[bookingIndex].confirmedTime = confirmedTime;

    bookingsData.bookings[bookingIndex].updatedAt = new Date().toISOString();

    saveJSON(BOOKINGS_FILE, bookingsData);

    res.json({ success: true, booking: bookingsData.bookings[bookingIndex] });
});

// ============================================
// PRODUCTS ROUTES
// ============================================

app.get('/api/products', (req, res) => {
    const { category, onSale } = req.query;
    const data = loadJSON(PRODUCTS_FILE);

    let products = data.products;

    if (category) {
        products = products.filter(p => p.category === category);
    }

    if (onSale === 'true') {
        products = products.filter(p => p.onSale);
    }

    res.json({ success: true, products });
});

app.get('/api/products/:id', (req, res) => {
    const data = loadJSON(PRODUCTS_FILE);
    const product = data.products.find(p => p.id === req.params.id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, product });
});

// ============================================
// ORDERS ROUTES
// ============================================

// Create order
app.post('/api/orders', authenticateToken, (req, res) => {
    const { items, deliveryMethod, deliveryAddress, promoCode } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Order must contain items' });
    }

    const productsData = loadJSON(PRODUCTS_FILE);
    const ordersData = loadJSON(ORDERS_FILE);

    // Calculate order totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
        const product = productsData.products.find(p => p.id === item.productId);
        if (!product) {
            return res.status(404).json({ success: false, message: `Product ${item.productId} not found` });
        }
        if (product.stock < item.quantity) {
            return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}` });
        }

        const unitPrice = product.onSale && product.salePrice ? product.salePrice : product.price;
        subtotal += unitPrice * item.quantity;

        orderItems.push({
            productId: product.id,
            productName: product.name,
            quantity: item.quantity,
            unitPrice
        });
    }

    // Delivery fee
    const deliveryFees = { pickup: 0, standard: 65, express: 120 };
    const deliveryFee = deliveryFees[deliveryMethod] || 0;

    // Apply promo code
    let discount = 0;
    let appliedPromo = null;
    if (promoCode) {
        const promosData = loadJSON(PROMOS_FILE);
        const promo = promosData.promos.find(
            p => p.code.toUpperCase() === promoCode.toUpperCase() && p.active
        );

        if (promo && new Date(promo.expiresAt) > new Date()) {
            if (!promo.minOrder || subtotal >= promo.minOrder) {
                if (promo.discountType === 'percentage') {
                    discount = Math.round(subtotal * (promo.discountValue / 100));
                } else {
                    discount = promo.discountValue;
                }
                appliedPromo = promo.code;

                // Increment usage
                promo.timesUsed++;
                saveJSON(PROMOS_FILE, promosData);
            }
        }
    }

    const total = subtotal + deliveryFee - discount;

    const newOrder = {
        id: uuidv4(),
        userId: req.user.id,
        items: orderItems,
        subtotal,
        deliveryMethod: deliveryMethod || 'pickup',
        deliveryFee,
        deliveryAddress: deliveryAddress || null,
        promoCode: appliedPromo,
        discount,
        total,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    ordersData.orders.push(newOrder);
    saveJSON(ORDERS_FILE, ordersData);

    // Update product stock
    for (const item of items) {
        const productIndex = productsData.products.findIndex(p => p.id === item.productId);
        if (productIndex !== -1) {
            productsData.products[productIndex].stock -= item.quantity;
        }
    }
    saveJSON(PRODUCTS_FILE, productsData);

    // Award loyalty points (using centralized config)
    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);
    if (userIndex !== -1) {
        const pointsToAdd = loyaltyHelperModule.calculateSpendPoints(total);
        usersData.users[userIndex].points += pointsToAdd;
        usersData.users[userIndex].tier = calculateTier(usersData.users[userIndex].points);
        saveJSON(USERS_FILE, usersData);

        const loyaltyData = loadJSON(LOYALTY_FILE);
        loyaltyData.transactions.push({
            id: uuidv4(),
            userId: req.user.id,
            points: pointsToAdd,
            type: 'earned',
            description: `Order #${newOrder.id.substring(0, 8)}`,
            createdAt: new Date().toISOString()
        });
        saveJSON(LOYALTY_FILE, loyaltyData);
    }

    res.status(201).json({
        success: true,
        message: 'Order placed successfully!',
        order: newOrder
    });
});

// Get user's orders
app.get('/api/orders', authenticateToken, (req, res) => {
    const ordersData = loadJSON(ORDERS_FILE);
    const userOrders = ordersData.orders.filter(o => o.userId === req.user.id);

    userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, orders: userOrders });
});

// ============================================
// PROMO ROUTES
// ============================================

app.post('/api/promo/validate', (req, res) => {
    const { code, subtotal } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, message: 'Promo code is required' });
    }

    const promosData = loadJSON(PROMOS_FILE);
    const promo = promosData.promos.find(
        p => p.code.toUpperCase() === code.toUpperCase() && p.active
    );

    if (!promo) {
        return res.status(404).json({ success: false, message: 'Invalid promo code' });
    }

    if (new Date(promo.expiresAt) < new Date()) {
        return res.status(400).json({ success: false, message: 'Promo code has expired' });
    }

    if (promo.usageLimit && promo.timesUsed >= promo.usageLimit) {
        return res.status(400).json({ success: false, message: 'Promo code usage limit reached' });
    }

    if (promo.minOrder && subtotal < promo.minOrder) {
        return res.status(400).json({
            success: false,
            message: `Minimum order of R${promo.minOrder} required`
        });
    }

    let discount = 0;
    if (promo.discountType === 'percentage') {
        discount = Math.round((subtotal || 0) * (promo.discountValue / 100));
    } else {
        discount = promo.discountValue;
    }

    res.json({
        success: true,
        promo: {
            code: promo.code,
            description: promo.description,
            discountType: promo.discountType,
            discountValue: promo.discountValue,
            calculatedDiscount: discount
        }
    });
});

// Get highlighted promos for Special Offers section (public endpoint)
app.get('/api/promos/highlighted', (req, res) => {
    try {
        const data = loadJSON(PROMOS_FILE);
        const now = new Date();

        // Filter for active, highlighted promos that haven't expired
        const promos = data.promos
            .filter(p => p.active && p.highlighted)
            .filter(p => !p.expiresAt || new Date(p.expiresAt) >= now)
            .map(p => ({
                // Only return safe, public fields
                code: p.code,
                description: p.description,
                discountType: p.discountType,
                discountValue: p.discountValue,
                minOrder: p.minOrder || 0,
                expiresAt: p.expiresAt,
                badge: p.badge || 'SPECIAL',
                title: p.title || p.code,
                subtitle: p.subtitle || p.description || '',
                priority: p.priority || 0
            }))
            .sort((a, b) => (a.priority || 0) - (b.priority || 0));

        res.json({ success: true, promos });
    } catch (error) {
        console.error('Error loading highlighted promos:', error);
        res.status(500).json({ success: false, message: 'Failed to load special offers' });
    }
});

// ============================================
// LOYALTY ROUTES
// ============================================

app.get('/api/loyalty/balance', authenticateToken, (req, res) => {
    const usersData = loadJSON(USERS_FILE);
    const user = usersData.users.find(u => u.id === req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
        success: true,
        points: user.points,
        tier: user.tier,
        referralCode: user.referralCode
    });
});

app.get('/api/loyalty/history', authenticateToken, (req, res) => {
    const loyaltyData = loadJSON(LOYALTY_FILE);
    const transactions = loyaltyData.transactions.filter(t => t.userId === req.user.id);

    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, transactions });
});

app.post('/api/loyalty/redeem', authenticateToken, (req, res) => {
    const { points, rewardType } = req.body;

    const usersData = loadJSON(USERS_FILE);
    const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (usersData.users[userIndex].points < points) {
        return res.status(400).json({ success: false, message: 'Insufficient points' });
    }

    usersData.users[userIndex].points -= points;
    usersData.users[userIndex].tier = calculateTier(usersData.users[userIndex].points);
    saveJSON(USERS_FILE, usersData);

    // Log redemption
    const loyaltyData = loadJSON(LOYALTY_FILE);
    loyaltyData.transactions.push({
        id: uuidv4(),
        userId: req.user.id,
        points: -points,
        type: 'redeemed',
        description: `Redeemed: ${rewardType || 'Discount'}`,
        createdAt: new Date().toISOString()
    });
    saveJSON(LOYALTY_FILE, loyaltyData);

    res.json({
        success: true,
        message: 'Points redeemed successfully!',
        remainingPoints: usersData.users[userIndex].points
    });
});

// ============================================
// REFERRAL ROUTES
// ============================================

app.post('/api/referrals/apply', authenticateToken, (req, res) => {
    const { referralCode } = req.body;

    if (!referralCode) {
        return res.status(400).json({ success: false, message: 'Referral code is required' });
    }

    const usersData = loadJSON(USERS_FILE);
    const currentUser = usersData.users.find(u => u.id === req.user.id);

    if (currentUser.referredBy) {
        return res.status(400).json({ success: false, message: 'You have already used a referral code' });
    }

    const referrer = usersData.users.find(
        u => u.referralCode.toUpperCase() === referralCode.toUpperCase() && u.id !== req.user.id
    );

    if (!referrer) {
        return res.status(404).json({ success: false, message: 'Invalid referral code' });
    }

    // Update current user
    const currentUserIndex = usersData.users.findIndex(u => u.id === req.user.id);
    usersData.users[currentUserIndex].referredBy = referrer.id;

    // Award points to both (using centralized config)
    const referralPoints = loyaltyHelperModule.getReferralPoints();

    // Points to referrer
    const referrerIndex = usersData.users.findIndex(u => u.id === referrer.id);
    usersData.users[referrerIndex].points += referralPoints;
    usersData.users[referrerIndex].tier = calculateTier(usersData.users[referrerIndex].points);

    // Points to referee
    usersData.users[currentUserIndex].points += referralPoints;
    usersData.users[currentUserIndex].tier = calculateTier(usersData.users[currentUserIndex].points);

    saveJSON(USERS_FILE, usersData);

    // Log transactions
    const loyaltyData = loadJSON(LOYALTY_FILE);
    loyaltyData.transactions.push({
        id: uuidv4(),
        userId: referrer.id,
        points: referralPoints,
        type: 'earned',
        description: `Referral: ${currentUser.name} joined`,
        createdAt: new Date().toISOString()
    });
    loyaltyData.transactions.push({
        id: uuidv4(),
        userId: req.user.id,
        points: referralPoints,
        type: 'earned',
        description: `Welcome bonus: Referred by ${referrer.name}`,
        createdAt: new Date().toISOString()
    });
    saveJSON(LOYALTY_FILE, loyaltyData);

    res.json({
        success: true,
        message: `Referral applied! You and ${referrer.name} each earned ${referralPoints} points!`,
        pointsEarned: referralPoints
    });
});

app.get('/api/referrals', authenticateToken, (req, res) => {
    const usersData = loadJSON(USERS_FILE);
    const currentUser = usersData.users.find(u => u.id === req.user.id);

    const referrals = usersData.users.filter(u => u.referredBy === req.user.id);

    res.json({
        success: true,
        referralCode: currentUser.referralCode,
        referralCount: referrals.length,
        referrals: referrals.map(r => ({ name: r.name, date: r.createdAt }))
    });
});

// ============================================
// HAIR TRACKER ROUTES
// ============================================

// Get hair tracker config (public - no auth required)
app.get('/api/hair-tracker/config', (req, res) => {
    try {
        const config = loadJSON(HAIR_TRACKER_FILE);
        if (!config) {
            return res.status(500).json({ success: false, message: 'Hair tracker config not found' });
        }
        res.json({ success: true, config });
    } catch (error) {
        console.error('Error loading hair tracker config:', error);
        res.status(500).json({ success: false, message: 'Failed to load hair tracker config' });
    }
});

// Get user's hair tracker data with computed metrics
app.get('/api/hair-tracker', authenticateToken, (req, res) => {
    try {
        const usersData = loadJSON(USERS_FILE);
        const user = usersData.users.find(u => u.id === req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const tracker = user.hairTracker || {};
        const config = loadJSON(HAIR_TRACKER_FILE) || {};
        const today = new Date();

        // Derive maintenance interval from config if not set on user
        let maintenanceIntervalDays = tracker.maintenanceIntervalDays;
        if (!maintenanceIntervalDays && tracker.extensionType) {
            maintenanceIntervalDays = config.extensionTypeIntervals?.[tracker.extensionType]
                || config.defaultMaintenanceIntervalDays
                || 42;
        } else if (!maintenanceIntervalDays) {
            maintenanceIntervalDays = config.defaultMaintenanceIntervalDays || 42;
        }

        let daysSinceInstall = null;
        let daysUntilMaintenance = null;
        let nextMaintenanceDate = tracker.nextMaintenanceDate;

        if (tracker.lastInstallDate) {
            const lastInstall = new Date(tracker.lastInstallDate);
            daysSinceInstall = Math.floor((today - lastInstall) / 86400000);

            // Calculate next maintenance date if not set
            if (!nextMaintenanceDate) {
                const nm = new Date(lastInstall.getTime() + maintenanceIntervalDays * 86400000);
                nextMaintenanceDate = nm.toISOString();
            }
            daysUntilMaintenance = Math.max(0, Math.floor((new Date(nextMaintenanceDate) - today) / 86400000));
        }

        // Calculate next wash date
        const washFrequency = config.washFrequencyDays || 3;
        let nextWashDate = null;
        let daysUntilWash = null;
        if (tracker.lastWashDate) {
            const lastWash = new Date(tracker.lastWashDate);
            const nextWash = new Date(lastWash.getTime() + washFrequency * 86400000);
            nextWashDate = nextWash.toISOString();
            daysUntilWash = Math.max(0, Math.floor((nextWash - today) / 86400000));
        }

        // Calculate deep condition schedule
        const deepConditionFrequency = config.deepConditionFrequencyDays || 14;
        let nextDeepConditionDate = null;
        let daysUntilDeepCondition = null;
        if (tracker.lastDeepConditionDate) {
            const lastDeep = new Date(tracker.lastDeepConditionDate);
            const nextDeep = new Date(lastDeep.getTime() + deepConditionFrequency * 86400000);
            nextDeepConditionDate = nextDeep.toISOString();
            daysUntilDeepCondition = Math.max(0, Math.floor((nextDeep - today) / 86400000));
        }

        const washes = tracker.washHistory?.length || 0;
        const productsUsedCount = tracker.productsUsed?.length || 0;

        // Calculate hair health score
        const healthCfg = config.healthScore || {};
        const baseScore = healthCfg.base ?? 100;
        const penalties = healthCfg.penalties || {};
        let hairHealthScore = baseScore;

        // Apply penalties
        if (daysUntilMaintenance !== null && daysUntilMaintenance < 0) {
            // Overdue for maintenance
            const overdueDays = Math.abs(daysUntilMaintenance);
            hairHealthScore -= overdueDays * (penalties.overMaintenanceByDay || 0.5);
        }

        if (tracker.lastDeepConditionDate) {
            const daysSinceDeepCondition = Math.floor((today - new Date(tracker.lastDeepConditionDate)) / 86400000);
            if (daysSinceDeepCondition > deepConditionFrequency * 2) {
                hairHealthScore -= (daysSinceDeepCondition - deepConditionFrequency) * (penalties.noDeepConditionOverDays || 0.3);
            }
        }

        // Check wash frequency (too many washes per week)
        if (tracker.washHistory && tracker.washHistory.length > 0) {
            const oneWeekAgo = new Date(today.getTime() - 7 * 86400000);
            const washesThisWeek = tracker.washHistory.filter(w => new Date(w.date) >= oneWeekAgo).length;
            if (washesThisWeek > 3) {
                hairHealthScore -= (washesThisWeek - 3) * (penalties.tooManyWashesPerWeek || 1.0);
            }
        }

        // Clamp health score between 0 and 100
        hairHealthScore = Math.max(0, Math.min(100, Math.round(hairHealthScore)));

        res.json({
            success: true,
            data: {
                ...tracker,
                maintenanceIntervalDays,
                nextMaintenanceDate,
                daysSinceInstall,
                daysUntilMaintenance,
                nextWashDate,
                daysUntilWash,
                nextDeepConditionDate,
                daysUntilDeepCondition,
                washes,
                productsUsedCount,
                hairHealthScore,
                washFrequencyDays: washFrequency,
                deepConditionFrequencyDays: deepConditionFrequency
            }
        });
    } catch (error) {
        console.error('Error getting hair tracker:', error);
        res.status(500).json({ success: false, message: 'Failed to load hair tracker data' });
    }
});

// Update hair tracker (extend existing PATCH)
app.patch('/api/hair-tracker', authenticateToken, (req, res) => {
    try {
        const {
            lastInstallDate,
            extensionType,
            maintenanceIntervalDays,
            nextMaintenanceDate,
            lastDeepConditionDate,
            productsUsed,
            hairHealthScore
        } = req.body;

        const usersData = loadJSON(USERS_FILE);
        const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = usersData.users[userIndex];
        const existingTracker = user.hairTracker || {};

        // Merge with existing data
        user.hairTracker = {
            ...existingTracker,
            lastInstallDate: lastInstallDate !== undefined ? lastInstallDate : existingTracker.lastInstallDate,
            extensionType: extensionType !== undefined ? extensionType : existingTracker.extensionType,
            maintenanceIntervalDays: maintenanceIntervalDays !== undefined ? maintenanceIntervalDays : existingTracker.maintenanceIntervalDays,
            nextMaintenanceDate: nextMaintenanceDate !== undefined ? nextMaintenanceDate : existingTracker.nextMaintenanceDate,
            lastDeepConditionDate: lastDeepConditionDate !== undefined ? lastDeepConditionDate : existingTracker.lastDeepConditionDate,
            productsUsed: productsUsed !== undefined ? productsUsed : existingTracker.productsUsed,
            hairHealthScore: hairHealthScore !== undefined ? hairHealthScore : existingTracker.hairHealthScore,
            washHistory: existingTracker.washHistory || [],
            lastWashDate: existingTracker.lastWashDate
        };

        // If lastInstallDate changed, reset nextMaintenanceDate to recalculate
        if (lastInstallDate && lastInstallDate !== existingTracker.lastInstallDate) {
            const config = loadJSON(HAIR_TRACKER_FILE) || {};
            const extType = extensionType || existingTracker.extensionType;
            const interval = maintenanceIntervalDays
                || config.extensionTypeIntervals?.[extType]
                || config.defaultMaintenanceIntervalDays
                || 42;
            const nm = new Date(new Date(lastInstallDate).getTime() + interval * 86400000);
            user.hairTracker.nextMaintenanceDate = nm.toISOString();
        }

        saveJSON(USERS_FILE, usersData);

        res.json({
            success: true,
            hairTracker: user.hairTracker
        });
    } catch (error) {
        console.error('Error updating hair tracker:', error);
        res.status(500).json({ success: false, message: 'Failed to update hair tracker' });
    }
});

// Log a wash event
app.post('/api/hair-tracker/log-wash', authenticateToken, (req, res) => {
    try {
        const { date, notes } = req.body;
        const usersData = loadJSON(USERS_FILE);
        const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = usersData.users[userIndex];
        user.hairTracker = user.hairTracker || {};
        user.hairTracker.washHistory = user.hairTracker.washHistory || [];

        const washDate = date ? new Date(date) : new Date();

        user.hairTracker.washHistory.push({
            id: uuidv4(),
            date: washDate.toISOString(),
            notes: notes || ''
        });
        user.hairTracker.lastWashDate = washDate.toISOString();

        saveJSON(USERS_FILE, usersData);

        res.json({
            success: true,
            message: 'Wash logged successfully',
            hairTracker: user.hairTracker
        });
    } catch (error) {
        console.error('Error logging wash:', error);
        res.status(500).json({ success: false, message: 'Failed to log wash' });
    }
});

// Log a deep condition event
app.post('/api/hair-tracker/log-deep-condition', authenticateToken, (req, res) => {
    try {
        const { date, notes } = req.body;
        const usersData = loadJSON(USERS_FILE);
        const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = usersData.users[userIndex];
        user.hairTracker = user.hairTracker || {};
        user.hairTracker.deepConditionHistory = user.hairTracker.deepConditionHistory || [];

        const conditionDate = date ? new Date(date) : new Date();

        user.hairTracker.deepConditionHistory.push({
            id: uuidv4(),
            date: conditionDate.toISOString(),
            notes: notes || ''
        });
        user.hairTracker.lastDeepConditionDate = conditionDate.toISOString();

        saveJSON(USERS_FILE, usersData);

        res.json({
            success: true,
            message: 'Deep condition logged successfully',
            hairTracker: user.hairTracker
        });
    } catch (error) {
        console.error('Error logging deep condition:', error);
        res.status(500).json({ success: false, message: 'Failed to log deep condition' });
    }
});

// Add a product to tracker
app.post('/api/hair-tracker/add-product', authenticateToken, (req, res) => {
    try {
        const { productId, productName } = req.body;

        if (!productId && !productName) {
            return res.status(400).json({ success: false, message: 'Product ID or name required' });
        }

        const usersData = loadJSON(USERS_FILE);
        const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = usersData.users[userIndex];
        user.hairTracker = user.hairTracker || {};
        user.hairTracker.productsUsed = user.hairTracker.productsUsed || [];

        // Check if product already exists
        const existingProduct = user.hairTracker.productsUsed.find(p =>
            (productId && p.productId === productId) || (productName && p.productName === productName)
        );

        if (!existingProduct) {
            user.hairTracker.productsUsed.push({
                productId: productId || null,
                productName: productName || null,
                addedAt: new Date().toISOString()
            });
            saveJSON(USERS_FILE, usersData);
        }

        res.json({
            success: true,
            message: existingProduct ? 'Product already tracked' : 'Product added successfully',
            hairTracker: user.hairTracker
        });
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ success: false, message: 'Failed to add product' });
    }
});

// Remove a product from tracker
app.delete('/api/hair-tracker/remove-product/:productId', authenticateToken, (req, res) => {
    try {
        const { productId } = req.params;

        const usersData = loadJSON(USERS_FILE);
        const userIndex = usersData.users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = usersData.users[userIndex];
        if (user.hairTracker?.productsUsed) {
            user.hairTracker.productsUsed = user.hairTracker.productsUsed.filter(p => p.productId !== productId);
            saveJSON(USERS_FILE, usersData);
        }

        res.json({
            success: true,
            message: 'Product removed successfully',
            hairTracker: user.hairTracker
        });
    } catch (error) {
        console.error('Error removing product:', error);
        res.status(500).json({ success: false, message: 'Failed to remove product' });
    }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Dashboard stats
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
    const bookingsData = loadJSON(BOOKINGS_FILE);
    const ordersData = loadJSON(ORDERS_FILE);
    const usersData = loadJSON(USERS_FILE);

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Get first day of current month (YYYY-MM-01)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Revenue this month (from orders with createdAt in current month, excluding cancelled)
    const monthRevenue = ordersData.orders
        .filter(o => {
            if (o.status === 'cancelled') return false;
            const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
            return orderDate && orderDate >= monthStart && orderDate <= today;
        })
        .reduce((sum, o) => sum + (o.total || 0), 0);

    // Bookings this month
    const monthBookings = bookingsData.bookings.filter(b => {
        return b.date && b.date >= monthStart && b.date <= today;
    }).length;

    // Product orders this month
    const monthOrders = ordersData.orders.filter(o => {
        const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
        return orderDate && orderDate >= monthStart && orderDate <= today;
    }).length;

    // Active customers (users who have made a booking or order in the last 90 days)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const activeUserIds = new Set();

    bookingsData.bookings.forEach(b => {
        if (b.date >= ninetyDaysAgo) activeUserIds.add(b.userId);
    });
    ordersData.orders.forEach(o => {
        const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
        if (orderDate && orderDate >= ninetyDaysAgo) activeUserIds.add(o.userId);
    });
    const activeCustomers = activeUserIds.size;

    // Today's bookings count
    const todayBookings = bookingsData.bookings.filter(b => b.date === today).length;
    const pendingBookings = bookingsData.bookings.filter(b => b.status === 'pending').length;
    const pendingOrders = ordersData.orders.filter(o => o.status === 'pending').length;

    res.json({
        success: true,
        stats: {
            // New monthly metrics for dashboard cards
            monthRevenue,
            monthBookings,
            monthOrders,
            activeCustomers,
            // Legacy fields (still useful for other purposes)
            totalRevenue: ordersData.orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.total || 0), 0),
            totalBookings: bookingsData.bookings.length,
            todayBookings,
            pendingBookings,
            totalOrders: ordersData.orders.length,
            pendingOrders,
            totalCustomers: usersData.users.length
        }
    });
});

// Revenue trend data for charts (last 30 days by default)
app.get('/api/admin/revenue-trend', authenticateAdmin, (req, res) => {
    const { range = '30d' } = req.query;
    const ordersData = loadJSON(ORDERS_FILE);

    const now = new Date();
    let days = 30;
    if (range === '7d') days = 7;
    else if (range === '90d') days = 90;

    // Build array of dates for the last N days
    const labels = [];
    const values = [];

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(dateStr);

        // Sum revenue for this day from orders (paid, not cancelled)
        const dayRevenue = ordersData.orders
            .filter(o => {
                if (o.status === 'cancelled' || o.paymentStatus !== 'paid') return false;
                const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
                return orderDate === dateStr;
            })
            .reduce((sum, o) => sum + (o.total || 0), 0);

        values.push(dayRevenue);
    }

    res.json({ success: true, labels, values });
});

// Popular services data for charts (last 30 days by default)
app.get('/api/admin/popular-services', authenticateAdmin, (req, res) => {
    const { range = '30d' } = req.query;
    const bookingsData = loadJSON(BOOKINGS_FILE);

    const now = new Date();
    let days = 30;
    if (range === '7d') days = 7;
    else if (range === '90d') days = 90;

    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Count bookings per service in the time range
    const serviceCounts = {};
    bookingsData.bookings.forEach(b => {
        if (b.date >= startDate) {
            const serviceName = b.serviceName || 'Unknown';
            serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
        }
    });

    // Sort by count and take top 5
    const sorted = Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const labels = sorted.map(s => s[0]);
    const values = sorted.map(s => s[1]);

    res.json({ success: true, labels, values });
});

// Get all bookings (admin)
app.get('/api/admin/bookings', authenticateAdmin, (req, res) => {
    const { status, date, stylistId } = req.query;
    const bookingsData = loadJSON(BOOKINGS_FILE);
    const usersData = loadJSON(USERS_FILE);

    let bookings = bookingsData.bookings;

    if (status) bookings = bookings.filter(b => b.status === status);
    if (date) bookings = bookings.filter(b => b.date === date);
    if (stylistId) bookings = bookings.filter(b => b.stylistId === stylistId);

    // Add customer info
    bookings = bookings.map(b => {
        const user = usersData.users.find(u => u.id === b.userId);
        return {
            ...b,
            customerName: user ? user.name : 'Unknown',
            customerPhone: user ? user.phone : null,
            customerEmail: user ? user.email : null
        };
    });

    bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, bookings });
});

// Confirm booking time (admin)
app.patch('/api/admin/bookings/:id/confirm', authenticateAdmin, (req, res) => {
    const { confirmedTime } = req.body;

    const bookingsData = loadJSON(BOOKINGS_FILE);
    const bookingIndex = bookingsData.bookings.findIndex(b => b.id === req.params.id);

    if (bookingIndex === -1) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    bookingsData.bookings[bookingIndex].confirmedTime = confirmedTime;
    bookingsData.bookings[bookingIndex].status = 'confirmed';
    bookingsData.bookings[bookingIndex].updatedAt = new Date().toISOString();

    saveJSON(BOOKINGS_FILE, bookingsData);

    res.json({ success: true, booking: bookingsData.bookings[bookingIndex] });
});

// Update booking status (admin) - supports 'completed', 'cancelled', 'pending', 'confirmed'
app.patch('/api/admin/bookings/:id/status', authenticateAdmin, (req, res) => {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
    }

    const bookingsData = loadJSON(BOOKINGS_FILE);
    const bookingIndex = bookingsData.bookings.findIndex(b => b.id === req.params.id);

    if (bookingIndex === -1) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    bookingsData.bookings[bookingIndex].status = status;
    bookingsData.bookings[bookingIndex].updatedAt = new Date().toISOString();

    // Add completion timestamp if marking as completed
    if (status === 'completed') {
        bookingsData.bookings[bookingIndex].completedAt = new Date().toISOString();
    }

    saveJSON(BOOKINGS_FILE, bookingsData);

    res.json({ success: true, booking: bookingsData.bookings[bookingIndex] });
});

// Get all orders (admin)
app.get('/api/admin/orders', authenticateAdmin, (req, res) => {
    const { status } = req.query;
    const ordersData = loadJSON(ORDERS_FILE);
    const usersData = loadJSON(USERS_FILE);

    let orders = ordersData.orders;

    if (status) orders = orders.filter(o => o.status === status);

    // Add customer info
    orders = orders.map(o => {
        const user = usersData.users.find(u => u.id === o.userId);
        return {
            ...o,
            customerName: user ? user.name : 'Unknown',
            customerPhone: user ? user.phone : null,
            customerEmail: user ? user.email : null
        };
    });

    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, orders });
});

// Update order status (admin)
app.patch('/api/admin/orders/:id', authenticateAdmin, (req, res) => {
    const { status } = req.body;

    const ordersData = loadJSON(ORDERS_FILE);
    const orderIndex = ordersData.orders.findIndex(o => o.id === req.params.id);

    if (orderIndex === -1) {
        return res.status(404).json({ success: false, message: 'Order not found' });
    }

    ordersData.orders[orderIndex].status = status;
    ordersData.orders[orderIndex].updatedAt = new Date().toISOString();

    saveJSON(ORDERS_FILE, ordersData);

    res.json({ success: true, order: ordersData.orders[orderIndex] });
});

// Get all customers (admin)
app.get('/api/admin/customers', authenticateAdmin, (req, res) => {
    const usersData = loadJSON(USERS_FILE);
    const bookingsData = loadJSON(BOOKINGS_FILE);
    const ordersData = loadJSON(ORDERS_FILE);

    const customers = usersData.users
        .filter(u => u.role === 'customer')
        .map(u => {
            const userBookings = bookingsData.bookings.filter(b => b.userId === u.id);
            const userOrders = ordersData.orders.filter(o => o.userId === u.id);
            const totalSpent = userOrders.reduce((sum, o) => sum + o.total, 0);

            return {
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                tier: u.tier,
                points: u.points,
                totalBookings: userBookings.length,
                totalOrders: userOrders.length,
                totalSpent,
                createdAt: u.createdAt
            };
        });

    res.json({ success: true, customers });
});

// Staff management (admin)
app.get('/api/admin/staff', authenticateAdmin, (req, res) => {
    const data = loadJSON(STYLISTS_FILE);
    res.json({ success: true, staff: data.stylists });
});

app.post('/api/admin/staff', authenticateAdmin, (req, res) => {
    const { name, specialty, tagline, instagram, color } = req.body;

    if (!name || !specialty) {
        return res.status(400).json({ success: false, message: 'Name and specialty are required' });
    }

    const data = loadJSON(STYLISTS_FILE);

    const newStylist = {
        id: name.toLowerCase().replace(/\s+/g, '_'),
        name,
        specialty,
        tagline: tagline || '',
        rating: 5.0,
        reviewCount: 0,
        clientsCount: 0,
        yearsExperience: 0,
        instagram: instagram || '',
        color: color || '#FF6B9D',
        available: true,
        imageUrl: 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=400'
    };

    data.stylists.push(newStylist);
    saveJSON(STYLISTS_FILE, data);

    res.status(201).json({ success: true, stylist: newStylist });
});

app.patch('/api/admin/staff/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(STYLISTS_FILE);
    const stylistIndex = data.stylists.findIndex(s => s.id === req.params.id);

    if (stylistIndex === -1) {
        return res.status(404).json({ success: false, message: 'Stylist not found' });
    }

    const allowedUpdates = ['name', 'specialty', 'tagline', 'instagram', 'color', 'available', 'imageUrl'];
    for (const key of allowedUpdates) {
        if (req.body[key] !== undefined) {
            data.stylists[stylistIndex][key] = req.body[key];
        }
    }

    saveJSON(STYLISTS_FILE, data);

    res.json({ success: true, stylist: data.stylists[stylistIndex] });
});

app.delete('/api/admin/staff/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(STYLISTS_FILE);
    const stylistIndex = data.stylists.findIndex(s => s.id === req.params.id);

    if (stylistIndex === -1) {
        return res.status(404).json({ success: false, message: 'Stylist not found' });
    }

    data.stylists.splice(stylistIndex, 1);
    saveJSON(STYLISTS_FILE, data);

    res.json({ success: true, message: 'Stylist deleted' });
});

// Product management (admin)
app.post('/api/admin/products', authenticateAdmin, (req, res) => {
    const { name, category, description, price, salePrice, stock, imageUrl } = req.body;

    if (!name || !category || !price) {
        return res.status(400).json({ success: false, message: 'Name, category, and price are required' });
    }

    const data = loadJSON(PRODUCTS_FILE);

    const newProduct = {
        id: `prod_${uuidv4().substring(0, 8)}`,
        name,
        category,
        description: description || '',
        price,
        salePrice: salePrice || null,
        onSale: !!salePrice,
        stock: stock || 0,
        imageUrl: imageUrl || ''
    };

    data.products.push(newProduct);
    saveJSON(PRODUCTS_FILE, data);

    res.status(201).json({ success: true, product: newProduct });
});

app.patch('/api/admin/products/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(PRODUCTS_FILE);
    const productIndex = data.products.findIndex(p => p.id === req.params.id);

    if (productIndex === -1) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const allowedUpdates = ['name', 'category', 'description', 'price', 'salePrice', 'onSale', 'stock', 'imageUrl'];
    for (const key of allowedUpdates) {
        if (req.body[key] !== undefined) {
            data.products[productIndex][key] = req.body[key];
        }
    }

    saveJSON(PRODUCTS_FILE, data);

    res.json({ success: true, product: data.products[productIndex] });
});

app.delete('/api/admin/products/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(PRODUCTS_FILE);
    const productIndex = data.products.findIndex(p => p.id === req.params.id);

    if (productIndex === -1) {
        return res.status(404).json({ success: false, message: 'Product not found' });
    }

    data.products.splice(productIndex, 1);
    saveJSON(PRODUCTS_FILE, data);

    res.json({ success: true, message: 'Product deleted' });
});

// Promo management (admin)
app.get('/api/admin/promos', authenticateAdmin, (req, res) => {
    const data = loadJSON(PROMOS_FILE);
    res.json({ success: true, promos: data.promos });
});

app.post('/api/admin/promos', authenticateAdmin, (req, res) => {
    const { code, description, discountType, discountValue, minOrder, expiresAt, usageLimit,
            highlighted, badge, title, subtitle, priority } = req.body;

    if (!code || !discountType || !discountValue) {
        return res.status(400).json({ success: false, message: 'Code, discount type, and value are required' });
    }

    const data = loadJSON(PROMOS_FILE);

    if (data.promos.find(p => p.code.toUpperCase() === code.toUpperCase())) {
        return res.status(409).json({ success: false, message: 'Promo code already exists' });
    }

    const newPromo = {
        id: `promo_${uuidv4().substring(0, 8)}`,
        code: code.toUpperCase(),
        description: description || '',
        discountType,
        discountValue,
        minOrder: minOrder || 0,
        expiresAt: expiresAt || null,
        usageLimit: usageLimit || null,
        timesUsed: 0,
        active: true,
        // Special Offer fields
        highlighted: highlighted === true,
        badge: badge || '',
        title: title || '',
        subtitle: subtitle || '',
        priority: typeof priority === 'number' ? priority : 0
    };

    data.promos.push(newPromo);
    saveJSON(PROMOS_FILE, data);

    res.status(201).json({ success: true, promo: newPromo });
});

app.patch('/api/admin/promos/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(PROMOS_FILE);
    const promoIndex = data.promos.findIndex(p => p.id === req.params.id);

    if (promoIndex === -1) {
        return res.status(404).json({ success: false, message: 'Promo not found' });
    }

    // Include Special Offer fields in allowed updates
    const allowedUpdates = ['description', 'discountType', 'discountValue', 'minOrder', 'expiresAt', 'usageLimit', 'active',
                           'highlighted', 'badge', 'title', 'subtitle', 'priority'];
    for (const key of allowedUpdates) {
        if (req.body[key] !== undefined) {
            data.promos[promoIndex][key] = req.body[key];
        }
    }

    saveJSON(PROMOS_FILE, data);

    res.json({ success: true, promo: data.promos[promoIndex] });
});

app.delete('/api/admin/promos/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(PROMOS_FILE);
    const promoIndex = data.promos.findIndex(p => p.id === req.params.id);

    if (promoIndex === -1) {
        return res.status(404).json({ success: false, message: 'Promo not found' });
    }

    data.promos.splice(promoIndex, 1);
    saveJSON(PROMOS_FILE, data);

    res.json({ success: true, message: 'Promo deleted' });
});

// ============================================
// LOYALTY SETTINGS MANAGEMENT (Admin)
// ============================================

// Import loyalty helper
const loyaltyHelper = require('./helpers/loyalty');

// Get loyalty configuration (admin)
app.get('/api/admin/loyalty', authenticateAdmin, (req, res) => {
    try {
        const config = loyaltyHelper.getLoyaltyConfig(true); // Force refresh
        res.json({
            success: true,
            pointsRules: config.pointsRules,
            tierThresholds: config.tierThresholds,
            referral: config.referral,
            earnRulesDisplay: config.earnRulesDisplay || []
        });
    } catch (error) {
        console.error('Error fetching loyalty config:', error);
        res.status(500).json({ success: false, message: 'Failed to load loyalty settings' });
    }
});

// Update loyalty configuration (admin)
app.put('/api/admin/loyalty', authenticateAdmin, (req, res) => {
    const { pointsRules, tierThresholds, referral, earnRulesDisplay } = req.body;

    // Validate input
    const validation = loyaltyHelper.validateLoyaltyConfig({ pointsRules, tierThresholds, referral, earnRulesDisplay });

    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            message: 'Invalid loyalty configuration',
            errors: validation.errors,
            warnings: validation.warnings || []
        });
    }

    // Save configuration
    const saved = loyaltyHelper.saveLoyaltyConfig({ pointsRules, tierThresholds, referral, earnRulesDisplay });

    if (saved) {
        const updatedConfig = loyaltyHelper.getLoyaltyConfig(true);
        res.json({
            success: true,
            message: 'Loyalty settings updated successfully',
            pointsRules: updatedConfig.pointsRules,
            tierThresholds: updatedConfig.tierThresholds,
            referral: updatedConfig.referral,
            earnRulesDisplay: updatedConfig.earnRulesDisplay,
            warnings: validation.warnings || []
        });
    } else {
        res.status(500).json({ success: false, message: 'Failed to save loyalty settings' });
    }
});

// Reset loyalty configuration to defaults (admin)
app.post('/api/admin/loyalty/reset', authenticateAdmin, (req, res) => {
    const defaultConfig = loyaltyHelper.getDefaultConfig();
    const saved = loyaltyHelper.saveLoyaltyConfig(defaultConfig);

    if (saved) {
        res.json({
            success: true,
            message: 'Loyalty settings reset to defaults',
            pointsRules: defaultConfig.pointsRules,
            tierThresholds: defaultConfig.tierThresholds,
            referral: defaultConfig.referral,
            earnRulesDisplay: defaultConfig.earnRulesDisplay
        });
    } else {
        res.status(500).json({ success: false, message: 'Failed to reset loyalty settings' });
    }
});

// ============================================
// ADMIN HAIR TRACKER SETTINGS
// ============================================

// Get hair tracker settings for admin
app.get('/api/admin/hair-tracker', authenticateAdmin, (req, res) => {
    try {
        const config = loadJSON(HAIR_TRACKER_FILE);
        if (!config) {
            return res.status(500).json({ success: false, message: 'Hair tracker config not found' });
        }
        res.json({ success: true, ...config });
    } catch (error) {
        console.error('Error loading hair tracker config:', error);
        res.status(500).json({ success: false, message: 'Failed to load hair tracker settings' });
    }
});

// Update hair tracker settings
app.put('/api/admin/hair-tracker', authenticateAdmin, (req, res) => {
    try {
        const {
            defaultMaintenanceIntervalDays,
            washFrequencyDays,
            deepConditionFrequencyDays,
            extensionTypeIntervals,
            extensionTypes,
            healthScore,
            copy,
            tips
        } = req.body;

        // Validate
        const errors = [];
        if (defaultMaintenanceIntervalDays !== undefined && (isNaN(defaultMaintenanceIntervalDays) || defaultMaintenanceIntervalDays < 1)) {
            errors.push('Default maintenance interval must be at least 1 day');
        }
        if (washFrequencyDays !== undefined && (isNaN(washFrequencyDays) || washFrequencyDays < 1)) {
            errors.push('Wash frequency must be at least 1 day');
        }
        if (deepConditionFrequencyDays !== undefined && (isNaN(deepConditionFrequencyDays) || deepConditionFrequencyDays < 1)) {
            errors.push('Deep condition frequency must be at least 1 day');
        }

        if (errors.length > 0) {
            return res.status(400).json({ success: false, errors });
        }

        // Load existing config
        const existingConfig = loadJSON(HAIR_TRACKER_FILE) || {};

        // Merge updates
        const updatedConfig = {
            defaultMaintenanceIntervalDays: parseInt(defaultMaintenanceIntervalDays) || existingConfig.defaultMaintenanceIntervalDays || 42,
            washFrequencyDays: parseInt(washFrequencyDays) || existingConfig.washFrequencyDays || 3,
            deepConditionFrequencyDays: parseInt(deepConditionFrequencyDays) || existingConfig.deepConditionFrequencyDays || 14,
            extensionTypeIntervals: extensionTypeIntervals || existingConfig.extensionTypeIntervals || {},
            extensionTypes: extensionTypes || existingConfig.extensionTypes || [],
            healthScore: healthScore || existingConfig.healthScore || { base: 100, penalties: {} },
            copy: copy || existingConfig.copy || {},
            tips: tips || existingConfig.tips || []
        };

        // Ensure extensionTypeIntervals is updated from extensionTypes if provided
        if (extensionTypes && Array.isArray(extensionTypes)) {
            updatedConfig.extensionTypeIntervals = {};
            extensionTypes.forEach(et => {
                if (et.id && et.maintenanceDays !== undefined) {
                    updatedConfig.extensionTypeIntervals[et.id] = parseInt(et.maintenanceDays) || 42;
                }
            });
        }

        saveJSON(HAIR_TRACKER_FILE, updatedConfig);

        res.json({
            success: true,
            message: 'Hair tracker settings updated successfully',
            ...updatedConfig
        });
    } catch (error) {
        console.error('Error updating hair tracker settings:', error);
        res.status(500).json({ success: false, message: 'Failed to update hair tracker settings' });
    }
});

// Reset hair tracker settings to defaults
app.post('/api/admin/hair-tracker/reset', authenticateAdmin, (req, res) => {
    try {
        const defaultConfig = {
            defaultMaintenanceIntervalDays: 42,
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            extensionTypeIntervals: {
                tapes: 42,
                wefts: 56,
                keratin_bonds: 90,
                clip_ins: 0,
                ponytails: 0
            },
            extensionTypes: [
                { id: 'tapes', label: 'Tape Extensions', maintenanceDays: 42 },
                { id: 'wefts', label: 'Weft Extensions', maintenanceDays: 56 },
                { id: 'keratin_bonds', label: 'Keratin Bonds', maintenanceDays: 90 },
                { id: 'clip_ins', label: 'Clip-In Extensions', maintenanceDays: 0 },
                { id: 'ponytails', label: 'Ponytails', maintenanceDays: 0 }
            ],
            healthScore: {
                base: 100,
                penalties: {
                    overMaintenanceByDay: 0.5,
                    noDeepConditionOverDays: 0.3,
                    tooManyWashesPerWeek: 1.0,
                    missedWashDay: 0.2
                }
            },
            copy: {
                trackerTitle: 'Hair Care Journey',
                trackerSubtitle: 'Keep your extensions healthy and on track',
                nextWashLabel: 'Next Wash Day',
                maintenanceLabel: 'Maintenance Due',
                deepConditionLabel: 'Deep Condition',
                noInstallMessage: 'Set up your hair tracker to get personalized care recommendations!',
                setupButtonText: 'Set Up Tracker'
            },
            tips: [
                'Your extensions are at optimal health! Keep up the great care routine.',
                'Consider booking maintenance in the next 2 weeks for best results.',
                'You\'re due for a deep conditioning treatment this week.',
                'Use a silk pillowcase to reduce friction and tangling while you sleep.',
                'Avoid applying heat directly to the bonds or tape areas.'
            ]
        };

        saveJSON(HAIR_TRACKER_FILE, defaultConfig);

        res.json({
            success: true,
            message: 'Hair tracker settings reset to defaults',
            ...defaultConfig
        });
    } catch (error) {
        console.error('Error resetting hair tracker settings:', error);
        res.status(500).json({ success: false, message: 'Failed to reset hair tracker settings' });
    }
});

// Get tier benefits info (public)
app.get('/api/loyalty/tiers', (req, res) => {
    const config = loyaltyHelper.getLoyaltyConfig();
    const tiers = ['bronze', 'silver', 'gold', 'platinum'].map(tier => ({
        name: tier,
        threshold: config.tierThresholds[tier],
        benefits: loyaltyHelper.getTierBenefits(tier)
    }));

    res.json({ success: true, tiers });
});

// Get public loyalty config (for client-side display)
// This endpoint returns all config needed to render the Rewards & Referrals section
app.get('/api/loyalty/config', (req, res) => {
    try {
        const config = loyaltyHelper.getLoyaltyConfig(true);

        res.json({
            success: true,
            pointsRules: config.pointsRules,
            tierThresholds: config.tierThresholds,
            referral: config.referral,
            earnRulesDisplay: config.earnRulesDisplay || []
        });
    } catch (error) {
        console.error('Error fetching public loyalty config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load loyalty configuration'
        });
    }
});

// ============================================
// SERVE HTML PAGES
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'flirt-hair-app.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'flirt-admin-console.html'));
});

// ============================================
// NOTIFICATION ENDPOINTS (Admin-triggered)
// ============================================

// Get active notifications (for client app)
app.get('/api/notifications/active', (req, res) => {
    const data = loadJSON(NOTIFICATIONS_FILE);
    if (!data) return res.json({ notifications: [] });

    const now = new Date();
    const active = data.notifications.filter(n => {
        if (!n.active) return false;
        if (n.expiresAt && new Date(n.expiresAt) < now) return false;
        if (n.startsAt && new Date(n.startsAt) > now) return false;
        return true;
    });

    res.json({ notifications: active });
});

// Get all notifications (admin)
app.get('/api/notifications', authenticateToken, (req, res) => {
    const data = loadJSON(NOTIFICATIONS_FILE);
    res.json(data || { notifications: [] });
});

// Create notification (admin only)
app.post('/api/notifications', authenticateAdmin, (req, res) => {
    const { title, message, type, action, actionText, startsAt, expiresAt } = req.body;

    if (!title || !message) {
        return res.status(400).json({ message: 'Title and message are required' });
    }

    const data = loadJSON(NOTIFICATIONS_FILE) || { notifications: [] };

    const notification = {
        id: uuidv4(),
        title,
        message,
        type: type || 'promo',
        action: action || null,
        actionText: actionText || 'View',
        active: true,
        startsAt: startsAt || new Date().toISOString(),
        expiresAt: expiresAt || null,
        createdAt: new Date().toISOString(),
        createdBy: req.user.userId
    };

    data.notifications.unshift(notification);
    saveJSON(NOTIFICATIONS_FILE, data);

    res.status(201).json({ message: 'Notification created', notification });
});

// Update notification (admin only)
app.put('/api/notifications/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(NOTIFICATIONS_FILE);
    if (!data) return res.status(404).json({ message: 'Notifications not found' });

    const index = data.notifications.findIndex(n => n.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Notification not found' });

    data.notifications[index] = { ...data.notifications[index], ...req.body, updatedAt: new Date().toISOString() };
    saveJSON(NOTIFICATIONS_FILE, data);

    res.json({ message: 'Notification updated', notification: data.notifications[index] });
});

// Delete notification (admin only)
app.delete('/api/notifications/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(NOTIFICATIONS_FILE);
    if (!data) return res.status(404).json({ message: 'Notifications not found' });

    const index = data.notifications.findIndex(n => n.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: 'Notification not found' });

    data.notifications.splice(index, 1);
    saveJSON(NOTIFICATIONS_FILE, data);

    res.json({ message: 'Notification deleted' });
});

// Toggle notification active status (admin only)
app.patch('/api/notifications/:id/toggle', authenticateAdmin, (req, res) => {
    const data = loadJSON(NOTIFICATIONS_FILE);
    if (!data) return res.status(404).json({ message: 'Notifications not found' });

    const notification = data.notifications.find(n => n.id === req.params.id);
    if (!notification) return res.status(404).json({ message: 'Notification not found' });

    notification.active = !notification.active;
    saveJSON(NOTIFICATIONS_FILE, data);

    res.json({ message: `Notification ${notification.active ? 'activated' : 'deactivated'}`, notification });
});

// ============================================
// CHAT ENDPOINTS (PUBLIC - Customer Side)
// ============================================

// Optional auth middleware - sets req.user if token is valid, but doesn't fail if not
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            req.user = null;
        } else {
            req.user = decoded;
        }
        next();
    });
}

// Send a message (create or continue conversation)
app.post('/api/chat/message', optionalAuth, (req, res) => {
    const { conversationId, guestId, source, text } = req.body;

    // Validate text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    if (text.length > 2000) {
        return res.status(400).json({ success: false, message: 'Message too long (max 2000 characters)' });
    }

    const chatData = loadJSON(CHAT_FILE) || { conversations: [] };
    const now = new Date().toISOString();

    let conversation;
    let isNewConversation = false;

    if (conversationId) {
        // Find existing conversation
        conversation = chatData.conversations.find(c => c.id === conversationId);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        // Verify ownership
        if (req.user) {
            if (conversation.userId && conversation.userId !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        } else {
            if (conversation.guestId && conversation.guestId !== guestId) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }
    } else {
        // Create new conversation
        isNewConversation = true;

        // Get user info if authenticated
        let userName = null;
        let userEmail = null;
        if (req.user) {
            const usersData = loadJSON(USERS_FILE);
            const user = usersData.users.find(u => u.id === req.user.id);
            if (user) {
                userName = user.name;
                userEmail = user.email;
            }
        }

        conversation = {
            id: 'conv_' + uuidv4().substring(0, 8),
            userId: req.user ? req.user.id : null,
            userName: userName,
            userEmail: userEmail,
            guestId: req.user ? null : (guestId || 'guest_' + uuidv4().substring(0, 8)),
            source: source || 'web',
            createdAt: now,
            lastMessageAt: now,
            status: 'open',
            assignedTo: null,
            messages: []
        };

        // Add welcome message from system
        conversation.messages.push({
            id: 'msg_' + uuidv4().substring(0, 8),
            from: 'system',
            text: 'Welcome to Flirt Hair Support! How can we help you today?',
            createdAt: now,
            readByAgent: false
        });

        chatData.conversations.push(conversation);
    }

    // Add the new message
    const newMessage = {
        id: 'msg_' + uuidv4().substring(0, 8),
        from: 'user',
        text: text.trim(),
        createdAt: now,
        readByAgent: false
    };

    conversation.messages.push(newMessage);
    conversation.lastMessageAt = now;

    saveJSON(CHAT_FILE, chatData);

    res.json({
        success: true,
        conversation: {
            id: conversation.id,
            status: conversation.status,
            lastMessageAt: conversation.lastMessageAt
        },
        message: newMessage,
        isNewConversation
    });
});

// Get a specific conversation (user)
app.get('/api/chat/conversation/:id', optionalAuth, (req, res) => {
    const { id } = req.params;
    const { guestId } = req.query;

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const conversation = chatData.conversations.find(c => c.id === id);

    if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Verify ownership
    if (req.user) {
        if (conversation.userId && conversation.userId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
    } else {
        if (conversation.guestId && conversation.guestId !== guestId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
    }

    // Mark agent messages as read by user (optional tracking)
    res.json({
        success: true,
        conversation
    });
});

// Get latest conversation for current visitor
app.get('/api/chat/my-latest', optionalAuth, (req, res) => {
    const { guestId } = req.query;

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData || !chatData.conversations) {
        return res.json({ success: true, conversation: null });
    }

    let conversation;

    if (req.user) {
        // Find by userId
        conversation = chatData.conversations
            .filter(c => c.userId === req.user.id && c.status === 'open')
            .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))[0];
    } else if (guestId) {
        // Find by guestId
        conversation = chatData.conversations
            .filter(c => c.guestId === guestId && c.status === 'open')
            .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))[0];
    }

    res.json({
        success: true,
        conversation: conversation || null
    });
});

// ============================================
// CHAT ENDPOINTS (ADMIN - Agent Side)
// ============================================

// List all conversations (admin inbox)
app.get('/api/admin/chat/conversations', authenticateAdmin, (req, res) => {
    const { status, search } = req.query;

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData || !chatData.conversations) {
        return res.json({ success: true, conversations: [] });
    }

    let conversations = chatData.conversations;

    // Filter by status if provided
    if (status) {
        conversations = conversations.filter(c => c.status === status);
    }

    // Search in userName, userEmail, or messages
    if (search) {
        const searchLower = search.toLowerCase();
        conversations = conversations.filter(c => {
            if (c.userName && c.userName.toLowerCase().includes(searchLower)) return true;
            if (c.userEmail && c.userEmail.toLowerCase().includes(searchLower)) return true;
            if (c.messages.some(m => m.text.toLowerCase().includes(searchLower))) return true;
            return false;
        });
    }

    // Sort by lastMessageAt descending
    conversations.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    // Return summary info for inbox view
    const summaries = conversations.map(c => {
        const lastUserMessage = [...c.messages].reverse().find(m => m.from === 'user');
        const unreadCount = c.messages.filter(m => m.from === 'user' && !m.readByAgent).length;

        return {
            id: c.id,
            userName: c.userName || (c.guestId ? `Guest ${c.guestId.substring(0, 8)}` : 'Unknown'),
            userEmail: c.userEmail || null,
            guestId: c.guestId,
            source: c.source,
            lastMessage: lastUserMessage ? lastUserMessage.text.substring(0, 100) : '',
            lastMessageAt: c.lastMessageAt,
            unreadCount,
            status: c.status,
            createdAt: c.createdAt
        };
    });

    res.json({ success: true, conversations: summaries });
});

// Get full conversation (admin)
app.get('/api/admin/chat/conversations/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const conversation = chatData.conversations.find(c => c.id === id);

    if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    res.json({ success: true, conversation });
});

// Send message as agent
app.post('/api/admin/chat/message', authenticateAdmin, (req, res) => {
    const { conversationId, text } = req.body;

    if (!conversationId) {
        return res.status(400).json({ success: false, message: 'Conversation ID is required' });
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Message text is required' });
    }

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData) {
        return res.status(404).json({ success: false, message: 'Chat data not found' });
    }

    const conversation = chatData.conversations.find(c => c.id === conversationId);

    if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const now = new Date().toISOString();

    const newMessage = {
        id: 'msg_' + uuidv4().substring(0, 8),
        from: 'agent',
        text: text.trim(),
        createdAt: now,
        agentId: req.user.id,
        readByAgent: true
    };

    conversation.messages.push(newMessage);
    conversation.lastMessageAt = now;

    // Assign conversation to this agent if not already assigned
    if (!conversation.assignedTo) {
        conversation.assignedTo = req.user.id;
    }

    saveJSON(CHAT_FILE, chatData);

    res.json({ success: true, message: newMessage });
});

// Mark conversation as read (admin)
app.patch('/api/admin/chat/conversations/:id/read', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData) {
        return res.status(404).json({ success: false, message: 'Chat data not found' });
    }

    const conversation = chatData.conversations.find(c => c.id === id);

    if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Mark all user messages as read by agent
    conversation.messages.forEach(m => {
        if (m.from === 'user') {
            m.readByAgent = true;
        }
    });

    saveJSON(CHAT_FILE, chatData);

    res.json({ success: true, message: 'Conversation marked as read' });
});

// Update conversation status (admin)
app.patch('/api/admin/chat/conversations/:id/status', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['open', 'closed'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const chatData = loadJSON(CHAT_FILE);
    if (!chatData) {
        return res.status(404).json({ success: false, message: 'Chat data not found' });
    }

    const conversation = chatData.conversations.find(c => c.id === id);

    if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    conversation.status = status;
    conversation.updatedAt = new Date().toISOString();

    saveJSON(CHAT_FILE, chatData);

    res.json({ success: true, message: `Conversation ${status}`, conversation });
});

// ============================================
// GALLERY ENDPOINTS
// ============================================

// Get all active gallery items (public)
app.get('/api/gallery', (req, res) => {
    const data = loadJSON(GALLERY_FILE);
    if (!data) return res.json({ items: [] });

    const activeItems = data.items
        .filter(item => item.active)
        .sort((a, b) => a.order - b.order);

    res.json({ items: activeItems });
});

// Get all gallery items (admin)
app.get('/api/admin/gallery', authenticateAdmin, (req, res) => {
    const data = loadJSON(GALLERY_FILE);
    if (!data) return res.json({ items: [] });

    const items = data.items.sort((a, b) => a.order - b.order);
    res.json({ items });
});

// Create gallery item (admin)
app.post('/api/admin/gallery', authenticateAdmin, (req, res) => {
    const { imageUrl, altText, label, category } = req.body;

    if (!imageUrl) {
        return res.status(400).json({ message: 'Image URL is required' });
    }

    const data = loadJSON(GALLERY_FILE) || { items: [] };

    // Find the highest order number
    const maxOrder = data.items.reduce((max, item) => Math.max(max, item.order || 0), 0);

    const newItem = {
        id: `img_${uuidv4().substring(0, 8)}`,
        imageUrl,
        altText: altText || 'Gallery Image',
        label: label || '',
        category: category || 'general',
        order: maxOrder + 1,
        active: true,
        createdAt: new Date().toISOString()
    };

    data.items.push(newItem);
    saveJSON(GALLERY_FILE, data);

    res.status(201).json({ message: 'Gallery item created', item: newItem });
});

// Update gallery item (admin)
app.patch('/api/admin/gallery/:id', authenticateAdmin, (req, res) => {
    const { imageUrl, altText, label, category, order, active } = req.body;

    const data = loadJSON(GALLERY_FILE);
    if (!data) return res.status(404).json({ message: 'Gallery not found' });

    const itemIndex = data.items.findIndex(item => item.id === req.params.id);
    if (itemIndex === -1) {
        return res.status(404).json({ message: 'Gallery item not found' });
    }

    const item = data.items[itemIndex];

    if (imageUrl !== undefined) item.imageUrl = imageUrl;
    if (altText !== undefined) item.altText = altText;
    if (label !== undefined) item.label = label;
    if (category !== undefined) item.category = category;
    if (order !== undefined) item.order = order;
    if (active !== undefined) item.active = active;

    item.updatedAt = new Date().toISOString();

    saveJSON(GALLERY_FILE, data);

    res.json({ message: 'Gallery item updated', item });
});

// Delete gallery item (admin)
app.delete('/api/admin/gallery/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(GALLERY_FILE);
    if (!data) return res.status(404).json({ message: 'Gallery not found' });

    const itemIndex = data.items.findIndex(item => item.id === req.params.id);
    if (itemIndex === -1) {
        return res.status(404).json({ message: 'Gallery item not found' });
    }

    data.items.splice(itemIndex, 1);
    saveJSON(GALLERY_FILE, data);

    res.json({ message: 'Gallery item deleted' });
});

// Toggle gallery item active status (admin)
app.patch('/api/admin/gallery/:id/toggle', authenticateAdmin, (req, res) => {
    const data = loadJSON(GALLERY_FILE);
    if (!data) return res.status(404).json({ message: 'Gallery not found' });

    const item = data.items.find(item => item.id === req.params.id);
    if (!item) {
        return res.status(404).json({ message: 'Gallery item not found' });
    }

    item.active = !item.active;
    item.updatedAt = new Date().toISOString();
    saveJSON(GALLERY_FILE, data);

    res.json({ message: `Gallery item ${item.active ? 'activated' : 'deactivated'}`, item });
});

// Reorder gallery items (admin)
app.post('/api/admin/gallery/reorder', authenticateAdmin, (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ message: 'orderedIds array is required' });
    }

    const data = loadJSON(GALLERY_FILE);
    if (!data) return res.status(404).json({ message: 'Gallery not found' });

    // Update order based on array position
    orderedIds.forEach((id, index) => {
        const item = data.items.find(item => item.id === id);
        if (item) {
            item.order = index + 1;
        }
    });

    saveJSON(GALLERY_FILE, data);

    res.json({ message: 'Gallery order updated' });
});

// ============================================
// HAIR TIPS ENDPOINTS
// ============================================

// Get random active tip (public)
app.get('/api/hair-tips/random', (req, res) => {
    const data = loadJSON(HAIR_TIPS_FILE);
    if (!data || !data.tips) return res.json({ tip: null });

    const activeTips = data.tips.filter(tip => tip.active);
    if (activeTips.length === 0) return res.json({ tip: null });

    const randomIndex = Math.floor(Math.random() * activeTips.length);
    const randomTip = activeTips[randomIndex];

    res.json({ tip: { id: randomTip.id, text: randomTip.text } });
});

// Get all tips (public - for admin to list)
app.get('/api/hair-tips', (req, res) => {
    const data = loadJSON(HAIR_TIPS_FILE);
    if (!data) return res.json({ tips: [] });

    res.json({ tips: data.tips || [] });
});

// Get all tips (admin)
app.get('/api/admin/hair-tips', authenticateAdmin, (req, res) => {
    const data = loadJSON(HAIR_TIPS_FILE);
    if (!data) return res.json({ tips: [] });

    res.json({ tips: data.tips || [] });
});

// Create hair tip (admin)
app.post('/api/admin/hair-tips', authenticateAdmin, (req, res) => {
    const { text, category, priority } = req.body;

    if (!text || text.trim() === '') {
        return res.status(400).json({ message: 'Tip text is required' });
    }

    const data = loadJSON(HAIR_TIPS_FILE) || { tips: [] };

    // Generate a new ID
    const maxId = data.tips.reduce((max, tip) => {
        const num = parseInt(tip.id.replace('tip', '')) || 0;
        return Math.max(max, num);
    }, 0);

    const newTip = {
        id: `tip${maxId + 1}`,
        text: text.trim(),
        active: true,
        category: category || 'general',
        priority: priority || 1,
        createdAt: new Date().toISOString()
    };

    data.tips.push(newTip);
    saveJSON(HAIR_TIPS_FILE, data);

    res.status(201).json({ message: 'Hair tip created', tip: newTip });
});

// Update hair tip (admin)
app.put('/api/admin/hair-tips/:id', authenticateAdmin, (req, res) => {
    const { text, category, priority, active } = req.body;

    const data = loadJSON(HAIR_TIPS_FILE);
    if (!data) return res.status(404).json({ message: 'Hair tips data not found' });

    const tipIndex = data.tips.findIndex(tip => tip.id === req.params.id);
    if (tipIndex === -1) {
        return res.status(404).json({ message: 'Hair tip not found' });
    }

    const tip = data.tips[tipIndex];

    if (text !== undefined) tip.text = text.trim();
    if (category !== undefined) tip.category = category;
    if (priority !== undefined) tip.priority = priority;
    if (active !== undefined) tip.active = active;

    tip.updatedAt = new Date().toISOString();

    saveJSON(HAIR_TIPS_FILE, data);

    res.json({ message: 'Hair tip updated', tip });
});

// Toggle hair tip active status (admin)
app.patch('/api/admin/hair-tips/:id/toggle', authenticateAdmin, (req, res) => {
    const data = loadJSON(HAIR_TIPS_FILE);
    if (!data) return res.status(404).json({ message: 'Hair tips data not found' });

    const tip = data.tips.find(tip => tip.id === req.params.id);
    if (!tip) {
        return res.status(404).json({ message: 'Hair tip not found' });
    }

    tip.active = !tip.active;
    tip.updatedAt = new Date().toISOString();
    saveJSON(HAIR_TIPS_FILE, data);

    res.json({ message: `Hair tip ${tip.active ? 'activated' : 'deactivated'}`, tip });
});

// Delete hair tip (admin)
app.delete('/api/admin/hair-tips/:id', authenticateAdmin, (req, res) => {
    const data = loadJSON(HAIR_TIPS_FILE);
    if (!data) return res.status(404).json({ message: 'Hair tips data not found' });

    const tipIndex = data.tips.findIndex(tip => tip.id === req.params.id);
    if (tipIndex === -1) {
        return res.status(404).json({ message: 'Hair tip not found' });
    }

    data.tips.splice(tipIndex, 1);
    saveJSON(HAIR_TIPS_FILE, data);

    res.json({ message: 'Hair tip deleted' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`
    ========================================
    Flirt Hair & Beauty - Backend Server
    ========================================

    Server running on: http://localhost:${PORT}

    Client App: http://localhost:${PORT}/
    Admin Console: http://localhost:${PORT}/admin

    API Endpoints:
    --------------
    Auth:
      POST /api/auth/signup
      POST /api/auth/login
      GET  /api/auth/me

    Bookings:
      GET  /api/stylists
      GET  /api/services/hair
      GET  /api/services/beauty
      POST /api/bookings
      GET  /api/bookings
      PATCH /api/bookings/:id

    Shop:
      GET  /api/products
      POST /api/orders
      GET  /api/orders
      POST /api/promo/validate

    Loyalty:
      GET  /api/loyalty/balance
      GET  /api/loyalty/history
      POST /api/loyalty/redeem
      POST /api/referrals/apply
      GET  /api/referrals

    Admin:
      GET  /api/admin/stats
      GET  /api/admin/bookings
      PATCH /api/admin/bookings/:id/confirm
      GET  /api/admin/orders
      PATCH /api/admin/orders/:id
      GET  /api/admin/customers
      CRUD /api/admin/staff
      CRUD /api/admin/products
      CRUD /api/admin/promos

    ========================================
    `);
});
