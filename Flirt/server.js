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

let db, UserRepository, StylistRepository, ServiceRepository, BookingRepository, ProductRepository, OrderRepository, PromoRepository, GalleryRepository, PaymentRepository, PaymentSettingsRepository, LoyaltyRepository, NotificationRepository, ChatRepository, HairTipRepository;

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
    GalleryRepository = dbModule.GalleryRepository;
    PaymentRepository = dbModule.PaymentRepository;
    PaymentSettingsRepository = dbModule.PaymentSettingsRepository;
    LoyaltyRepository = dbModule.LoyaltyRepository;
    NotificationRepository = dbModule.NotificationRepository;
    ChatRepository = dbModule.ChatRepository;
    HairTipRepository = dbModule.HairTipRepository;

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

const IS_DEV = process.env.NODE_ENV !== 'production';

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
app.use(express.json({ limit: '10mb' })); // Increase limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Needed for PayFast form callbacks
app.use(express.static(__dirname));

// ============================================
// SEED ADMIN USER
// ============================================
async function seedAdminUser() {
    try {
        // Initialize database first
        await db.initializeDatabase();

        // Seed stylists into DB if missing
        await seedStylistsDefaults();
        // Seed services into DB if missing
        await seedServicesDefaults();
        // Seed hair tips into DB if missing
        await seedHairTipsDefaults();

        // Load persisted payment configuration into runtime (if any)
        try {
            const storedPaymentConfig = await PaymentSettingsRepository.getConfig();
            if (storedPaymentConfig) {
                PaymentService.setRuntimeConfig(storedPaymentConfig);
                console.log('Loaded payment configuration from database');
            }
        } catch (err) {
            console.error('Warning: failed to load payment config from DB:', err.message);
        }

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
        await seedStylistsDefaults();
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

// Get all service types with metadata (for dynamic booking type cards)
app.get('/api/service-types', async (req, res) => {
    try {
        const services = await ServiceRepository.findAll();

        // Group services by type and get counts
        const typeMap = {};
        services.forEach(service => {
            if (!typeMap[service.service_type]) {
                typeMap[service.service_type] = {
                    type: service.service_type,
                    count: 0,
                    services: []
                };
            }
            if (service.active) {
                typeMap[service.service_type].count++;
                typeMap[service.service_type].services.push(service);
            }
        });

        const types = Object.values(typeMap).filter(t => t.count > 0);

        res.json({ success: true, types });
    } catch (error) {
        console.error('Error fetching service types:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch service types' });
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

        // Check same stylist, same date, same time (support both old and new schema)
        const bookingDate = b.requestedDate || b.date;
        if (b.stylistId === stylistId && bookingDate === date) {
            // For confirmed bookings with exact time
            if (b.confirmedTime === time || b.time === time || b.assignedStartTime === time) {
                return true;
            }
        }
        return false;
    });

    return conflictingBooking;
}

// Normalize DB booking rows to API-friendly camelCase
function mapBookingResponse(row) {
    if (!row) return null;

    return {
        id: row.id,
        userId: row.user_id || row.userId,
        type: row.booking_type || row.bookingType || row.type,
        stylistId: row.stylist_id || row.stylistId || null,
        stylistName: row.stylist_name || row.stylistName || null,
        serviceId: row.service_id || row.serviceId,
        serviceName: row.service_name || row.serviceName,
        servicePrice: row.service_price ?? row.servicePrice ?? null,
        // New two-step booking fields
        requestedDate: row.requested_date || row.requestedDate || null,
        requestedTimeWindow: row.requested_time_window || row.requestedTimeWindow || null,
        assignedStartTime: row.assigned_start_time || row.assignedStartTime || null,
        assignedEndTime: row.assigned_end_time || row.assignedEndTime || null,
        // Legacy fields (for backward compatibility)
        date: row.date || row.requested_date || null,
        preferredTimeOfDay: row.preferred_time_of_day ?? row.preferredTimeOfDay ?? null,
        time: row.time ?? null,
        confirmedTime: row.confirmed_time ?? row.confirmedTime ?? null,
        status: row.status,
        notes: row.notes ?? null,
        createdAt: row.created_at ?? row.createdAt ?? null,
        updatedAt: row.updated_at ?? row.updatedAt ?? null,
        customerName: row.customer_name ?? row.customerName ?? null,
        customerPhone: row.customer_phone ?? row.customerPhone ?? null,
        customerEmail: row.customer_email ?? row.customerEmail ?? null
    };
}

// Ensure time strings are stored in HH:MM 24h format
function normalizeTimeStr(time) {
    if (!time) return null;
    const trimmed = String(time).trim().toLowerCase();
    const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!match) return trimmed;

    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? match[2].padEnd(2, '0') : '00';
    const ampm = match[3];

    if (ampm === 'am' && hours === 12) hours = 0;
    if (ampm === 'pm' && hours < 12) hours += 12;

    hours = hours % 24;
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

// Helper function to add hours to a time string (HH:MM format)
function addHoursToTime(timeStr, hoursToAdd) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const newHours = (hours + hoursToAdd) % 24;
    return `${newHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Helper function to add duration in minutes to a time string (HH:MM format)
function addDuration(timeStr, durationMinutes) {
    if (!timeStr || !durationMinutes) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + durationMinutes;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
}

// Create booking
app.post('/api/bookings', authenticateToken, async (req, res) => {
    const { type, stylistId, serviceId, date, requestedTimeWindow, preferredTimeOfDay, time, notes } = req.body;

    // Support both new (requestedTimeWindow) and legacy (preferredTimeOfDay) parameters
    const timeWindow = requestedTimeWindow || preferredTimeOfDay;

    if (!type || !serviceId || !date) {
        return res.status(400).json({ success: false, message: 'Type, service, and date are required' });
    }

    // For the new two-step booking flow, require time window instead of exact time
    if (type === 'hair' && !timeWindow) {
        return res.status(400).json({ success: false, message: 'Time window is required for hair bookings (MORNING, AFTERNOON, LATE_AFTERNOON, or EVENING)' });
    }

    if (type === 'beauty' && !time) {
        return res.status(400).json({ success: false, message: 'Time is required for beauty bookings' });
    }

    // Validate time window for hair bookings
    const validTimeWindows = ['MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'];
    if (type === 'hair' && timeWindow && !validTimeWindows.includes(timeWindow)) {
        return res.status(400).json({
            success: false,
            message: `Invalid time window. Must be one of: ${validTimeWindows.join(', ')}`
        });
    }

    // Validate date is in the future (compare dates only, not time)
    const bookingDate = new Date(date + 'T00:00:00'); // Parse as local timezone
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
        return res.status(400).json({ success: false, message: 'Booking date must be in the future' });
    }

    try {
        const normalizedTime = normalizeTimeStr(time);

        // Check for booking conflicts (exact same stylist, date, time)
        // Only for beauty bookings with exact time - hair bookings will be checked when admin assigns time
        if (normalizedTime && type === 'beauty' && stylistId) {
            const conflict = await BookingRepository.findConflict(stylistId, date, normalizedTime);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: 'This time slot is already booked. Please select a different time.',
                    conflict: {
                        date: conflict.requestedDate || conflict.date,
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
            type,
            stylistId: stylistId || null,
            serviceId,
            serviceName: service.name,
            servicePrice: service.price,
            // New two-step booking fields
            requestedDate: date,
            requestedTimeWindow: type === 'hair' ? timeWindow : null,
            assignedStartTime: type === 'beauty' ? normalizedTime : null,
            assignedEndTime: type === 'beauty' && normalizedTime ? addHoursToTime(normalizedTime, 1) : null,
            status: type === 'hair' ? 'REQUESTED' : 'CONFIRMED',
            // Legacy fields (for backward compatibility)
            date,
            preferredTimeOfDay: type === 'hair' ? timeWindow : null,
            time: type === 'beauty' ? normalizedTime : null,
            confirmedTime: type === 'beauty' ? normalizedTime : null,
            notes: notes || null
        };

        const createdBooking = await BookingRepository.create(newBooking);
        const bookingResponse = mapBookingResponse(createdBooking);

        // Award loyalty points for booking
        const loyaltySettings = await LoyaltyRepository.getSettings();
        const pointsToAdd = loyaltySettings.pointsRules?.bookingPoints || 50;

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
                ? 'Booking request submitted! We will assign an exact time within 24 hours and notify you.'
                : 'Booking confirmed!',
            booking: bookingResponse
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
        res.json({ success: true, bookings: userBookings.map(mapBookingResponse) });
    } catch (error) {
        console.error('Database error fetching user bookings:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
    }
});

// Cancel/reschedule booking
app.patch('/api/bookings/:id', authenticateToken, async (req, res) => {
    const { status, date, preferredTimeOfDay, time, confirmedTime, requestedDate, requestedTimeWindow, assignedStartTime, assignedEndTime } = req.body;

    // Log request for debugging
    console.log(`📝 PATCH /api/bookings/${req.params.id}:`, JSON.stringify(req.body, null, 2));

    try {
        // Find booking and verify ownership
        const booking = await BookingRepository.findById(req.params.id);

        if (!booking || booking.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const updates = {};

        // Handle new two-step booking fields
        if (status) {
            // Validate status
            const validStatuses = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
            updates.status = status;
        }

        // Support both new and legacy field names for date
        const newDate = requestedDate || date;
        if (newDate) {
            updates.requestedDate = newDate;
            updates.date = newDate; // Keep legacy field for backward compatibility
            // Reset status to REQUESTED when rescheduling (unless explicitly set)
            if (!status) updates.status = 'REQUESTED';
        }

        // Support both new and legacy field names for time window
        const newTimeWindow = requestedTimeWindow || preferredTimeOfDay;
        if (newTimeWindow !== undefined) {
            // Validate time window if not null
            if (newTimeWindow !== null) {
                const validWindows = ['MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'];
                if (!validWindows.includes(newTimeWindow)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid time window '${newTimeWindow}'. Must be one of: ${validWindows.join(', ')}`
                    });
                }
            }
            updates.requestedTimeWindow = newTimeWindow;
            updates.preferredTimeOfDay = newTimeWindow; // Keep legacy field
        }

        // Handle assigned time fields (can be set to null when rescheduling)
        if (assignedStartTime !== undefined) {
            updates.assignedStartTime = assignedStartTime === null ? null : assignedStartTime;
        }
        if (assignedEndTime !== undefined) {
            updates.assignedEndTime = assignedEndTime === null ? null : assignedEndTime;
        }

        // Legacy fields
        if (time) updates.time = normalizeTimeStr(time);
        if (confirmedTime !== undefined) updates.confirmedTime = confirmedTime === null ? null : normalizeTimeStr(confirmedTime);

        console.log(`✅ Updating booking with:`, JSON.stringify(updates, null, 2));

        const updatedBooking = await BookingRepository.update(req.params.id, updates);

        res.json({ success: true, booking: mapBookingResponse(updatedBooking) });
    } catch (error) {
        console.error('❌ Database error updating booking:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update booking' });
    }
});

