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

// Database imports - SQLite-only (mandatory)
const DATABASE_PATH = process.env.DATABASE_PATH || './db/flirt.db';

let db, UserRepository, StylistRepository, ServiceRepository, BookingRepository, ProductRepository, OrderRepository, PromoRepository;

try {
    const dbModule = require('./db/database');

    // Initialize all database repositories
    db = dbModule;
    UserRepository = dbModule.UserRepository;
    StylistRepository = dbModule.StylistRepository;
    ServiceRepository = dbModule.ServiceRepository;
    BookingRepository = dbModule.BookingRepository;
    ProductRepository = dbModule.ProductRepository;
    OrderRepository = dbModule.OrderRepository;
    PromoRepository = dbModule.PromoRepository;

    // Ensure database directory exists
    const dbDir = path.dirname(DATABASE_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`📁 Created database directory: ${dbDir}`);
    }

    console.log('✅ SQLite database initialized at:', DATABASE_PATH);

} catch (error) {
    console.error('❌ FATAL: Failed to initialize SQLite database:', error.message);
    console.error('🔍 Error type:', error.constructor.name);
    if (error.message.includes('invalid ELF header')) {
        console.error('🔧 SQLite3 native bindings are compiled for wrong architecture');
        console.error('💡 This usually happens when SQLite3 was compiled for different OS');
        console.error('🚀 Try running: npm rebuild sqlite3 --build-from-source');
    }
    console.error('💥 Server cannot start without database. Exiting...');
    process.exit(1);
}

// Payment services import
const PaymentService = require('./services/payments');

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


// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================
// SEED ADMIN USER
// ============================================
async function seedAdminUser() {
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
        throw error; // Re-throw to prevent server from starting with broken admin setup
    }
}