// ============================================
// USER INSPO PHOTOS ROUTES
// ============================================

// Get user's inspo photos
app.get('/api/inspo-photos', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const photos = await db.dbAll(
            'SELECT id, label, notes, created_at FROM user_inspo_photos WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );

        // Don't send full base64 data in list view - too large
        res.json({ success: true, photos, count: photos.length });
    } catch (error) {
        console.error('Database error fetching inspo photos:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch photos' });
    }
});

// Get single inspo photo with full image data
app.get('/api/inspo-photos/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const photo = await db.dbGet(
            'SELECT * FROM user_inspo_photos WHERE id = ? AND user_id = ?',
            [req.params.id, userId]
        );

        if (!photo) {
            return res.status(404).json({ success: false, message: 'Photo not found' });
        }

        res.json({ success: true, photo });
    } catch (error) {
        console.error('Database error fetching inspo photo:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch photo' });
    }
});

// Add inspo photo
app.post('/api/inspo-photos', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { imageData, label, notes } = req.body;

        if (!imageData) {
            return res.status(400).json({ success: false, message: 'Image data is required' });
        }

        // Check current count
        const countResult = await db.dbGet(
            'SELECT COUNT(*) as count FROM user_inspo_photos WHERE user_id = ?',
            [userId]
        );

        if (countResult.count >= 5) {
            return res.status(400).json({
                success: false,
                message: 'Maximum of 5 photos allowed. Please delete a photo before uploading a new one.'
            });
        }

        const photoId = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await db.dbRun(
            'INSERT INTO user_inspo_photos (id, user_id, image_data, label, notes) VALUES (?, ?, ?, ?, ?)',
            [photoId, userId, imageData, label || null, notes || null]
        );

        const newPhoto = await db.dbGet(
            'SELECT id, label, notes, created_at FROM user_inspo_photos WHERE id = ?',
            [photoId]
        );

        res.json({ success: true, photo: newPhoto });
    } catch (error) {
        console.error('Database error adding inspo photo:', error.message);
        res.status(500).json({ success: false, message: 'Failed to add photo' });
    }
});

// Delete inspo photo
app.delete('/api/inspo-photos/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Verify ownership
        const photo = await db.dbGet(
            'SELECT id FROM user_inspo_photos WHERE id = ? AND user_id = ?',
            [req.params.id, userId]
        );

        if (!photo) {
            return res.status(404).json({ success: false, message: 'Photo not found' });
        }

        await db.dbRun('DELETE FROM user_inspo_photos WHERE id = ? AND user_id = ?', [req.params.id, userId]);

        res.json({ success: true, message: 'Photo deleted' });
    } catch (error) {
        console.error('Database error deleting inspo photo:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete photo' });
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
        const spendRand = loyaltySettings.pointsRules?.spendRand || 0;
        let pointsToAdd = 0;

        // Calculate points if spendRand is valid (positive)
        if (spendRand > 0) {
            pointsToAdd = Math.floor(total / spendRand);
        }

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
// PAYMENT ROUTES
// ============================================

// Initiate a payment for an order
app.post('/api/payments/initiate', authenticateToken, async (req, res) => {
    const { provider = 'payfast', orderId } = req.body;

    if (!orderId) {
        return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    try {
        const order = await OrderRepository.findById(orderId);
        if (!order || order.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Order already paid' });
        }

        const customer = await UserRepository.findById(req.user.id);

        const configStatus = PaymentService.getPaymentConfigStatus();
        if (provider === 'payfast' && !configStatus.payfast.configured) {
            return res.status(400).json({ success: false, message: 'PayFast is not configured' });
        }
        if (provider === 'yoco' && !configStatus.yoco.configured) {
            return res.status(400).json({ success: false, message: 'Yoco is not configured' });
        }

        const paymentInit = await PaymentService.initializePayment(
            provider,
            { id: order.id, total: order.total, items: order.items || [] },
            { id: customer.id, name: customer.name || customer.email, email: customer.email }
        );

        await PaymentRepository.create({
            id: paymentInit.paymentId,
            orderId: order.id,
            userId: customer.id,
            amount: order.total,
            currency: 'ZAR',
            provider,
            status: 'pending',
            metadata: { providerResponse: paymentInit }
        });

        await OrderRepository.updatePaymentStatus(order.id, 'pending');

        res.json({ success: true, payment: paymentInit });
    } catch (error) {
        console.error('Error initiating payment:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to start payment' });
    }
});

// Check payment status
app.get('/api/payments/:id/status', authenticateToken, async (req, res) => {
    try {
        const payment = await PaymentRepository.findById(req.params.id);
        if (!payment || payment.user_id !== req.user.id) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        res.json({ success: true, payment });
    } catch (error) {
        console.error('Error fetching payment status:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payment status' });
    }
});

// PayFast ITN webhook
app.post('/api/payments/webhook/payfast', async (req, res) => {
    try {
        const result = PaymentService.processWebhook('payfast', req.body, req.headers);

        if (!result.valid) {
            return res.status(400).json({ success: false, message: result.reason || 'Invalid ITN' });
        }

        const paymentStatus = result.completed ? 'paid' : (result.status || 'pending').toLowerCase();
        const providerStatus = result.completed ? 'completed' : (result.status || 'processing').toLowerCase();

        if (result.paymentId) {
            await PaymentRepository.updateStatus(result.paymentId, providerStatus, result.pfPaymentId, { itn: result });
        }
        if (result.orderId) {
            await OrderRepository.updatePaymentStatus(result.orderId, paymentStatus);
            if (paymentStatus === 'paid') {
                await OrderRepository.updateStatus(result.orderId, 'paid');
            }
        }

        return res.send('OK');
    } catch (error) {
        console.error('PayFast webhook error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Yoco webhook
app.post('/api/payments/webhook/yoco', async (req, res) => {
    try {
        const result = PaymentService.processWebhook('yoco', req.body, req.headers);

        if (result.valid === false) {
            return res.status(400).json({ success: false, message: result.reason || 'Invalid webhook' });
        }

        const paymentStatus = result.completed ? 'paid' : (result.status || 'pending').toLowerCase();
        const providerStatus = result.completed ? 'completed' : (result.status || result.type || 'processing').toLowerCase();

        if (result.paymentId) {
            await PaymentRepository.updateStatus(result.paymentId, providerStatus, result.yocoPaymentId, { event: result });
        }
        if (result.orderId) {
            await OrderRepository.updatePaymentStatus(result.orderId, paymentStatus);
            if (paymentStatus === 'paid') {
                await OrderRepository.updateStatus(result.orderId, 'paid');
            }
        }

        return res.send('OK');
    } catch (error) {
        console.error('Yoco webhook error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
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

        if (!user.referral_code) {
            const newCode = generateReferralCode(user.name || 'User');
            await UserRepository.update(user.id, { referralCode: newCode });
            user.referral_code = newCode;
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
        const referralPoints = loyaltySettings.pointsRules?.referralPoints || 100;

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
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (!currentUser.referral_code) {
            const newCode = generateReferralCode(currentUser.name || 'User');
            await UserRepository.update(currentUser.id, { referralCode: newCode });
            currentUser.referral_code = newCode;
        }
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
        const extensionTypeIntervals = {
            'clip-in': 1,        // Daily removal
            'tape-in': 42,       // 6 weeks
            'sew-in': 56,        // 8 weeks
            'micro-link': 84,    // 12 weeks
            'fusion': 84,        // 12 weeks
            'halo': 1,           // Daily removal
            'ponytail': 14,      // 2 weeks
            'other': 42          // Default 6 weeks
        };

        const extensionTypeLabels = {
            'clip-in': 'Clip-In Extensions',
            'tape-in': 'Tape-In Extensions',
            'sew-in': 'Sew-In Weave',
            'micro-link': 'Micro-Link Extensions',
            'fusion': 'Fusion Extensions',
            'halo': 'Halo Extensions',
            'ponytail': 'Ponytail Extensions',
            'other': 'Other'
        };

        // Convert to array of objects for frontend
        const extensionTypes = Object.keys(extensionTypeIntervals).map(id => ({
            id,
            label: extensionTypeLabels[id],
            maintenanceDays: extensionTypeIntervals[id]
        }));

        const config = {
            washFrequencyDays: 3,
            deepConditionFrequencyDays: 14,
            defaultMaintenanceIntervalDays: 42,
            extensionTypes,
            extensionTypeIntervals // Keep for backward compatibility
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

// ============================================
// ADMIN - SERVICE MANAGEMENT
// ============================================

// Get all services (with optional filtering)
app.get('/api/admin/services', authenticateAdmin, async (req, res) => {
    try {
        const { service_type, active } = req.query;
        let services = await ServiceRepository.findAll();

        // Filter by service_type if provided
        if (service_type) {
            services = services.filter(s => s.service_type === service_type);
        }

        // Filter by active status if provided
        if (active !== undefined) {
            const activeFilter = active === 'true' || active === '1' ? 1 : 0;
            services = services.filter(s => s.active === activeFilter);
        }

        res.json({ success: true, services });
    } catch (error) {
        console.error('Error fetching services:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch services' });
    }
});

// Get single service
app.get('/api/admin/services/:id', authenticateAdmin, async (req, res) => {
    try {
        const service = await ServiceRepository.findById(req.params.id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        res.json({ success: true, service });
    } catch (error) {
        console.error('Error fetching service:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch service' });
    }
});

// Get unique service types (for dropdown/filter)
app.get('/api/admin/service-types', authenticateAdmin, async (req, res) => {
    try {
        const services = await ServiceRepository.findAll();
        const types = [...new Set(services.map(s => s.service_type))].sort();
        res.json({ success: true, types });
    } catch (error) {
        console.error('Error fetching service types:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch service types' });
    }
});

// Create new service
app.post('/api/admin/services', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, price, duration, service_type, category, image_url } = req.body;

        // Validation
        if (!name || !price || !service_type) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: name, price, service_type'
            });
        }

        if (typeof price !== 'number' || price < 0) {
            return res.status(400).json({
                success: false,
                message: 'Price must be a positive number'
            });
        }

        const service = {
            id: require('uuid').v4(),
            name: name.trim(),
            description: description ? description.trim() : null,
            price,
            duration: duration || null,
            service_type: service_type.trim().toLowerCase(),
            category: category ? category.trim() : null,
            image_url: image_url ? image_url.trim() : null,
            active: 1,
            created_at: new Date().toISOString()
        };

        await ServiceRepository.create(service);

        res.json({ success: true, service, message: 'Service created successfully' });
    } catch (error) {
        console.error('Error creating service:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create service' });
    }
});

// Update service
app.put('/api/admin/services/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, duration, service_type, category, image_url, active } = req.body;

        // Check if service exists
        const existing = await ServiceRepository.findById(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Validation
        if (price !== undefined && (typeof price !== 'number' || price < 0)) {
            return res.status(400).json({
                success: false,
                message: 'Price must be a positive number'
            });
        }

        const updates = {
            name: name !== undefined ? name.trim() : existing.name,
            description: description !== undefined ? (description ? description.trim() : null) : existing.description,
            price: price !== undefined ? price : existing.price,
            duration: duration !== undefined ? duration : existing.duration,
            service_type: service_type !== undefined ? service_type.trim().toLowerCase() : existing.service_type,
            category: category !== undefined ? (category ? category.trim() : null) : existing.category,
            image_url: image_url !== undefined ? (image_url ? image_url.trim() : null) : existing.image_url,
            active: active !== undefined ? (active ? 1 : 0) : existing.active
        };

        await ServiceRepository.update(id, updates);
        const updatedService = await ServiceRepository.findById(id);

        res.json({ success: true, service: updatedService, message: 'Service updated successfully' });
    } catch (error) {
        console.error('Error updating service:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update service' });
    }
});

// Toggle service active status
app.patch('/api/admin/services/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const service = await ServiceRepository.findById(id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        const newStatus = service.active ? 0 : 1;
        await ServiceRepository.update(id, { active: newStatus });
        const updated = await ServiceRepository.findById(id);

        res.json({
            success: true,
            service: updated,
            message: `Service ${newStatus ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        console.error('Error toggling service status:', error.message);
        res.status(500).json({ success: false, message: 'Failed to toggle service status' });
    }
});

// Delete service
app.delete('/api/admin/services/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const service = await ServiceRepository.findById(id);

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Check if service is being used in any bookings
        const bookings = await BookingRepository.findAll();
        const serviceInUse = bookings.some(b => b.service_id === id);

        if (serviceInUse) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete service - it is referenced in existing bookings. Consider deactivating it instead.'
            });
        }

        await ServiceRepository.delete(id);

        res.json({ success: true, message: 'Service deleted successfully' });
    } catch (error) {
        console.error('Error deleting service:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete service' });
    }
});

// ========== STAFF SERVICES MANAGEMENT ==========

// Get all services offered by a specific staff member
app.get('/api/admin/staff/:staffId/services', authenticateAdmin, async (req, res) => {
    try {
        const { staffId } = req.params;

        const staffServices = await db.dbAll(`
            SELECT
                ss.*,
                s.name as service_name,
                s.price as default_price,
                s.duration as default_duration,
                s.category,
                s.service_type
            FROM staff_services ss
            JOIN services s ON ss.service_id = s.id
            WHERE ss.staff_id = ?
            ORDER BY s.category, s.name
        `, [staffId]);

        res.json({ success: true, services: staffServices });
    } catch (error) {
        console.error('Error fetching staff services:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch staff services' });
    }
});

// Add a service to a staff member's offerings
app.post('/api/admin/staff/:staffId/services', authenticateAdmin, async (req, res) => {
    try {
        const { staffId } = req.params;
        const { serviceId, customPrice, customDuration } = req.body;

        if (!serviceId) {
            return res.status(400).json({ success: false, message: 'Service ID is required' });
        }

        // Check if already exists
        const existing = await db.dbGet(
            'SELECT id FROM staff_services WHERE staff_id = ? AND service_id = ?',
            [staffId, serviceId]
        );

        if (existing) {
            return res.status(400).json({ success: false, message: 'Service already added to this staff member' });
        }

        const id = uuidv4();
        await db.dbRun(`
            INSERT INTO staff_services (id, staff_id, service_id, custom_price, custom_duration, active)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [id, staffId, serviceId, customPrice || null, customDuration || null]);

        res.json({ success: true, message: 'Service added to staff member' });
    } catch (error) {
        console.error('Error adding staff service:', error);
        res.status(500).json({ success: false, message: 'Failed to add service' });
    }
});

// Update a staff member's service (custom pricing/duration)
app.put('/api/admin/staff/:staffId/services/:serviceId', authenticateAdmin, async (req, res) => {
    try {
        const { staffId, serviceId } = req.params;
        const { customPrice, customDuration, active } = req.body;

        await db.dbRun(`
            UPDATE staff_services
            SET custom_price = ?,
                custom_duration = ?,
                active = ?,
                updated_at = datetime('now')
            WHERE staff_id = ? AND service_id = ?
        `, [customPrice || null, customDuration || null, active !== undefined ? active : 1, staffId, serviceId]);

        res.json({ success: true, message: 'Staff service updated' });
    } catch (error) {
        console.error('Error updating staff service:', error);
        res.status(500).json({ success: false, message: 'Failed to update service' });
    }
});

// Remove a service from a staff member
app.delete('/api/admin/staff/:staffId/services/:serviceId', authenticateAdmin, async (req, res) => {
    try {
        const { staffId, serviceId } = req.params;

        await db.dbRun(
            'DELETE FROM staff_services WHERE staff_id = ? AND service_id = ?',
            [staffId, serviceId]
        );

        res.json({ success: true, message: 'Service removed from staff member' });
    } catch (error) {
        console.error('Error removing staff service:', error);
        res.status(500).json({ success: false, message: 'Failed to remove service' });
    }
});

// Get services for a specific stylist (client-facing, filtered by active and type)
app.get('/api/stylists/:stylistId/services', async (req, res) => {
    try {
        const { stylistId } = req.params;
        const { type } = req.query; // optional filter by service_type

        let query = `
            SELECT
                s.id,
                s.name,
                s.description,
                s.category,
                s.service_type,
                s.image_url,
                COALESCE(ss.custom_price, s.price) as price,
                COALESCE(ss.custom_duration, s.duration) as duration,
                ss.active as staff_service_active
            FROM staff_services ss
            JOIN services s ON ss.service_id = s.id
            WHERE ss.staff_id = ?
              AND ss.active = 1
              AND s.active = 1
        `;

        const params = [stylistId];

        if (type) {
            query += ' AND s.service_type = ?';
            params.push(type);
        }

        query += ' ORDER BY s.category, s.name';

        const services = await db.dbAll(query, params);

        res.json({ success: true, services });
    } catch (error) {
        console.error('Error fetching stylist services:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch services' });
    }
});