// Run seed on startup
seedAdminUser();


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
    try {
        existingUser = await UserRepository.findByEmail(email);
    } catch (error) {
        console.error('Database error during signup:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
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
    try {
        newUser = await UserRepository.create(userData);
    } catch (error) {
        console.error('Database error creating user:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create account - please try again later' });
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

    try {
        user = await UserRepository.findByEmail(email);
    } catch (error) {
        console.error('Database error during login:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
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
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const { passwordHash: _, password_hash: __, ...userResponse } = user;
        res.json({ success: true, user: userResponse });
    } catch (error) {
        console.error('Database error fetching user:', error.message);
        res.status(500).json({ success: false, message: 'Database error' });
    }
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
        let user = await UserRepository.findByEmail(email);

        if (!user) {
            const userId = uuidv4();
            user = {
                id: userId,
                email,
                name,
                phone: '',
                password_hash: null, // OAuth users don't have passwords
                role: 'customer',
                points: 0,
                tier: 'bronze',
                referralCode: generateReferralCode(name),
                referredBy: null,
                hairTracker: { lastInstallDate: null, extensionType: null },
                createdAt: new Date().toISOString(),
                authProvider: 'google'
            };
            await UserRepository.create(user);
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

        let user = await UserRepository.findByEmail(email);

        if (!user) {
            const userId = uuidv4();
            user = {
                id: userId,
                email,
                name,
                phone: '',
                password_hash: null, // OAuth users don't have passwords
                role: 'customer',
                points: 0,
                tier: 'bronze',
                referralCode: generateReferralCode(name),
                referredBy: null,
                hairTracker: { lastInstallDate: null, extensionType: null },
                createdAt: new Date().toISOString(),
                authProvider: 'facebook'
            };
            await UserRepository.create(user);
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
app.patch('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const { name, phone } = req.body;
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (phone) updateData.phone = phone;

        if (Object.keys(updateData).length > 0) {
            await UserRepository.updateById(req.user.id, updateData);
        }

        const updatedUser = await UserRepository.findById(req.user.id);
        const { password_hash: _, ...userResponse } = updatedUser;
        res.json({ success: true, user: userResponse });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ============================================
// HAIR PROFILE ENDPOINTS
// ============================================

// Get hair profile for authenticated user
app.get('/api/hair-profile', authenticateToken, async (req, res) => {
    try {
        const user = await UserRepository.findById(req.user.id);

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
    } catch (error) {
        console.error('Error getting hair profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Update hair profile for authenticated user
app.patch('/api/hair-profile', authenticateToken, async (req, res) => {
    try {
        const { hairType, extensionType, preferredStylist, notes } = req.body;
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Initialize hairProfile if it doesn't exist
        let profile = user.hairProfile || {};

        // Merge updates
        if (hairType !== undefined) profile.hairType = hairType;
        if (extensionType !== undefined) profile.extensionType = extensionType;
        if (preferredStylist !== undefined) profile.preferredStylist = preferredStylist;
        if (notes !== undefined) profile.notes = notes;

        const updateData = {
            hairProfile: profile,
            updatedAt: new Date().toISOString()
        };
        await UserRepository.updateById(req.user.id, updateData);

        res.json({ success: true, hairProfile: profile });
    } catch (error) {
        console.error('Error updating hair profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ============================================
// NOTIFICATION PREFERENCES ENDPOINTS
// ============================================

// Get notification preferences for authenticated user
app.get('/api/notification-prefs', authenticateToken, async (req, res) => {
    try {
        const user = await UserRepository.findById(req.user.id);

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
    } catch (error) {
        console.error('Database error getting notification preferences:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update notification preferences for authenticated user
app.patch('/api/notification-prefs', authenticateToken, async (req, res) => {
    try {
        const { promotions, appointmentReminders, loyaltyUpdates } = req.body;
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Initialize notificationPrefs if it doesn't exist
        const currentPrefs = user.notificationPrefs || {
            promotions: true,
            appointmentReminders: true,
            loyaltyUpdates: true
        };

        // Merge updates
        const updatedPrefs = { ...currentPrefs };
        if (promotions !== undefined) updatedPrefs.promotions = promotions;
        if (appointmentReminders !== undefined) updatedPrefs.appointmentReminders = appointmentReminders;
        if (loyaltyUpdates !== undefined) updatedPrefs.loyaltyUpdates = loyaltyUpdates;

        await UserRepository.updateById(req.user.id, {
            notificationPrefs: updatedPrefs,
            updatedAt: new Date().toISOString()
        });

        res.json({ success: true, notificationPrefs: updatedPrefs });
    } catch (error) {
        console.error('Database error updating notification preferences:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
        }

        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        // Hash and save new password
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        const updateData = {
            password_hash: newPasswordHash,
            mustChangePassword: false,
            updatedAt: new Date().toISOString()
        };
        await UserRepository.updateById(req.user.id, updateData);

        console.log(`Password changed for user: ${user.email}`);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ============================================
// STYLISTS ROUTES
// ============================================

app.get('/api/stylists', async (req, res) => {
    try {
        const stylists = await StylistRepository.findAll();
        res.json({ success: true, stylists });
    } catch (error) {
        console.error('Database error fetching stylists:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch stylists' });
    }
});

app.get('/api/stylists/:id', async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);

        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        res.json({ success: true, stylist });
    } catch (error) {
        console.error('Database error fetching stylist:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch stylist' });
    }
});

// ============================================
// SERVICES ROUTES
// ============================================

app.get('/api/services/hair', async (req, res) => {
    try {
        const services = await ServiceRepository.findByType('hair');
        res.json({ success: true, services });
    } catch (error) {
        console.error('Database error fetching hair services:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch hair services' });
    }
});

app.get('/api/services/beauty', async (req, res) => {
    try {
        const services = await ServiceRepository.findByType('beauty');
        res.json({ success: true, services });
    } catch (error) {
        console.error('Database error fetching beauty services:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch beauty services' });
    }
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
app.post('/api/bookings', authenticateToken, async (req, res) => {
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

    try {
        // Check for booking conflicts (exact same stylist, date, time)
        if (time && stylistId) {
            const conflict = await BookingRepository.findConflict(stylistId, date, time);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: 'This time slot is already booked. Please select a different time.',
                    conflict: {
                        date: conflict.date,
                        time: conflict.confirmed_time || conflict.time
                    }
                });
            }
        }

        // Get service details
        const service = await ServiceRepository.findById(serviceId);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        const newBooking = {
            id: uuidv4(),
            userId: req.user.id,
            bookingType: type,
            stylistId: stylistId || null,
            serviceId,
            serviceName: service.name,
            servicePrice: service.price,
            date,
            preferredTimeOfDay: type === 'hair' ? (preferredTimeOfDay || null) : null,
            time: type === 'beauty' ? time : null,
            confirmedTime: type === 'beauty' ? time : null,
            status: type === 'hair' ? 'pending' : 'confirmed',
            notes: notes || null
        };

        const createdBooking = await BookingRepository.create(newBooking);

        // Award loyalty points for booking
        const loyaltySettings = await LoyaltyRepository.getSettings();
        const pointsToAdd = loyaltySettings.bookingPoints || 50;

        if (pointsToAdd > 0) {
            await UserRepository.addPoints(req.user.id, pointsToAdd);
            await LoyaltyRepository.addTransaction({
                id: uuidv4(),
                userId: req.user.id,
                points: pointsToAdd,
                type: 'earned',
                description: `Booking: ${service.name}`
            });
        }

        res.status(201).json({
            success: true,
            message: type === 'hair'
                ? 'Booking request submitted. We will contact you within 24 hours to confirm the time.'
                : 'Booking confirmed!',
            booking: createdBooking
        });
    } catch (error) {
        console.error('Database error creating booking:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create booking - please try again later' });
    }
});

// Get user's bookings
app.get('/api/bookings', authenticateToken, async (req, res) => {
    try {
        const userBookings = await BookingRepository.findByUserId(req.user.id);
        res.json({ success: true, bookings: userBookings });
    } catch (error) {
        console.error('Database error fetching user bookings:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
    }
});

// Cancel/reschedule booking
app.patch('/api/bookings/:id', authenticateToken, async (req, res) => {
    const { status, date, preferredTimeOfDay, time, confirmedTime } = req.body;

    try {
        // Find booking and verify ownership
        const booking = await BookingRepository.findById(req.params.id);

        if (!booking || booking.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const updates = {};

        if (status) updates.status = status;
        if (date) {
            updates.date = date;
            // Reset status to pending when rescheduling
            if (!status) updates.status = 'pending';
        }
        if (preferredTimeOfDay !== undefined) updates.preferred_time_of_day = preferredTimeOfDay;
        if (time) updates.time = time;
        // Allow confirmedTime to be explicitly set to null (when rescheduling)
        if (confirmedTime !== undefined) updates.confirmed_time = confirmedTime;

        const updatedBooking = await BookingRepository.update(req.params.id, updates);

        res.json({ success: true, booking: updatedBooking });
    } catch (error) {
        console.error('Database error updating booking:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update booking' });
    }
});

// ============================================
// PRODUCTS ROUTES
// ============================================

app.get('/api/products', async (req, res) => {
    try {
        const { category, onSale } = req.query;
        const filters = {};

        if (category) {
            filters.category = category;
        }

        if (onSale === 'true') {
            filters.onSale = true;
        }

        const products = await ProductRepository.findAll(filters);
        res.json({ success: true, products });
    } catch (error) {
        console.error('Database error fetching products:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await ProductRepository.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.json({ success: true, product });
    } catch (error) {
        console.error('Database error fetching product:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch product' });
    }
});

// ============================================
// ORDERS ROUTES
// ============================================

// Create order
app.post('/api/orders', authenticateToken, async (req, res) => {
    const { items, deliveryMethod, deliveryAddress, promoCode } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Order must contain items' });
    }

    try {
        // Calculate order totals
        let subtotal = 0;
        const orderItems = [];

        // Validate products and calculate subtotal
        for (const item of items) {
            const product = await ProductRepository.findById(item.productId);
            if (!product) {
                return res.status(404).json({ success: false, message: `Product ${item.productId} not found` });
            }
            if (product.stock < item.quantity) {
                return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}` });
            }

            const unitPrice = product.on_sale && product.sale_price ? product.sale_price : product.price;
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
            const promo = await PromoRepository.findByCode(promoCode);

            if (promo && promo.active && new Date(promo.expires_at) > new Date()) {
                if (!promo.min_order || subtotal >= promo.min_order) {
                    if (promo.discount_type === 'percentage') {
                        discount = Math.round(subtotal * (promo.discount_value / 100));
                    } else {
                        discount = promo.discount_value;
                    }
                    appliedPromo = promo.code;

                    // Increment usage
                    await PromoRepository.incrementUsage(promo.id);
                }
            }
        }

        const total = subtotal + deliveryFee - discount;

        const orderData = {
            id: uuidv4(),
            userId: req.user.id,
            subtotal,
            deliveryMethod: deliveryMethod || 'pickup',
            deliveryFee,
            deliveryAddress: deliveryAddress ? JSON.stringify(deliveryAddress) : null,
            promoCode: appliedPromo,
            discount,
            total,
            status: 'pending'
        };

        // Create order with items
        const newOrder = await OrderRepository.create(orderData, orderItems);

        // Update product stock
        for (const item of items) {
            await ProductRepository.updateStock(item.productId, -item.quantity);
        }

        // Award loyalty points
        const loyaltySettings = await LoyaltyRepository.getSettings();
        const pointsToAdd = Math.floor(total / loyaltySettings.spendRatio);

        if (pointsToAdd > 0) {
            await UserRepository.addPoints(req.user.id, pointsToAdd);
            await LoyaltyRepository.addTransaction({
                id: uuidv4(),
                userId: req.user.id,
                points: pointsToAdd,
                type: 'earned',
                description: `Order #${newOrder.id.substring(0, 8)}`
            });
        }

        res.status(201).json({
            success: true,
            message: 'Order placed successfully!',
            order: newOrder
        });
    } catch (error) {
        console.error('Database error creating order:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create order - please try again later' });
    }
});

// Get user's orders
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const userOrders = await OrderRepository.findByUserId(req.user.id);
        res.json({ success: true, orders: userOrders });
    } catch (error) {
        console.error('Database error fetching user orders:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

// ============================================
// PROMO ROUTES
// ============================================

app.post('/api/promo/validate', async (req, res) => {
    const { code, subtotal } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, message: 'Promo code is required' });
    }

    try {
        const promo = await PromoRepository.findByCode(code);

        if (!promo || !promo.active) {
            return res.status(404).json({ success: false, message: 'Invalid promo code' });
        }

        if (new Date(promo.expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: 'Promo code has expired' });
        }

        if (promo.usage_limit && promo.times_used >= promo.usage_limit) {
            return res.status(400).json({ success: false, message: 'Promo code usage limit reached' });
        }

        if (promo.min_order && subtotal < promo.min_order) {
            return res.status(400).json({
                success: false,
                message: `Minimum order of R${promo.min_order} required`
            });
        }

        let discount = 0;
        if (promo.discount_type === 'percentage') {
            discount = Math.round((subtotal || 0) * (promo.discount_value / 100));
        } else {
            discount = promo.discount_value;
        }

        res.json({
            success: true,
            promo: {
                code: promo.code,
                description: promo.description,
                discountType: promo.discount_type,
                discountValue: promo.discount_value,
                calculatedDiscount: discount
            }
        });
    } catch (error) {
        console.error('Database error validating promo:', error.message);
        res.status(500).json({ success: false, message: 'Failed to validate promo code' });
    }
});

// Get highlighted promos for Special Offers section (public endpoint)
app.get('/api/promos/highlighted', async (req, res) => {
    try {
        const now = new Date();
        const allPromos = await PromoRepository.findAll();

        // Filter for active, highlighted promos that haven't expired
        const promos = allPromos
            .filter(p => p.active && p.highlighted)
            .filter(p => !p.expires_at || new Date(p.expires_at) >= now)
            .map(p => ({
                // Only return safe, public fields
                code: p.code,
                description: p.description,
                discountType: p.discount_type,
                discountValue: p.discount_value,
                minOrder: p.min_order || 0,
                expiresAt: p.expires_at,
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

app.get('/api/loyalty/balance', authenticateToken, async (req, res) => {
    try {
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({
            success: true,
            points: user.points,
            tier: user.tier,
            referralCode: user.referral_code
        });
    } catch (error) {
        console.error('Database error fetching loyalty balance:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch loyalty balance' });
    }
});

app.get('/api/loyalty/history', authenticateToken, async (req, res) => {
    try {
        const transactions = await LoyaltyRepository.getTransactionsByUserId(req.user.id);
        res.json({ success: true, transactions });
    } catch (error) {
        console.error('Database error fetching loyalty history:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch loyalty history' });
    }
});

app.post('/api/loyalty/redeem', authenticateToken, async (req, res) => {
    const { points, rewardType } = req.body;

    try {
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user.points < points) {
            return res.status(400).json({ success: false, message: 'Insufficient points' });
        }

        // Deduct points and update tier
        const newBalance = await UserRepository.deductPoints(req.user.id, points);

        // Log redemption transaction
        await LoyaltyRepository.addTransaction({
            id: uuidv4(),
            userId: req.user.id,
            points: -points,
            type: 'redeemed',
            description: `Redeemed: ${rewardType || 'Discount'}`
        });

        res.json({
            success: true,
            message: 'Points redeemed successfully!',
            remainingPoints: newBalance
        });
    } catch (error) {
        console.error('Database error redeeming points:', error.message);
        res.status(500).json({ success: false, message: 'Failed to redeem points' });
    }
});

// ============================================
// REFERRAL ROUTES
// ============================================

app.post('/api/referrals/apply', authenticateToken, async (req, res) => {
    const { referralCode } = req.body;

    if (!referralCode) {
        return res.status(400).json({ success: false, message: 'Referral code is required' });
    }

    try {
        const currentUser = await UserRepository.findById(req.user.id);

        if (currentUser.referred_by) {
            return res.status(400).json({ success: false, message: 'You have already used a referral code' });
        }

        const referrer = await UserRepository.findByReferralCode(referralCode);

        if (!referrer || referrer.id === req.user.id) {
            return res.status(404).json({ success: false, message: 'Invalid referral code' });
        }

        // Get referral points from loyalty settings
        const loyaltySettings = await LoyaltyRepository.getSettings();
        const referralPoints = loyaltySettings.referralPoints || 100;

        // Update current user's referrer
        await UserRepository.update(req.user.id, { referred_by: referrer.id });

        // Award points to both users
        await UserRepository.addPoints(referrer.id, referralPoints);
        await UserRepository.addPoints(req.user.id, referralPoints);

        // Log loyalty transactions
        await LoyaltyRepository.addTransaction({
            id: uuidv4(),
            userId: referrer.id,
            points: referralPoints,
            type: 'earned',
            description: `Referral: ${currentUser.name} joined`
        });

        await LoyaltyRepository.addTransaction({
            id: uuidv4(),
            userId: req.user.id,
            points: referralPoints,
            type: 'earned',
            description: `Welcome bonus: Referred by ${referrer.name}`
        });

        res.json({
            success: true,
            message: `Referral applied! You and ${referrer.name} each earned ${referralPoints} points!`,
            pointsEarned: referralPoints
        });
    } catch (error) {
        console.error('Database error applying referral:', error.message);
        res.status(500).json({ success: false, message: 'Failed to apply referral code' });
    }
});

app.get('/api/referrals', authenticateToken, async (req, res) => {
    try {
        const currentUser = await UserRepository.findById(req.user.id);
        const referrals = await UserRepository.findReferrals(req.user.id);

        res.json({
            success: true,
            referralCode: currentUser.referral_code,
            referralCount: referrals.length,
            referrals: referrals.map(r => ({ name: r.name, date: r.created_at }))
        });
    } catch (error) {
        console.error('Database error fetching referrals:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
    }
});

// ============================================
// HAIR TRACKER ROUTES
// ============================================

// Get hair tracker config (public - no auth required)
app.get('/api/hair-tracker/config', async (req, res) => {
    try {
        // Hair tracker config is now stored in the database or use default values
        const config = {
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            defaultMaintenanceIntervalDays: 42,
            extensionTypes: [
                'clip-in',
                'tape-in',
                'sew-in',
                'micro-link',
                'fusion',
                'halo',
                'ponytail',
                'other'
            ],
            extensionTypeIntervals: {
                'clip-in': 1,        // Daily removal
                'tape-in': 42,       // 6 weeks
                'sew-in': 56,        // 8 weeks
                'micro-link': 84,    // 12 weeks
                'fusion': 84,        // 12 weeks
                'halo': 1,           // Daily removal
                'ponytail': 14,      // 2 weeks
                'other': 42          // Default 6 weeks
            }
        };
        res.json({ success: true, config });
    } catch (error) {
        console.error('Error loading hair tracker config:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Get user's hair tracker data with computed metrics
app.get('/api/hair-tracker', authenticateToken, async (req, res) => {
    try {
        const user = await UserRepository.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const tracker = user.hairTracker || {};
        // Use the same config as in the config endpoint
        const config = {
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            defaultMaintenanceIntervalDays: 42,
            extensionTypeIntervals: {
                'clip-in': 1,
                'tape-in': 42,
                'sew-in': 56,
                'micro-link': 84,
                'fusion': 84,
                'halo': 1,
                'ponytail': 14,
                'other': 42
            },
            healthScore: {
                base: 100,
                penalties: {
                    overMaintenanceByDay: 0.5,
                    noDeepConditionOverDays: 0.3,
                    tooManyWashesPerWeek: 1.0
                }
            }
        };
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
        console.error('Database error getting hair tracker:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update hair tracker (extend existing PATCH)
app.patch('/api/hair-tracker', authenticateToken, async (req, res) => {
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

        const user = await UserRepository.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const existingTracker = user.hairTracker || {};

        // Merge with existing data
        const updatedTracker = {
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
            const config = {
                extensionTypeIntervals: {
                    'clip-in': 1,
                    'tape-in': 42,
                    'sew-in': 56,
                    'micro-link': 84,
                    'fusion': 84,
                    'halo': 1,
                    'ponytail': 14,
                    'other': 42
                },
                defaultMaintenanceIntervalDays: 42
            };
            const extType = extensionType || existingTracker.extensionType;
            const interval = maintenanceIntervalDays
                || config.extensionTypeIntervals?.[extType]
                || config.defaultMaintenanceIntervalDays
                || 42;
            const nm = new Date(new Date(lastInstallDate).getTime() + interval * 86400000);
            updatedTracker.nextMaintenanceDate = nm.toISOString();
        }

        await UserRepository.updateById(req.user.id, {
            hairTracker: updatedTracker
        });

        res.json({
            success: true,
            hairTracker: updatedTracker
        });
    } catch (error) {
        console.error('Database error updating hair tracker:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Log a wash event
app.post('/api/hair-tracker/log-wash', authenticateToken, async (req, res) => {
    try {
        const { date, notes } = req.body;
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentTracker = user.hairTracker || {};
        const washHistory = currentTracker.washHistory || [];
        const washDate = date ? new Date(date) : new Date();

        const newWashEntry = {
            id: uuidv4(),
            date: washDate.toISOString(),
            notes: notes || ''
        };

        washHistory.push(newWashEntry);

        const updatedTracker = {
            ...currentTracker,
            washHistory: washHistory,
            lastWashDate: washDate.toISOString()
        };

        await UserRepository.updateById(req.user.id, {
            hairTracker: updatedTracker
        });

        res.json({
            success: true,
            message: 'Wash logged successfully',
            hairTracker: updatedTracker
        });
    } catch (error) {
        console.error('Database error logging wash:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Log a deep condition event
app.post('/api/hair-tracker/log-deep-condition', authenticateToken, async (req, res) => {
    try {
        const { date, notes } = req.body;
        const user = await UserRepository.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentTracker = user.hairTracker || {};
        const deepConditionHistory = currentTracker.deepConditionHistory || [];
        const conditionDate = date ? new Date(date) : new Date();

        const newDeepConditionEntry = {
            id: uuidv4(),
            date: conditionDate.toISOString(),
            notes: notes || ''
        };

        deepConditionHistory.push(newDeepConditionEntry);

        const updatedTracker = {
            ...currentTracker,
            deepConditionHistory: deepConditionHistory,
            lastDeepConditionDate: conditionDate.toISOString()
        };

        await UserRepository.updateById(req.user.id, {
            hairTracker: updatedTracker
        });

        res.json({
            success: true,
            message: 'Deep condition logged successfully',
            hairTracker: updatedTracker
        });
    } catch (error) {
        console.error('Database error logging deep condition:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Add a product to tracker
app.post('/api/hair-tracker/add-product', authenticateToken, async (req, res) => {
    try {
        const { productId, productName } = req.body;

        if (!productId && !productName) {
            return res.status(400).json({ success: false, message: 'Product ID or name required' });
        }

        const user = await UserRepository.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentTracker = user.hairTracker || {};
        const productsUsed = currentTracker.productsUsed || [];

        // Check if product already exists
        const existingProduct = productsUsed.find(p =>
            (productId && p.productId === productId) || (productName && p.productName === productName)
        );

        let updatedTracker = currentTracker;
        if (!existingProduct) {
            const newProduct = {
                productId: productId || null,
                productName: productName || null,
                addedAt: new Date().toISOString()
            };

            updatedTracker = {
                ...currentTracker,
                productsUsed: [...productsUsed, newProduct]
            };

            await UserRepository.updateById(req.user.id, {
                hairTracker: updatedTracker
            });
        }

        res.json({
            success: true,
            message: existingProduct ? 'Product already tracked' : 'Product added successfully',
            hairTracker: updatedTracker
        });
    } catch (error) {
        console.error('Database error adding product:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Remove a product from tracker
app.delete('/api/hair-tracker/remove-product/:productId', authenticateToken, async (req, res) => {
    try {
        const { productId } = req.params;

        const user = await UserRepository.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentTracker = user.hairTracker || {};
        let updatedTracker = currentTracker;

        if (currentTracker.productsUsed) {
            const filteredProducts = currentTracker.productsUsed.filter(p => p.productId !== productId);

            updatedTracker = {
                ...currentTracker,
                productsUsed: filteredProducts
            };

            await UserRepository.updateById(req.user.id, {
                hairTracker: updatedTracker
            });
        }

        res.json({
            success: true,
            message: 'Product removed successfully',
            hairTracker: updatedTracker
        });
    } catch (error) {
        console.error('Database error removing product:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Dashboard stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // Get first day of current month (YYYY-MM-01)
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        // Get all data from repositories
        const allBookings = await BookingRepository.findAll();
        const allOrders = await OrderRepository.findAll();
        const allUsers = await UserRepository.findAll();

        // Revenue this month (from orders with createdAt in current month, excluding cancelled)
        const monthRevenue = allOrders
            .filter(o => {
                if (o.status === 'cancelled') return false;
                const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
                return orderDate && orderDate >= monthStart && orderDate <= today;
            })
            .reduce((sum, o) => sum + (o.total || 0), 0);

        // Bookings this month
        const monthBookings = allBookings.filter(b => {
            return b.date && b.date >= monthStart && b.date <= today;
        }).length;

        // Product orders this month
        const monthOrders = allOrders.filter(o => {
            const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
            return orderDate && orderDate >= monthStart && orderDate <= today;
        }).length;

        // Active customers (users who have made a booking or order in the last 90 days)
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const activeUserIds = new Set();

        allBookings.forEach(b => {
            if (b.date >= ninetyDaysAgo) activeUserIds.add(b.userId);
        });
        allOrders.forEach(o => {
            const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
            if (orderDate && orderDate >= ninetyDaysAgo) activeUserIds.add(o.userId);
        });
        const activeCustomers = activeUserIds.size;

        // Today's bookings count
        const todayBookings = allBookings.filter(b => b.date === today).length;
        const pendingBookings = allBookings.filter(b => b.status === 'pending').length;
        const pendingOrders = allOrders.filter(o => o.status === 'pending').length;

        res.json({
            success: true,
            stats: {
                // New monthly metrics for dashboard cards
                monthRevenue,
                monthBookings,
                monthOrders,
                activeCustomers,
                // Legacy fields (still useful for other purposes)
                totalRevenue: allOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.total || 0), 0),
                totalBookings: allBookings.length,
                todayBookings,
                pendingBookings,
                totalOrders: allOrders.length,
                pendingOrders,
                totalCustomers: allUsers.length
            }
        });
    } catch (error) {
        console.error('Database error in admin stats:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Revenue trend data for charts (last 30 days by default)
app.get('/api/admin/revenue-trend', authenticateAdmin, async (req, res) => {
    try {
        const { range = '30d' } = req.query;
        const allOrders = await OrderRepository.findAll();

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
            const dayRevenue = allOrders
                .filter(o => {
                    if (o.status === 'cancelled' || o.paymentStatus !== 'paid') return false;
                    const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
                    return orderDate === dateStr;
                })
                .reduce((sum, o) => sum + (o.total || 0), 0);

            values.push(dayRevenue);
        }

        res.json({ success: true, labels, values });
    } catch (error) {
        console.error('Database error in revenue trend:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Popular services data for charts (last 30 days by default)
app.get('/api/admin/popular-services', authenticateAdmin, async (req, res) => {
    try {
        const { range = '30d' } = req.query;
        const allBookings = await BookingRepository.findAll();

        const now = new Date();
        let days = 30;
        if (range === '7d') days = 7;
        else if (range === '90d') days = 90;

        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Count bookings per service in the time range
        const serviceCounts = {};
        allBookings.forEach(b => {
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
    } catch (error) {
        console.error('Database error in popular services:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Get payment configuration status (admin)
app.get('/api/admin/payment-config', authenticateAdmin, async (req, res) => {
    try {
        const configStatus = PaymentService.getPaymentConfigStatus();
        res.json({
            success: true,
            config: configStatus
        });
    } catch (error) {
        console.error('Error fetching payment config:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch payment configuration'
        });
    }
});

// Get all bookings (admin)
app.get('/api/admin/bookings', authenticateAdmin, async (req, res) => {
    try {
        const { status, date, stylistId } = req.query;
        let bookings = await BookingRepository.findAll();

        if (status) bookings = bookings.filter(b => b.status === status);
        if (date) bookings = bookings.filter(b => b.date === date);
        if (stylistId) bookings = bookings.filter(b => b.stylistId === stylistId);

        // Add customer info
        const bookingsWithCustomers = await Promise.all(bookings.map(async (b) => {
            try {
                const user = await UserRepository.findById(b.userId);
                return {
                    ...b,
                    customerName: user ? user.name : 'Unknown',
                    customerPhone: user ? user.phone : null,
                    customerEmail: user ? user.email : null
                };
            } catch (error) {
                console.error(`Error fetching user ${b.userId} for booking ${b.id}:`, error.message);
                return {
                    ...b,
                    customerName: 'Unknown',
                    customerPhone: null,
                    customerEmail: null
                };
            }
        }));

        bookingsWithCustomers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ success: true, bookings: bookingsWithCustomers });
    } catch (error) {
        console.error('Database error in admin bookings:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Confirm booking time (admin)
app.patch('/api/admin/bookings/:id/confirm', authenticateAdmin, async (req, res) => {
    try {
        const { confirmedTime } = req.body;

        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const updatedBooking = await BookingRepository.updateById(req.params.id, {
            confirmedTime: confirmedTime,
            status: 'confirmed',
            updatedAt: new Date().toISOString()
        });

        res.json({ success: true, booking: updatedBooking });
    } catch (error) {
        console.error('Database error confirming booking:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update booking status (admin) - supports 'completed', 'cancelled', 'pending', 'confirmed'
app.patch('/api/admin/bookings/:id/status', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const updateData = {
            status: status,
            updatedAt: new Date().toISOString()
        };

        // Add completion timestamp if marking as completed
        if (status === 'completed') {
            updateData.completedAt = new Date().toISOString();
        }

        const updatedBooking = await BookingRepository.updateById(req.params.id, updateData);

        res.json({ success: true, booking: updatedBooking });
    } catch (error) {
        console.error('Database error updating booking status:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Get all orders (admin)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let orders = await OrderRepository.findAll();

        if (status) orders = orders.filter(o => o.status === status);

        // Add customer info
        const ordersWithCustomers = await Promise.all(orders.map(async (o) => {
            try {
                const user = await UserRepository.findById(o.userId);
                return {
                    ...o,
                    customerName: user ? user.name : 'Unknown',
                    customerPhone: user ? user.phone : null,
                    customerEmail: user ? user.email : null
                };
            } catch (error) {
                console.error(`Error fetching user ${o.userId} for order ${o.id}:`, error.message);
                return {
                    ...o,
                    customerName: 'Unknown',
                    customerPhone: null,
                    customerEmail: null
                };
            }
        }));

        ordersWithCustomers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ success: true, orders: ordersWithCustomers });
    } catch (error) {
        console.error('Database error in admin orders:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update order status (admin)
app.patch('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.body;

        const order = await OrderRepository.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const updatedOrder = await OrderRepository.updateById(req.params.id, {
            status: status,
            updatedAt: new Date().toISOString()
        });

        res.json({ success: true, order: updatedOrder });
    } catch (error) {
        console.error('Database error updating order status:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Get all customers (admin)
app.get('/api/admin/customers', authenticateAdmin, async (req, res) => {
    try {
        const allUsers = await UserRepository.findAll();
        const allBookings = await BookingRepository.findAll();
        const allOrders = await OrderRepository.findAll();

        const customers = allUsers
            .filter(u => u.role === 'customer')
            .map(u => {
                const userBookings = allBookings.filter(b => b.userId === u.id);
                const userOrders = allOrders.filter(o => o.userId === u.id);
                const totalSpent = userOrders.reduce((sum, o) => sum + (o.total || 0), 0);

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
    } catch (error) {
        console.error('Database error in admin customers:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Staff management (admin)
app.get('/api/admin/staff', authenticateAdmin, async (req, res) => {
    try {
        const stylists = await StylistRepository.findAll();
        res.json({ success: true, staff: stylists });
    } catch (error) {
        console.error('Database error in admin staff:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.post('/api/admin/staff', authenticateAdmin, async (req, res) => {
    try {
        const { name, specialty, tagline, instagram, color } = req.body;

        if (!name || !specialty) {
            return res.status(400).json({ success: false, message: 'Name and specialty are required' });
        }

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

        const createdStylist = await StylistRepository.create(newStylist);

        res.status(201).json({ success: true, stylist: createdStylist });
    } catch (error) {
        console.error('Database error creating stylist:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.patch('/api/admin/staff/:id', authenticateAdmin, async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        const allowedUpdates = ['name', 'specialty', 'tagline', 'instagram', 'color', 'available', 'imageUrl'];
        const updateData = {};
        for (const key of allowedUpdates) {
            if (req.body[key] !== undefined) {
                updateData[key] = req.body[key];
            }
        }

        const updatedStylist = await StylistRepository.updateById(req.params.id, updateData);

        res.json({ success: true, stylist: updatedStylist });
    } catch (error) {
        console.error('Database error updating stylist:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.delete('/api/admin/staff/:id', authenticateAdmin, async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        await StylistRepository.deleteById(req.params.id);

        res.json({ success: true, message: 'Stylist deleted' });
    } catch (error) {
        console.error('Database error deleting stylist:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Product management (admin)
app.post('/api/admin/products', authenticateAdmin, async (req, res) => {
    try {
        const { name, category, description, price, salePrice, stock, imageUrl } = req.body;

        if (!name || !category || !price) {
            return res.status(400).json({ success: false, message: 'Name, category, and price are required' });
        }

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

        const createdProduct = await ProductRepository.create(newProduct);

        res.status(201).json({ success: true, product: createdProduct });
    } catch (error) {
        console.error('Database error creating product:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.patch('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
    try {
        const product = await ProductRepository.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const allowedUpdates = ['name', 'category', 'description', 'price', 'salePrice', 'onSale', 'stock', 'imageUrl'];
        const updateData = {};
        for (const key of allowedUpdates) {
            if (req.body[key] !== undefined) {
                updateData[key] = req.body[key];
            }
        }

        const updatedProduct = await ProductRepository.updateById(req.params.id, updateData);

        res.json({ success: true, product: updatedProduct });
    } catch (error) {
        console.error('Database error updating product:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.delete('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
    try {
        const product = await ProductRepository.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        await ProductRepository.deleteById(req.params.id);

        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        console.error('Database error deleting product:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Promo management (admin)
app.get('/api/admin/promos', authenticateAdmin, async (req, res) => {
    try {
        const promos = await PromoRepository.findAll();
        res.json({ success: true, promos: promos });
    } catch (error) {
        console.error('Database error in admin promos:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.post('/api/admin/promos', authenticateAdmin, async (req, res) => {
    try {
        const { code, description, discountType, discountValue, minOrder, expiresAt, usageLimit,
                highlighted, badge, title, subtitle, priority } = req.body;

        if (!code || !discountType || !discountValue) {
            return res.status(400).json({ success: false, message: 'Code, discount type, and value are required' });
        }

        const existingPromos = await PromoRepository.findAll();
        if (existingPromos.find(p => p.code.toUpperCase() === code.toUpperCase())) {
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

        const createdPromo = await PromoRepository.create(newPromo);

        res.status(201).json({ success: true, promo: createdPromo });
    } catch (error) {
        console.error('Database error creating promo:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.patch('/api/admin/promos/:id', authenticateAdmin, async (req, res) => {
    try {
        const promo = await PromoRepository.findById(req.params.id);
        if (!promo) {
            return res.status(404).json({ success: false, message: 'Promo not found' });
        }

        // Include Special Offer fields in allowed updates
        const allowedUpdates = ['description', 'discountType', 'discountValue', 'minOrder', 'expiresAt', 'usageLimit', 'active',
                               'highlighted', 'badge', 'title', 'subtitle', 'priority'];
        const updateData = {};
        for (const key of allowedUpdates) {
            if (req.body[key] !== undefined) {
                updateData[key] = req.body[key];
            }
        }

        const updatedPromo = await PromoRepository.updateById(req.params.id, updateData);

        res.json({ success: true, promo: updatedPromo });
    } catch (error) {
        console.error('Database error updating promo:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.delete('/api/admin/promos/:id', authenticateAdmin, async (req, res) => {
    try {
        const promo = await PromoRepository.findById(req.params.id);
        if (!promo) {
            return res.status(404).json({ success: false, message: 'Promo not found' });
        }

        await PromoRepository.deleteById(req.params.id);

        res.json({ success: true, message: 'Promo deleted' });
    } catch (error) {
        console.error('Database error deleting promo:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
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
app.get('/api/admin/hair-tracker', authenticateAdmin, async (req, res) => {
    try {
        // Return the hardcoded configuration used throughout the app
        const config = {
            defaultMaintenanceIntervalDays: 42,
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            extensionTypeIntervals: {
                'clip-in': 1,
                'tape-in': 42,
                'sew-in': 56,
                'micro-link': 84,
                'fusion': 84,
                'halo': 1,
                'ponytail': 14,
                'other': 42
            },
            extensionTypes: [
                { id: 'clip-in', label: 'Clip-In Extensions', maintenanceDays: 1 },
                { id: 'tape-in', label: 'Tape Extensions', maintenanceDays: 42 },
                { id: 'sew-in', label: 'Sew-In Extensions', maintenanceDays: 56 },
                { id: 'micro-link', label: 'Micro-Link Extensions', maintenanceDays: 84 },
                { id: 'fusion', label: 'Fusion Extensions', maintenanceDays: 84 },
                { id: 'halo', label: 'Halo Extensions', maintenanceDays: 1 },
                { id: 'ponytail', label: 'Ponytail Extensions', maintenanceDays: 14 },
                { id: 'other', label: 'Other Extensions', maintenanceDays: 42 }
            ],
            healthScore: {
                base: 100,
                penalties: {
                    overMaintenanceByDay: 0.5,
                    noDeepConditionOverDays: 0.3,
                    tooManyWashesPerWeek: 1.0
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

        res.json({ success: true, ...config });
    } catch (error) {
        console.error('Database error loading hair tracker config:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update hair tracker settings
app.put('/api/admin/hair-tracker', authenticateAdmin, async (req, res) => {
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

        // Validate input
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

        // Since configuration is now hardcoded in the app code, we return the current config
        const updatedConfig = {
            defaultMaintenanceIntervalDays: 42,
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            extensionTypeIntervals: {
                'clip-in': 1,
                'tape-in': 42,
                'sew-in': 56,
                'micro-link': 84,
                'fusion': 84,
                'halo': 1,
                'ponytail': 14,
                'other': 42
            },
            extensionTypes: [
                { id: 'clip-in', label: 'Clip-In Extensions', maintenanceDays: 1 },
                { id: 'tape-in', label: 'Tape Extensions', maintenanceDays: 42 },
                { id: 'sew-in', label: 'Sew-In Extensions', maintenanceDays: 56 },
                { id: 'micro-link', label: 'Micro-Link Extensions', maintenanceDays: 84 },
                { id: 'fusion', label: 'Fusion Extensions', maintenanceDays: 84 },
                { id: 'halo', label: 'Halo Extensions', maintenanceDays: 1 },
                { id: 'ponytail', label: 'Ponytail Extensions', maintenanceDays: 14 },
                { id: 'other', label: 'Other Extensions', maintenanceDays: 42 }
            ],
            healthScore: {
                base: 100,
                penalties: {
                    overMaintenanceByDay: 0.5,
                    noDeepConditionOverDays: 0.3,
                    tooManyWashesPerWeek: 1.0
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

        res.json({
            success: true,
            message: 'Hair tracker settings updated successfully (configuration is now application-managed)',
            ...updatedConfig
        });
    } catch (error) {
        console.error('Database error updating hair tracker settings:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Reset hair tracker settings to defaults
app.post('/api/admin/hair-tracker/reset', authenticateAdmin, async (req, res) => {
    try {
        const defaultConfig = {
            defaultMaintenanceIntervalDays: 42,
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            extensionTypeIntervals: {
                'clip-in': 1,
                'tape-in': 42,
                'sew-in': 56,
                'micro-link': 84,
                'fusion': 84,
                'halo': 1,
                'ponytail': 14,
                'other': 42
            },
            extensionTypes: [
                { id: 'clip-in', label: 'Clip-In Extensions', maintenanceDays: 1 },
                { id: 'tape-in', label: 'Tape Extensions', maintenanceDays: 42 },
                { id: 'sew-in', label: 'Sew-In Extensions', maintenanceDays: 56 },
                { id: 'micro-link', label: 'Micro-Link Extensions', maintenanceDays: 84 },
                { id: 'fusion', label: 'Fusion Extensions', maintenanceDays: 84 },
                { id: 'halo', label: 'Halo Extensions', maintenanceDays: 1 },
                { id: 'ponytail', label: 'Ponytail Extensions', maintenanceDays: 14 },
                { id: 'other', label: 'Other Extensions', maintenanceDays: 42 }
            ],
            healthScore: {
                base: 100,
                penalties: {
                    overMaintenanceByDay: 0.5,
                    noDeepConditionOverDays: 0.3,
                    tooManyWashesPerWeek: 1.0
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

        res.json({
            success: true,
            message: 'Hair tracker settings reset to defaults (configuration is now application-managed)',
            ...defaultConfig
        });
    } catch (error) {
        console.error('Database error resetting hair tracker settings:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
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

// In-memory storage for notifications (since these are transient admin messages)
let notificationsStore = { notifications: [] };

// Get active notifications (for client app)
app.get('/api/notifications/active', async (req, res) => {
    try {
        const now = new Date();
        const active = notificationsStore.notifications.filter(n => {
            if (!n.active) return false;
            if (n.expiresAt && new Date(n.expiresAt) < now) return false;
            if (n.startsAt && new Date(n.startsAt) > now) return false;
            return true;
        });

        res.json({ notifications: active });
    } catch (error) {
        console.error('Error getting active notifications:', error.message);
        res.status(500).json({ success: false, message: 'Error loading notifications' });
    }
});

// Get all notifications (admin)
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        res.json(notificationsStore);
    } catch (error) {
        console.error('Error getting notifications:', error.message);
        res.status(500).json({ success: false, message: 'Error loading notifications' });
    }
});

// Create notification (admin only)
app.post('/api/notifications', authenticateAdmin, async (req, res) => {
    try {
        const { title, message, type, action, actionText, startsAt, expiresAt } = req.body;

        if (!title || !message) {
            return res.status(400).json({ message: 'Title and message are required' });
        }

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

        notificationsStore.notifications.unshift(notification);

        res.status(201).json({ message: 'Notification created', notification });
    } catch (error) {
        console.error('Error creating notification:', error.message);
        res.status(500).json({ success: false, message: 'Error creating notification' });
    }
});

// Update notification (admin only)
app.put('/api/notifications/:id', authenticateAdmin, async (req, res) => {
    try {
        const index = notificationsStore.notifications.findIndex(n => n.id === req.params.id);
        if (index === -1) return res.status(404).json({ message: 'Notification not found' });

        notificationsStore.notifications[index] = {
            ...notificationsStore.notifications[index],
            ...req.body,
            updatedAt: new Date().toISOString()
        };

        res.json({ message: 'Notification updated', notification: notificationsStore.notifications[index] });
    } catch (error) {
        console.error('Error updating notification:', error.message);
        res.status(500).json({ success: false, message: 'Error updating notification' });
    }
});

// Delete notification (admin only)
app.delete('/api/notifications/:id', authenticateAdmin, async (req, res) => {
    try {
        const index = notificationsStore.notifications.findIndex(n => n.id === req.params.id);
        if (index === -1) return res.status(404).json({ message: 'Notification not found' });

        notificationsStore.notifications.splice(index, 1);

        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error.message);
        res.status(500).json({ success: false, message: 'Error deleting notification' });
    }
});

// Toggle notification active status (admin only)
app.patch('/api/notifications/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        const notification = notificationsStore.notifications.find(n => n.id === req.params.id);
        if (!notification) return res.status(404).json({ message: 'Notification not found' });

        notification.active = !notification.active;

        res.json({ message: `Notification ${notification.active ? 'activated' : 'deactivated'}`, notification });
    } catch (error) {
        console.error('Error toggling notification:', error.message);
        res.status(500).json({ success: false, message: 'Error toggling notification' });
    }
});

// ============================================
// CHAT ENDPOINTS (PUBLIC - Customer Side)
// ============================================

// In-memory storage for chat conversations (since these are transient support messages)
let chatStore = { conversations: [] };
let galleryStore = { items: [] };
let hairTipsStore = { tips: [] };

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
app.post('/api/chat/message', optionalAuth, async (req, res) => {
    try {
        const { conversationId, guestId, source, text } = req.body;

        // Validate text
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Message text is required' });
        }

        if (text.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message too long (max 2000 characters)' });
        }

        const now = new Date().toISOString();

        let conversation;
        let isNewConversation = false;

        if (conversationId) {
            // Find existing conversation
            conversation = chatStore.conversations.find(c => c.id === conversationId);

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
                try {
                    const user = await UserRepository.findById(req.user.id);
                    if (user) {
                        userName = user.name;
                        userEmail = user.email;
                    }
                } catch (error) {
                    console.error('Error fetching user for chat:', error.message);
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

            chatStore.conversations.push(conversation);
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
    } catch (error) {
        console.error('Error processing chat message:', error.message);
        res.status(500).json({ success: false, message: 'Error processing message' });
    }
});

// Get a specific conversation (user)
app.get('/api/chat/conversation/:id', optionalAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { guestId } = req.query;

        const conversation = chatStore.conversations.find(c => c.id === id);

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
    } catch (error) {
        console.error('Error getting conversation:', error.message);
        res.status(500).json({ success: false, message: 'Error loading conversation' });
    }
});

// Get latest conversation for current visitor
app.get('/api/chat/my-latest', optionalAuth, (req, res) => {
    try {
        const { guestId } = req.query;

        if (!chatStore.conversations || chatStore.conversations.length === 0) {
            return res.json({ success: true, conversation: null });
        }

        let conversation;

        if (req.user) {
            // Find by userId
            conversation = chatStore.conversations
                .filter(c => c.userId === req.user.id && c.status === 'open')
                .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))[0];
        } else if (guestId) {
            // Find by guestId
            conversation = chatStore.conversations
                .filter(c => c.guestId === guestId && c.status === 'open')
                .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))[0];
        }

        res.json({
            success: true,
            conversation: conversation || null
        });
    } catch (error) {
        console.error('Error getting latest conversation:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ============================================
// CHAT ENDPOINTS (ADMIN - Agent Side)
// ============================================

// List all conversations (admin inbox)
app.get('/api/admin/chat/conversations', authenticateAdmin, async (req, res) => {
    try {
        const { status, search } = req.query;

        if (!chatStore.conversations || chatStore.conversations.length === 0) {
            return res.json({ success: true, conversations: [] });
        }

        let conversations = [...chatStore.conversations];

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
    } catch (error) {
        console.error('Error listing admin conversations:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get full conversation (admin)
app.get('/api/admin/chat/conversations/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (!chatStore.conversations || chatStore.conversations.length === 0) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const conversation = chatStore.conversations.find(c => c.id === id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error getting admin conversation:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Send message as agent
app.post('/api/admin/chat/message', authenticateAdmin, async (req, res) => {
    try {
        const { conversationId, text } = req.body;

        if (!conversationId) {
            return res.status(400).json({ success: false, message: 'Conversation ID is required' });
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Message text is required' });
        }

        if (!chatStore.conversations || chatStore.conversations.length === 0) {
            return res.status(404).json({ success: false, message: 'Chat data not found' });
        }

        const conversation = chatStore.conversations.find(c => c.id === conversationId);

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

        res.json({ success: true, message: newMessage });
    } catch (error) {
        console.error('Error sending admin chat message:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Mark conversation as read (admin)
app.patch('/api/admin/chat/conversations/:id/read', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (!chatStore.conversations || chatStore.conversations.length === 0) {
            return res.status(404).json({ success: false, message: 'Chat data not found' });
        }

        const conversation = chatStore.conversations.find(c => c.id === id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        // Mark all user messages as read by agent
        conversation.messages.forEach(m => {
            if (m.from === 'user') {
                m.readByAgent = true;
            }
        });

        res.json({ success: true, message: 'Conversation marked as read' });
    } catch (error) {
        console.error('Error marking conversation as read:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Update conversation status (admin)
app.patch('/api/admin/chat/conversations/:id/status', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['open', 'closed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        if (!chatStore.conversations || chatStore.conversations.length === 0) {
            return res.status(404).json({ success: false, message: 'Chat data not found' });
        }

        const conversation = chatStore.conversations.find(c => c.id === id);

        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        conversation.status = status;
        conversation.updatedAt = new Date().toISOString();

        res.json({ success: true, message: `Conversation ${status}`, conversation });
    } catch (error) {
        console.error('Error updating conversation status:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ============================================
// GALLERY ENDPOINTS
// ============================================

// Get all active gallery items (public)
app.get('/api/gallery', (req, res) => {
    try {
        if (!galleryStore.items || galleryStore.items.length === 0) {
            return res.json({ items: [] });
        }

        const activeItems = galleryStore.items
            .filter(item => item.active)
            .sort((a, b) => a.order - b.order);

        res.json({ items: activeItems });
    } catch (error) {
        console.error('Error getting gallery items:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get all gallery items (admin)
app.get('/api/admin/gallery', authenticateAdmin, async (req, res) => {
    try {
        if (!galleryStore.items || galleryStore.items.length === 0) {
            return res.json({ items: [] });
        }

        const items = [...galleryStore.items].sort((a, b) => a.order - b.order);
        res.json({ items });
    } catch (error) {
        console.error('Error getting admin gallery items:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create gallery item (admin)
app.post('/api/admin/gallery', authenticateAdmin, async (req, res) => {
    try {
        const { imageUrl, altText, label, category } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ message: 'Image URL is required' });
        }

        // Find the highest order number
        const maxOrder = galleryStore.items.reduce((max, item) => Math.max(max, item.order || 0), 0);

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

        galleryStore.items.push(newItem);

        res.status(201).json({ message: 'Gallery item created', item: newItem });
    } catch (error) {
        console.error('Error creating gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update gallery item (admin)
app.patch('/api/admin/gallery/:id', authenticateAdmin, async (req, res) => {
    try {
        const { imageUrl, altText, label, category, order, active } = req.body;

        if (!galleryStore.items || galleryStore.items.length === 0) {
            return res.status(404).json({ message: 'Gallery not found' });
        }

        const itemIndex = galleryStore.items.findIndex(item => item.id === req.params.id);
        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Gallery item not found' });
        }

        const item = galleryStore.items[itemIndex];

        if (imageUrl !== undefined) item.imageUrl = imageUrl;
        if (altText !== undefined) item.altText = altText;
        if (label !== undefined) item.label = label;
        if (category !== undefined) item.category = category;
        if (order !== undefined) item.order = order;
        if (active !== undefined) item.active = active;

        item.updatedAt = new Date().toISOString();

        res.json({ message: 'Gallery item updated', item });
    } catch (error) {
        console.error('Error updating gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete gallery item (admin)
app.delete('/api/admin/gallery/:id', authenticateAdmin, async (req, res) => {
    try {
        if (!galleryStore.items || galleryStore.items.length === 0) {
            return res.status(404).json({ message: 'Gallery not found' });
        }

        const itemIndex = galleryStore.items.findIndex(item => item.id === req.params.id);
        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Gallery item not found' });
        }

        galleryStore.items.splice(itemIndex, 1);

        res.json({ message: 'Gallery item deleted' });
    } catch (error) {
        console.error('Error deleting gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Toggle gallery item active status (admin)
app.patch('/api/admin/gallery/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        if (!galleryStore.items || galleryStore.items.length === 0) {
            return res.status(404).json({ message: 'Gallery not found' });
        }

        const item = galleryStore.items.find(item => item.id === req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Gallery item not found' });
        }

        item.active = !item.active;
        item.updatedAt = new Date().toISOString();

        res.json({ message: `Gallery item ${item.active ? 'activated' : 'deactivated'}`, item });
    } catch (error) {
        console.error('Error toggling gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Reorder gallery items (admin)
app.post('/api/admin/gallery/reorder', authenticateAdmin, async (req, res) => {
    try {
        const { orderedIds } = req.body;

        if (!Array.isArray(orderedIds)) {
            return res.status(400).json({ message: 'orderedIds array is required' });
        }

        if (!galleryStore.items || galleryStore.items.length === 0) {
            return res.status(404).json({ message: 'Gallery not found' });
        }

        // Update order based on array position
        orderedIds.forEach((id, index) => {
            const item = galleryStore.items.find(item => item.id === id);
            if (item) {
                item.order = index + 1;
            }
        });

        res.json({ message: 'Gallery order updated' });
    } catch (error) {
        console.error('Error reordering gallery items:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================
// HAIR TIPS ENDPOINTS
// ============================================

// Get random active tip (public)
app.get('/api/hair-tips/random', (req, res) => {
    try {
        if (!hairTipsStore.tips || hairTipsStore.tips.length === 0) {
            return res.json({ tip: null });
        }

        const activeTips = hairTipsStore.tips.filter(tip => tip.active);
        if (activeTips.length === 0) {
            return res.json({ tip: null });
        }

        const randomIndex = Math.floor(Math.random() * activeTips.length);
        const randomTip = activeTips[randomIndex];

        res.json({ tip: { id: randomTip.id, text: randomTip.text } });
    } catch (error) {
        console.error('Error getting random hair tip:', error);
        res.status(500).json({ tip: null });
    }
});

// Get all tips (public - for admin to list)
app.get('/api/hair-tips', (req, res) => {
    try {
        if (!hairTipsStore.tips || hairTipsStore.tips.length === 0) {
            return res.json({ tips: [] });
        }

        res.json({ tips: hairTipsStore.tips });
    } catch (error) {
        console.error('Error getting hair tips:', error);
        res.status(500).json({ tips: [] });
    }
});

// Get all tips (admin)
app.get('/api/admin/hair-tips', authenticateAdmin, async (req, res) => {
    try {
        if (!hairTipsStore.tips || hairTipsStore.tips.length === 0) {
            return res.json({ tips: [] });
        }

        res.json({ tips: hairTipsStore.tips });
    } catch (error) {
        console.error('Error getting admin hair tips:', error);
        res.status(500).json({ tips: [] });
    }
});

// Create hair tip (admin)
app.post('/api/admin/hair-tips', authenticateAdmin, async (req, res) => {
    try {
        const { text, category, priority } = req.body;

        if (!text || text.trim() === '') {
            return res.status(400).json({ message: 'Tip text is required' });
        }

        // Generate a new ID
        const maxId = hairTipsStore.tips.reduce((max, tip) => {
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

        hairTipsStore.tips.push(newTip);

        res.status(201).json({ message: 'Hair tip created', tip: newTip });
    } catch (error) {
        console.error('Error creating hair tip:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update hair tip (admin)
app.put('/api/admin/hair-tips/:id', authenticateAdmin, async (req, res) => {
    try {
        const { text, category, priority, active } = req.body;

        if (!hairTipsStore.tips || hairTipsStore.tips.length === 0) {
            return res.status(404).json({ message: 'Hair tips data not found' });
        }

        const tipIndex = hairTipsStore.tips.findIndex(tip => tip.id === req.params.id);
        if (tipIndex === -1) {
            return res.status(404).json({ message: 'Hair tip not found' });
        }

        const tip = hairTipsStore.tips[tipIndex];

        if (text !== undefined) tip.text = text.trim();
        if (category !== undefined) tip.category = category;
        if (priority !== undefined) tip.priority = priority;
        if (active !== undefined) tip.active = active;

        tip.updatedAt = new Date().toISOString();

        res.json({ message: 'Hair tip updated', tip });
    } catch (error) {
        console.error('Error updating hair tip:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Toggle hair tip active status (admin)
app.patch('/api/admin/hair-tips/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        if (!hairTipsStore.tips || hairTipsStore.tips.length === 0) {
            return res.status(404).json({ message: 'Hair tips data not found' });
        }

        const tip = hairTipsStore.tips.find(tip => tip.id === req.params.id);
        if (!tip) {
            return res.status(404).json({ message: 'Hair tip not found' });
        }

        tip.active = !tip.active;
        tip.updatedAt = new Date().toISOString();

        res.json({ message: `Hair tip ${tip.active ? 'activated' : 'deactivated'}`, tip });
    } catch (error) {
        console.error('Error toggling hair tip:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete hair tip (admin)
app.delete('/api/admin/hair-tips/:id', authenticateAdmin, async (req, res) => {
    try {
        if (!hairTipsStore.tips || hairTipsStore.tips.length === 0) {
            return res.status(404).json({ message: 'Hair tips data not found' });
        }

        const tipIndex = hairTipsStore.tips.findIndex(tip => tip.id === req.params.id);
        if (tipIndex === -1) {
            return res.status(404).json({ message: 'Hair tip not found' });
        }

        hairTipsStore.tips.splice(tipIndex, 1);

        res.json({ message: 'Hair tip deleted' });
    } catch (error) {
        console.error('Error deleting hair tip:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
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