// Dashboard stats
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // Get first day of current month (YYYY-MM-01)
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        // Get last day of current month (YYYY-MM-DD)
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

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

        // Bookings this month (all bookings in current month, including future dates)
        const monthBookings = allBookings.filter(b => {
            const bookingDate = b.requestedDate || b.date;
            return bookingDate && bookingDate >= monthStart && bookingDate <= monthEnd;
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
            const bookingDate = b.requestedDate || b.date;
            if (bookingDate >= ninetyDaysAgo) activeUserIds.add(b.userId);
        });
        allOrders.forEach(o => {
            const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
            if (orderDate && orderDate >= ninetyDaysAgo) activeUserIds.add(o.userId);
        });
        const activeCustomers = activeUserIds.size;

        // Today's bookings count
        const todayBookings = allBookings.filter(b => {
            const bookingDate = b.requestedDate || b.date;
            return bookingDate === today;
        }).length;
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
            const bookingDate = b.requestedDate || b.date;
            if (bookingDate >= startDate) {
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
        const storedConfig = await PaymentSettingsRepository.getConfig();
        res.json({
            success: true,
            config: configStatus,
            storedConfig
        });
    } catch (error) {
        console.error('Error fetching payment config:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch payment configuration'
        });
    }
});

// Update payment configuration (admin)
app.put('/api/admin/payment-config', authenticateAdmin, async (req, res) => {
    try {
        const { appUrl, apiBaseUrl, payfast = {}, yoco = {} } = req.body;

        const newConfig = {
            appUrl,
            apiBaseUrl,
            payfast: {
                merchantId: payfast.merchantId,
                merchantKey: payfast.merchantKey,
                passphrase: payfast.passphrase,
                sandbox: payfast.sandbox
            },
            yoco: {
                secretKey: yoco.secretKey,
                publicKey: yoco.publicKey,
                webhookSecret: yoco.webhookSecret
            }
        };

        await PaymentSettingsRepository.saveConfig(newConfig);
        PaymentService.setRuntimeConfig(newConfig);

        const configStatus = PaymentService.getPaymentConfigStatus();

        res.json({
            success: true,
            message: 'Payment configuration updated',
            config: configStatus
        });
    } catch (error) {
        console.error('Error updating payment config:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update payment configuration'
        });
    }
});

// Create booking (admin on behalf of customer)
app.post('/api/admin/bookings', authenticateAdmin, async (req, res) => {
    const { userId, type, stylistId, serviceId, date, time, duration, notes } = req.body;

    if (!userId || !type || !serviceId || !date || !time) {
        return res.status(400).json({ success: false, message: 'User, type, service, date, and time are required' });
    }

    if (type === 'hair' && !stylistId) {
        return res.status(400).json({ success: false, message: 'Stylist is required for hair bookings' });
    }

    // Validate date is in the future (compare dates only, not time)
    const bookingDate = new Date(date + 'T00:00:00'); // Parse as local timezone
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
        return res.status(400).json({ success: false, message: 'Booking date must be in the future' });
    }

    try {
        const normalizedTime = normalizeTimeStr(time);

        const user = await UserRepository.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const service = await ServiceRepository.findById(serviceId);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Use provided duration or fall back to service duration
        const bookingDuration = duration || service.duration || 60;
        const endTime = addDuration(normalizedTime, bookingDuration);

        // Check for conflicts if stylist is assigned
        if (stylistId) {
            const conflict = await BookingRepository.findConflict(stylistId, date, normalizedTime);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: 'This time slot is already booked. Please select a different time.',
                    conflict: {
                        date: conflict.date,
                        time: conflict.assigned_start_time || conflict.confirmed_time || conflict.time
                    }
                });
            }
        }

        // Admin bookings are always CONFIRMED with specific start/end times
        const newBooking = {
            id: uuidv4(),
            userId,
            bookingType: type,  // New schema field
            type,  // Legacy field
            stylistId: stylistId || null,
            serviceId,
            serviceName: service.name,
            servicePrice: service.price,
            requestedDate: date,  // New schema field (required NOT NULL)
            date,  // Legacy field
            requestedTimeWindow: null,  // Admin bookings don't use time windows
            preferredTimeOfDay: null,  // Legacy field
            assignedStartTime: normalizedTime,  // Confirmed start time
            assignedEndTime: endTime,  // Confirmed end time
            time: normalizedTime,  // Legacy field
            confirmedTime: normalizedTime,  // Legacy field
            status: 'CONFIRMED',  // Admin bookings are immediately confirmed
            notes: notes || null
        };

        const createdBooking = await BookingRepository.create(newBooking);
        const bookingResponse = mapBookingResponse(createdBooking);

        // Award loyalty points to the customer
        const loyaltySettings = await LoyaltyRepository.getSettings();
        const pointsToAdd = loyaltySettings.pointsRules?.bookingPoints || 50;

        if (pointsToAdd > 0) {
            await UserRepository.addPoints(userId, pointsToAdd);
            await LoyaltyRepository.addTransaction({
                id: uuidv4(),
                userId,
                points: pointsToAdd,
                type: 'earned',
                description: `Booking (Created by admin): ${service.name}`
            });
        }

        res.status(201).json({
            success: true,
            message: 'Booking created',
            booking: bookingResponse
        });
    } catch (error) {
        console.error('Database error creating admin booking:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create booking - please try again later' });
    }
});

// Get all bookings (admin)
app.get('/api/admin/bookings', authenticateAdmin, async (req, res) => {
    try {
        const {
            status, date, dateFrom, dateTo, stylistId, serviceId,
            timeOfDay, bookingType, search, sortBy, sortDir,
            page, limit
        } = req.query;

        // Build filters object
        const filters = {};
        if (status) filters.status = status;
        if (date) filters.date = date;
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
        if (stylistId) filters.stylistId = stylistId;
        if (serviceId) filters.serviceId = serviceId;
        if (timeOfDay) filters.timeOfDay = timeOfDay;
        if (bookingType) filters.bookingType = bookingType;
        if (search) filters.search = search;
        if (sortBy) filters.sortBy = sortBy;
        if (sortDir) filters.sortDir = sortDir;

        // Fetch all filtered bookings
        let bookings = await BookingRepository.findAll(filters);
        const totalCount = bookings.length;

        // Apply pagination if requested
        const pageNum = parseInt(page) || 1;
        const pageSize = parseInt(limit) || 50;
        const startIndex = (pageNum - 1) * pageSize;
        const endIndex = startIndex + pageSize;

        const paginatedBookings = bookings.slice(startIndex, endIndex);
        const mapped = paginatedBookings.map(mapBookingResponse);

        res.json({
            success: true,
            bookings: mapped,
            pagination: {
                page: pageNum,
                limit: pageSize,
                total: totalCount,
                totalPages: Math.ceil(totalCount / pageSize)
            }
        });
    } catch (error) {
        console.error('Database error in admin bookings:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Confirm booking time (admin)
app.patch('/api/admin/bookings/:id/confirm', authenticateAdmin, async (req, res) => {
    try {
        const { confirmedTime } = req.body;
        const normalizedTime = normalizeTimeStr(confirmedTime);

        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const updatedBooking = await BookingRepository.updateById(req.params.id, {
            confirmedTime: normalizedTime,
            status: 'CONFIRMED',  // Use uppercase to match CHECK constraint
            updatedAt: new Date().toISOString()
        });

        res.json({ success: true, booking: mapBookingResponse(updatedBooking) });
    } catch (error) {
        console.error('Database error confirming booking:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update booking status (admin) - supports 'COMPLETED', 'CANCELLED', 'REQUESTED', 'CONFIRMED'
app.patch('/api/admin/bookings/:id/status', authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        // Accept both lowercase and uppercase, but convert to uppercase for database
        const statusUpper = status ? status.toUpperCase() : null;
        const validStatuses = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

        if (!statusUpper || !validStatuses.includes(statusUpper)) {
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
            status: statusUpper,  // Use uppercase for database
            updatedAt: new Date().toISOString()
        };

        // Add completion timestamp if marking as completed
        if (statusUpper === 'COMPLETED') {
            updateData.completedAt = new Date().toISOString();
        }

        const updatedBooking = await BookingRepository.updateById(req.params.id, updateData);

        res.json({ success: true, booking: mapBookingResponse(updatedBooking) });
    } catch (error) {
        console.error('Database error updating booking status:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Update booking details (admin) - full edit capability
app.patch('/api/admin/bookings/:id', authenticateAdmin, async (req, res) => {
    const {
        serviceId,
        stylistId,
        status,
        date,
        time,
        duration,
        requestedDate,
        requestedTimeWindow,
        assignedStartTime,
        assignedEndTime,
        notes,
        confirmedTime
    } = req.body;

    console.log(`📝 PATCH /api/admin/bookings/${req.params.id}:`, JSON.stringify(req.body, null, 2));

    try {
        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const updates = {};

        // Service
        if (serviceId !== undefined) {
            updates.service_id = serviceId;
            // Fetch service name if changing service
            if (serviceId) {
                const service = await ServiceRepository.findById(serviceId);
                if (service) {
                    updates.service_name = service.name;
                    updates.service_price = service.price;
                }
            }
        }

        // Stylist
        if (stylistId !== undefined) {
            updates.stylist_id = stylistId || null;
        }

        // Status
        if (status) {
            const statusUpper = status.toUpperCase();
            const validStatuses = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
            if (!validStatuses.includes(statusUpper)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
            updates.status = statusUpper;
        }

        // Date handling - support both new and legacy fields
        const newDate = requestedDate || date;
        if (newDate) {
            updates.requested_date = newDate;
            updates.date = newDate; // Keep legacy field
        }

        // Time window
        if (requestedTimeWindow !== undefined) {
            if (requestedTimeWindow !== null) {
                const validWindows = ['MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'];
                if (!validWindows.includes(requestedTimeWindow)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid time window. Must be one of: ${validWindows.join(', ')}`
                    });
                }
            }
            updates.requested_time_window = requestedTimeWindow;
            updates.preferred_time_of_day = requestedTimeWindow; // Legacy field
        }

        // Assigned times
        if (assignedStartTime !== undefined) {
            updates.assigned_start_time = assignedStartTime;
        }
        if (assignedEndTime !== undefined) {
            updates.assigned_end_time = assignedEndTime;
        }

        // Legacy time field
        if (time !== undefined) {
            updates.time = time;
        }
        if (confirmedTime !== undefined) {
            updates.confirmed_time = confirmedTime;
        }

        // Notes
        if (notes !== undefined) {
            updates.notes = notes;
        }

        updates.updated_at = new Date().toISOString();

        console.log(`✅ Admin updating booking with:`, JSON.stringify(updates, null, 2));

        const updatedBooking = await BookingRepository.updateById(req.params.id, updates);

        res.json({ success: true, booking: mapBookingResponse(updatedBooking) });
    } catch (error) {
        console.error('❌ Database error updating booking:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update booking' });
    }
});

// Bulk update booking statuses (admin)
app.patch('/api/admin/bookings/bulk-status', authenticateAdmin, async (req, res) => {
    try {
        const { bookingIds, status } = req.body;
        const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

        if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Booking IDs array is required' });
        }

        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const results = [];
        const errors = [];

        for (const id of bookingIds) {
            try {
                const booking = await BookingRepository.findById(id);
                if (!booking) {
                    errors.push({ id, error: 'Booking not found' });
                    continue;
                }

                const updateData = {
                    status: status,
                    updatedAt: new Date().toISOString()
                };

                if (status === 'completed') {
                    updateData.completedAt = new Date().toISOString();
                }

                const updated = await BookingRepository.updateById(id, updateData);
                results.push({ id, status: 'success', booking: mapBookingResponse(updated) });
            } catch (err) {
                errors.push({ id, error: err.message });
            }
        }

        res.json({
            success: true,
            updated: results.length,
            failed: errors.length,
            results,
            errors
        });
    } catch (error) {
        console.error('Database error in bulk status update:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Assign exact time to a REQUESTED booking (admin) - NEW ENDPOINT
app.post('/api/admin/bookings/:id/assign-time', authenticateAdmin, async (req, res) => {
    try {
        const { stylistId, assignedStartTime, assignedEndTime } = req.body;

        // Validate inputs
        if (!stylistId || !assignedStartTime || !assignedEndTime) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: stylistId, assignedStartTime, assignedEndTime'
            });
        }

        // Verify booking exists and is in REQUESTED status
        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (booking.status !== 'REQUESTED' && booking.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Booking is already ${booking.status}. Can only assign time to REQUESTED bookings.`
            });
        }

        // Verify stylist exists
        const stylist = await StylistRepository.findById(stylistId);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        // Assign the time (this checks for conflicts)
        const updatedBooking = await BookingRepository.assignTime(req.params.id, {
            stylistId,
            assignedStartTime,
            assignedEndTime
        });

        // Send notification to customer
        try {
            const user = await UserRepository.findById(booking.user_id);
            if (user && user.email) {
                await emailService.sendBookingConfirmation(updatedBooking, user, stylist);
                console.log(`✅ Confirmation email sent to ${user.email}`);
            }
        } catch (emailError) {
            console.error('Failed to send confirmation email:', emailError.message);
            // Don't fail the request if email fails
        }

        console.log(`✅ Time assigned to booking ${req.params.id}: ${assignedStartTime} with stylist ${stylist.name}`);

        res.json({
            success: true,
            booking: mapBookingResponse(updatedBooking),
            message: `Time assigned successfully! Booking confirmed for ${new Date(assignedStartTime).toLocaleString()}`
        });

    } catch (error) {
        console.error('Assign time error:', error);
        if (error.message.includes('conflict')) {
            return res.status(409).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get all orders (admin)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
    try {
        const { status, deliveryMethod, date, dateFrom, dateTo } = req.query;
        const filters = {
            ...(status ? { status: status.toLowerCase() } : {}),
            ...(deliveryMethod ? { deliveryMethod } : {}),
            ...(date ? { date } : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {})
        };
        let orders = await OrderRepository.findAll(filters);

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
        const allBookings = (await BookingRepository.findAll()).map(mapBookingResponse);
        const allOrders = await OrderRepository.findAll();

        const customers = allUsers
            .filter(u => u.role === 'customer')
            .map(u => {
                const userBookings = allBookings.filter(b => (b.userId || b.user_id) === u.id);
                const userOrders = allOrders.filter(o => (o.userId || o.user_id) === u.id);
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

// Create customer (admin)
app.post('/api/admin/customers', authenticateAdmin, async (req, res) => {
    try {
        const { name, email, phone, tier = 'bronze', points = 0, password } = req.body;

        if (!name || !email) {
            return res.status(400).json({ success: false, message: 'Name and email are required' });
        }

        const existing = await UserRepository.findByEmail(email);
        if (existing) {
            return res.status(400).json({ success: false, message: 'A user with this email already exists' });
        }

        const userId = uuidv4();
        const passwordValue = password || Math.random().toString(36).slice(2, 10);
        const passwordHash = await bcrypt.hash(passwordValue, 10);

        await UserRepository.create({
            id: userId,
            email,
            passwordHash,
            name,
            phone: phone || null,
            role: 'customer',
            points: points || 0,
            tier
        });

        const created = await UserRepository.findById(userId);
        res.status(201).json({ success: true, customer: created, generatedPassword: password ? undefined : passwordValue });
    } catch (error) {
        console.error('Error creating customer:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Update customer (admin)
app.put('/api/admin/customers/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, phone, tier, points, password } = req.body;
        const existing = await UserRepository.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const updates = {
            name: name !== undefined ? name : existing.name,
            phone: phone !== undefined ? phone : existing.phone,
            tier: tier !== undefined ? tier : existing.tier,
            points: points !== undefined ? points : existing.points
        };

        if (password) {
            updates.passwordHash = await bcrypt.hash(password, 10);
        }

        await UserRepository.update(req.params.id, updates);
        const updated = await UserRepository.findById(req.params.id);
        res.json({ success: true, customer: updated });
    } catch (error) {
        console.error('Error updating customer:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Staff management (admin)
app.get('/api/admin/staff', authenticateAdmin, async (req, res) => {
    try {
        await seedStylistsDefaults();
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

        const updatedStylist = await StylistRepository.update(req.params.id, updateData);

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

        await StylistRepository.delete(req.params.id);

        res.json({ success: true, message: 'Stylist deleted' });
    } catch (error) {
        console.error('Database error deleting stylist:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Archive staff (soft delete)
app.patch('/api/admin/staff/:id/archive', authenticateAdmin, async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        await StylistRepository.archive(req.params.id);
        const updated = await StylistRepository.findById(req.params.id);

        res.json({ success: true, stylist: updated, message: 'Stylist archived' });
    } catch (error) {
        console.error('Database error archiving stylist:', error.message);
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
                highlighted, badge, title, subtitle, priority, showInShopBanner } = req.body;

        if (!code || !discountType || !discountValue) {
            return res.status(400).json({ success: false, message: 'Code, discount type, and value are required' });
        }

        const existingPromos = await PromoRepository.findAll();
        if (existingPromos.find(p => p.code.toUpperCase() === code.toUpperCase())) {
            return res.status(409).json({ success: false, message: 'Promo code already exists' });
        }

        // If showInShopBanner is true, unset all other promos' shop banner flag
        if (showInShopBanner === true) {
            const currentShopBanner = existingPromos.find(p => p.show_in_shop_banner === 1);
            if (currentShopBanner) {
                await PromoRepository.update(currentShopBanner.id, { show_in_shop_banner: 0 });
            }
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
            priority: typeof priority === 'number' ? priority : 0,
            // Shop Banner field
            show_in_shop_banner: showInShopBanner === true ? 1 : 0
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

        // Handle shop banner flag specially (only one promo can be shop banner)
        if (req.body.showInShopBanner !== undefined) {
            if (req.body.showInShopBanner === true) {
                // Unset all other promos' shop banner flag
                const allPromos = await PromoRepository.findAll();
                for (const p of allPromos) {
                    if (p.show_in_shop_banner === 1 && p.id !== req.params.id) {
                        await PromoRepository.updateById(p.id, { show_in_shop_banner: 0 });
                    }
                }
                updateData.show_in_shop_banner = 1;
            } else {
                updateData.show_in_shop_banner = 0;
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

// Get active shop banner promo (public endpoint)
app.get('/api/promo/shop-banner', async (req, res) => {
    try {
        const promos = await PromoRepository.findAll();
        const shopBanner = promos.find(p => p.show_in_shop_banner === 1 && p.active === 1);

        if (!shopBanner) {
            return res.json({ success: true, promo: null });
        }

        // Check if promo is expired
        if (shopBanner.expiresAt && new Date(shopBanner.expiresAt) < new Date()) {
            return res.json({ success: true, promo: null });
        }

        res.json({ success: true, promo: shopBanner });
    } catch (error) {
        console.error('Error fetching shop banner:', error.message);
        return res.status(500).json({ success: false, message: 'Server error' });
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
        const active = await NotificationRepository.findActive();
        res.json({ notifications: active });
    } catch (error) {
        console.error('Error getting active notifications:', error.message);
        res.status(500).json({ success: false, message: 'Error loading notifications' });
    }
});

// Get all notifications (admin)
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await NotificationRepository.findAll();
        res.json({ notifications });
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
            createdBy: req.user.userId
        };

        const created = await NotificationRepository.create(notification);

        res.status(201).json({ message: 'Notification created', notification: created });
    } catch (error) {
        console.error('Error creating notification:', error.message);
        res.status(500).json({ success: false, message: 'Error creating notification' });
    }
});

// Update notification (admin only)
app.put('/api/notifications/:id', authenticateAdmin, async (req, res) => {
    try {
        const notification = await NotificationRepository.findById(req.params.id);
        if (!notification) return res.status(404).json({ message: 'Notification not found' });

        const updated = await NotificationRepository.update(req.params.id, req.body);

        res.json({ message: 'Notification updated', notification: updated });
    } catch (error) {
        console.error('Error updating notification:', error.message);
        res.status(500).json({ success: false, message: 'Error updating notification' });
    }
});

// Delete notification (admin only)
app.delete('/api/notifications/:id', authenticateAdmin, async (req, res) => {
    try {
        const notification = await NotificationRepository.findById(req.params.id);
        if (!notification) return res.status(404).json({ message: 'Notification not found' });

        await NotificationRepository.delete(req.params.id);

        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error.message);
        res.status(500).json({ success: false, message: 'Error deleting notification' });
    }
});

// Toggle notification active status (admin only)
app.patch('/api/notifications/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        const notification = await NotificationRepository.findById(req.params.id);
        if (!notification) return res.status(404).json({ message: 'Notification not found' });

        const updated = await NotificationRepository.toggleActive(req.params.id);

        res.json({ message: `Notification ${updated.active ? 'activated' : 'deactivated'}`, notification: updated });
    } catch (error) {
        console.error('Error toggling notification:', error.message);
        res.status(500).json({ success: false, message: 'Error toggling notification' });
    }
});

// ============================================
// CHAT ENDPOINTS (PUBLIC - Customer Side)
// ============================================

// Rate limiting for chat (in-memory, simple implementation)
const chatRateLimiter = {
    requests: new Map(), // key: userId or guestId, value: { count, resetAt }
    maxRequests: 10, // 10 messages per minute
    windowMs: 60 * 1000, // 1 minute

    check(identifier) {
        const now = Date.now();
        const record = this.requests.get(identifier);

        if (!record || now > record.resetAt) {
            // New window
            this.requests.set(identifier, {
                count: 1,
                resetAt: now + this.windowMs
            });
            return true;
        }

        if (record.count >= this.maxRequests) {
            return false; // Rate limit exceeded
        }

        record.count++;
        return true;
    }
};

const DEFAULT_HAIR_TIPS = [
    { text: 'Sleep on a silk pillowcase to reduce friction and frizz.', category: 'care' },
    { text: 'Use a sulfate-free shampoo to keep moisture locked in.', category: 'wash' },
    { text: 'Deep condition once a week for softer, stronger strands.', category: 'treatment' },
    { text: 'Trim your ends every 8-10 weeks to prevent split ends.', category: 'maintenance' },
    { text: 'Avoid high heat; style on medium or low settings.', category: 'heat' },
    { text: 'Always apply a heat protectant before blow-drying or ironing.', category: 'heat' },
    { text: 'Rinse with cool water to boost shine and seal the cuticle.', category: 'wash' },
    { text: 'Detangle from ends to roots using a wide-tooth comb.', category: 'detangle' },
    { text: 'Massage your scalp for 2 minutes daily to encourage circulation.', category: 'scalp' },
    { text: 'Don’t sleep with wet hair; it can cause breakage and tangles.', category: 'care' },
    { text: 'Use a microfiber towel or cotton T-shirt to blot-dry gently.', category: 'drying' },
    { text: 'Limit washing to 2-3 times a week to preserve natural oils.', category: 'wash' },
    { text: 'Protect hair from sun with hats or UV-protectant sprays.', category: 'protection' },
    { text: 'Keep extensions detangled with a soft bristle or loop brush.', category: 'extensions' },
    { text: 'Avoid oils near tape/weft bonds to prevent slipping.', category: 'extensions' },
    { text: 'Hydrate from within: drink water for scalp and hair health.', category: 'lifestyle' },
    { text: 'Use a bond-building treatment monthly to reinforce strength.', category: 'treatment' },
    { text: 'Switch to a wide satin scrunchie to avoid creases and breakage.', category: 'styling' },
    { text: 'Clarify monthly to remove buildup, then follow with a mask.', category: 'wash' },
    { text: 'Cold-pressed oils on mid-lengths and ends add shine—avoid the roots.', category: 'care' }
];

// Seed default services into DB if none exist
async function seedServicesDefaults() {
    try {
        const existingHair = await ServiceRepository.findByType('hair');
        const existingBeauty = await ServiceRepository.findByType('beauty');
        if (existingHair.length > 0 && existingBeauty.length > 0) return;

        const defaults = [
            // Hair services
            {
                id: 'service_tape',
                name: 'Tape Extensions',
                description: 'Tape-in hair extension installation',
                price: 2500,
                duration: 150,
                serviceType: 'hair',
                category: 'extensions'
            },
            {
                id: 'service_weft',
                name: 'Weft Installation',
                description: 'Weft extension installation',
                price: 3200,
                duration: 180,
                serviceType: 'hair',
                category: 'extensions'
            },
            {
                id: 'service_color',
                name: 'Color Matching',
                description: 'Color match consultation',
                price: 0,
                duration: 30,
                serviceType: 'hair',
                category: 'consultation'
            },
            {
                id: 'service_maintenance',
                name: 'Maintenance',
                description: 'Extension maintenance',
                price: 800,
                duration: 90,
                serviceType: 'hair',
                category: 'maintenance'
            },
            // Beauty (minimal seed)
            {
                id: 'service_manicure',
                name: 'Manicure',
                description: 'Manicure treatment',
                price: 250,
                duration: 45,
                serviceType: 'beauty',
                category: 'nails'
            },
            {
                id: 'service_pedicure',
                name: 'Pedicure',
                description: 'Pedicure treatment',
                price: 300,
                duration: 60,
                serviceType: 'beauty',
                category: 'nails'
            }
        ];

        for (const svc of defaults) {
            const exists = await ServiceRepository.findById(svc.id);
            if (exists) continue;
            await ServiceRepository.create({
                id: svc.id,
                name: svc.name,
                description: svc.description,
                price: svc.price,
                duration: svc.duration,
                serviceType: svc.serviceType,
                category: svc.category
            });
        }
        console.log('Seeded default services');
    } catch (err) {
        console.error('Failed to seed services:', err.message);
    }
}

// Seed default stylists into DB if none exist
async function seedStylistsDefaults() {
    try {
        const existing = await StylistRepository.findAll();
        if (existing && existing.length > 0) return;

        const defaults = [
            {
                id: 'stylist_lisa',
                name: 'Lisa Thompson',
                specialty: 'Senior Stylist',
                tagline: '8 years experience',
                rating: 4.9,
                reviewCount: 127,
                clientsCount: 350,
                yearsExperience: 8,
                instagram: '@lisathompson',
                color: '#F67599',
                available: true,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images1.jpg'
            },
            {
                id: 'stylist_emma',
                name: 'Emma Williams',
                specialty: 'Extension Specialist',
                tagline: 'Keratin Bonds, Volume',
                rating: 4.8,
                reviewCount: 94,
                clientsCount: 280,
                yearsExperience: 6,
                instagram: '@emmaextensions',
                color: '#414042',
                available: true,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images2.jpg'
            },
            {
                id: 'stylist_sarah',
                name: 'Sarah Martinez',
                specialty: 'Color Expert',
                tagline: 'Color Match, Balayage',
                rating: 5.0,
                reviewCount: 203,
                clientsCount: 410,
                yearsExperience: 10,
                instagram: '@sarahcolor',
                color: '#FFB6C1',
                available: true,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories1.jpg'
            },
            {
                id: 'stylist_maya',
                name: 'Maya Johnson',
                specialty: 'Maintenance Expert',
                tagline: 'Maintenance, Repairs',
                rating: 4.9,
                reviewCount: 156,
                clientsCount: 320,
                yearsExperience: 5,
                instagram: '@mayamaintains',
                color: '#6d6e70',
                available: true,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images3.jpg'
            }
        ];

        for (const stylist of defaults) {
            await StylistRepository.create(stylist);
        }
        console.log('Seeded default stylists');
    } catch (err) {
        console.error('Failed to seed stylists:', err.message);
    }
}

// Seed default hair tips for customer app if none exist (persisted)
async function seedHairTipsDefaults() {
    try {
        const existing = await HairTipRepository.findAll(true);
        if (existing && existing.length > 0) return;

        for (let i = 0; i < DEFAULT_HAIR_TIPS.length; i++) {
            const tip = DEFAULT_HAIR_TIPS[i];
            await HairTipRepository.create({
                id: `tip${i + 1}`,
                text: tip.text,
                category: tip.category || 'general',
                priority: tip.priority || 1,
                active: 1
            });
        }
        console.log('Seeded default hair tips');
    } catch (err) {
        console.error('Failed to seed hair tips:', err.message);
    }
}

seedHairTipsDefaults();
// Seed gallery defaults into DB if empty
seedGalleryDefaults();

// Seed default gallery items from flirthair.co.za assets if gallery is empty
async function seedGalleryDefaults() {
    try {
        const existing = await GalleryRepository.findAll({});
        if (existing && existing.length > 0) return;

        const defaults = [
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images1.jpg',
                altText: 'Salon inspo 1',
                label: 'Salon inspo',
                category: 'inspiration'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images2.jpg',
                altText: 'Salon inspo 2',
                label: 'Salon inspo',
                category: 'inspiration'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories1.jpg',
                altText: 'Tape extensions',
                label: 'Tape extensions',
                category: 'services'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories3.jpg',
                altText: 'Weft installation',
                label: 'Weft installation',
                category: 'services'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories5.jpg',
                altText: 'Color matching',
                label: 'Color matching',
                category: 'services'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU249_PLUMPING.WASH_250ml-03-300x300.png',
                altText: 'Plumping Wash',
                label: 'Plumping Wash',
                category: 'products'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU491_SESSION.SPRAY_FLEX_400ML_EU-02-300x300.png',
                altText: 'Session Spray',
                label: 'Session Spray',
                category: 'products'
            },
            {
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU291_STIMULATE-ME.WASH_250ml-03-300x300.png',
                altText: 'Stimulate Me Wash',
                label: 'Stimulate Me Wash',
                category: 'products'
            }
        ];

        for (let idx = 0; idx < defaults.length; idx++) {
            const item = defaults[idx];
            await GalleryRepository.create({
                id: `seed_${idx + 1}`,
                imageUrl: item.imageUrl,
                altText: item.altText,
                label: item.label,
                category: item.category,
                order: idx + 1,
                active: true
            });
        }
    } catch (err) {
        console.error('Failed to seed gallery defaults:', err.message);
    }
}

seedGalleryDefaults();

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

// Helpers for chat
function mapConversationResponse(conv, messages = []) {
    if (!conv) return null;
    return {
        id: conv.id,
        userId: conv.user_id || conv.userId,
        guestId: conv.guest_id || conv.guestId,
        customerName: conv.user_name || conv.customerName || 'Guest',
        customerEmail: conv.user_email || conv.customerEmail || null,
        source: conv.source || 'general',
        status: conv.status,
        assignedTo: conv.assigned_to || conv.assignedTo || null,
        unreadCount: conv.unread_by_agent || conv.unreadByAgent || 0,
        unreadByUser: conv.unread_by_user || conv.unreadByUser || 0,
        createdAt: conv.created_at || conv.createdAt,
        updatedAt: conv.updated_at || conv.updatedAt,
        lastMessageAt: conv.last_message_at || conv.lastMessageAt,
        messages: messages.map(m => ({
            id: m.id,
            from: m.from_type || m.from,
            text: m.text,
            createdAt: m.created_at || m.createdAt,
            timestamp: m.created_at || m.createdAt,
            agentId: m.agent_id || m.agentId,
            readByAgent: !!(m.read_by_agent || m.readByAgent),
            readByUser: !!(m.read_by_user || m.readByUser)
        }))
    };
}

async function getUserDisplay(userId) {
    if (!userId) return { name: 'Guest', email: null };
    try {
        const user = await UserRepository.findById(userId);
        if (!user) return { name: 'Guest', email: null };
        return { name: user.name || 'Guest', email: user.email || null };
    } catch {
        return { name: 'Guest', email: null };
    }
}

async function buildConversationPayload(conv, includeMessages = true) {
    if (!conv) return null;
    let customerName = conv.user_name || conv.customerName || null;
    let customerEmail = conv.user_email || conv.customerEmail || null;

    if (!customerName && conv.user_id) {
        const userInfo = await getUserDisplay(conv.user_id);
        customerName = userInfo.name;
        customerEmail = userInfo.email;
    }
    if (!customerName) {
        customerName = conv.guest_id ? `Guest ${conv.guest_id.substring(0, 8)}` : 'Guest';
    }

    let messages = [];
    if (includeMessages) {
        messages = await ChatRepository.findMessagesByConversation(conv.id, 500);
    }

    return mapConversationResponse(
        {
            ...conv,
            user_name: customerName,
            user_email: customerEmail
        },
        messages
    );
}

// Send a message (create or continue conversation)
app.post('/api/chat/message', optionalAuth, async (req, res) => {
    try {
        const { conversationId, guestId, source, text } = req.body;

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Message text is required' });
        }
        if (text.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message too long (max 2000 characters)' });
        }

        const now = new Date().toISOString();
        const userDisplay = await getUserDisplay(req.user?.id);
        let conversation = null;
        let isNewConversation = false;

        if (conversationId) {
            conversation = await ChatRepository.findConversationById(conversationId);
            if (!conversation) {
                return res.status(404).json({ success: false, message: 'Conversation not found' });
            }
            if (req.user) {
                if (conversation.user_id && conversation.user_id !== req.user.id) {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
                // Enrich stored name/email for known user
                if (!conversation.user_name || !conversation.user_email) {
                    await ChatRepository.updateConversation(conversation.id, {
                        userName: userDisplay.name,
                        userEmail: userDisplay.email
                    });
                    conversation.user_name = userDisplay.name;
                    conversation.user_email = userDisplay.email;
                }
            } else if (conversation.guest_id && conversation.guest_id !== guestId) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        } else {
            isNewConversation = true;
            const newConv = {
                id: 'conv_' + uuidv4().substring(0, 8),
                userId: req.user ? req.user.id : null,
                guestId: req.user ? null : (guestId || 'guest_' + uuidv4().substring(0, 8)),
                userName: req.user ? userDisplay.name : 'Guest',
                userEmail: req.user ? userDisplay.email : null,
                source: source || 'web',
                status: 'open',
                assignedTo: null,
                unreadByAgent: 1, // the welcome message will be read? keep 1 for user msg later
                unreadByUser: 0,
                createdAt: now,
                updatedAt: now,
                lastMessageAt: now
            };
            // Create conversation
            conversation = await ChatRepository.createConversation(newConv);
            // Add welcome system message
            await ChatRepository.createMessage({
                id: 'msg_' + uuidv4().substring(0, 8),
                conversationId: conversation.id,
                fromType: 'system',
                text: 'Welcome to Flirt Hair Support! How can we help you today?',
                readByAgent: 0,
                readByUser: 0,
                createdAt: now
            });
        }

        // Add the new user message
        const newMessage = await ChatRepository.createMessage({
            id: 'msg_' + uuidv4().substring(0, 8),
            conversationId: conversation.id,
            fromType: 'user',
            text: text.trim(),
            readByAgent: 0,
            readByUser: 1,
            createdAt: now
        });

        // Increment unread for agent
        await ChatRepository.incrementUnread(conversation.id, false);

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                status: conversation.status,
                lastMessageAt: now
            },
            message: {
                id: newMessage.id,
                from: newMessage.from_type,
                text: newMessage.text,
                createdAt: newMessage.created_at
            },
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

        const conversation = await ChatRepository.findConversationById(id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        if (req.user) {
            if (conversation.user_id && conversation.user_id !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        } else if (conversation.guest_id && conversation.guest_id !== guestId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const payload = await buildConversationPayload(conversation, true);
        res.json({ success: true, conversation: payload });
    } catch (error) {
        console.error('Error getting conversation:', error.message);
        res.status(500).json({ success: false, message: 'Error loading conversation' });
    }
});

// Get latest conversation for current visitor
app.get('/api/chat/my-latest', optionalAuth, async (req, res) => {
    try {
        const { guestId } = req.query;
        const conversation = await ChatRepository.findLatestConversation(req.user?.id || null, guestId || null);
        if (!conversation) {
            return res.json({ success: true, conversation: null });
        }
        const payload = await buildConversationPayload(conversation, true);
        res.json({ success: true, conversation: payload });
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
        const { status, assignedTo } = req.query;
        const conversations = await ChatRepository.findAllConversations({ status, assignedTo });

        const summaries = [];
        for (const c of conversations) {
            const payload = await buildConversationPayload(c, false);
            const msgs = await ChatRepository.findMessagesByConversation(c.id, 5);
            const lastUser = [...msgs].reverse().find(m => m.from_type === 'user');
            summaries.push({
                id: c.id,
                userName: payload.customerName,
                userEmail: payload.customerEmail,
                guestId: c.guest_id,
                source: c.source,
                lastMessage: lastUser ? lastUser.text.substring(0, 100) : '',
                lastMessageAt: c.last_message_at,
                unreadCount: c.unread_by_agent || 0,
                status: c.status,
                createdAt: c.created_at
            });
        }

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
        const conversation = await ChatRepository.findConversationById(id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        const payload = await buildConversationPayload(conversation, true);
        res.json({ success: true, conversation: payload });
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

        const conversation = await ChatRepository.findConversationById(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const now = new Date().toISOString();
        const newMessage = await ChatRepository.createMessage({
            id: 'msg_' + uuidv4().substring(0, 8),
            conversationId,
            fromType: 'agent',
            text: text.trim(),
            agentId: req.user.id,
            readByAgent: 1,
            readByUser: 0,
            createdAt: now
        });

        // Assign conversation if needed
        if (!conversation.assigned_to) {
            await ChatRepository.updateConversation(conversationId, { assignedTo: req.user.id });
        }

        // Increment unread for user
        await ChatRepository.incrementUnread(conversationId, true);

        res.json({ success: true, message: {
            id: newMessage.id,
            from: newMessage.from_type,
            text: newMessage.text,
            createdAt: newMessage.created_at
        }});
    } catch (error) {
        console.error('Error sending admin chat message:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Mark conversation as read (admin)
app.patch('/api/admin/chat/conversations/:id/read', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const conversation = await ChatRepository.findConversationById(id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        await ChatRepository.markMessagesAsRead(id, true);
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

        const conversation = await ChatRepository.findConversationById(id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const updated = await ChatRepository.updateConversation(id, { status });

        res.json({ success: true, message: `Conversation ${status}`, conversation: updated });
    } catch (error) {
        console.error('Error updating conversation status:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ============================================
// GALLERY ENDPOINTS
// ============================================

// Get all active gallery items (public)
app.get('/api/gallery', async (req, res) => {
    try {
        await seedGalleryDefaults();
        const activeItems = await GalleryRepository.findAll({ includeInactive: false });
        const instagram = await GalleryRepository.getInstagram();
        res.json({ items: activeItems, instagram: instagram || null });
    } catch (error) {
        console.error('Error getting gallery items:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Dev-only: Auto-login as first user (useful when social logins are not configured)
if (IS_DEV) {
    app.get('/api/auth/dev-login', async (req, res) => {
        try {
            const users = await UserRepository.findAll();
            let user = users && users.length > 0 ? users[0] : null;

            if (!user) {
                // Create a placeholder user if none exist
                const userId = uuidv4();
                const passwordHash = await bcrypt.hash('dev-user', 10);
                user = await UserRepository.create({
                    id: userId,
                    email: 'devuser@flirthair.co.za',
                    passwordHash,
                    name: 'Dev User',
                    phone: '',
                    role: 'customer',
                    points: 0,
                    tier: 'bronze',
                    referralCode: generateReferralCode('Dev User'),
                    referredBy: null
                });
            }

            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            const { passwordHash, password_hash, ...userResponse } = user;
            res.json({ success: true, token, user: userResponse });
        } catch (error) {
            console.error('Dev login error:', error);
            res.status(500).json({ success: false, message: 'Dev login failed' });
        }
    });
}

// Get all gallery items (admin)
app.get('/api/admin/gallery', authenticateAdmin, async (req, res) => {
    try {
        await seedGalleryDefaults();
        const items = await GalleryRepository.findAll({ includeInactive: true });
        const instagram = await GalleryRepository.getInstagram();
        res.json({ items, instagram: instagram || null });
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

        const existing = await GalleryRepository.findAll({ includeInactive: true });
        const maxOrder = existing.reduce((max, item) => Math.max(max, item.order_num || item.order || 0), 0);

        const newItem = await GalleryRepository.create({
            id: `img_${uuidv4().substring(0, 8)}`,
            imageUrl,
            altText: altText || 'Gallery Image',
            label: label || '',
            category: category || 'general',
            order: maxOrder + 1,
            active: true
        });

        res.status(201).json({ message: 'Gallery item created', item: newItem });
    } catch (error) {
        console.error('Error creating gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Set Instagram feed configuration
async function handleInstagramConfig(req, res) {
    try {
        const { username, embedUrl } = req.body || {};
        if (!username && !embedUrl) {
            return res.status(400).json({ message: 'username or embedUrl is required' });
        }
        const normalized = (username || '').replace('@', '').trim();
        const url = embedUrl && embedUrl.trim()
            ? embedUrl.trim()
            : normalized
                ? `https://www.instagram.com/${normalized}/embed`
                : null;

        const saved = await GalleryRepository.setInstagram({
            username: normalized || null,
            embedUrl: url
        });

        res.json({ success: true, instagram: saved });
    } catch (error) {
        console.error('Error updating Instagram config:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

app.put('/api/admin/gallery/instagram', authenticateAdmin, handleInstagramConfig);
app.post('/api/admin/gallery/instagram', authenticateAdmin, handleInstagramConfig);

// Proxy Instagram feed (best-effort, public data)
app.get('/api/instagram/:username', async (req, res) => {
    const username = (req.params.username || '').trim();
    if (!username) return res.status(400).json({ success: false, message: 'Username is required' });

    try {
        const igRes = await fetch(`https://www.instagram.com/${username}/?__a=1&__d=dis`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; FlirtBot/1.0)'
            }
        });

        if (!igRes.ok) {
            return res.status(502).json({ success: false, message: 'Failed to fetch Instagram feed' });
        }

        const json = await igRes.json();
        const edges =
            json?.graphql?.user?.edge_owner_to_timeline_media?.edges ||
            json?.items ||
            [];

        const images = edges
            .slice(0, 9)
            .map(edge => {
                const node = edge.node || edge;
                return {
                    url: node.display_url || node.thumbnail_src || node.thumbnail_url,
                    link: node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : null
                };
            })
            .filter(img => img.url);

        if (!images.length) {
            return res.status(204).json({ success: true, images: [] });
        }

        res.json({ success: true, images });
    } catch (error) {
        console.error('Instagram proxy error:', error.message);
        res.status(500).json({ success: false, message: 'Instagram feed unavailable' });
    }
});

// Update gallery item (admin)
app.patch('/api/admin/gallery/:id', authenticateAdmin, async (req, res) => {
    try {
        const { imageUrl, altText, label, category, order, active } = req.body;

        const existing = await GalleryRepository.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: 'Gallery item not found' });
        }

        const updated = await GalleryRepository.update(req.params.id, {
            imageUrl,
            altText,
            label,
            category,
            order,
            active
        });

        res.json({ message: 'Gallery item updated', item: updated });
    } catch (error) {
        console.error('Error updating gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete gallery item (admin)
app.delete('/api/admin/gallery/:id', authenticateAdmin, async (req, res) => {
    try {
        const existing = await GalleryRepository.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: 'Gallery item not found' });
        }

        await GalleryRepository.delete(req.params.id);

        res.json({ message: 'Gallery item deleted' });
    } catch (error) {
        console.error('Error deleting gallery item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Toggle gallery item active status (admin)
app.patch('/api/admin/gallery/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        const item = await GalleryRepository.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Gallery item not found' });
        }

        const updated = await GalleryRepository.update(req.params.id, { active: !item.active });

        res.json({ message: `Gallery item ${updated.active ? 'activated' : 'deactivated'}`, item: updated });
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

        const existing = await GalleryRepository.findAll({ includeInactive: true });
        if (!existing || existing.length === 0) {
            return res.status(404).json({ message: 'Gallery not found' });
        }

        await GalleryRepository.reorder(orderedIds);

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
app.get('/api/hair-tips/random', async (req, res) => {
    try {
        await seedHairTipsDefaults();
        const tips = await HairTipRepository.findAll(false);
        if (!tips || tips.length === 0) {
            return res.json({ tip: null });
        }

        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        res.json({ tip: { id: randomTip.id, text: randomTip.text, category: randomTip.category } });
    } catch (error) {
        console.error('Error getting random hair tip:', error);
        res.status(500).json({ tip: null });
    }
});

// Get all tips (public - for admin to list)
app.get('/api/hair-tips', async (req, res) => {
    try {
        await seedHairTipsDefaults();
        const tips = await HairTipRepository.findAll(true);
        res.json({ tips });
    } catch (error) {
        console.error('Error getting hair tips:', error);
        res.status(500).json({ tips: [] });
    }
});

// Get all tips (admin)
app.get('/api/admin/hair-tips', authenticateAdmin, async (req, res) => {
    try {
        await seedHairTipsDefaults();
        const tips = await HairTipRepository.findAll(true);
        res.json({ tips });
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

        const newTip = await HairTipRepository.create({
            text: text.trim(),
            category: category || 'general',
            priority: priority || 1,
            active: 1
        });

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

        const updated = await HairTipRepository.update(req.params.id, {
            text: text !== undefined ? text.trim() : undefined,
            category,
            priority,
            active
        });

        if (!updated) {
            return res.status(404).json({ message: 'Hair tip not found' });
        }

        res.json({ message: 'Hair tip updated', tip: updated });
    } catch (error) {
        console.error('Error updating hair tip:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Toggle hair tip active status (admin)
app.patch('/api/admin/hair-tips/:id/toggle', authenticateAdmin, async (req, res) => {
    try {
        const toggled = await HairTipRepository.toggle(req.params.id);
        if (!toggled) {
            return res.status(404).json({ message: 'Hair tip not found' });
        }

        res.json({ message: `Hair tip ${toggled.active ? 'activated' : 'deactivated'}`, tip: toggled });
    } catch (error) {
        console.error('Error toggling hair tip:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete hair tip (admin)
app.delete('/api/admin/hair-tips/:id', authenticateAdmin, async (req, res) => {
    try {
        const existing = await HairTipRepository.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ message: 'Hair tip not found' });
        }

        await HairTipRepository.delete(req.params.id);

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
