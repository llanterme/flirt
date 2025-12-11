const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const querystring = require('querystring');
const multer = require('multer');

// Configure multer for file uploads
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const UPLOADS_SERVICES_DIR = path.join(UPLOADS_DIR, 'services');

// Ensure upload directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_SERVICES_DIR)) fs.mkdirSync(UPLOADS_SERVICES_DIR, { recursive: true });

// Multer storage configuration for service images
const serviceImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_SERVICES_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `service_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
        cb(null, filename);
    }
});

// File filter for images
const imageFileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'), false);
    }
};

// Multer upload instances
const uploadServiceImage = multer({
    storage: serviceImageStorage,
    fileFilter: imageFileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    }
});

// Database imports - SQLite-only (mandatory)
const DATABASE_PATH = process.env.DATABASE_PATH || './db/flirt.db';

let db, UserRepository, StylistRepository, ServiceRepository, BookingRepository, ProductRepository, OrderRepository, PromoRepository, GalleryRepository, PaymentRepository, PaymentSettingsRepository, LoyaltyRepository, NotificationRepository, ChatRepository, HairTipRepository, PayrollRepository, PasswordResetRepository, RewardsConfigRepository, RewardTrackRepository, UserRewardRepository, ServicePackageRepository, UserPackageRepository, InvoiceRepository, RewardTrackDefinitionRepository, ServiceRewardMappingRepository, CategoryRewardMappingRepository;

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
    PayrollRepository = dbModule.PayrollRepository;
    PasswordResetRepository = dbModule.PasswordResetRepository;
    // Rewards Programme
    RewardsConfigRepository = dbModule.RewardsConfigRepository;
    RewardTrackRepository = dbModule.RewardTrackRepository;
    UserRewardRepository = dbModule.UserRewardRepository;
    ServicePackageRepository = dbModule.ServicePackageRepository;
    UserPackageRepository = dbModule.UserPackageRepository;
    // Service-to-Reward Track Mappings
    RewardTrackDefinitionRepository = dbModule.RewardTrackDefinitionRepository;
    ServiceRewardMappingRepository = dbModule.ServiceRewardMappingRepository;
    CategoryRewardMappingRepository = dbModule.CategoryRewardMappingRepository;
    // Invoicing System
    InvoiceRepository = dbModule.InvoiceRepository;

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

// Email service import
const emailService = require('./services/email');

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
app.use('/uploads', express.static(UPLOADS_DIR)); // Serve uploaded files

// ============================================
// SEED ADMIN USER
// ============================================
async function seedAdminUser() {
    try {
        // Initialize database first
        await db.initializeDatabase();

        // Ensure bookings table has duration column (migration)
        try {
            await db.dbRun('ALTER TABLE bookings ADD COLUMN duration INTEGER');
            console.log('✅ Added duration column to bookings table');
        } catch (err) {
            // Column likely already exists, ignore
            if (!err.message.includes('duplicate column')) {
                console.log('Duration column check:', err.message);
            }
        }

        // Seed all default data (with error handling for each)
        try {
            await seedStylistsDefaults();
        } catch (err) {
            console.error('Warning: Failed to seed stylists:', err.message);
        }

        try {
            await seedServicesDefaults();
        } catch (err) {
            console.error('Warning: Failed to seed services:', err.message);
        }

        try {
            await seedHairTipsDefaults();
        } catch (err) {
            console.error('Warning: Failed to seed hair tips:', err.message);
        }

        try {
            await seedGalleryDefaults();
        } catch (err) {
            console.error('Warning: Failed to seed gallery:', err.message);
        }

        try {
            await seedProductsDefaults();
        } catch (err) {
            console.error('Warning: Failed to seed products:', err.message);
        }

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
                email: 'admin@flirt.co.za',
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
            console.log(`✅ Admin user created in SQLite: admin@flirt.co.za`);
            console.log('⚠️  Admin must change password on first login');
        }
    } catch (error) {
        console.error('❌ Failed to initialize database:', error.message);
        console.error(error.stack);
        throw error; // Re-throw to prevent server from starting with broken setup
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

// Permission-based access control for staff
// Usage: requirePermission('bookings') or requirePermission(['bookings', 'customers'])
function requirePermission(permissionOrPermissions) {
    const permissions = Array.isArray(permissionOrPermissions) ? permissionOrPermissions : [permissionOrPermissions];

    return async (req, res, next) => {
        try {
            // Admin always has access
            if (req.user.role === 'admin') {
                return next();
            }

            // Staff need specific permissions
            if (req.user.role === 'staff') {
                const userPermissions = req.user.permissions ?
                    (typeof req.user.permissions === 'string' ? JSON.parse(req.user.permissions) : req.user.permissions) : {};

                // Check if user has any of the required permissions
                const hasPermission = permissions.some(p => userPermissions[p] === true);

                if (hasPermission) {
                    return next();
                }
            }

            return res.status(403).json({
                success: false,
                message: 'You do not have permission to access this resource'
            });
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({ success: false, message: 'Permission check failed' });
        }
    };
}

// ============================================
// REWARDS PROCESSING SERVICE
// ============================================

const RewardsService = {
    // Main entry point - called when booking is completed OR invoice is finalized
    // requirePayment: true = only process if invoice is paid, false = process immediately
    async processCompletedBooking(booking, user, requirePayment = false) {
        try {
            const config = await RewardsConfigRepository.get();
            if (!config || !config.programme_enabled) {
                console.log('Rewards programme is disabled');
                return { processed: false, reason: 'programme_disabled' };
            }

            const results = {
                processed: true,
                rewards: [],
                tracks: []
            };

            // Get service details
            const service = await ServiceRepository.findById(booking.service_id || booking.serviceId);
            if (!service) {
                console.log('Service not found for booking:', booking.id);
                return results;
            }

            const bookingAmount = booking.final_amount || booking.finalAmount || booking.total_amount || booking.amount || 0;

            // Get applicable reward tracks from database mappings
            const applicableTracks = await CategoryRewardMappingRepository.getTracksForService(service.id, service.category);

            // Process each applicable track
            for (const trackMapping of applicableTracks) {
                // Skip tracks that require payment if payment not confirmed
                if (requirePayment && trackMapping.require_payment && !booking.paid) {
                    console.log(`Skipping track ${trackMapping.track_id} - payment required but not confirmed`);
                    continue;
                }

                const trackResult = await this.processTrackFromDefinition(
                    user.id,
                    trackMapping,
                    bookingAmount,
                    booking
                );
                if (trackResult) results.tracks.push(trackResult);
            }

            // Also check for spend track if enabled (applies to all paid services)
            if (config.spend_enabled && bookingAmount > 0) {
                // Check if spend track wasn't already processed via mappings
                const hasSpendTrack = applicableTracks.some(t => t.track_id === 'track_spend');
                if (!hasSpendTrack) {
                    const spendResult = await this.processSpendTrack(user.id, config, bookingAmount, booking);
                    if (spendResult) results.tracks.push(spendResult);
                }
            }

            // Check referral rewards (for referrer when referee completes qualifying booking)
            if (config.referral_enabled) {
                const referralResult = await this.checkReferralReward(user, config, bookingAmount, booking);
                if (referralResult) results.rewards.push(referralResult);
            }

            return results;
        } catch (error) {
            console.error('Error processing rewards for booking:', error);
            return { processed: false, error: error.message };
        }
    },

    // Process a reward track using database-defined milestones
    async processTrackFromDefinition(userId, trackMapping, bookingAmount, booking) {
        try {
            const trackDef = await RewardTrackDefinitionRepository.findById(trackMapping.track_id);
            if (!trackDef || !trackDef.active) {
                return null;
            }

            // Get or create user's progress on this track
            const userTrack = await RewardTrackRepository.getOrCreate(userId, trackDef.name);

            // Parse milestones from JSON if needed
            const milestones = typeof trackDef.milestones === 'string'
                ? JSON.parse(trackDef.milestones)
                : (trackDef.milestones || []);

            let newCount = userTrack.current_count || 0;
            let newAmount = userTrack.current_amount || 0;
            let rewardIssued = null;

            // Apply points multiplier from mapping
            const multiplier = trackMapping.points_multiplier || 1.0;

            if (trackDef.track_type === 'visit_count') {
                // Increment visit count
                newCount = Math.round((userTrack.current_count || 0) + (1 * multiplier));
                await RewardTrackRepository.increment(userId, trackDef.name, Math.round(1 * multiplier), 0);

                // Check milestones
                for (const milestone of milestones) {
                    const targetCount = milestone.count;
                    const isRepeating = milestone.repeating === true;

                    if (isRepeating) {
                        // Repeating milestone - check if we crossed a threshold
                        const previousCycles = Math.floor((userTrack.current_count || 0) / targetCount);
                        const newCycles = Math.floor(newCount / targetCount);
                        if (newCycles > previousCycles) {
                            rewardIssued = await this.issueRewardFromMilestone(userId, trackDef, milestone);
                            await RewardTrackRepository.updateMilestone(userId, trackDef.name, newCount);
                        }
                    } else {
                        // One-time milestone
                        if (newCount === targetCount && (userTrack.last_milestone_reached || 0) < targetCount) {
                            rewardIssued = await this.issueRewardFromMilestone(userId, trackDef, milestone);
                            await RewardTrackRepository.updateMilestone(userId, trackDef.name, newCount);
                        }
                    }
                }
            } else if (trackDef.track_type === 'spend_amount') {
                // Increment spend amount
                const amountToAdd = Math.round(bookingAmount * multiplier);
                newAmount = (userTrack.current_amount || 0) + amountToAdd;
                await RewardTrackRepository.increment(userId, trackDef.name, 0, amountToAdd);

                // Check amount-based milestones
                for (const milestone of milestones) {
                    const targetAmount = milestone.amount;
                    const isRepeating = milestone.repeating === true;

                    if (isRepeating) {
                        const previousCycles = Math.floor((userTrack.current_amount || 0) / targetAmount);
                        const newCycles = Math.floor(newAmount / targetAmount);
                        if (newCycles > previousCycles) {
                            rewardIssued = await this.issueRewardFromMilestone(userId, trackDef, milestone);
                            await RewardTrackRepository.updateMilestone(userId, trackDef.name, newCycles);
                        }
                    } else {
                        if (newAmount >= targetAmount && (userTrack.current_amount || 0) < targetAmount) {
                            rewardIssued = await this.issueRewardFromMilestone(userId, trackDef, milestone);
                            await RewardTrackRepository.updateMilestone(userId, trackDef.name, targetAmount);
                        }
                    }
                }
            }

            return {
                track: trackDef.name,
                trackDisplayName: trackDef.display_name,
                trackType: trackDef.track_type,
                newCount,
                newAmount,
                milestones,
                rewardIssued
            };
        } catch (error) {
            console.error(`Error processing track ${trackMapping.track_id}:`, error);
            return null;
        }
    },

    // Issue reward based on milestone definition
    async issueRewardFromMilestone(userId, trackDef, milestone) {
        const expiryDays = trackDef.reward_expiry_days || 90;
        const rewardType = milestone.reward_type === 'percentage_discount' ? 'discount_percent' : milestone.reward_type;
        const description = milestone.description || `${trackDef.display_name} reward - ${milestone.reward_value}% off`;

        return await this.issueReward(
            userId,
            trackDef.name,
            rewardType,
            milestone.reward_value,
            expiryDays,
            description
        );
    },

    // Legacy: Check if service is a nails service (fallback for backwards compatibility)
    isNailsService(category) {
        const nailsKeywords = ['nail', 'nails', 'manicure', 'pedicure', 'gel', 'acrylic'];
        return nailsKeywords.some(kw => category.toLowerCase().includes(kw));
    },

    // Legacy: Check if service is a maintenance service (fallback for backwards compatibility)
    isMaintenanceService(category) {
        const maintenanceKeywords = ['maintenance', 'extension', 'weave', 'tape', 'keratin', 'weft'];
        return maintenanceKeywords.some(kw => category.toLowerCase().includes(kw));
    },

    // Process spend track (legacy method, kept for backwards compatibility with config)
    async processSpendTrack(userId, config, amount, booking) {
        try {
            const track = await RewardTrackRepository.getOrCreate(userId, 'spend');

            const currentAmount = track.current_amount || 0;
            const newAmount = currentAmount + amount;

            // Update track with amount (countIncrement=0, amountIncrement=amount)
            await RewardTrackRepository.increment(userId, 'spend', 0, amount);

            let rewardIssued = null;

            // Check if threshold crossed
            const previousMilestones = Math.floor(currentAmount / config.spend_threshold);
            const newMilestones = Math.floor(newAmount / config.spend_threshold);

            if (newMilestones > previousMilestones) {
                // User has crossed a spend threshold
                rewardIssued = await this.issueReward(userId, 'spend', 'discount_percent', config.spend_discount, config.spend_reward_expiry_days, 'Spend & Save reward - ' + config.spend_discount + '% off next service');
                await RewardTrackRepository.updateMilestone(userId, 'spend', newMilestones);
            }

            return {
                track: 'spend',
                currentAmount: newAmount,
                threshold: config.spend_threshold,
                progressPercent: Math.round((newAmount % config.spend_threshold) / config.spend_threshold * 100),
                rewardIssued
            };
        } catch (error) {
            console.error('Error processing spend track:', error);
            return null;
        }
    },

    // Check and issue referral reward
    async checkReferralReward(user, config, bookingAmount, booking) {
        try {
            // This user was referred by someone - check if this is their first qualifying booking
            if (!user.referred_by && !user.referredBy) return null;

            const referrerId = user.referred_by || user.referredBy;

            // Check if referral reward was already issued for this referee
            const existingReferral = await this.getReferralRecord(user.id);
            if (existingReferral && existingReferral.reward_issued) return null;

            // Check if booking meets minimum value
            if (bookingAmount < config.referral_min_booking_value) return null;

            // Issue reward to referrer
            const rewardDescription = config.referral_reward_description || 'Complimentary wash & blow-dry';
            const reward = await this.issueReward(
                referrerId,
                'referral',
                'free_service',
                config.referral_reward_service_id,
                90, // 90 day expiry for referral rewards
                rewardDescription
            );

            // Mark referral as rewarded
            await this.markReferralRewarded(user.id, bookingAmount);

            return {
                type: 'referral',
                referrerId,
                reward
            };
        } catch (error) {
            console.error('Error checking referral reward:', error);
            return null;
        }
    },

    // Issue a reward to user
    async issueReward(userId, trackType, rewardType, value, expiryDays, description) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiryDays);

        const reward = await UserRewardRepository.create({
            id: uuidv4(),
            userId,
            rewardType,       // 'discount_percent', 'discount_fixed', 'free_service'
            rewardValue: value,
            sourceTrack: trackType,  // 'nails', 'maintenance', 'spend', 'referral'
            description,
            expiresAt: expiryDate.toISOString()
        });

        console.log(`Issued reward to user ${userId}: ${description}`);
        return reward;
    },

    // Get referral record for a user (as referee)
    async getReferralRecord(refereeId) {
        try {
            const result = await db.dbGet('SELECT * FROM referrals WHERE referee_id = ?', [refereeId]);
            return result;
        } catch (error) {
            return null;
        }
    },

    // Mark referral as having issued reward
    async markReferralRewarded(refereeId, bookingValue) {
        try {
            await db.dbRun(`
                UPDATE referrals
                SET referee_first_booking_value = ?, reward_issued = 1
                WHERE referee_id = ?
            `, [bookingValue, refereeId]);
        } catch (error) {
            console.error('Error marking referral rewarded:', error);
        }
    },

    // Apply reward to a booking
    async applyRewardToBooking(bookingId, rewardId) {
        try {
            const reward = await UserRewardRepository.findById(rewardId);
            if (!reward || reward.status !== 'active') {
                return { success: false, message: 'Reward not found or already used' };
            }

            // Check expiry
            if (new Date(reward.expires_at) < new Date()) {
                await UserRewardRepository.updateStatus(rewardId, 'expired');
                return { success: false, message: 'Reward has expired' };
            }

            // Calculate discount
            let discountAmount = 0;
            const booking = await BookingRepository.findById(bookingId);
            const rewardValue = reward.reward_value || 0;

            if (reward.reward_type === 'discount_percent') {
                const baseAmount = booking.total_amount || booking.amount || booking.service_price || 0;
                discountAmount = baseAmount * (rewardValue / 100);
            } else if (reward.reward_type === 'discount_fixed') {
                discountAmount = rewardValue;
            } else if (reward.reward_type === 'free_service') {
                // Full discount for free service rewards
                discountAmount = booking.total_amount || booking.amount || booking.service_price || 0;
            }

            // Update booking with reward
            await BookingRepository.updateById(bookingId, {
                rewardId: rewardId,
                discountAmount: discountAmount
            });

            // Mark reward as redeemed
            await UserRewardRepository.redeem(rewardId, bookingId);

            return {
                success: true,
                discountAmount,
                reward
            };
        } catch (error) {
            console.error('Error applying reward to booking:', error);
            return { success: false, message: error.message };
        }
    },

    // Get user's reward progress summary
    async getUserProgress(userId) {
        try {
            const config = await RewardsConfigRepository.get();
            if (!config || !config.programme_enabled) {
                return { enabled: false };
            }

            const tracks = {};

            // Get all active track definitions from database
            const trackDefinitions = await RewardTrackDefinitionRepository.findAll();

            for (const trackDef of trackDefinitions) {
                const userTrack = await RewardTrackRepository.getOrCreate(userId, trackDef.name);
                const milestones = typeof trackDef.milestones === 'string'
                    ? JSON.parse(trackDef.milestones)
                    : (trackDef.milestones || []);

                if (trackDef.track_type === 'visit_count') {
                    const currentCount = userTrack.current_count || 0;

                    // Find next milestone
                    let nextMilestone = null;
                    let progressToNext = 0;

                    for (const milestone of milestones) {
                        const target = milestone.count;
                        const isRepeating = milestone.repeating === true;

                        if (isRepeating) {
                            const cycleProgress = currentCount % target;
                            progressToNext = Math.round((cycleProgress / target) * 100);
                            nextMilestone = {
                                target,
                                reward: milestone.reward_value,
                                description: milestone.description,
                                remaining: target - cycleProgress,
                                repeating: true
                            };
                            break;
                        } else if (currentCount < target) {
                            progressToNext = Math.round((currentCount / target) * 100);
                            nextMilestone = {
                                target,
                                reward: milestone.reward_value,
                                description: milestone.description,
                                remaining: target - currentCount,
                                repeating: false
                            };
                            break;
                        }
                    }

                    tracks[trackDef.name] = {
                        id: trackDef.id,
                        enabled: true,
                        displayName: trackDef.display_name,
                        description: trackDef.description,
                        icon: trackDef.icon,
                        type: 'visit_count',
                        currentCount,
                        milestones,
                        nextMilestone,
                        progressPercent: progressToNext
                    };
                } else if (trackDef.track_type === 'spend_amount') {
                    const currentAmount = userTrack.current_amount || 0;

                    // Find next milestone
                    let nextMilestone = null;
                    let progressToNext = 0;

                    for (const milestone of milestones) {
                        const target = milestone.amount;
                        const isRepeating = milestone.repeating === true;

                        if (isRepeating) {
                            const cycleProgress = currentAmount % target;
                            progressToNext = Math.round((cycleProgress / target) * 100);
                            nextMilestone = {
                                target,
                                reward: milestone.reward_value,
                                description: milestone.description,
                                remaining: target - cycleProgress,
                                repeating: true
                            };
                            break;
                        } else if (currentAmount < target) {
                            progressToNext = Math.round((currentAmount / target) * 100);
                            nextMilestone = {
                                target,
                                reward: milestone.reward_value,
                                description: milestone.description,
                                remaining: target - currentAmount,
                                repeating: false
                            };
                            break;
                        }
                    }

                    tracks[trackDef.name] = {
                        id: trackDef.id,
                        enabled: true,
                        displayName: trackDef.display_name,
                        description: trackDef.description,
                        icon: trackDef.icon,
                        type: 'spend_amount',
                        currentAmount,
                        milestones,
                        nextMilestone,
                        progressPercent: progressToNext
                    };
                }
            }

            // Active rewards
            const activeRewards = await UserRewardRepository.findActiveForUser(userId);

            // Packages
            const activePackages = await UserPackageRepository.findActiveForUser(userId);

            return {
                enabled: true,
                programmeName: config.programme_name,
                tracks,
                activeRewards,
                activePackages,
                termsVersion: config.terms_version
            };
        } catch (error) {
            console.error('Error getting user reward progress:', error);
            return { enabled: false, error: error.message };
        }
    },

    // Expire old rewards (call periodically)
    async expireOldRewards() {
        try {
            await UserRewardRepository.expireOld();
            await UserPackageRepository.expireOld();
            console.log('Expired old rewards and packages');
        } catch (error) {
            console.error('Error expiring old rewards:', error);
        }
    }
};

// Run reward expiry check every hour
setInterval(() => RewardsService.expireOldRewards(), 60 * 60 * 1000);

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

// Forgot password - request reset link
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    try {
        const user = await UserRepository.findByEmail(email);

        // Always return success to prevent email enumeration
        if (!user) {
            console.log(`Password reset requested for non-existent email: ${email}`);
            return res.json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        }

        // Generate a secure random token
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        // Ensure the table exists (run migration if needed)
        try {
            await db.dbRun(`
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    expires_at TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            `);
        } catch (e) {
            // Table might already exist, that's fine
        }

        await PasswordResetRepository.createToken(user.id, resetToken, expiresAt);

        // Build reset URL
        const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
        const resetUrl = `${baseUrl}/?reset_token=${resetToken}`;

        // Send email
        try {
            await emailService.sendEmail({
                to: user.email,
                subject: 'Reset Your Flirt Hair Password',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #414042 0%, #2d2d2e 100%); padding: 30px; text-align: center;">
                            <h1 style="color: #F67599; margin: 0; font-size: 28px;">FL!RT</h1>
                            <p style="color: #fff; margin: 5px 0 0;">Hair & Beauty Bar</p>
                        </div>
                        <div style="padding: 30px; background: #f8f8f8;">
                            <h2 style="color: #414042; margin-bottom: 20px;">Reset Your Password</h2>
                            <p style="color: #666; line-height: 1.6;">Hi ${user.name},</p>
                            <p style="color: #666; line-height: 1.6;">You requested to reset your password. Click the button below to set a new password:</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${resetUrl}" style="background: #F67599; color: white; padding: 15px 30px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block;">Reset Password</a>
                            </div>
                            <p style="color: #666; line-height: 1.6; font-size: 14px;">This link will expire in 1 hour.</p>
                            <p style="color: #666; line-height: 1.6; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
                            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                            <p style="color: #999; font-size: 12px; text-align: center;">Flirt Hair & Beauty Bar</p>
                        </div>
                    </div>
                `
            });
            console.log(`Password reset email sent to: ${user.email}`);
        } catch (emailError) {
            console.error('Failed to send password reset email:', emailError.message);
            // Still return success to prevent enumeration, but log the error
        }

        res.json({
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent.'
        });

    } catch (error) {
        console.error('Error in forgot password:', error.message);
        res.status(500).json({ success: false, message: 'An error occurred. Please try again later.' });
    }
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    try {
        const resetToken = await PasswordResetRepository.findByToken(token);

        if (!resetToken) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset link. Please request a new one.' });
        }

        // Hash the new password
        const passwordHash = await bcrypt.hash(newPassword, 10);

        // Update user's password
        await UserRepository.update(resetToken.user_id, {
            passwordHash,
            mustChangePassword: false
        });

        // Mark token as used
        await PasswordResetRepository.markUsed(token);

        console.log(`Password reset successful for user: ${resetToken.user_id}`);

        res.json({
            success: true,
            message: 'Password has been reset successfully. You can now log in with your new password.'
        });

    } catch (error) {
        console.error('Error in reset password:', error.message);
        res.status(500).json({ success: false, message: 'An error occurred. Please try again later.' });
    }
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
        // Get hair profile from the dedicated repository method
        const hairProfile = await UserRepository.getHairProfile(req.user.id) || {
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

        // Build update object with only provided fields
        const updates = {};
        if (hairType !== undefined) updates.hairType = hairType;
        if (extensionType !== undefined) updates.extensionType = extensionType;
        if (preferredStylist !== undefined) updates.preferredStylist = preferredStylist;
        if (notes !== undefined) updates.notes = notes;

        // Update hair profile using the dedicated repository method
        const hairProfile = await UserRepository.updateHairProfile(req.user.id, updates);

        res.json({ success: true, hairProfile });
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
        // Get notification prefs from the dedicated repository method
        const notificationPrefs = await UserRepository.getNotificationPrefs(req.user.id) || {
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

        // Build update object with only provided fields
        const updates = {};
        if (promotions !== undefined) updates.promotions = promotions;
        if (appointmentReminders !== undefined) updates.appointmentReminders = appointmentReminders;
        if (loyaltyUpdates !== undefined) updates.loyaltyUpdates = loyaltyUpdates;

        // Update notification prefs using the dedicated repository method
        const notificationPrefs = await UserRepository.updateNotificationPrefs(req.user.id, updates);

        res.json({ success: true, notificationPrefs });
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

// Client booking endpoints - only return bookable services (excludes retail, redemptions, training)
app.get('/api/services/hair', async (req, res) => {
    try {
        const services = await ServiceRepository.findBookableByType('hair');
        res.json({ success: true, services });
    } catch (error) {
        console.error('Database error fetching hair services:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch hair services' });
    }
});

app.get('/api/services/beauty', async (req, res) => {
    try {
        const services = await ServiceRepository.findBookableByType('beauty');
        res.json({ success: true, services });
    } catch (error) {
        console.error('Database error fetching beauty services:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch beauty services' });
    }
});

// Get all service types with metadata (for dynamic booking type cards)
// Only includes bookable services for client appointment booking
app.get('/api/service-types', async (req, res) => {
    try {
        const services = await ServiceRepository.findBookable();

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
            typeMap[service.service_type].count++;
            typeMap[service.service_type].services.push(service);
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
        duration: row.duration ?? null,
        status: row.status,
        notes: row.notes ?? null,
        // Commission fields
        commissionRate: row.commission_rate ?? null,
        commissionAmount: row.commission_amount ?? null,
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
    const { type, stylistId, serviceId, date, requestedTimeWindow, preferredTimeOfDay, time, notes, assignedStartTime, assignedEndTime } = req.body;

    // Support both new (requestedTimeWindow) and legacy (preferredTimeOfDay) parameters
    const timeWindow = requestedTimeWindow || preferredTimeOfDay;

    // Check if exact times are provided (real-time availability flow)
    const hasExactTimes = assignedStartTime && assignedEndTime;

    if (!type || !serviceId || !date) {
        return res.status(400).json({ success: false, message: 'Type, service, and date are required' });
    }

    // For hair bookings: require either exact times OR time window
    if (type === 'hair' && !hasExactTimes && !timeWindow) {
        return res.status(400).json({ success: false, message: 'Time window or exact time is required for hair bookings' });
    }

    // Beauty bookings can also use time window (time preference) instead of exact time
    if (type === 'beauty' && !time && !hasExactTimes && !timeWindow) {
        return res.status(400).json({ success: false, message: 'Time or time preference is required for beauty bookings' });
    }

    // Validate time window for bookings (only if using time window flow)
    const validTimeWindows = ['MORNING', 'MIDDAY', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING'];
    if (timeWindow && !hasExactTimes && !validTimeWindows.includes(timeWindow)) {
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
        const normalizedTime = normalizeTimeStr(time) || assignedStartTime;

        // Check for booking conflicts when exact times are provided
        if (hasExactTimes && stylistId) {
            const conflict = await BookingRepository.findConflict(stylistId, assignedStartTime, assignedEndTime);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: 'This time slot is no longer available. Please select a different time.',
                    conflict: {
                        date: conflict.requested_date || conflict.date,
                        time: conflict.assigned_start_time || conflict.confirmed_time || conflict.time
                    }
                });
            }
        }
        // Legacy conflict check for beauty bookings without exact times
        else if (normalizedTime && type === 'beauty' && stylistId) {
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

        // Validate that stylist offers this service (if stylist is specified)
        if (stylistId) {
            const staffServiceRow = await db.dbGet(
                'SELECT id FROM staff_services WHERE staff_id = ? AND service_id = ? AND active = 1',
                [stylistId, serviceId]
            );

            if (!staffServiceRow) {
                const stylist = await StylistRepository.findById(stylistId);
                return res.status(400).json({
                    success: false,
                    message: `${stylist?.name || 'This stylist'} does not offer ${service.name}. Please select a different stylist or service.`
                });
            }
        }

        // Determine if booking should be immediately confirmed
        // Confirmed ONLY if exact times are provided (real-time availability flow)
        // Time preference bookings (morning/midday/afternoon) require salon confirmation
        const isConfirmed = hasExactTimes;

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
            requestedTimeWindow: !hasExactTimes ? timeWindow : null,
            assignedStartTime: hasExactTimes ? assignedStartTime : null,
            assignedEndTime: hasExactTimes ? assignedEndTime : null,
            status: isConfirmed ? 'CONFIRMED' : 'REQUESTED',
            // Legacy fields (for backward compatibility)
            date,
            preferredTimeOfDay: !hasExactTimes ? timeWindow : null,
            time: normalizedTime || assignedStartTime || null,
            confirmedTime: isConfirmed ? (assignedStartTime || normalizedTime) : null,
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
            message: isConfirmed
                ? 'Booking confirmed!'
                : 'Booking request submitted! We will assign an exact time within 24 hours and notify you.',
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

// Get stylist availability for a given date and service
app.get('/api/availability/:stylistId', async (req, res) => {
    try {
        const { stylistId } = req.params;
        const { date, serviceId } = req.query;

        // Validate required params
        if (!date) {
            return res.status(400).json({ success: false, message: 'Date is required' });
        }

        // Validate date format and ensure it's not in the past
        const requestedDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (isNaN(requestedDate.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid date format' });
        }
        if (requestedDate < today) {
            return res.status(400).json({ success: false, message: 'Cannot check availability for past dates' });
        }

        // Get stylist info
        const stylist = await StylistRepository.findById(stylistId);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        // Get service duration (default 60 mins if not specified)
        let serviceDuration = 60;
        if (serviceId) {
            const service = await ServiceRepository.findById(serviceId);
            if (service && service.duration) {
                serviceDuration = service.duration;
            }
        }

        // Get business hours for the day of week
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayOfWeek = dayNames[requestedDate.getDay()];

        let businessHours = null;
        const settingsRow = await db.dbGet('SELECT hours_json FROM business_settings WHERE id = 1');
        if (settingsRow && settingsRow.hours_json) {
            const hoursObj = JSON.parse(settingsRow.hours_json);
            businessHours = hoursObj[dayOfWeek];
        }

        // Default hours if not configured
        if (!businessHours) {
            if (dayOfWeek === 'sun') {
                // Closed on Sunday
                return res.json({
                    success: true,
                    date,
                    stylist: { id: stylist.id, name: stylist.name },
                    serviceDuration,
                    closed: true,
                    message: 'Salon is closed on this day',
                    slots: []
                });
            }
            // Default hours: Mon-Fri 8-18, Sat 9-16
            businessHours = dayOfWeek === 'sat'
                ? { open: '09:00', close: '16:00' }
                : { open: '08:00', close: '18:00' };
        }

        // Check if closed
        if (!businessHours.open || !businessHours.close) {
            return res.json({
                success: true,
                date,
                stylist: { id: stylist.id, name: stylist.name },
                serviceDuration,
                closed: true,
                message: 'Salon is closed on this day',
                slots: []
            });
        }

        // Parse business hours
        const [openHour, openMin] = businessHours.open.split(':').map(Number);
        const [closeHour, closeMin] = businessHours.close.split(':').map(Number);
        const openMinutes = openHour * 60 + openMin;
        const closeMinutes = closeHour * 60 + closeMin;

        // Generate 30-minute slots within business hours
        const slotInterval = 30;
        const slots = [];

        for (let mins = openMinutes; mins < closeMinutes; mins += slotInterval) {
            const hour = Math.floor(mins / 60);
            const minute = mins % 60;
            const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

            // Check if service would end after closing
            const endMins = mins + serviceDuration;
            if (endMins > closeMinutes) {
                // Service won't fit before closing
                slots.push({ time: timeStr, available: false, reason: 'too_late' });
                continue;
            }

            slots.push({ time: timeStr, available: true });
        }

        // Get existing bookings for this stylist on this date
        const existingBookings = await db.dbAll(`
            SELECT assigned_start_time, assigned_end_time, status
            FROM bookings
            WHERE stylist_id = ?
            AND requested_date = ?
            AND status IN ('CONFIRMED', 'REQUESTED')
            AND assigned_start_time IS NOT NULL
            AND assigned_end_time IS NOT NULL
        `, [stylistId, date]);

        // Mark slots as unavailable if they conflict with existing bookings
        for (const slot of slots) {
            if (!slot.available) continue;

            const [slotHour, slotMin] = slot.time.split(':').map(Number);
            const slotStartMins = slotHour * 60 + slotMin;
            const slotEndMins = slotStartMins + serviceDuration;

            // Check against each existing booking
            for (const booking of existingBookings) {
                const [bookStartHour, bookStartMin] = booking.assigned_start_time.split(':').map(Number);
                const [bookEndHour, bookEndMin] = booking.assigned_end_time.split(':').map(Number);
                const bookStartMins = bookStartHour * 60 + bookStartMin;
                const bookEndMins = bookEndHour * 60 + bookEndMin;

                // Check for overlap
                const overlaps = (slotStartMins < bookEndMins && slotEndMins > bookStartMins);

                if (overlaps) {
                    slot.available = false;
                    slot.reason = 'booked';
                    break;
                }
            }
        }

        // Filter out past slots if date is today
        const now = new Date();
        if (requestedDate.toDateString() === now.toDateString()) {
            const currentMins = now.getHours() * 60 + now.getMinutes();
            for (const slot of slots) {
                const [slotHour, slotMin] = slot.time.split(':').map(Number);
                const slotMins = slotHour * 60 + slotMin;
                if (slotMins <= currentMins) {
                    slot.available = false;
                    slot.reason = 'past';
                }
            }
        }

        res.json({
            success: true,
            date,
            stylist: { id: stylist.id, name: stylist.name },
            businessHours,
            serviceDuration,
            slots
        });

    } catch (error) {
        console.error('Error fetching availability:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch availability' });
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
            // Validate status - support both system and MySalonOnline statuses
            const validStatuses = [
                'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED',
                'No Status', 'To Be Confirmed', 'Online Booking', 'Paid',
                'New Extentions', 'New Extensions', 'Late', 'No Show'
            ];
            const matchedStatus = validStatuses.find(s =>
                s.toUpperCase() === status.toUpperCase() || s === status
            );
            if (!matchedStatus) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
            updates.status = matchedStatus;
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
        // Only show products marked for online sale on public storefront
        const filters = { availableOnline: true };

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
            status: 'pending',
            items: orderItems
        };

        // Create order with items
        const newOrder = await OrderRepository.create(orderData);

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

        // Send order confirmation email
        try {
            const user = await UserRepository.findById(req.user.id);
            if (user && user.email) {
                await emailService.sendOrderConfirmation(newOrder, user);
                console.log(`✅ Order confirmation email sent to ${user.email}`);
            }
        } catch (emailError) {
            console.error('Failed to send order confirmation email:', emailError.message);
            // Don't fail the request if email fails
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

// Get single order detail (user)
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
    try {
        const order = await OrderRepository.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        // Ensure user can only view their own orders
        if (order.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        res.json({ success: true, order });
    } catch (error) {
        console.error('Database error fetching order:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch order' });
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

            // Check if this is a booking payment and update booking status
            const payment = await PaymentRepository.findById(result.paymentId);
            if (payment && payment.booking_id) {
                console.log(`💳 Booking payment received for ${payment.booking_id}: ${paymentStatus}`);
                await BookingRepository.recordPayment(payment.booking_id, {
                    status: paymentStatus,
                    method: 'payfast',
                    amount: payment.amount,
                    reference: result.pfPaymentId,
                    date: new Date().toISOString()
                });

                // Process rewards for paid bookings
                if (result.completed) {
                    try {
                        const booking = await BookingRepository.findById(payment.booking_id);
                        if (booking && booking.user_id) {
                            const user = await UserRepository.findById(booking.user_id);
                            if (user) {
                                const bookingWithPayment = { ...booking, paid: true, final_amount: payment.amount };
                                const rewardsResult = await RewardsService.processCompletedBooking(bookingWithPayment, user, true);
                                console.log('💎 Rewards processed for PayFast payment:', rewardsResult);
                            }
                        }
                    } catch (rewardError) {
                        console.error('Error processing rewards for PayFast payment:', rewardError);
                    }
                }
            }
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

            // Process rewards for paid bookings via Yoco
            if (result.completed) {
                try {
                    const payment = await PaymentRepository.findById(result.paymentId);
                    if (payment && payment.booking_id) {
                        const booking = await BookingRepository.findById(payment.booking_id);
                        if (booking && booking.user_id) {
                            const user = await UserRepository.findById(booking.user_id);
                            if (user) {
                                const bookingWithPayment = { ...booking, paid: true, final_amount: payment.amount };
                                const rewardsResult = await RewardsService.processCompletedBooking(bookingWithPayment, user, true);
                                console.log('💎 Rewards processed for Yoco payment:', rewardsResult);
                            }
                        }
                    }
                } catch (rewardError) {
                    console.error('Error processing rewards for Yoco payment:', rewardError);
                }
            }
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
// PAYMENT LANDING PAGE & RESULT ROUTES
// ============================================

// Payment landing page - serves auto-submitting form for PayFast
// This is the URL sent in emails since PayFast requires form POST
app.get('/pay/:paymentId', async (req, res) => {
    try {
        const payment = await PaymentRepository.findById(req.params.paymentId);

        if (!payment) {
            return res.status(404).send(generatePaymentErrorPage('Payment Not Found', 'The payment link you clicked is invalid or has expired.'));
        }

        if (payment.status === 'completed' || payment.status === 'paid') {
            return res.redirect('/payment/success?ref=' + req.params.paymentId);
        }

        if (payment.status !== 'pending') {
            return res.status(400).send(generatePaymentErrorPage('Payment Unavailable', 'This payment is no longer available. Please contact us for assistance.'));
        }

        // Check if payment metadata has the form data
        const metadata = typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata;
        const providerResponse = metadata?.providerResponse;

        if (!providerResponse || !providerResponse.formData) {
            return res.status(400).send(generatePaymentErrorPage('Payment Error', 'Payment data is missing. Please request a new payment link.'));
        }

        // Serve auto-submitting PayFast form
        const html = PaymentService.generatePayFastRedirectHtml({
            formAction: providerResponse.formAction,
            formData: providerResponse.formData
        });

        res.send(html);
    } catch (error) {
        console.error('Payment landing page error:', error);
        res.status(500).send(generatePaymentErrorPage('Error', 'An unexpected error occurred. Please try again or contact support.'));
    }
});

// Payment success page
app.get('/payment/success', async (req, res) => {
    const ref = req.query.ref;
    res.send(generatePaymentResultPage('success', 'Payment Successful!', 'Thank you for your payment. Your booking has been confirmed.', ref));
});

// Payment cancelled page
app.get('/payment/cancel', async (req, res) => {
    const ref = req.query.ref;
    res.send(generatePaymentResultPage('cancel', 'Payment Cancelled', 'Your payment was cancelled. You can try again from your appointments page.', ref));
});

// Payment failed page
app.get('/payment/failed', async (req, res) => {
    const ref = req.query.ref;
    res.send(generatePaymentResultPage('failed', 'Payment Failed', 'Your payment could not be processed. Please try again or contact us for assistance.', ref));
});

// Helper function to generate payment result pages
function generatePaymentResultPage(type, title, message, ref) {
    const colors = {
        success: { bg: '#d4edda', border: '#c3e6cb', text: '#155724', icon: '✓' },
        cancel: { bg: '#fff3cd', border: '#ffeeba', text: '#856404', icon: '⚠' },
        failed: { bg: '#f8d7da', border: '#f5c6cb', text: '#721c24', icon: '✗' }
    };
    const c = colors[type] || colors.failed;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Flirt Hair & Beauty</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #fff5f7 0%, #ffe4e9 100%);
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(246,117,153,0.2);
            padding: 40px;
            max-width: 400px;
            width: 100%;
            text-align: center;
        }
        .icon {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: ${c.bg};
            border: 3px solid ${c.border};
            color: ${c.text};
            font-size: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
        }
        h1 { color: #414042; font-size: 24px; margin-bottom: 10px; }
        p { color: #6d6e70; line-height: 1.6; margin-bottom: 20px; }
        .ref { font-size: 12px; color: #999; margin-top: 15px; }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #F67599 0%, #e05a7f 100%);
            color: white;
            padding: 14px 30px;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(246,117,153,0.4); }
        .logo { margin-bottom: 20px; }
        .logo span { color: #F67599; font-size: 28px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo"><span>Flirt</span></div>
        <div class="icon">${c.icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <a href="/" class="btn">Go to App</a>
        ${ref ? `<p class="ref">Reference: ${ref}</p>` : ''}
    </div>
</body>
</html>`;
}

// Helper function to generate error pages
function generatePaymentErrorPage(title, message) {
    return generatePaymentResultPage('failed', title, message, null);
}

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
// Helper function to get hair tracker settings from database
async function getHairTrackerSettings() {
    const defaultConfig = {
        defaultMaintenanceIntervalDays: 42,
        washFrequencyDays: 3,
        deepConditionFrequencyDays: 14,
        extensionTypes: [
            { id: 'clip-in', label: 'Clip-In Extensions', maintenanceDays: 1 },
            { id: 'tape-in', label: 'Tape-In Extensions', maintenanceDays: 42 },
            { id: 'sew-in', label: 'Sew-In Weave', maintenanceDays: 56 },
            { id: 'micro-link', label: 'Micro-Link Extensions', maintenanceDays: 84 },
            { id: 'fusion', label: 'Fusion Extensions', maintenanceDays: 84 },
            { id: 'halo', label: 'Halo Extensions', maintenanceDays: 1 },
            { id: 'ponytail', label: 'Ponytail Extensions', maintenanceDays: 14 },
            { id: 'other', label: 'Other', maintenanceDays: 42 }
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
            'Use a silk pillowcase to reduce friction and tangling while you sleep.',
            'Avoid applying heat directly to the bonds or tape areas.',
            'Brush your extensions gently from the ends up, never from the roots.',
            'Use sulfate-free shampoos to protect the bonds.',
            'Deep condition every 2 weeks to keep extensions soft and manageable.'
        ]
    };

    try {
        // Try to get settings from database
        const row = await dbGet('SELECT value FROM hair_tracker_settings WHERE key = ?', ['config']);
        if (row && row.value) {
            const savedConfig = JSON.parse(row.value);
            // Merge with defaults to ensure all fields exist
            return {
                ...defaultConfig,
                ...savedConfig,
                healthScore: { ...defaultConfig.healthScore, ...savedConfig.healthScore },
                copy: { ...defaultConfig.copy, ...savedConfig.copy }
            };
        }
    } catch (error) {
        console.log('No saved hair tracker settings, using defaults');
    }

    return defaultConfig;
}

// Helper function to save hair tracker settings to database
async function saveHairTrackerSettings(config) {
    await dbRun(
        `INSERT OR REPLACE INTO hair_tracker_settings (key, value) VALUES (?, ?)`,
        ['config', JSON.stringify(config)]
    );
}

app.get('/api/hair-tracker/config', async (req, res) => {
    try {
        const config = await getHairTrackerSettings();

        // Build extensionTypeIntervals map for backward compatibility
        const extensionTypeIntervals = {};
        if (config.extensionTypes) {
            config.extensionTypes.forEach(et => {
                extensionTypeIntervals[et.id] = et.maintenanceDays;
            });
        }

        res.json({
            success: true,
            config: {
                ...config,
                extensionTypeIntervals
            }
        });
    } catch (error) {
        console.error('Error loading hair tracker config:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Get user's hair tracker data with computed metrics
app.get('/api/hair-tracker', authenticateToken, async (req, res) => {
    try {
        // Get tracker data from the dedicated hair_tracker table
        const tracker = await UserRepository.getHairTracker(req.user.id) || {};
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

        // Get existing tracker data from database
        const existingTracker = await UserRepository.getHairTracker(req.user.id) || {};

        // Calculate next maintenance date if lastInstallDate changed
        let calculatedNextMaintenance = nextMaintenanceDate;
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
            calculatedNextMaintenance = nm.toISOString();
        }

        // Update tracker using the dedicated repository method
        const updatedTracker = await UserRepository.updateHairTracker(req.user.id, {
            lastInstallDate,
            extensionType,
            maintenanceIntervalDays,
            nextMaintenanceDate: calculatedNextMaintenance,
            lastDeepConditionDate,
            productsUsed,
            hairHealthScore
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

        // Get existing tracker from database
        const currentTracker = await UserRepository.getHairTracker(req.user.id) || {};
        const washHistory = currentTracker.washHistory || [];
        const washDate = date ? new Date(date) : new Date();

        const newWashEntry = {
            id: uuidv4(),
            date: washDate.toISOString(),
            notes: notes || ''
        };

        washHistory.push(newWashEntry);

        // Update tracker using the dedicated repository method
        const updatedTracker = await UserRepository.updateHairTracker(req.user.id, {
            washHistory: washHistory,
            lastWashDate: washDate.toISOString()
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

        // Get existing tracker from database
        const currentTracker = await UserRepository.getHairTracker(req.user.id) || {};
        const conditionDate = date ? new Date(date) : new Date();

        // Update tracker using the dedicated repository method
        const updatedTracker = await UserRepository.updateHairTracker(req.user.id, {
            lastDeepConditionDate: conditionDate.toISOString()
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

        // Get existing tracker from database
        const currentTracker = await UserRepository.getHairTracker(req.user.id) || {};
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

            // Update tracker using the dedicated repository method
            updatedTracker = await UserRepository.updateHairTracker(req.user.id, {
                productsUsed: [...productsUsed, newProduct]
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

        // Get existing tracker from database
        const currentTracker = await UserRepository.getHairTracker(req.user.id) || {};
        let updatedTracker = currentTracker;

        if (currentTracker.productsUsed) {
            const filteredProducts = currentTracker.productsUsed.filter(p => p.productId !== productId);

            // Update tracker using the dedicated repository method
            updatedTracker = await UserRepository.updateHairTracker(req.user.id, {
                productsUsed: filteredProducts
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
// ADMIN - STAFF MANAGEMENT (Admin only)
// ============================================

// Available permissions for staff members
const STAFF_PERMISSIONS = {
    bookings: { label: 'Bookings', description: 'View and manage bookings' },
    customers: { label: 'Customers', description: 'View and manage customers' },
    services: { label: 'Services', description: 'View and manage services' },
    products: { label: 'Products', description: 'View and manage products' },
    orders: { label: 'Orders', description: 'View and manage orders' },
    invoices: { label: 'Invoices', description: 'Create and manage invoices' },
    reports: { label: 'Reports', description: 'View reports and analytics' },
    promotions: { label: 'Promotions', description: 'Manage promotions and promos' },
    gallery: { label: 'Gallery', description: 'Manage gallery images' },
    chat: { label: 'Chat', description: 'Access customer chat' },
    stylists: { label: 'Stylists', description: 'Manage stylist profiles' },
    rewards: { label: 'Rewards', description: 'Manage rewards programme' }
};

// Get list of available permissions
app.get('/api/admin/staff/permissions-list', authenticateAdmin, async (req, res) => {
    // Only admin can view this
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    res.json({ success: true, permissions: STAFF_PERMISSIONS });
});

// Get all staff members
app.get('/api/admin/staff', authenticateAdmin, async (req, res) => {
    try {
        // Only admin can view staff list
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const staff = await UserRepository.findAllStaff();

        // Parse permissions and remove sensitive data
        const safeStaff = staff.map(s => ({
            id: s.id,
            email: s.email,
            name: s.name,
            phone: s.phone,
            role: s.role,
            permissions: s.permissions ? JSON.parse(s.permissions) : {},
            stylistId: s.stylist_id,
            stylistName: s.stylist_name,
            createdAt: s.created_at,
            updatedAt: s.updated_at
        }));

        res.json({ success: true, staff: safeStaff });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch staff members' });
    }
});

// Create new staff member
app.post('/api/admin/staff', authenticateAdmin, async (req, res) => {
    try {
        // Only admin can create staff
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const { email, name, phone, permissions, stylistId, password } = req.body;

        if (!email || !name) {
            return res.status(400).json({ success: false, message: 'Email and name are required' });
        }

        // Check if email already exists
        const existing = await UserRepository.findByEmail(email);
        if (existing) {
            return res.status(400).json({ success: false, message: 'Email already in use' });
        }

        // Generate temporary password if not provided
        const tempPassword = password || Math.random().toString(36).slice(-8) + 'A1!';
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        const staff = await UserRepository.createStaff({
            email,
            name,
            phone,
            passwordHash,
            permissions: permissions || {},
            stylistId
        });

        res.json({
            success: true,
            staff: {
                id: staff.id,
                email: staff.email,
                name: staff.name,
                phone: staff.phone,
                role: staff.role,
                permissions: staff.permissions ? JSON.parse(staff.permissions) : {},
                stylistId: staff.stylist_id
            },
            temporaryPassword: tempPassword,
            message: 'Staff member created. They will need to change their password on first login.'
        });
    } catch (error) {
        console.error('Error creating staff:', error);
        res.status(500).json({ success: false, message: 'Failed to create staff member' });
    }
});

// Update staff member
app.put('/api/admin/staff/:id', authenticateAdmin, async (req, res) => {
    try {
        // Only admin can update staff
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const { id } = req.params;
        const { name, phone, permissions, stylistId } = req.body;

        // Get existing user
        const user = await UserRepository.findById(id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Staff member not found' });
        }

        // Can't modify admin accounts
        if (user.role === 'admin' && req.user.id !== user.id) {
            return res.status(403).json({ success: false, message: 'Cannot modify other admin accounts' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (permissions !== undefined) updates.permissions = permissions;
        if (stylistId !== undefined) updates.stylistId = stylistId;

        const updated = await UserRepository.update(id, updates);

        res.json({
            success: true,
            staff: {
                id: updated.id,
                email: updated.email,
                name: updated.name,
                phone: updated.phone,
                role: updated.role,
                permissions: updated.permissions ? JSON.parse(updated.permissions) : {},
                stylistId: updated.stylist_id
            }
        });
    } catch (error) {
        console.error('Error updating staff:', error);
        res.status(500).json({ success: false, message: 'Failed to update staff member' });
    }
});

// Reset staff password
app.post('/api/admin/staff/:id/reset-password', authenticateAdmin, async (req, res) => {
    try {
        // Only admin can reset passwords
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const { id } = req.params;

        const user = await UserRepository.findById(id);
        if (!user || (user.role !== 'staff' && user.role !== 'admin')) {
            return res.status(404).json({ success: false, message: 'Staff member not found' });
        }

        // Generate new temporary password
        const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        await UserRepository.update(id, {
            passwordHash,
            mustChangePassword: true
        });

        res.json({
            success: true,
            temporaryPassword: tempPassword,
            message: 'Password reset. Staff member will need to change password on next login.'
        });
    } catch (error) {
        console.error('Error resetting staff password:', error);
        res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
});

// Remove staff member (converts back to customer)
app.delete('/api/admin/staff/:id', authenticateAdmin, async (req, res) => {
    try {
        // Only admin can remove staff
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const { id } = req.params;

        const user = await UserRepository.findById(id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Staff member not found' });
        }

        // Can't remove admin accounts
        if (user.role === 'admin') {
            return res.status(403).json({ success: false, message: 'Cannot remove admin accounts' });
        }

        await UserRepository.removeStaff(id);

        res.json({ success: true, message: 'Staff member removed' });
    } catch (error) {
        console.error('Error removing staff:', error);
        res.status(500).json({ success: false, message: 'Failed to remove staff member' });
    }
});

// Get current user's permissions
app.get('/api/admin/my-permissions', authenticateAdmin, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            res.json({
                success: true,
                role: 'admin',
                permissions: { all: true },
                permissionsList: STAFF_PERMISSIONS
            });
        } else {
            const permissions = req.user.permissions ?
                (typeof req.user.permissions === 'string' ? JSON.parse(req.user.permissions) : req.user.permissions) : {};

            res.json({
                success: true,
                role: 'staff',
                permissions,
                permissionsList: STAFF_PERMISSIONS
            });
        }
    } catch (error) {
        console.error('Error fetching permissions:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch permissions' });
    }
});

// ============================================
// ADMIN - SERVICE MANAGEMENT
// ============================================

// Get all services (with optional filtering)
// Admin can see ALL services (bookable + non-bookable) for invoicing
app.get('/api/admin/services', authenticateAdmin, async (req, res) => {
    try {
        const { service_type, active, bookable } = req.query;
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

        // Filter by bookable status if provided
        if (bookable !== undefined) {
            const bookableFilter = bookable === 'true' || bookable === '1' ? 1 : 0;
            services = services.filter(s => s.bookable === bookableFilter);
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

// Create new service
app.post('/api/admin/services', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, price, duration, service_type, category, image_url, bookable } = req.body;

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
            display_order: req.body.display_order || 0,
            commission_rate: req.body.commission_rate !== undefined ? req.body.commission_rate : null,
            active: 1,
            bookable: bookable !== undefined ? (bookable ? 1 : 0) : 1, // Default to bookable
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
        const { name, description, price, duration, service_type, category, image_url, display_order, active, bookable } = req.body;

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
            display_order: display_order !== undefined ? display_order : (existing.display_order || 0),
            commission_rate: req.body.commission_rate !== undefined ? req.body.commission_rate : existing.commission_rate,
            active: active !== undefined ? (active ? 1 : 0) : existing.active,
            bookable: bookable !== undefined ? (bookable ? 1 : 0) : existing.bookable
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

// Seed hair services from predefined list
app.post('/api/admin/services/seed-hair', authenticateAdmin, async (req, res) => {
    try {
        const { v4: uuidv4 } = require('uuid');

        // All hair services
        const services = [
            // Consultation
            { name: 'Consultation', price: 0, category: 'Consultation', description: 'A personalised session to discuss your hair goals, assess your hair, recommend the best options, and provide a customised quote before your appointment.' },

            // Cut & Styling
            { name: 'Short Blow Dry', price: 220, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
            { name: 'Medium Blow Dry', price: 290, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
            { name: 'Long Blow Dry', price: 360, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
            { name: 'XL Blow Dry', price: 430, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage followed by a sleek, salon-quality blow dry tailored to your preferred style.' },
            { name: 'Cut & Style Short', price: 295, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
            { name: 'Cut & Style Medium', price: 395, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
            { name: 'Cut & Style Long', price: 495, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
            { name: 'Cut & Style XL', price: 595, category: 'Cut & Styling', description: 'A customised haircut and professional style to enhance your look and suit your lifestyle.' },
            { name: 'Ladies Wash Only', price: 100, category: 'Cut & Styling', description: 'Enjoy a refreshing hair wash and head massage.' },
            { name: 'Gents Cut', price: 200, category: 'Cut & Styling', description: 'A fresh cut and salon-quality style for hair that looks effortless and perfectly shaped.' },

            // Colour Services
            { name: 'Root Refresh', price: 625, category: 'Colour Services', description: 'Covers regrowth to keep your colour looking seamless. Prices from R625-R825. Price excludes gloss, cut, and blow-dry.' },
            { name: 'Full Colour Service', price: 950, category: 'Colour Services', description: 'Transform your look with a vibrant, all-over colour tailored to you. Prices from R950-R1850. Price excludes gloss, cut, and blow-dry.' },

            // Lightening Services
            { name: 'Face Frame', price: 420, category: 'Lightening Services', description: "Foils around the hairline, creating a 'money piece' for a pop of brightness. Prices from R420-R550. Price excludes gloss, cut, and blow-dry." },
            { name: 'T-Section Lightening', price: 625, category: 'Lightening Services', description: 'Targeted lightening applied to the top and front sections of your hair for added brightness and dimension. Prices from R625-835. Price excludes gloss, cut, and blow-dry.' },
            { name: 'Half Head Lightening', price: 750, category: 'Lightening Services', description: 'Touch up focused on the top half of your hair, framing the hairline without compromising health. Prices from R750-R950. Price excludes gloss, cut, and blow-dry.' },
            { name: 'Full Head Lightening', price: 1000, category: 'Lightening Services', description: 'Create a bold, luminous look with highlights applied throughout your entire head, adding depth, dimension, and a radiant finish. Prices from R1000-1800. Price excludes gloss, cut, and blow-dry.' },
            { name: 'Highlight & Lowlights', price: 1400, category: 'Lightening Services', description: 'Add dimension and depth to your hair with a combination of highlights and lowlights, creating a natural, multi-tonal, and beautifully blended look. Prices from R1400-R1800. Price excludes gloss, cut, and blow-dry.' },

            // Balayage
            { name: 'Partial Balayage', price: 1500, category: 'Balayage', description: 'A hand-painted colour technique applied to select sections of your hair for a natural, sun-kissed look with subtle dimension and brightness. Prices from R1500-R2385. Price excludes gloss, cut, and blow-dry.' },
            { name: 'Full Balayage', price: 1750, category: 'Balayage', description: 'A hand-painted colour technique applied throughout the entire head for a seamless, sun-kissed, and dimensional look. Perfect for a natural, luminous finish. Prices from R1750-R1900. Price excludes gloss, cut, and blow-dry.' },

            // Treatments
            { name: 'Inoar Brazilian Treatment', price: 850, category: 'Treatments', description: 'A smoothing treatment that reduces frizz, adds shine, and leaves hair soft, sleek, and manageable. Ideal for all hair types and a long-lasting, polished finish. Prices from R850-R1400.' },
            { name: 'MK Treatment', price: 1100, category: 'Treatments', description: 'A nourishing and restorative treatment designed to repair, strengthen, and revitalize damaged or stressed hair, leaving it soft, smooth, and healthy-looking. Prices from R1100-R3350.' },
            { name: 'Davines Experience', price: 550, category: 'Treatments', description: "A personalised hair treatment tailored to your hair's unique needs." },
            { name: 'Wella Experience', price: 300, category: 'Treatments', description: 'A professional salon treatment that nourishes, repairs, and strengthens your hair.' },
            { name: 'Botox', price: 600, category: 'Treatments', description: 'A deep-repair treatment that smooths, strengthens, and restores hair from within. Ideal for damaged, frizzy, or aging hair, leaving it soft, shiny, and revitalised.' },

            // Extension Maintenance
            { name: 'Tape-In Maintenance', price: 1000, category: 'Extension Maintenance', description: 'Removal, retaping and reinstallation. Includes wash & blow-dry.' },
            { name: 'Weft Maintenance', price: 1600, category: 'Extension Maintenance', description: 'Removal and reinstallation of wefts. Includes wash & blow-dry.' },
            { name: 'Keratin Maintenance', price: 1000, category: 'Extension Maintenance', description: 'Removal, rebonding and reinstallation. Includes wash & blow-dry.' },
            { name: 'Installation / Removal Only', price: 450, category: 'Extension Maintenance', description: 'Extension installation or removal service only.' },
        ];

        // Ensure Hair service type exists
        let hairType = await db.dbGet("SELECT id FROM service_types WHERE name = 'Hair'");
        if (!hairType) {
            const hairTypeId = uuidv4();
            await db.dbRun(
                "INSERT INTO service_types (id, name, description, display_order, active) VALUES (?, ?, ?, ?, ?)",
                [hairTypeId, 'Hair', 'Hair services', 1, 1]
            );
            hairType = { id: hairTypeId };
        }

        // Create categories
        const categories = [...new Set(services.map(s => s.category))];
        for (let i = 0; i < categories.length; i++) {
            const catName = categories[i];
            const existing = await db.dbGet(
                "SELECT id FROM service_categories WHERE name = ? AND service_type_id = ?",
                [catName, hairType.id]
            );
            if (!existing) {
                await db.dbRun(
                    "INSERT INTO service_categories (id, name, service_type_id, display_order, active) VALUES (?, ?, ?, ?, ?)",
                    [uuidv4(), catName, hairType.id, i + 1, 1]
                );
            }
        }

        // Deactivate existing hair services (don't delete - foreign key constraints with bookings)
        await db.dbRun("UPDATE services SET active = 0 WHERE service_type = 'hair'");

        // Insert all new services
        for (const service of services) {
            await db.dbRun(
                `INSERT INTO services (id, name, description, price, duration, service_type, category, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), service.name, service.description, service.price, 60, 'hair', service.category, 1]
            );
        }

        console.log(`Seeded ${services.length} hair services`);
        res.json({ success: true, message: `Successfully seeded ${services.length} hair services`, count: services.length });
    } catch (error) {
        console.error('Error seeding hair services:', error.message);
        res.status(500).json({ success: false, message: 'Failed to seed hair services: ' + error.message });
    }
});

// Bulk import services and products from JSON data
app.post('/api/admin/bulk-import', authenticateAdmin, async (req, res) => {
    try {
        const { services: importServices, products: importProducts, clearExisting = false } = req.body;
        const results = { services: { created: 0, updated: 0 }, products: { created: 0, updated: 0 } };

        // Optionally clear existing data
        if (clearExisting) {
            await db.dbRun("DELETE FROM services WHERE 1=1");
            await db.dbRun("DELETE FROM products WHERE 1=1");
            console.log('Cleared existing services and products');
        }

        // Import services
        if (importServices && Array.isArray(importServices)) {
            for (const svc of importServices) {
                const existing = await db.dbGet('SELECT id FROM services WHERE name = ? COLLATE NOCASE', [svc.name]);
                if (existing) {
                    await db.dbRun(`
                        UPDATE services SET
                            price = ?, cost_price = ?, description = ?, category = ?,
                            service_type = ?, commission_rate = ?, duration = ?, active = ?
                        WHERE id = ?
                    `, [
                        svc.price || 0, svc.cost_price || 0, svc.description || '',
                        svc.category || 'General', svc.service_type || 'hair',
                        svc.commission_rate || 0.30, svc.duration || null, svc.active !== false ? 1 : 0,
                        existing.id
                    ]);
                    results.services.updated++;
                } else {
                    const serviceId = svc.id || `svc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    await db.dbRun(`
                        INSERT INTO services (id, name, description, price, cost_price, duration, service_type, category, commission_rate, active, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `, [
                        serviceId, svc.name, svc.description || '', svc.price || 0, svc.cost_price || 0,
                        svc.duration || null, svc.service_type || 'hair', svc.category || 'General',
                        svc.commission_rate || 0.30, svc.active !== false ? 1 : 0
                    ]);
                    results.services.created++;
                }
            }
        }

        // Import products
        if (importProducts && Array.isArray(importProducts)) {
            for (const prod of importProducts) {
                const existing = await db.dbGet('SELECT id FROM products WHERE name = ? COLLATE NOCASE', [prod.name]);
                if (existing) {
                    await db.dbRun(`
                        UPDATE products SET
                            price = ?, cost_price = ?, description = ?, category = ?,
                            stock = ?, commission_rate = ?, is_service_product = ?, supplier = ?, active = ?
                        WHERE id = ?
                    `, [
                        prod.price || 0, prod.cost_price || 0, prod.description || '',
                        prod.category || 'General', prod.stock || 0, prod.commission_rate || 0.10,
                        prod.is_service_product ? 1 : 0, prod.supplier || '', prod.active !== false ? 1 : 0,
                        existing.id
                    ]);
                    results.products.updated++;
                } else {
                    const productId = prod.id || `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    await db.dbRun(`
                        INSERT INTO products (id, name, description, price, cost_price, category, stock, commission_rate, is_service_product, supplier, active, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `, [
                        productId, prod.name, prod.description || '', prod.price || 0, prod.cost_price || 0,
                        prod.category || 'General', prod.stock || 0, prod.commission_rate || 0.10,
                        prod.is_service_product ? 1 : 0, prod.supplier || '', prod.active !== false ? 1 : 0
                    ]);
                    results.products.created++;
                }
            }
        }

        console.log(`Bulk import complete: ${results.services.created} services created, ${results.services.updated} updated; ${results.products.created} products created, ${results.products.updated} updated`);
        res.json({
            success: true,
            message: 'Bulk import completed',
            results
        });
    } catch (error) {
        console.error('Error in bulk import:', error.message);
        res.status(500).json({ success: false, message: 'Bulk import failed: ' + error.message });
    }
});

// Bulk import customers from JSON data
app.post('/api/admin/bulk-import-customers', authenticateAdmin, async (req, res) => {
    try {
        const { customers, skipExisting = true } = req.body;
        const results = { created: 0, skipped: 0, errors: [] };

        if (!customers || !Array.isArray(customers)) {
            return res.status(400).json({ success: false, message: 'customers array is required' });
        }

        for (const customer of customers) {
            try {
                // Check if email already exists
                const existing = await db.dbGet('SELECT id FROM users WHERE email = ? COLLATE NOCASE', [customer.email]);
                if (existing) {
                    if (skipExisting) {
                        results.skipped++;
                        continue;
                    }
                    // Update existing customer
                    await db.dbRun(`
                        UPDATE users SET
                            name = ?, phone = ?, points = ?, tier = ?, referral_code = ?
                        WHERE id = ?
                    `, [
                        customer.name, customer.phone || null, customer.points || 0,
                        customer.tier || 'bronze', customer.referral_code || null, existing.id
                    ]);
                    results.skipped++;
                    continue;
                }

                // Create new customer
                await db.dbRun(`
                    INSERT INTO users (
                        id, email, password_hash, name, phone, role,
                        points, tier, referral_code, must_change_password, created_at
                    ) VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, 1, datetime('now'))
                `, [
                    customer.id,
                    customer.email,
                    customer.password_hash,
                    customer.name || 'Customer',
                    customer.phone || null,
                    customer.points || 0,
                    customer.tier || 'bronze',
                    customer.referral_code || null
                ]);
                results.created++;
            } catch (error) {
                if (error.message.includes('UNIQUE constraint failed')) {
                    results.skipped++;
                } else {
                    results.errors.push({ email: customer.email, error: error.message });
                }
            }
        }

        console.log(`Customer bulk import: ${results.created} created, ${results.skipped} skipped, ${results.errors.length} errors`);
        res.json({
            success: true,
            message: 'Customer import completed',
            results
        });
    } catch (error) {
        console.error('Error in customer bulk import:', error.message);
        res.status(500).json({ success: false, message: 'Customer bulk import failed: ' + error.message });
    }
});

// Delete a customer by ID
app.delete('/api/admin/customers/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check customer exists
        const customer = await db.dbGet('SELECT id, email, role FROM users WHERE id = ?', [id]);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        // Don't allow deleting admins or staff
        if (customer.role !== 'customer') {
            return res.status(403).json({ success: false, message: 'Cannot delete non-customer accounts' });
        }

        // Delete the customer
        await db.dbRun('DELETE FROM users WHERE id = ?', [id]);

        console.log(`Deleted customer: ${customer.email}`);
        res.json({ success: true, message: 'Customer deleted' });
    } catch (error) {
        console.error('Error deleting customer:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete customer: ' + error.message });
    }
});

// Bulk delete customers by ID list
app.post('/api/admin/customers/bulk-delete', authenticateAdmin, async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }

        let deleted = 0;
        let skipped = 0;

        for (const id of ids) {
            const customer = await db.dbGet('SELECT id, role FROM users WHERE id = ?', [id]);
            if (!customer) {
                skipped++;
                continue;
            }
            if (customer.role !== 'customer') {
                skipped++;
                continue;
            }

            await db.dbRun('DELETE FROM users WHERE id = ?', [id]);
            deleted++;
        }

        console.log(`Bulk delete: ${deleted} deleted, ${skipped} skipped`);
        res.json({ success: true, deleted, skipped });
    } catch (error) {
        console.error('Error in bulk delete:', error.message);
        res.status(500).json({ success: false, message: 'Bulk delete failed: ' + error.message });
    }
});

// ============================================
// ADMIN - SERVICE TYPES MANAGEMENT
// ============================================

// Get all service types
app.get('/api/admin/service-types', authenticateAdmin, async (req, res) => {
    try {
        const types = await db.dbAll(`
            SELECT * FROM service_types
            ORDER BY display_order, name
        `);
        res.json({ success: true, types });
    } catch (error) {
        console.error('Error fetching service types:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load service types' });
    }
});

// Get service types (public - for dropdowns)
app.get('/api/service-types', async (req, res) => {
    try {
        const types = await db.dbAll(`
            SELECT id, name, description FROM service_types
            WHERE active = 1
            ORDER BY display_order, name
        `);
        res.json({ success: true, types });
    } catch (error) {
        console.error('Error fetching service types:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load service types' });
    }
});

// Create service type
app.post('/api/admin/service-types', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, display_order = 0 } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        // Check for duplicate name
        const existing = await db.dbGet('SELECT id FROM service_types WHERE LOWER(name) = LOWER(?)', [name]);
        if (existing) {
            return res.status(400).json({ success: false, message: 'A service type with this name already exists' });
        }

        const id = `type_${uuidv4()}`;
        await db.dbRun(
            `INSERT INTO service_types (id, name, description, display_order) VALUES (?, ?, ?, ?)`,
            [id, name.toLowerCase(), description || null, display_order]
        );

        const newType = await db.dbGet('SELECT * FROM service_types WHERE id = ?', [id]);
        res.json({ success: true, type: newType });
    } catch (error) {
        console.error('Error creating service type:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create service type' });
    }
});

// Update service type
app.put('/api/admin/service-types/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, display_order, active } = req.body;

        const existing = await db.dbGet('SELECT * FROM service_types WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Service type not found' });
        }

        // Check for duplicate name if changing
        if (name && name.toLowerCase() !== existing.name) {
            const duplicate = await db.dbGet('SELECT id FROM service_types WHERE LOWER(name) = LOWER(?) AND id != ?', [name, id]);
            if (duplicate) {
                return res.status(400).json({ success: false, message: 'A service type with this name already exists' });
            }
        }

        await db.dbRun(
            `UPDATE service_types SET
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                display_order = COALESCE(?, display_order),
                active = COALESCE(?, active)
            WHERE id = ?`,
            [name ? name.toLowerCase() : null, description, display_order, active, id]
        );

        const updated = await db.dbGet('SELECT * FROM service_types WHERE id = ?', [id]);
        res.json({ success: true, type: updated });
    } catch (error) {
        console.error('Error updating service type:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update service type' });
    }
});

// Delete service type
app.delete('/api/admin/service-types/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if type is in use by any services
        const servicesUsingType = await db.dbGet(
            'SELECT COUNT(*) as count FROM services WHERE service_type = (SELECT name FROM service_types WHERE id = ?)',
            [id]
        );

        if (servicesUsingType && servicesUsingType.count > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete - ${servicesUsingType.count} service(s) are using this type`
            });
        }

        await db.dbRun('DELETE FROM service_types WHERE id = ?', [id]);
        res.json({ success: true, message: 'Service type deleted successfully' });
    } catch (error) {
        console.error('Error deleting service type:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete service type' });
    }
});

// ============================================
// ADMIN - SERVICE CATEGORIES MANAGEMENT
// ============================================

// Get all categories (optionally filtered by service type)
app.get('/api/admin/service-categories', authenticateAdmin, async (req, res) => {
    try {
        const { service_type_id } = req.query;

        let query = `
            SELECT sc.*, st.name as service_type_name
            FROM service_categories sc
            LEFT JOIN service_types st ON sc.service_type_id = st.id
        `;
        const params = [];

        if (service_type_id) {
            query += ' WHERE sc.service_type_id = ?';
            params.push(service_type_id);
        }

        query += ' ORDER BY st.display_order, sc.display_order, sc.name';

        const categories = await db.dbAll(query, params);
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Error fetching service categories:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load service categories' });
    }
});

// Get categories for a service type (public - for dropdowns)
app.get('/api/service-categories', async (req, res) => {
    try {
        const { service_type_id, service_type } = req.query;

        let query = `
            SELECT sc.id, sc.name, sc.description, sc.service_type_id
            FROM service_categories sc
            LEFT JOIN service_types st ON sc.service_type_id = st.id
            WHERE sc.active = 1
        `;
        const params = [];

        if (service_type_id) {
            query += ' AND sc.service_type_id = ?';
            params.push(service_type_id);
        } else if (service_type) {
            query += ' AND st.name = ?';
            params.push(service_type.toLowerCase());
        }

        query += ' ORDER BY sc.display_order, sc.name';

        const categories = await db.dbAll(query, params);
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Error fetching service categories:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load service categories' });
    }
});

// Create service category
app.post('/api/admin/service-categories', authenticateAdmin, async (req, res) => {
    try {
        const { name, service_type_id, description, display_order = 0 } = req.body;

        if (!name || !service_type_id) {
            return res.status(400).json({ success: false, message: 'Name and service type are required' });
        }

        // Verify service type exists
        const typeExists = await db.dbGet('SELECT id FROM service_types WHERE id = ?', [service_type_id]);
        if (!typeExists) {
            return res.status(400).json({ success: false, message: 'Invalid service type' });
        }

        // Check for duplicate name within same type
        const existing = await db.dbGet(
            'SELECT id FROM service_categories WHERE LOWER(name) = LOWER(?) AND service_type_id = ?',
            [name, service_type_id]
        );
        if (existing) {
            return res.status(400).json({ success: false, message: 'A category with this name already exists for this service type' });
        }

        const id = uuidv4();
        await db.dbRun(
            `INSERT INTO service_categories (id, name, service_type_id, description, display_order) VALUES (?, ?, ?, ?, ?)`,
            [id, name, service_type_id, description || null, display_order]
        );

        const newCategory = await db.dbGet(`
            SELECT sc.*, st.name as service_type_name
            FROM service_categories sc
            LEFT JOIN service_types st ON sc.service_type_id = st.id
            WHERE sc.id = ?
        `, [id]);
        res.json({ success: true, category: newCategory });
    } catch (error) {
        console.error('Error creating service category:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create service category' });
    }
});

// Update service category
app.put('/api/admin/service-categories/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, service_type_id, description, display_order, active } = req.body;

        const existing = await db.dbGet('SELECT * FROM service_categories WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Service category not found' });
        }

        // Check for duplicate name within same type if changing
        const newTypeId = service_type_id || existing.service_type_id;
        if (name && (name !== existing.name || newTypeId !== existing.service_type_id)) {
            const duplicate = await db.dbGet(
                'SELECT id FROM service_categories WHERE LOWER(name) = LOWER(?) AND service_type_id = ? AND id != ?',
                [name, newTypeId, id]
            );
            if (duplicate) {
                return res.status(400).json({ success: false, message: 'A category with this name already exists for this service type' });
            }
        }

        await db.dbRun(
            `UPDATE service_categories SET
                name = COALESCE(?, name),
                service_type_id = COALESCE(?, service_type_id),
                description = COALESCE(?, description),
                display_order = COALESCE(?, display_order),
                active = COALESCE(?, active)
            WHERE id = ?`,
            [name, service_type_id, description, display_order, active, id]
        );

        const updated = await db.dbGet(`
            SELECT sc.*, st.name as service_type_name
            FROM service_categories sc
            LEFT JOIN service_types st ON sc.service_type_id = st.id
            WHERE sc.id = ?
        `, [id]);
        res.json({ success: true, category: updated });
    } catch (error) {
        console.error('Error updating service category:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update service category' });
    }
});

// Delete service category
app.delete('/api/admin/service-categories/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if category is in use by any services
        const categoryName = await db.dbGet('SELECT name FROM service_categories WHERE id = ?', [id]);
        if (categoryName) {
            const servicesUsingCategory = await db.dbGet(
                'SELECT COUNT(*) as count FROM services WHERE category = ?',
                [categoryName.name]
            );

            if (servicesUsingCategory && servicesUsingCategory.count > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot delete - ${servicesUsingCategory.count} service(s) are using this category`
                });
            }
        }

        await db.dbRun('DELETE FROM service_categories WHERE id = ?', [id]);
        res.json({ success: true, message: 'Service category deleted successfully' });
    } catch (error) {
        console.error('Error deleting service category:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete service category' });
    }
});

// ============================================
// ADMIN - SERVICE IMAGE UPLOAD
// ============================================

// Upload service image
app.post('/api/admin/services/:id/image', authenticateAdmin, uploadServiceImage.single('image'), async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        const service = await ServiceRepository.findById(id);
        if (!service) {
            // Delete uploaded file if service not found
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Delete old image if it's a local upload
        if (service.image_url && service.image_url.startsWith('/uploads/')) {
            const oldImagePath = path.join(__dirname, service.image_url);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }

        // Build the URL for the uploaded image
        const imageUrl = `/uploads/services/${req.file.filename}`;

        // Update service with new image URL
        await ServiceRepository.updateById(id, { image_url: imageUrl });

        const updated = await ServiceRepository.findById(id);
        res.json({
            success: true,
            message: 'Image uploaded successfully',
            imageUrl,
            service: updated
        });
    } catch (error) {
        console.error('Error uploading service image:', error.message);
        // Clean up uploaded file on error
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(500).json({ success: false, message: 'Failed to upload image' });
    }
});

// Delete service image
app.delete('/api/admin/services/:id/image', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const service = await ServiceRepository.findById(id);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Delete image file if it's a local upload
        if (service.image_url && service.image_url.startsWith('/uploads/')) {
            const imagePath = path.join(__dirname, service.image_url);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        // Update service to remove image URL
        await ServiceRepository.updateById(id, { image_url: null });

        res.json({ success: true, message: 'Image deleted successfully' });
    } catch (error) {
        console.error('Error deleting service image:', error.message);
        res.status(500).json({ success: false, message: 'Failed to delete image' });
    }
});

// Multer error handler for service image uploads
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File too large. Maximum size is 5MB.' });
        }
        return res.status(400).json({ success: false, message: err.message });
    } else if (err && err.message && err.message.includes('image files')) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
});

// ========== TEAM SERVICES MANAGEMENT ==========

// Get all services offered by a specific team member
app.get('/api/admin/team/:staffId/services', authenticateAdmin, async (req, res) => {
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

// Add a service to a team member's offerings
app.post('/api/admin/team/:staffId/services', authenticateAdmin, async (req, res) => {
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

// Batch add services to a team member (for adding entire categories at once)
app.post('/api/admin/team/:staffId/services/batch', authenticateAdmin, async (req, res) => {
    try {
        const { staffId } = req.params;
        const { serviceIds } = req.body;

        if (!serviceIds || !Array.isArray(serviceIds) || serviceIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Service IDs array is required' });
        }

        // Get existing services for this staff member
        const existingServices = await db.dbAll(
            'SELECT service_id FROM staff_services WHERE staff_id = ?',
            [staffId]
        );
        const existingIds = new Set(existingServices.map(s => s.service_id));

        // Filter to only add services not already assigned
        const newServiceIds = serviceIds.filter(id => !existingIds.has(id));

        if (newServiceIds.length === 0) {
            return res.json({ success: true, message: 'All services already added', added: 0, skipped: serviceIds.length });
        }

        // Add all new services in a transaction
        let added = 0;
        for (const serviceId of newServiceIds) {
            try {
                const id = uuidv4();
                await db.dbRun(`
                    INSERT INTO staff_services (id, staff_id, service_id, custom_price, custom_duration, active)
                    VALUES (?, ?, ?, NULL, NULL, 1)
                `, [id, staffId, serviceId]);
                added++;
            } catch (e) {
                // Skip duplicates silently
                if (!e.message.includes('UNIQUE constraint')) {
                    console.error('Error adding service:', serviceId, e);
                }
            }
        }

        res.json({
            success: true,
            message: `Added ${added} services`,
            added,
            skipped: serviceIds.length - added
        });
    } catch (error) {
        console.error('Error batch adding staff services:', error);
        res.status(500).json({ success: false, message: 'Failed to add services' });
    }
});

// Batch remove services from a team member (for removing entire categories at once)
app.delete('/api/admin/team/:staffId/services/batch', authenticateAdmin, async (req, res) => {
    try {
        const { staffId } = req.params;
        const { serviceIds } = req.body;

        if (!serviceIds || !Array.isArray(serviceIds) || serviceIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Service IDs array is required' });
        }

        // Remove all specified services
        const placeholders = serviceIds.map(() => '?').join(',');
        const result = await db.dbRun(
            `DELETE FROM staff_services WHERE staff_id = ? AND service_id IN (${placeholders})`,
            [staffId, ...serviceIds]
        );

        res.json({
            success: true,
            message: `Removed ${result.changes || serviceIds.length} services`,
            removed: result.changes || serviceIds.length
        });
    } catch (error) {
        console.error('Error batch removing staff services:', error);
        res.status(500).json({ success: false, message: 'Failed to remove services' });
    }
});

// Update a team member's service (custom pricing/duration)
app.put('/api/admin/team/:staffId/services/:serviceId', authenticateAdmin, async (req, res) => {
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

// Remove a service from a team member
app.delete('/api/admin/team/:staffId/services/:serviceId', authenticateAdmin, async (req, res) => {
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

// Get stylists who offer a specific service (client-facing)
app.get('/api/services/:serviceId/stylists', async (req, res) => {
    try {
        const { serviceId } = req.params;

        const query = `
            SELECT
                st.id,
                st.name,
                st.specialty,
                st.tagline,
                st.clients_count,
                st.years_experience,
                st.instagram,
                st.color,
                st.image_url,
                COALESCE(ss.custom_price, s.price) as service_price,
                COALESCE(ss.custom_duration, s.duration) as service_duration
            FROM staff_services ss
            JOIN stylists st ON ss.staff_id = st.id
            JOIN services s ON ss.service_id = s.id
            WHERE ss.service_id = ?
              AND ss.active = 1
              AND st.available = 1
            ORDER BY st.name
        `;

        const stylists = await db.dbAll(query, [serviceId]);

        res.json({ success: true, stylists });
    } catch (error) {
        console.error('Error fetching stylists for service:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stylists' });
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

        // Get invoices for the month (list() returns array directly)
        const monthInvoices = await InvoiceRepository.list({
            start_date: monthStart,
            end_date: today,
            limit: 1000
        });

        // Revenue this month from PAID INVOICES (primary source of service revenue)
        const invoiceRevenue = (monthInvoices || [])
            .filter(inv => inv.payment_status === 'paid')
            .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);

        // Revenue from product orders (secondary source)
        const orderRevenue = allOrders
            .filter(o => {
                if (o.status === 'cancelled') return false;
                const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
                return orderDate && orderDate >= monthStart && orderDate <= today;
            })
            .reduce((sum, o) => sum + (o.total || 0), 0);

        // Total monthly revenue = invoices + product orders
        const monthRevenue = invoiceRevenue + orderRevenue;

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
        const pendingBookings = allBookings.filter(b => b.status === 'REQUESTED').length;
        const pendingOrders = allOrders.filter(o => o.status === 'pending').length; // Orders use lowercase status

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

        // Get date range for invoices
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const endDate = now.toISOString().split('T')[0];

        // Get all paid invoices in the range (list() returns array directly)
        const paidInvoices = await InvoiceRepository.list({
            start_date: startDate,
            end_date: endDate,
            payment_status: 'paid',
            limit: 1000
        }) || [];

        // Build array of dates for the last N days
        const labels = [];
        const values = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            labels.push(dateStr);

            // Sum revenue for this day from INVOICES (service revenue)
            const dayInvoiceRevenue = paidInvoices
                .filter(inv => {
                    // Use service_date or created_at for matching
                    const invDate = inv.service_date || (inv.created_at ? inv.created_at.split('T')[0] : null);
                    return invDate === dateStr;
                })
                .reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);

            // Sum revenue for this day from orders (product revenue)
            const dayOrderRevenue = allOrders
                .filter(o => {
                    if (o.status === 'cancelled' || o.paymentStatus !== 'paid') return false;
                    const orderDate = o.createdAt ? o.createdAt.split('T')[0] : null;
                    return orderDate === dateStr;
                })
                .reduce((sum, o) => sum + (o.total || 0), 0);

            values.push(dayInvoiceRevenue + dayOrderRevenue);
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

        const now = new Date();
        let days = 30;
        if (range === '7d') days = 7;
        else if (range === '90d') days = 90;

        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const endDate = now.toISOString().split('T')[0];

        // Get service counts from invoice_services table (most accurate revenue source)
        const invoiceServiceCounts = await db.dbAll(`
            SELECT
                isv.service_name,
                COUNT(*) as count,
                SUM(isv.total) as revenue
            FROM invoice_services isv
            JOIN invoices i ON isv.invoice_id = i.id
            WHERE i.service_date >= ?
              AND i.service_date <= ?
              AND i.status != 'void'
            GROUP BY isv.service_name
            ORDER BY count DESC
            LIMIT 5
        `, [startDate, endDate]);

        // Fallback to bookings if no invoice data
        if (!invoiceServiceCounts || invoiceServiceCounts.length === 0) {
            const allBookings = await BookingRepository.findAll();

            const serviceCounts = {};
            allBookings.forEach(b => {
                const bookingDate = b.requestedDate || b.date;
                if (bookingDate >= startDate) {
                    const serviceName = b.serviceName || 'Unknown';
                    serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
                }
            });

            const sorted = Object.entries(serviceCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            const labels = sorted.map(s => s[0]);
            const values = sorted.map(s => s[1]);

            return res.json({ success: true, labels, values });
        }

        const labels = invoiceServiceCounts.map(s => s.service_name || 'Unknown');
        const values = invoiceServiceCounts.map(s => s.count);

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

// ============================================
// BUSINESS SETTINGS API
// ============================================

// Get business settings
app.get('/api/admin/business-settings', authenticateAdmin, async (req, res) => {
    try {
        let row = await db.dbGet('SELECT * FROM business_settings WHERE id = 1');
        if (!row) {
            // Create default if not exists
            await db.dbRun('INSERT OR IGNORE INTO business_settings (id) VALUES (1)');
            row = await db.dbGet('SELECT * FROM business_settings WHERE id = 1');
        }
        res.json({
            success: true,
            settings: {
                businessName: row.business_name,
                email: row.email,
                phone: row.phone,
                address: row.address,
                hours: JSON.parse(row.hours_json || '{}')
            }
        });
    } catch (error) {
        console.error('Error fetching business settings:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch business settings' });
    }
});

// Update business settings
app.put('/api/admin/business-settings', authenticateAdmin, async (req, res) => {
    try {
        const { businessName, email, phone, address, hours } = req.body;

        // Validate email format
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        const hoursJson = hours ? JSON.stringify(hours) : null;

        await db.dbRun(`
            UPDATE business_settings
            SET business_name = COALESCE(?, business_name),
                email = COALESCE(?, email),
                phone = COALESCE(?, phone),
                address = COALESCE(?, address),
                hours_json = COALESCE(?, hours_json),
                updated_at = datetime('now')
            WHERE id = 1
        `, [businessName, email, phone, address, hoursJson]);

        const updated = await db.dbGet('SELECT * FROM business_settings WHERE id = 1');
        res.json({
            success: true,
            message: 'Business settings updated successfully',
            settings: {
                businessName: updated.business_name,
                email: updated.email,
                phone: updated.phone,
                address: updated.address,
                hours: JSON.parse(updated.hours_json || '{}')
            }
        });
    } catch (error) {
        console.error('Error updating business settings:', error);
        res.status(500).json({ success: false, message: 'Failed to update business settings' });
    }
});

// ============================================
// DELIVERY CONFIG API
// ============================================

// Get delivery config
app.get('/api/admin/delivery-config', authenticateAdmin, async (req, res) => {
    try {
        let row = await db.dbGet('SELECT * FROM delivery_config WHERE id = 1');
        if (!row) {
            // Create default if not exists
            await db.dbRun('INSERT OR IGNORE INTO delivery_config (id) VALUES (1)');
            row = await db.dbGet('SELECT * FROM delivery_config WHERE id = 1');
        }
        res.json({
            success: true,
            config: {
                standardFee: row.standard_fee,
                expressFee: row.express_fee,
                freeThreshold: row.free_threshold
            }
        });
    } catch (error) {
        console.error('Error fetching delivery config:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch delivery config' });
    }
});

// Update delivery config
app.put('/api/admin/delivery-config', authenticateAdmin, async (req, res) => {
    try {
        const { standardFee, expressFee, freeThreshold } = req.body;

        // Validate numeric values
        if (standardFee !== undefined && (isNaN(standardFee) || standardFee < 0)) {
            return res.status(400).json({ success: false, message: 'Invalid standard fee' });
        }
        if (expressFee !== undefined && (isNaN(expressFee) || expressFee < 0)) {
            return res.status(400).json({ success: false, message: 'Invalid express fee' });
        }
        if (freeThreshold !== undefined && (isNaN(freeThreshold) || freeThreshold < 0)) {
            return res.status(400).json({ success: false, message: 'Invalid free threshold' });
        }

        await db.dbRun(`
            UPDATE delivery_config
            SET standard_fee = COALESCE(?, standard_fee),
                express_fee = COALESCE(?, express_fee),
                free_threshold = COALESCE(?, free_threshold),
                updated_at = datetime('now')
            WHERE id = 1
        `, [standardFee, expressFee, freeThreshold]);

        const updated = await db.dbGet('SELECT * FROM delivery_config WHERE id = 1');
        res.json({
            success: true,
            message: 'Delivery settings updated successfully',
            config: {
                standardFee: updated.standard_fee,
                expressFee: updated.express_fee,
                freeThreshold: updated.free_threshold
            }
        });
    } catch (error) {
        console.error('Error updating delivery config:', error);
        res.status(500).json({ success: false, message: 'Failed to update delivery config' });
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
        // Support both system and MySalonOnline statuses
        const validStatuses = [
            'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED',
            'No Status', 'To Be Confirmed', 'Online Booking', 'Paid',
            'New Extentions', 'New Extensions', 'Late', 'No Show'
        ];
        const matchedStatus = status ? validStatuses.find(s =>
            s.toUpperCase() === status.toUpperCase() || s === status
        ) : null;

        if (!matchedStatus) {
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
            status: matchedStatus,  // Use matched status to preserve proper casing
            updatedAt: new Date().toISOString()
        };

        // Add completion timestamp and snapshot commission if marking as completed
        if (matchedStatus === 'COMPLETED') {
            updateData.completedAt = new Date().toISOString();

            // Snapshot the commission amount at completion time
            // This prevents retroactive changes if service rates are modified later
            const VAT_RATE = 0.15;
            const priceExVat = (booking.service_price || 0) / (1 + VAT_RATE);

            // Priority: booking override > service rate > 0
            let effectiveRate;
            if (booking.commission_rate !== null && booking.commission_rate !== undefined) {
                effectiveRate = booking.commission_rate;
            } else {
                // Fetch service commission rate
                const service = await ServiceRepository.findById(booking.service_id);
                if (service && service.commission_rate !== null && service.commission_rate !== undefined) {
                    effectiveRate = service.commission_rate;
                } else {
                    effectiveRate = 0;
                }
            }

            // Store the snapshot - commission_rate used and calculated amount
            if (booking.commission_rate === null || booking.commission_rate === undefined) {
                updateData.commissionRate = effectiveRate;
            }
            updateData.commissionAmount = priceExVat * effectiveRate;
        }

        const updatedBooking = await BookingRepository.updateById(req.params.id, updateData);

        // Process rewards when booking is completed
        if (statusUpper === 'COMPLETED' && booking.user_id) {
            try {
                const user = await UserRepository.findById(booking.user_id);
                if (user) {
                    const rewardsResult = await RewardsService.processCompletedBooking(updatedBooking, user);
                    console.log('Rewards processed for completed booking:', rewardsResult);
                }
            } catch (rewardsError) {
                // Log but don't fail the booking completion
                console.error('Error processing rewards:', rewardsError);
            }
        }

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
        confirmedTime,
        commissionRate
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

        // Stylist - validate that stylist offers the service
        if (stylistId !== undefined) {
            if (stylistId) {
                // Get the service ID (either from this update or from existing booking)
                const effectiveServiceId = serviceId || booking.service_id;

                // Check if stylist offers this service
                const staffServiceRow = await db.dbGet(
                    'SELECT id FROM staff_services WHERE staff_id = ? AND service_id = ? AND active = 1',
                    [stylistId, effectiveServiceId]
                );

                if (!staffServiceRow) {
                    // Fetch stylist and service names for better error message
                    const stylist = await StylistRepository.findById(stylistId);
                    const service = await ServiceRepository.findById(effectiveServiceId);
                    return res.status(400).json({
                        success: false,
                        message: `${stylist?.name || 'This stylist'} does not offer ${service?.name || 'this service'}. Please assign a different stylist or update their service offerings first.`
                    });
                }
            }
            updates.stylist_id = stylistId || null;
        }

        // Status
        if (status) {
            // Support both system statuses (uppercase) and MySalonOnline statuses (mixed case)
            const validStatuses = [
                'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED',
                'No Status', 'To Be Confirmed', 'Online Booking', 'Paid',
                'New Extentions', 'New Extensions', 'Late', 'No Show'
            ];
            // Check if status matches any valid status (case-insensitive for system statuses)
            const matchedStatus = validStatuses.find(s =>
                s.toUpperCase() === status.toUpperCase() || s === status
            );
            if (!matchedStatus) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
                });
            }
            // Use the matched status to preserve proper casing for MySalonOnline statuses
            updates.status = matchedStatus;
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

        // Duration
        if (duration !== undefined) {
            updates.duration = duration;
        }

        // Commission rate override (null to use service/stylist default, or decimal like 0.30 for 30%)
        if (commissionRate !== undefined) {
            updates.commission_rate = commissionRate;
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

// ============================================
// BOOKING PAYMENT ENDPOINTS
// ============================================

// Initiate payment for a booking (client or admin-generated link)
app.post('/api/bookings/:id/payment/initiate', authenticateToken, async (req, res) => {
    try {
        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        // Allow if user owns the booking or is admin
        if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        if (booking.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Booking already paid' });
        }

        const customer = await UserRepository.findById(booking.user_id);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const configStatus = PaymentService.getPaymentConfigStatus();
        if (!configStatus.payfast.configured) {
            return res.status(400).json({ success: false, message: 'PayFast is not configured' });
        }

        // Create payment for booking with proper item name
        const paymentAmount = booking.service_price;
        const serviceName = booking.service_name || 'Hair Service';
        const paymentInit = await PaymentService.initializePayment(
            'payfast',
            {
                id: `booking_${booking.id}`,
                total: paymentAmount,
                items: [{ name: serviceName, quantity: 1, price: paymentAmount }]
            },
            { id: customer.id, name: customer.name || customer.email, email: customer.email },
            {
                itemName: `${serviceName} - Flirt Hair & Beauty`,
                itemDescription: `Booking at Flirt Hair & Beauty`
            }
        );

        // Create payment transaction record
        await PaymentRepository.create({
            id: paymentInit.paymentId,
            bookingId: booking.id,
            userId: customer.id,
            amount: paymentAmount,
            currency: 'ZAR',
            provider: 'payfast',
            status: 'pending',
            metadata: { providerResponse: paymentInit }
        });

        // Update booking payment status to pending
        await BookingRepository.update(booking.id, {
            paymentStatus: 'pending',
            paymentAmount: paymentAmount
        });

        // Generate the payUrl (landing page that auto-submits the form)
        const config = PaymentService.getEffectiveConfig();
        const payUrl = `${config.apiBaseUrl}/pay/${paymentInit.paymentId}`;

        console.log(`💳 Payment initiated for booking ${booking.id}: R${paymentAmount}`);

        res.json({
            success: true,
            payment: { ...paymentInit, payUrl },
            message: 'Payment link generated'
        });
    } catch (error) {
        console.error('Booking payment initiation error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to initiate payment' });
    }
});

// Record manual payment for a booking (admin only)
app.post('/api/admin/bookings/:id/payment/record', authenticateAdmin, async (req, res) => {
    try {
        const { method, amount, reference, notes } = req.body;

        if (!method || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Payment method and amount are required'
            });
        }

        const validMethods = ['cash', 'card_on_site', 'eft', 'payfast'];
        if (!validMethods.includes(method)) {
            return res.status(400).json({
                success: false,
                message: `Invalid payment method. Must be one of: ${validMethods.join(', ')}`
            });
        }

        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (booking.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Booking already paid' });
        }

        // Record the payment
        const updatedBooking = await BookingRepository.recordPayment(req.params.id, {
            status: 'paid',
            method,
            amount: parseFloat(amount),
            reference: reference || null,
            date: new Date().toISOString()
        });

        // Create payment transaction record for tracking
        const paymentId = require('uuid').v4();
        await PaymentRepository.create({
            id: paymentId,
            bookingId: booking.id,
            userId: booking.user_id,
            amount: parseFloat(amount),
            currency: 'ZAR',
            provider: method,
            providerTransactionId: reference || null,
            status: 'completed',
            metadata: { recordedBy: req.user.id, notes }
        });

        // Update notes if provided
        if (notes) {
            const existingNotes = booking.notes || '';
            const paymentNote = `[${new Date().toLocaleDateString()}] Payment recorded: R${amount} (${method})${reference ? ` - Ref: ${reference}` : ''}`;
            await BookingRepository.update(req.params.id, {
                notes: existingNotes ? `${existingNotes}\n${paymentNote}` : paymentNote
            });
        }

        console.log(`💵 Manual payment recorded for booking ${req.params.id}: R${amount} (${method})`);

        res.json({
            success: true,
            booking: mapBookingResponse(updatedBooking),
            message: `Payment of R${amount} recorded successfully`
        });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to record payment' });
    }
});

// Send payment link to customer (admin only)
app.post('/api/admin/bookings/:id/payment/send-link', authenticateAdmin, async (req, res) => {
    try {
        const { sendMethod = 'email' } = req.body; // 'email', 'sms', or 'both'

        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (booking.status !== 'CONFIRMED') {
            return res.status(400).json({
                success: false,
                message: 'Can only send payment links for confirmed bookings'
            });
        }

        if (booking.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Booking already paid' });
        }

        const customer = await UserRepository.findById(booking.user_id);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const configStatus = PaymentService.getPaymentConfigStatus();
        if (!configStatus.payfast.configured) {
            return res.status(400).json({ success: false, message: 'PayFast is not configured' });
        }

        // Generate payment link with proper item name
        const paymentAmount = booking.service_price;
        const serviceName = booking.service_name || 'Hair Service';
        const paymentInit = await PaymentService.initializePayment(
            'payfast',
            {
                id: `booking_${booking.id}`,
                total: paymentAmount,
                items: [{ name: serviceName, quantity: 1, price: paymentAmount }]
            },
            { id: customer.id, name: customer.name || customer.email, email: customer.email },
            {
                itemName: `${serviceName} - Flirt Hair & Beauty`,
                itemDescription: `Booking at Flirt Hair & Beauty`
            }
        );

        // Create payment transaction record
        await PaymentRepository.create({
            id: paymentInit.paymentId,
            bookingId: booking.id,
            userId: customer.id,
            amount: paymentAmount,
            currency: 'ZAR',
            provider: 'payfast',
            status: 'pending',
            metadata: { providerResponse: paymentInit, sentBy: req.user.id }
        });

        // Update booking payment status
        await BookingRepository.update(booking.id, {
            paymentStatus: 'pending',
            paymentAmount: paymentAmount
        });

        // Generate the payUrl (landing page that auto-submits the form)
        const config = PaymentService.getEffectiveConfig();
        const payUrl = `${config.apiBaseUrl}/pay/${paymentInit.paymentId}`;

        // Send payment link via email using the payUrl
        if (sendMethod === 'email' || sendMethod === 'both') {
            if (customer.email) {
                try {
                    await emailService.sendPaymentLink(booking, customer, payUrl);
                    console.log(`📧 Payment link sent to ${customer.email}`);
                } catch (emailError) {
                    console.error('Failed to send payment email:', emailError.message);
                }
            }
        }

        console.log(`💳 Payment link generated for booking ${booking.id} and sent to customer`);

        res.json({
            success: true,
            payment: { ...paymentInit, payUrl },
            customer: { name: customer.name, email: customer.email, phone: customer.phone },
            message: `Payment link ${sendMethod === 'email' ? 'sent' : 'generated'} successfully`
        });
    } catch (error) {
        console.error('Send payment link error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to send payment link' });
    }
});

// Get payment status for a booking
app.get('/api/bookings/:id/payment', authenticateToken, async (req, res) => {
    try {
        const booking = await BookingRepository.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        // Allow if user owns the booking or is admin
        if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        // Get payment transactions for this booking
        const payments = await PaymentRepository.findByBookingId(booking.id);

        res.json({
            success: true,
            paymentStatus: booking.payment_status || 'unpaid',
            paymentMethod: booking.payment_method,
            paymentAmount: booking.payment_amount,
            paymentDate: booking.payment_date,
            paymentReference: booking.payment_reference,
            transactions: payments
        });
    } catch (error) {
        console.error('Get booking payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payment status' });
    }
});

// Webhook handler for booking payments (PayFast ITN - extended)
// This is handled by existing webhook but we need to also check for booking payments
// (The existing webhook at /api/payments/webhook/payfast handles this via the payment transaction record)

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

// Get single order detail (admin)
app.get('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
    try {
        const order = await OrderRepository.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        // Add customer info
        const user = await UserRepository.findById(order.userId || order.user_id);
        const orderWithCustomer = {
            ...order,
            customerName: user ? user.name : 'Unknown',
            customerPhone: user ? user.phone : null,
            customerEmail: user ? user.email : null
        };
        res.json({ success: true, order: orderWithCustomer });
    } catch (error) {
        console.error('Database error fetching order:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch order' });
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

        const updatedOrder = await OrderRepository.updateStatus(req.params.id, status);

        res.json({ success: true, order: updatedOrder });
    } catch (error) {
        console.error('Database error updating order status:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// ============================================
// PAYROLL ROUTES (Admin)
// ============================================

// Get payroll summary for a period
app.get('/api/admin/payroll', authenticateAdmin, async (req, res) => {
    try {
        const { year, month, status } = req.query;
        const filters = {};
        if (year) filters.year = parseInt(year);
        if (month) filters.month = parseInt(month);
        if (status) filters.status = status;

        const records = await PayrollRepository.findAll(filters);

        // Enrich with stylist names
        const enrichedRecords = await Promise.all(records.map(async (r) => {
            const stylist = await StylistRepository.findById(r.stylist_id);
            return {
                ...r,
                stylistName: stylist ? stylist.name : 'Unknown'
            };
        }));

        res.json({ success: true, records: enrichedRecords });
    } catch (error) {
        console.error('Error fetching payroll records:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch payroll records' });
    }
});

// Get period summary (all stylists for a month)
app.get('/api/admin/payroll/summary', authenticateAdmin, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;

        const summary = await PayrollRepository.getPeriodSummary(year, month);
        res.json({ success: true, summary });
    } catch (error) {
        console.error('Error fetching payroll summary:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch payroll summary' });
    }
});

// Calculate payroll for a stylist (preview without saving)
app.get('/api/admin/payroll/calculate/:stylistId', authenticateAdmin, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;

        const calculation = await PayrollRepository.calculatePayroll(req.params.stylistId, year, month);
        res.json({ success: true, calculation });
    } catch (error) {
        console.error('Error calculating payroll:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to calculate payroll' });
    }
});

// Calculate and save payroll for all stylists for a period
app.post('/api/admin/payroll/generate', authenticateAdmin, async (req, res) => {
    try {
        const { year, month } = req.body;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'Year and month are required' });
        }

        const stylists = await StylistRepository.findAll();
        const results = [];

        for (const stylist of stylists) {
            try {
                const calculation = await PayrollRepository.calculatePayroll(stylist.id, year, month);
                const record = await PayrollRepository.upsert(calculation);
                results.push({
                    stylistId: stylist.id,
                    stylistName: stylist.name,
                    success: true,
                    record
                });
            } catch (err) {
                results.push({
                    stylistId: stylist.id,
                    stylistName: stylist.name,
                    success: false,
                    error: err.message
                });
            }
        }

        res.json({ success: true, results });
    } catch (error) {
        console.error('Error generating payroll:', error.message);
        res.status(500).json({ success: false, message: 'Failed to generate payroll' });
    }
});

// Export payroll to CSV
// NOTE: This route MUST be defined before /api/admin/payroll/:id to avoid route conflicts
app.get('/api/admin/payroll/export/csv', authenticateAdmin, async (req, res) => {
    try {
        const { year, month } = req.query;
        const filters = {};
        if (year) filters.year = parseInt(year);
        if (month) filters.month = parseInt(month);

        const records = await PayrollRepository.findAll(filters);

        // Build CSV with proper escaping
        const headers = [
            'Stylist',
            'Period',
            'Basic Pay',
            'Commission Rate',
            'Bookings',
            'Service Revenue (incl VAT)',
            'Service Revenue (excl VAT)',
            'Commission',
            'Gross Pay',
            'Status',
            'Finalized At',
            'Paid At'
        ];

        // Helper to escape CSV values (handle quotes and nulls)
        const escapeCSV = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            // Escape double quotes by doubling them
            return `"${str.replace(/"/g, '""')}"`;
        };

        const rows = await Promise.all(records.map(async (r) => {
            const stylist = await StylistRepository.findById(r.stylist_id);
            return [
                stylist ? stylist.name : 'Unknown',
                `${r.period_year}-${String(r.period_month).padStart(2, '0')}`,
                (r.basic_pay || 0).toFixed(2),
                ((r.commission_rate || 0) * 100).toFixed(1) + '%',
                r.total_bookings || 0,
                (r.total_service_revenue || 0).toFixed(2),
                (r.total_service_revenue_ex_vat || 0).toFixed(2),
                (r.commission_amount || 0).toFixed(2),
                (r.gross_pay || 0).toFixed(2),
                r.status || '',
                r.finalized_at || '',
                r.paid_at || ''
            ];
        }));

        const csv = [
            headers.map(h => escapeCSV(h)).join(','),
            ...rows.map(row => row.map(cell => escapeCSV(cell)).join(','))
        ].join('\n');

        const filename = year && month
            ? `payroll_${year}_${String(month).padStart(2, '0')}.csv`
            : `payroll_all.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting payroll:', error.message);
        res.status(500).json({ success: false, message: 'Failed to export payroll' });
    }
});

// Get single payroll record
app.get('/api/admin/payroll/:id', authenticateAdmin, async (req, res) => {
    try {
        const record = await PayrollRepository.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ success: false, message: 'Payroll record not found' });
        }

        const stylist = await StylistRepository.findById(record.stylist_id);
        res.json({
            success: true,
            record: {
                ...record,
                stylistName: stylist ? stylist.name : 'Unknown'
            }
        });
    } catch (error) {
        console.error('Error fetching payroll record:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch payroll record' });
    }
});

// Recalculate a payroll record
app.post('/api/admin/payroll/:id/recalculate', authenticateAdmin, async (req, res) => {
    try {
        const record = await PayrollRepository.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ success: false, message: 'Payroll record not found' });
        }
        if (record.status === 'paid') {
            return res.status(400).json({ success: false, message: 'Cannot recalculate a paid record' });
        }

        const calculation = await PayrollRepository.calculatePayroll(
            record.stylist_id,
            record.period_year,
            record.period_month
        );
        const updated = await PayrollRepository.upsert(calculation);

        const stylist = await StylistRepository.findById(record.stylist_id);
        res.json({
            success: true,
            record: {
                ...updated,
                stylistName: stylist ? stylist.name : 'Unknown'
            }
        });
    } catch (error) {
        console.error('Error recalculating payroll:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to recalculate payroll' });
    }
});

// Finalize payroll record
app.post('/api/admin/payroll/:id/finalize', authenticateAdmin, async (req, res) => {
    try {
        const record = await PayrollRepository.finalize(req.params.id);
        const stylist = await StylistRepository.findById(record.stylist_id);
        res.json({
            success: true,
            record: {
                ...record,
                stylistName: stylist ? stylist.name : 'Unknown'
            }
        });
    } catch (error) {
        console.error('Error finalizing payroll:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to finalize payroll' });
    }
});

// Mark payroll as paid
app.post('/api/admin/payroll/:id/pay', authenticateAdmin, async (req, res) => {
    try {
        const { notes } = req.body;
        const record = await PayrollRepository.markAsPaid(req.params.id, notes);
        const stylist = await StylistRepository.findById(record.stylist_id);
        res.json({
            success: true,
            record: {
                ...record,
                stylistName: stylist ? stylist.name : 'Unknown'
            }
        });
    } catch (error) {
        console.error('Error marking payroll as paid:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to mark payroll as paid' });
    }
});

// Delete payroll record
app.delete('/api/admin/payroll/:id', authenticateAdmin, async (req, res) => {
    try {
        await PayrollRepository.delete(req.params.id);
        res.json({ success: true, message: 'Payroll record deleted' });
    } catch (error) {
        console.error('Error deleting payroll:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to delete payroll' });
    }
});

// Update stylist pay settings
app.patch('/api/admin/stylists/:id/pay', authenticateAdmin, async (req, res) => {
    try {
        const { basicMonthlyPay, commissionRate } = req.body;
        const stylist = await StylistRepository.findById(req.params.id);

        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Stylist not found' });
        }

        // Update stylist with new pay settings
        const updates = {};
        if (basicMonthlyPay !== undefined) updates.basic_monthly_pay = basicMonthlyPay;
        if (commissionRate !== undefined) updates.commission_rate = commissionRate;

        await db.dbRun(`
            UPDATE stylists SET
                basic_monthly_pay = COALESCE(?, basic_monthly_pay),
                commission_rate = COALESCE(?, commission_rate)
            WHERE id = ?
        `, [updates.basic_monthly_pay, updates.commission_rate, req.params.id]);

        const updated = await StylistRepository.findById(req.params.id);
        res.json({ success: true, stylist: updated });
    } catch (error) {
        console.error('Error updating stylist pay:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update stylist pay settings' });
    }
});

// Get all customers (admin)
app.get('/api/admin/customers', authenticateAdmin, async (req, res) => {
    try {
        const { search, limit } = req.query;
        const allUsers = await UserRepository.findAll();
        const allBookings = (await BookingRepository.findAll()).map(mapBookingResponse);
        const allOrders = await OrderRepository.findAll();

        let customers = allUsers
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

        // Apply search filter if provided
        if (search) {
            const searchLower = search.toLowerCase();
            customers = customers.filter(c =>
                (c.name && c.name.toLowerCase().includes(searchLower)) ||
                (c.email && c.email.toLowerCase().includes(searchLower)) ||
                (c.phone && c.phone.includes(search))
            );
        }

        // Apply limit if provided
        if (limit) {
            customers = customers.slice(0, parseInt(limit));
        }

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

// Reset customer password (admin) - generates a new password and optionally sends email
app.post('/api/admin/customers/:id/reset-password', authenticateAdmin, async (req, res) => {
    try {
        const { sendEmail: shouldSendEmail = true, newPassword } = req.body;

        const user = await UserRepository.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        // Generate or use provided password
        const password = newPassword || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4).toUpperCase();
        const passwordHash = await bcrypt.hash(password, 10);

        await UserRepository.update(user.id, {
            passwordHash,
            mustChangePassword: true
        });

        // Optionally send email with new password
        if (shouldSendEmail && user.email) {
            try {
                await emailService.sendEmail({
                    to: user.email,
                    subject: 'Your Flirt Hair Password Has Been Reset',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background: linear-gradient(135deg, #414042 0%, #2d2d2e 100%); padding: 30px; text-align: center;">
                                <h1 style="color: #F67599; margin: 0; font-size: 28px;">FL!RT</h1>
                                <p style="color: #fff; margin: 5px 0 0;">Hair & Beauty Bar</p>
                            </div>
                            <div style="padding: 30px; background: #f8f8f8;">
                                <h2 style="color: #414042; margin-bottom: 20px;">Password Reset</h2>
                                <p style="color: #666; line-height: 1.6;">Hi ${user.name},</p>
                                <p style="color: #666; line-height: 1.6;">Your password has been reset by our team. Here are your new login credentials:</p>
                                <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #F67599;">
                                    <p style="margin: 5px 0;"><strong>Email:</strong> ${user.email}</p>
                                    <p style="margin: 5px 0;"><strong>Temporary Password:</strong> ${password}</p>
                                </div>
                                <p style="color: #666; line-height: 1.6;">Please log in and change your password immediately.</p>
                                <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                                <p style="color: #999; font-size: 12px; text-align: center;">Flirt Hair & Beauty Bar</p>
                            </div>
                        </div>
                    `
                });
                console.log(`Password reset email sent to: ${user.email}`);
            } catch (emailError) {
                console.error('Failed to send password reset email:', emailError.message);
            }
        }

        res.json({
            success: true,
            message: 'Password has been reset',
            temporaryPassword: password,
            emailSent: shouldSendEmail
        });

    } catch (error) {
        console.error('Error resetting customer password:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get comprehensive customer profile with all related data
app.get('/api/admin/customers/:id/profile', authenticateAdmin, async (req, res) => {
    try {
        const customerId = req.params.id;
        console.log('Fetching profile for customer:', customerId);

        // Get customer basic info
        const customer = await UserRepository.findById(customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        console.log('Found customer:', customer.name);

        // Get all bookings for this customer
        let bookings = [];
        try {
            const allBookings = await BookingRepository.findAll();
            bookings = allBookings
                .filter(b => (b.userId || b.user_id) === customerId)
                .map(mapBookingResponse)
                .sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (e) {
            console.log('Error fetching bookings:', e.message);
        }

        // Get all orders for this customer
        let orders = [];
        let ordersWithItems = [];
        try {
            const allOrders = await OrderRepository.findAll();
            orders = allOrders
                .filter(o => (o.userId || o.user_id) === customerId)
                .sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at));

            // Get order items for each order
            ordersWithItems = await Promise.all(orders.map(async (order) => {
                try {
                    const items = await db.dbAll(
                        'SELECT oi.*, p.name as product_name, p.image_url FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
                        [order.id]
                    );
                    return { ...order, items: items || [] };
                } catch (e) {
                    return { ...order, items: [] };
                }
            }));
        } catch (e) {
            console.log('Error fetching orders:', e.message);
        }

        // Get all invoices for this customer
        let invoices = [];
        let invoicesWithItems = [];
        try {
            invoices = await db.dbAll(`
                SELECT i.*,
                       (SELECT SUM(total_price) FROM invoice_items WHERE invoice_id = i.id) as calculated_total
                FROM invoices i
                WHERE i.customer_id = ?
                ORDER BY i.created_at DESC
            `, [customerId]) || [];

            // Get invoice items for each invoice
            invoicesWithItems = await Promise.all(invoices.map(async (invoice) => {
                try {
                    const items = await db.dbAll(
                        'SELECT * FROM invoice_items WHERE invoice_id = ?',
                        [invoice.id]
                    );
                    return { ...invoice, items: items || [] };
                } catch (e) {
                    return { ...invoice, items: [] };
                }
            }));
        } catch (e) {
            console.log('Error fetching invoices:', e.message);
        }

        // Get loyalty transactions
        let loyaltyTransactions = [];
        try {
            loyaltyTransactions = await LoyaltyRepository.getTransactionsByUser(customerId) || [];
        } catch (e) {
            console.log('Error fetching loyalty transactions:', e.message);
        }

        // Get referrals made by this customer
        let referralsMade = [];
        try {
            referralsMade = await db.dbAll(`
                SELECT r.*, u.name as referee_name, u.email as referee_email
                FROM referrals r
                LEFT JOIN users u ON r.referee_id = u.id
                WHERE r.referrer_id = ?
                ORDER BY r.created_at DESC
            `, [customerId]) || [];
        } catch (e) {
            console.log('Error fetching referrals made:', e.message);
        }

        // Get if this customer was referred by someone
        let referredBy = null;
        try {
            referredBy = await db.dbGet(`
                SELECT r.*, u.name as referrer_name, u.email as referrer_email
                FROM referrals r
                LEFT JOIN users u ON r.referrer_id = u.id
                WHERE r.referee_id = ?
            `, [customerId]);
        } catch (e) {
            console.log('Error fetching referred by:', e.message);
        }

        // Get inspo photos (table is named user_inspo_photos)
        let inspoPhotos = [];
        try {
            inspoPhotos = await db.dbAll(
                'SELECT id, label, notes, created_at FROM user_inspo_photos WHERE user_id = ? ORDER BY created_at DESC',
                [customerId]
            ) || [];
        } catch (e) {
            console.log('No inspo photos table or error:', e.message);
        }

        // Get rewards/redemptions (may not exist)
        let redemptions = [];
        try {
            redemptions = await db.dbAll(
                'SELECT * FROM reward_redemptions WHERE user_id = ? ORDER BY redeemed_at DESC',
                [customerId]
            ) || [];
        } catch (e) {
            console.log('No redemptions table or error:', e.message);
        }

        // Calculate summary stats
        const totalSpent = ordersWithItems.reduce((sum, o) => sum + (o.total || 0), 0) +
                          invoicesWithItems.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.total || i.calculated_total || 0), 0);

        const totalBookings = bookings.length;
        const completedBookings = bookings.filter(b => b.status === 'completed').length;
        const upcomingBookings = bookings.filter(b => ['confirmed', 'pending'].includes(b.status) && new Date(b.date) >= new Date()).length;

        const lastVisit = bookings.find(b => b.status === 'completed')?.date || null;

        // Get loyalty settings for tier calculation
        let loyaltySettings = {};
        try {
            loyaltySettings = await LoyaltyRepository.getSettings() || {};
        } catch (e) {
            console.log('Error fetching loyalty settings:', e.message);
        }

        console.log('Profile data collected, sending response');

        res.json({
            success: true,
            profile: {
                // Basic info
                id: customer.id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                tier: customer.tier,
                points: customer.points,
                createdAt: customer.createdAt,

                // Summary stats
                stats: {
                    totalSpent,
                    totalBookings,
                    completedBookings,
                    upcomingBookings,
                    totalOrders: orders.length,
                    totalInvoices: invoices.length,
                    lastVisit,
                    memberSince: customer.createdAt,
                    inspoPhotosCount: inspoPhotos.length,
                    referralsMadeCount: referralsMade.length,
                    pointsEarned: loyaltyTransactions.filter(t => t.points > 0).reduce((sum, t) => sum + t.points, 0),
                    pointsRedeemed: Math.abs(loyaltyTransactions.filter(t => t.points < 0).reduce((sum, t) => sum + t.points, 0))
                },

                // Detailed data
                bookings,
                orders: ordersWithItems,
                invoices: invoicesWithItems,
                loyaltyTransactions,
                referralsMade,
                referredBy,
                inspoPhotos,
                redemptions,
                loyaltySettings
            }
        });

    } catch (error) {
        console.error('Error fetching customer profile:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customer profile' });
    }
});

// Team management (stylists) - separate from staff accounts
app.get('/api/admin/team', authenticateAdmin, async (req, res) => {
    try {
        await seedStylistsDefaults();
        const stylists = await StylistRepository.findAll();
        res.json({ success: true, team: stylists });
    } catch (error) {
        console.error('Database error in admin team:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.post('/api/admin/team', authenticateAdmin, async (req, res) => {
    try {
        const { name, specialty, tagline, instagram, color, yearsExperience, imageUrl } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        const newStylist = {
            id: name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now(),
            name,
            specialty: specialty || 'Stylist',
            tagline: tagline || '',
            clientsCount: 0,
            yearsExperience: yearsExperience || 0,
            instagram: instagram || '',
            color: color || '#FF6B9D',
            available: true,
            imageUrl: imageUrl || 'https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=400'
        };

        const createdStylist = await StylistRepository.create(newStylist);

        res.status(201).json({ success: true, team: createdStylist, id: createdStylist.id });
    } catch (error) {
        console.error('Database error creating team member:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.patch('/api/admin/team/:id', authenticateAdmin, async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }

        const allowedUpdates = ['name', 'specialty', 'tagline', 'instagram', 'color', 'available', 'imageUrl', 'yearsExperience'];
        const updateData = {};
        for (const key of allowedUpdates) {
            if (req.body[key] !== undefined) {
                updateData[key] = req.body[key];
            }
        }

        const updatedStylist = await StylistRepository.update(req.params.id, updateData);

        res.json({ success: true, team: updatedStylist });
    } catch (error) {
        console.error('Database error updating team member:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

app.delete('/api/admin/team/:id', authenticateAdmin, async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }

        await StylistRepository.delete(req.params.id);

        res.json({ success: true, message: 'Team member deleted' });
    } catch (error) {
        console.error('Database error deleting team member:', error.message);
        return res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Archive team member (soft delete)
app.patch('/api/admin/team/:id/archive', authenticateAdmin, async (req, res) => {
    try {
        const stylist = await StylistRepository.findById(req.params.id);
        if (!stylist) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }

        await StylistRepository.archive(req.params.id);
        const updated = await StylistRepository.findById(req.params.id);

        res.json({ success: true, team: updated, message: 'Team member archived' });
    } catch (error) {
        console.error('Database error archiving team member:', error.message);
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
// ADMIN REWARDS PROGRAMME SETTINGS
// ============================================

// Get rewards programme configuration (admin)
app.get('/api/admin/rewards/config', authenticateAdmin, async (req, res) => {
    try {
        const config = await RewardsConfigRepository.get();
        res.json({ success: true, config });
    } catch (error) {
        console.error('Error fetching rewards config:', error);
        res.status(500).json({ success: false, message: 'Failed to load rewards settings' });
    }
});

// Update rewards programme configuration (admin)
app.put('/api/admin/rewards/config', authenticateAdmin, async (req, res) => {
    try {
        const updates = req.body;

        // Validate numeric fields
        const numericFields = [
            'nails_milestone_1_count', 'nails_milestone_1_discount',
            'nails_milestone_2_count', 'nails_milestone_2_discount',
            'nails_reward_expiry_days', 'maintenance_milestone_count',
            'maintenance_discount', 'maintenance_reward_expiry_days',
            'spend_threshold', 'spend_discount', 'spend_reward_expiry_days',
            'referral_min_booking_value', 'wash_blowdry_package_sessions',
            'wash_blowdry_package_discount'
        ];

        for (const field of numericFields) {
            if (updates[field] !== undefined && (isNaN(updates[field]) || updates[field] < 0)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid value for ${field}`
                });
            }
        }

        await RewardsConfigRepository.update(updates);
        const config = await RewardsConfigRepository.get();

        res.json({
            success: true,
            message: 'Rewards settings updated successfully',
            config
        });
    } catch (error) {
        console.error('Error updating rewards config:', error);
        res.status(500).json({ success: false, message: 'Failed to update rewards settings' });
    }
});

// Get all user rewards (admin view)
app.get('/api/admin/rewards', authenticateAdmin, async (req, res) => {
    try {
        const { status, userId, trackType, limit = 100, offset = 0 } = req.query;

        let query = `
            SELECT ur.*, u.name as user_name, u.email as user_email
            FROM user_rewards ur
            LEFT JOIN users u ON ur.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND ur.status = ?';
            params.push(status);
        }
        if (userId) {
            query += ' AND ur.user_id = ?';
            params.push(userId);
        }
        if (trackType) {
            query += ' AND ur.track_type = ?';
            params.push(trackType);
        }

        query += ' ORDER BY ur.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const rewards = await db.dbAll(query, params);

        // Get count
        let countQuery = `SELECT COUNT(*) as total FROM user_rewards ur WHERE 1=1`;
        const countParams = [];
        if (status) {
            countQuery += ' AND ur.status = ?';
            countParams.push(status);
        }
        if (userId) {
            countQuery += ' AND ur.user_id = ?';
            countParams.push(userId);
        }
        if (trackType) {
            countQuery += ' AND ur.track_type = ?';
            countParams.push(trackType);
        }

        const countResult = await db.dbGet(countQuery, countParams);

        res.json({
            success: true,
            rewards,
            total: countResult.total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error fetching rewards:', error);
        res.status(500).json({ success: false, message: 'Failed to load rewards' });
    }
});

// Manually issue a reward to user (admin)
app.post('/api/admin/rewards', authenticateAdmin, async (req, res) => {
    try {
        const { userId, trackType, rewardType, value, description, expiryDays = 90 } = req.body;

        if (!userId || !trackType || !rewardType || !description) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: userId, trackType, rewardType, description'
            });
        }

        // Verify user exists
        const user = await UserRepository.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const reward = await RewardsService.issueReward(
            userId,
            trackType,
            rewardType,
            value,
            expiryDays,
            description
        );

        res.json({
            success: true,
            message: 'Reward issued successfully',
            reward
        });
    } catch (error) {
        console.error('Error issuing reward:', error);
        res.status(500).json({ success: false, message: 'Failed to issue reward' });
    }
});

// Revoke/cancel a reward (admin)
app.delete('/api/admin/rewards/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const reward = await UserRewardRepository.findById(id);
        if (!reward) {
            return res.status(404).json({ success: false, message: 'Reward not found' });
        }

        if (reward.status === 'redeemed') {
            return res.status(400).json({
                success: false,
                message: 'Cannot revoke a redeemed reward'
            });
        }

        await UserRewardRepository.updateStatus(id, 'revoked');

        res.json({
            success: true,
            message: 'Reward revoked successfully'
        });
    } catch (error) {
        console.error('Error revoking reward:', error);
        res.status(500).json({ success: false, message: 'Failed to revoke reward' });
    }
});

// Get reward tracks summary (admin analytics)
app.get('/api/admin/rewards/analytics', authenticateAdmin, async (req, res) => {
    try {
        // Get reward statistics
        const stats = await db.dbGet(`
            SELECT
                COUNT(*) as total_rewards,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_rewards,
                SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) as redeemed_rewards,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_rewards,
                COUNT(DISTINCT user_id) as users_with_rewards
            FROM user_rewards
        `);

        // Get rewards by track type
        const byTrackType = await db.dbAll(`
            SELECT source_track as track_type, COUNT(*) as count,
                SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) as redeemed
            FROM user_rewards
            GROUP BY source_track
        `);

        // Get recent rewards
        const recentRewards = await db.dbAll(`
            SELECT ur.*, u.name as user_name
            FROM user_rewards ur
            LEFT JOIN users u ON ur.user_id = u.id
            ORDER BY ur.created_at DESC
            LIMIT 10
        `);

        // Get package stats
        const packageStats = await db.dbGet(`
            SELECT
                COUNT(*) as total_packages,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_packages,
                SUM(sessions_used) as total_sessions_used,
                SUM(total_sessions) as total_sessions_sold
            FROM user_packages
        `);

        res.json({
            success: true,
            stats,
            byTrackType,
            recentRewards,
            packageStats
        });
    } catch (error) {
        console.error('Error fetching rewards analytics:', error);
        res.status(500).json({ success: false, message: 'Failed to load analytics' });
    }
});

// Get user's reward tracks (admin view)
app.get('/api/admin/rewards/user/:userId', authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await UserRepository.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const progress = await RewardsService.getUserProgress(userId);
        const rewardHistory = await db.dbAll(`
            SELECT * FROM user_rewards
            WHERE user_id = ?
            ORDER BY created_at DESC
        `, [userId]);

        res.json({
            success: true,
            user: { id: user.id, name: user.name, email: user.email },
            progress,
            rewardHistory
        });
    } catch (error) {
        console.error('Error fetching user rewards:', error);
        res.status(500).json({ success: false, message: 'Failed to load user rewards' });
    }
});

// ============================================
// ADMIN REWARD TRACK DEFINITIONS
// Manage configurable reward tracks
// ============================================

// Get all reward track definitions (admin gets all including inactive)
app.get('/api/admin/reward-track-definitions', authenticateAdmin, async (req, res) => {
    try {
        // Admin gets all tracks including inactive ones
        const tracks = await RewardTrackDefinitionRepository.findAll(true);
        res.json({ success: true, tracks });
    } catch (error) {
        console.error('Error fetching reward track definitions:', error);
        res.status(500).json({ success: false, message: 'Failed to load reward track definitions' });
    }
});

// Get a single reward track definition
app.get('/api/admin/reward-track-definitions/:id', authenticateAdmin, async (req, res) => {
    try {
        const track = await RewardTrackDefinitionRepository.findById(req.params.id);
        if (!track) {
            return res.status(404).json({ success: false, message: 'Track not found' });
        }
        res.json({ success: true, track });
    } catch (error) {
        console.error('Error fetching reward track definition:', error);
        res.status(500).json({ success: false, message: 'Failed to load track' });
    }
});

// Create a new reward track definition
app.post('/api/admin/reward-track-definitions', authenticateAdmin, async (req, res) => {
    try {
        const { name, display_name, description, track_type, icon, milestones, reward_expiry_days, reward_applicable_to } = req.body;

        if (!name || !display_name || !track_type) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: name, display_name, track_type'
            });
        }

        if (!['visit_count', 'spend_amount'].includes(track_type)) {
            return res.status(400).json({
                success: false,
                message: 'track_type must be "visit_count" or "spend_amount"'
            });
        }

        const track = await RewardTrackDefinitionRepository.create({
            name,
            display_name,
            description,
            track_type,
            icon: icon || '🎁',
            milestones: milestones || [],
            reward_expiry_days: reward_expiry_days || 90,
            reward_applicable_to
        });

        res.json({ success: true, message: 'Track created successfully', track });
    } catch (error) {
        console.error('Error creating reward track definition:', error);
        if (error.message?.includes('UNIQUE constraint')) {
            return res.status(400).json({ success: false, message: 'A track with this name already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to create track' });
    }
});

// Update a reward track definition
app.put('/api/admin/reward-track-definitions/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const existing = await RewardTrackDefinitionRepository.findById(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Track not found' });
        }

        if (updates.track_type && !['visit_count', 'spend_amount'].includes(updates.track_type)) {
            return res.status(400).json({
                success: false,
                message: 'track_type must be "visit_count" or "spend_amount"'
            });
        }

        await RewardTrackDefinitionRepository.update(id, updates);
        const track = await RewardTrackDefinitionRepository.findById(id);

        res.json({ success: true, message: 'Track updated successfully', track });
    } catch (error) {
        console.error('Error updating reward track definition:', error);
        res.status(500).json({ success: false, message: 'Failed to update track' });
    }
});

// Delete a reward track definition
app.delete('/api/admin/reward-track-definitions/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await RewardTrackDefinitionRepository.findById(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Track not found' });
        }

        // Check if track has any active mappings
        const serviceMappings = await ServiceRewardMappingRepository.findByTrackId(id);
        const categoryMappings = await CategoryRewardMappingRepository.findByTrackId(id);

        if (serviceMappings.length > 0 || categoryMappings.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete track: it has ${serviceMappings.length} service mappings and ${categoryMappings.length} category mappings. Remove these first.`
            });
        }

        await RewardTrackDefinitionRepository.delete(id);
        res.json({ success: true, message: 'Track deleted successfully' });
    } catch (error) {
        console.error('Error deleting reward track definition:', error);
        res.status(500).json({ success: false, message: 'Failed to delete track' });
    }
});

// ============================================
// ADMIN SERVICE-TO-REWARD MAPPINGS
// Link individual services to reward tracks
// ============================================

// Get all service-reward mappings
app.get('/api/admin/service-reward-mappings', authenticateAdmin, async (req, res) => {
    try {
        const mappings = await ServiceRewardMappingRepository.findAll();
        res.json({ success: true, mappings });
    } catch (error) {
        console.error('Error fetching service-reward mappings:', error);
        res.status(500).json({ success: false, message: 'Failed to load mappings' });
    }
});

// Get mappings for a specific service
app.get('/api/admin/service-reward-mappings/service/:serviceId', authenticateAdmin, async (req, res) => {
    try {
        const mappings = await ServiceRewardMappingRepository.findByServiceId(req.params.serviceId);
        res.json({ success: true, mappings });
    } catch (error) {
        console.error('Error fetching service mappings:', error);
        res.status(500).json({ success: false, message: 'Failed to load mappings' });
    }
});

// Create a service-reward mapping
app.post('/api/admin/service-reward-mappings', authenticateAdmin, async (req, res) => {
    try {
        const { service_id, track_id, points_multiplier, require_payment } = req.body;

        if (!service_id || !track_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: service_id, track_id'
            });
        }

        // Verify service exists
        const service = await ServiceRepository.findById(service_id);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        // Verify track exists
        const track = await RewardTrackDefinitionRepository.findById(track_id);
        if (!track) {
            return res.status(404).json({ success: false, message: 'Reward track not found' });
        }

        const mapping = await ServiceRewardMappingRepository.create({
            service_id,
            track_id,
            points_multiplier: points_multiplier || 1.0,
            require_payment: require_payment !== undefined ? require_payment : 1
        });

        res.json({ success: true, message: 'Mapping created successfully', mapping });
    } catch (error) {
        console.error('Error creating service-reward mapping:', error);
        if (error.message?.includes('UNIQUE constraint')) {
            return res.status(400).json({ success: false, message: 'This service is already mapped to this track' });
        }
        res.status(500).json({ success: false, message: 'Failed to create mapping' });
    }
});

// Bulk assign services to a track
app.post('/api/admin/service-reward-mappings/bulk', authenticateAdmin, async (req, res) => {
    try {
        const { service_ids, track_id } = req.body;

        if (!service_ids || !Array.isArray(service_ids) || !track_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: service_ids (array), track_id'
            });
        }

        // Verify track exists
        const track = await RewardTrackDefinitionRepository.findById(track_id);
        if (!track) {
            return res.status(404).json({ success: false, message: 'Reward track not found' });
        }

        const results = await ServiceRewardMappingRepository.bulkAssign(service_ids, track_id);

        res.json({
            success: true,
            message: `Successfully mapped ${results.length} services to track "${track.display_name}"`,
            mappings: results
        });
    } catch (error) {
        console.error('Error bulk assigning service-reward mappings:', error);
        res.status(500).json({ success: false, message: 'Failed to create mappings' });
    }
});

// Delete a service-reward mapping
app.delete('/api/admin/service-reward-mappings/:id', authenticateAdmin, async (req, res) => {
    try {
        await ServiceRewardMappingRepository.delete(req.params.id);
        res.json({ success: true, message: 'Mapping removed successfully' });
    } catch (error) {
        console.error('Error deleting service-reward mapping:', error);
        res.status(500).json({ success: false, message: 'Failed to remove mapping' });
    }
});

// Delete mapping by service and track
app.delete('/api/admin/service-reward-mappings/service/:serviceId/track/:trackId', authenticateAdmin, async (req, res) => {
    try {
        await ServiceRewardMappingRepository.deleteByServiceAndTrack(req.params.serviceId, req.params.trackId);
        res.json({ success: true, message: 'Mapping removed successfully' });
    } catch (error) {
        console.error('Error deleting service-reward mapping:', error);
        res.status(500).json({ success: false, message: 'Failed to remove mapping' });
    }
});

// ============================================
// ADMIN CATEGORY-TO-REWARD MAPPINGS
// Link service categories to reward tracks
// ============================================

// Get all category-reward mappings
app.get('/api/admin/category-reward-mappings', authenticateAdmin, async (req, res) => {
    try {
        const mappings = await CategoryRewardMappingRepository.findAll();

        // Also get unique categories from services for UI dropdown
        const categories = await db.dbAll(`
            SELECT DISTINCT category FROM services
            WHERE active = 1 AND category IS NOT NULL
            ORDER BY category
        `);

        res.json({
            success: true,
            mappings,
            availableCategories: categories.map(c => c.category)
        });
    } catch (error) {
        console.error('Error fetching category-reward mappings:', error);
        res.status(500).json({ success: false, message: 'Failed to load mappings' });
    }
});

// Create a category-reward mapping
app.post('/api/admin/category-reward-mappings', authenticateAdmin, async (req, res) => {
    try {
        const { category_name, track_id } = req.body;

        if (!category_name || !track_id) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: category_name, track_id'
            });
        }

        // Verify track exists
        const track = await RewardTrackDefinitionRepository.findById(track_id);
        if (!track) {
            return res.status(404).json({ success: false, message: 'Reward track not found' });
        }

        const mapping = await CategoryRewardMappingRepository.create({
            category_name,
            track_id
        });

        res.json({ success: true, message: 'Category mapping created successfully', mapping });
    } catch (error) {
        console.error('Error creating category-reward mapping:', error);
        if (error.message?.includes('UNIQUE constraint')) {
            return res.status(400).json({ success: false, message: 'This category is already mapped to this track' });
        }
        res.status(500).json({ success: false, message: 'Failed to create mapping' });
    }
});

// Delete a category-reward mapping
app.delete('/api/admin/category-reward-mappings/:id', authenticateAdmin, async (req, res) => {
    try {
        await CategoryRewardMappingRepository.delete(req.params.id);
        res.json({ success: true, message: 'Category mapping removed successfully' });
    } catch (error) {
        console.error('Error deleting category-reward mapping:', error);
        res.status(500).json({ success: false, message: 'Failed to remove mapping' });
    }
});

// Get reward tracks applicable to a specific service (for booking flow)
app.get('/api/services/:serviceId/reward-tracks', optionalAuth, async (req, res) => {
    try {
        const service = await ServiceRepository.findById(req.params.serviceId);
        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        const tracks = await CategoryRewardMappingRepository.getTracksForService(service.id, service.category);
        res.json({ success: true, tracks });
    } catch (error) {
        console.error('Error fetching service reward tracks:', error);
        res.status(500).json({ success: false, message: 'Failed to load reward tracks' });
    }
});

// ============================================
// ADMIN SERVICE PACKAGES
// ============================================

// Get available service packages (admin)
app.get('/api/admin/packages', authenticateAdmin, async (req, res) => {
    try {
        const packages = await ServicePackageRepository.findAll();
        res.json({ success: true, packages });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ success: false, message: 'Failed to load packages' });
    }
});

// Create a service package (admin)
app.post('/api/admin/packages', authenticateAdmin, async (req, res) => {
    try {
        const {
            name, description, serviceId, sessions,
            discountPercent, validDays, price, active = true
        } = req.body;

        if (!name || !serviceId || !sessions || !price) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: name, serviceId, sessions, price'
            });
        }

        const pkg = await ServicePackageRepository.create({
            id: uuidv4(),
            name,
            description,
            serviceId,
            sessions,
            discountPercent: discountPercent || 0,
            validDays: validDays || 30,
            price,
            active
        });

        res.json({
            success: true,
            message: 'Package created successfully',
            package: pkg
        });
    } catch (error) {
        console.error('Error creating package:', error);
        res.status(500).json({ success: false, message: 'Failed to create package' });
    }
});

// Update a service package (admin)
app.put('/api/admin/packages/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const pkg = await ServicePackageRepository.findById(id);
        if (!pkg) {
            return res.status(404).json({ success: false, message: 'Package not found' });
        }

        await ServicePackageRepository.update(id, updates);
        const updated = await ServicePackageRepository.findById(id);

        res.json({
            success: true,
            message: 'Package updated successfully',
            package: updated
        });
    } catch (error) {
        console.error('Error updating package:', error);
        res.status(500).json({ success: false, message: 'Failed to update package' });
    }
});

// Delete a service package (admin)
app.delete('/api/admin/packages/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if any active user packages reference this
        const activeCount = await db.dbGet(`
            SELECT COUNT(*) as count FROM user_packages
            WHERE package_id = ? AND status = 'active'
        `, [id]);

        if (activeCount.count > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete package with active user subscriptions'
            });
        }

        await ServicePackageRepository.delete(id);

        res.json({
            success: true,
            message: 'Package deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting package:', error);
        res.status(500).json({ success: false, message: 'Failed to delete package' });
    }
});

// ============================================
// CUSTOMER REWARDS ENDPOINTS
// ============================================

// Get current user's reward progress
app.get('/api/rewards/my-progress', authenticateToken, async (req, res) => {
    try {
        const progress = await RewardsService.getUserProgress(req.user.id);
        res.json({ success: true, ...progress });
    } catch (error) {
        console.error('Error fetching reward progress:', error);
        res.status(500).json({ success: false, message: 'Failed to load reward progress' });
    }
});

// Get available rewards for current user
app.get('/api/rewards/available', authenticateToken, async (req, res) => {
    try {
        const rewards = await UserRewardRepository.findActiveForUser(req.user.id);
        res.json({ success: true, rewards });
    } catch (error) {
        console.error('Error fetching available rewards:', error);
        res.status(500).json({ success: false, message: 'Failed to load rewards' });
    }
});

// Get rewards applicable to a specific booking
app.get('/api/rewards/for-booking/:bookingId', authenticateToken, async (req, res) => {
    try {
        const { bookingId } = req.params;

        const booking = await BookingRepository.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        // Verify user owns this booking
        if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const rewards = await UserRewardRepository.findApplicableForBooking(
            req.user.id,
            booking.service_id
        );

        res.json({ success: true, rewards });
    } catch (error) {
        console.error('Error fetching rewards for booking:', error);
        res.status(500).json({ success: false, message: 'Failed to load rewards' });
    }
});

// Apply reward to booking
app.post('/api/rewards/apply', authenticateToken, async (req, res) => {
    try {
        const { bookingId, rewardId } = req.body;

        if (!bookingId || !rewardId) {
            return res.status(400).json({
                success: false,
                message: 'Missing bookingId or rewardId'
            });
        }

        const booking = await BookingRepository.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        // Verify user owns this booking
        if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Verify reward belongs to user
        const reward = await UserRewardRepository.findById(rewardId);
        if (!reward || reward.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Invalid reward' });
        }

        const result = await RewardsService.applyRewardToBooking(bookingId, rewardId);

        if (result.success) {
            res.json({
                success: true,
                message: 'Reward applied successfully',
                discountAmount: result.discountAmount
            });
        } else {
            res.status(400).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error applying reward:', error);
        res.status(500).json({ success: false, message: 'Failed to apply reward' });
    }
});

// Get user's reward history
app.get('/api/rewards/history', authenticateToken, async (req, res) => {
    try {
        const rewards = await db.dbAll(`
            SELECT * FROM user_rewards
            WHERE user_id = ?
            ORDER BY created_at DESC
        `, [req.user.id]);

        res.json({ success: true, rewards });
    } catch (error) {
        console.error('Error fetching reward history:', error);
        res.status(500).json({ success: false, message: 'Failed to load history' });
    }
});

// ============================================
// CUSTOMER PACKAGE ENDPOINTS
// ============================================

// Get available packages for purchase
app.get('/api/packages', async (req, res) => {
    try {
        const packages = await ServicePackageRepository.findActive();
        res.json({ success: true, packages });
    } catch (error) {
        console.error('Error fetching packages:', error);
        res.status(500).json({ success: false, message: 'Failed to load packages' });
    }
});

// Get user's active packages
app.get('/api/packages/mine', authenticateToken, async (req, res) => {
    try {
        const packages = await UserPackageRepository.findActiveForUser(req.user.id);
        res.json({ success: true, packages });
    } catch (error) {
        console.error('Error fetching user packages:', error);
        res.status(500).json({ success: false, message: 'Failed to load packages' });
    }
});

// Purchase a package
app.post('/api/packages/:id/purchase', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const pkg = await ServicePackageRepository.findById(id);
        if (!pkg || !pkg.active) {
            return res.status(404).json({ success: false, message: 'Package not found or not available' });
        }

        // Calculate validity dates
        const validFrom = new Date().toISOString().split('T')[0];
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + (pkg.validity_days || 30));

        const userPackage = await UserPackageRepository.create({
            userId: req.user.id,
            packageId: id,
            packageName: pkg.name,
            totalSessions: pkg.total_sessions,
            purchasePrice: pkg.final_price || pkg.base_price,
            validFrom,
            validUntil: validUntil.toISOString().split('T')[0]
        });

        res.json({
            success: true,
            message: 'Package purchased successfully',
            userPackage
        });
    } catch (error) {
        console.error('Error purchasing package:', error);
        res.status(500).json({ success: false, message: 'Failed to purchase package' });
    }
});

// Use a package session (called when booking with package)
app.post('/api/packages/:userPackageId/use-session', authenticateToken, async (req, res) => {
    try {
        const { userPackageId } = req.params;
        const { bookingId } = req.body;

        const userPkg = await UserPackageRepository.findById(userPackageId);
        if (!userPkg) {
            return res.status(404).json({ success: false, message: 'Package not found' });
        }

        // Verify ownership
        if (userPkg.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Check if expired or exhausted
        if (userPkg.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Package is not active' });
        }

        if (userPkg.sessions_used >= userPkg.total_sessions) {
            return res.status(400).json({ success: false, message: 'No sessions remaining' });
        }

        if (new Date(userPkg.valid_until) < new Date()) {
            await UserPackageRepository.updateStatus(userPackageId, 'expired');
            return res.status(400).json({ success: false, message: 'Package has expired' });
        }

        // Use the session - returns updated package
        const updatedPkg = await UserPackageRepository.useSession(userPackageId, bookingId);

        // Update booking to link to package
        if (bookingId) {
            await BookingRepository.updateById(bookingId, {
                packageSessionId: userPackageId
            });
        }

        res.json({
            success: true,
            message: 'Session used successfully',
            sessionsRemaining: updatedPkg.sessions_remaining,
            package: updatedPkg
        });
    } catch (error) {
        console.error('Error using package session:', error);
        res.status(500).json({ success: false, message: 'Failed to use session' });
    }
});

// ============================================
// ADMIN HAIR TRACKER SETTINGS
// ============================================

// Get hair tracker settings for admin
app.get('/api/admin/hair-tracker', authenticateAdmin, async (req, res) => {
    try {
        const config = await getHairTrackerSettings();
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

        // Build the config object to save
        const configToSave = {
            defaultMaintenanceIntervalDays: defaultMaintenanceIntervalDays || 42,
            washFrequencyDays: washFrequencyDays || 3,
            deepConditionFrequencyDays: deepConditionFrequencyDays || 14,
            extensionTypes: extensionTypes || [],
            healthScore: healthScore || {
                base: 100,
                penalties: {
                    overMaintenanceByDay: 0.5,
                    noDeepConditionOverDays: 0.3,
                    tooManyWashesPerWeek: 1.0
                }
            },
            copy: copy || {},
            tips: tips || []
        };

        // Save to database
        await saveHairTrackerSettings(configToSave);

        res.json({
            success: true,
            message: 'Hair tracker settings updated successfully',
            ...configToSave
        });
    } catch (error) {
        console.error('Database error updating hair tracker settings:', error.message);
        res.status(500).json({ success: false, message: 'Database error - please try again later' });
    }
});

// Reset hair tracker settings to defaults
app.post('/api/admin/hair-tracker/reset', authenticateAdmin, async (req, res) => {
    try {
        // Delete the saved config to revert to defaults
        await dbRun('DELETE FROM hair_tracker_settings WHERE key = ?', ['config']);

        // Get the default config
        const defaultConfig = await getHairTrackerSettings();

        res.json({
            success: true,
            message: 'Hair tracker settings reset to defaults',
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
            createdBy: req.user.id
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
        console.log(`[Stylists] Found ${existing ? existing.length : 0} existing stylists in database`);
        if (existing && existing.length > 0) {
            console.log('[Stylists] Skipping seed - stylists already exist:', existing.map(s => s.name).join(', '));
            return;
        }

        console.log('[Stylists] No stylists found - seeding defaults...');
        const defaults = [
            {
                id: 'stylist_lisa',
                name: 'Lisa Thompson',
                specialty: 'Senior Stylist',
                tagline: '8 years experience',
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

// Seed default products if none exist
async function seedProductsDefaults() {
    try {
        const existing = await ProductRepository.findAll({});
        if (existing && existing.length > 0) return;

        const defaults = [
            // Kevin Murphy Products
            {
                id: 'prod_kevin-murphy-doo-over',
                name: 'Kevin Murphy – Doo.Over',
                category: 'Kevin Murphy',
                description: 'A dry powder finishing spray that allows for natural movement, yet holds everything in just the right place. The end result is your dream hair with a soft, velvety feel.',
                price: 495,
                stock: 20,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU387_DOO.OVER_250ml-02-300x300.png'
            },
            {
                id: 'prod_kevin-murphy-plumping-wash',
                name: 'Kevin Murphy – Plumping Wash',
                category: 'Kevin Murphy',
                description: 'A densifying shampoo that thickens and strengthens fine, limp hair. Ginger Root and Nettle extracts help stimulate the scalp.',
                price: 450,
                stock: 15,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU249_PLUMPING.WASH_250ml-03-300x300.png'
            },
            {
                id: 'prod_kevin-murphy-session-spray',
                name: 'Kevin Murphy – Session Spray Flex',
                category: 'Kevin Murphy',
                description: 'A lightweight finishing spray with a flexible hold. Perfect for creating styles that move naturally.',
                price: 520,
                stock: 18,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU491_SESSION.SPRAY_FLEX_400ML_EU-02-300x300.png'
            },
            {
                id: 'prod_kevin-murphy-stimulate-me',
                name: 'Kevin Murphy – Stimulate-Me Wash',
                category: 'Kevin Murphy',
                description: 'An invigorating shampoo for hair and scalp. Enriched with Camphor Crystals and Bergamot to refresh and awaken.',
                price: 450,
                stock: 12,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/KMU291_STIMULATE-ME.WASH_250ml-03-300x300.png'
            },
            {
                id: 'prod_kevin-murphy-hydrate-me',
                name: 'Kevin Murphy – Hydrate-Me Wash',
                category: 'Kevin Murphy',
                description: 'A moisturising shampoo for coloured hair. Kakadu Plum provides intensive hydration without weighing hair down.',
                price: 450,
                stock: 14,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.WASH_250ml-300x300.png'
            },
            {
                id: 'prod_kevin-murphy-hydrate-me-rinse',
                name: 'Kevin Murphy – Hydrate-Me Rinse',
                category: 'Kevin Murphy',
                description: 'A smoothing conditioner that deeply hydrates dry, coloured hair while adding shine and softness.',
                price: 480,
                stock: 14,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2023/03/HYDRATE-ME.RINSE_250ml-300x300.png'
            },
            // Hair Extensions
            {
                id: 'prod_tape-extensions-18',
                name: 'Tape Extensions 18"',
                category: 'Hair Extensions',
                description: 'Premium quality tape-in hair extensions, 18 inches long. Natural human hair, available in various colours.',
                price: 2800,
                stock: 25,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories1.jpg'
            },
            {
                id: 'prod_tape-extensions-22',
                name: 'Tape Extensions 22"',
                category: 'Hair Extensions',
                description: 'Premium quality tape-in hair extensions, 22 inches long. Natural human hair for length and volume.',
                price: 3500,
                stock: 20,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories1.jpg'
            },
            {
                id: 'prod_weft-extensions-18',
                name: 'Weft Extensions 18"',
                category: 'Hair Extensions',
                description: 'Hand-tied weft extensions, 18 inches. Perfect for adding volume and length with minimal damage.',
                price: 3200,
                stock: 15,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories3.jpg'
            },
            {
                id: 'prod_weft-extensions-22',
                name: 'Weft Extensions 22"',
                category: 'Hair Extensions',
                description: 'Hand-tied weft extensions, 22 inches. Luxurious length for stunning transformations.',
                price: 4000,
                stock: 12,
                imageUrl: 'https://www.flirthair.co.za/wp-content/uploads/2022/03/categories3.jpg'
            },
            // Hair Care Tools
            {
                id: 'prod_extension-brush',
                name: 'Extension Care Brush',
                category: 'Hair Care Tools',
                description: 'Specially designed brush for hair extensions. Gentle bristles prevent tangling and damage.',
                price: 280,
                stock: 30,
                imageUrl: null
            },
            {
                id: 'prod_heat-protectant',
                name: 'Heat Protectant Spray',
                category: 'Hair Care Tools',
                description: 'Thermal protection spray for styling. Protects hair from heat damage up to 230°C.',
                price: 195,
                stock: 25,
                imageUrl: null
            },
            {
                id: 'prod_silk-pillowcase',
                name: 'Silk Pillowcase',
                category: 'Hair Care Tools',
                description: 'Mulberry silk pillowcase to reduce friction and extend the life of your extensions.',
                price: 450,
                stock: 20,
                imageUrl: null
            },
            // Maintenance Products
            {
                id: 'prod_tape-adhesive-remover',
                name: 'Tape Adhesive Remover',
                category: 'Maintenance',
                description: 'Professional-grade adhesive remover for safe tape extension removal.',
                price: 185,
                stock: 40,
                imageUrl: null
            },
            {
                id: 'prod_replacement-tape',
                name: 'Replacement Tape Tabs',
                category: 'Maintenance',
                description: 'High-quality replacement tape tabs for re-application. Pack of 40.',
                price: 120,
                stock: 50,
                imageUrl: null
            }
        ];

        for (const product of defaults) {
            await ProductRepository.create({
                id: product.id,
                name: product.name,
                category: product.category,
                description: product.description,
                price: product.price,
                stock: product.stock,
                imageUrl: product.imageUrl,
                active: true
            });
        }
        console.log('Seeded default products');
    } catch (err) {
        console.error('Failed to seed products:', err.message);
    }
}

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
                customerName: payload.customerName, // Fixed: was 'userName', admin console expects 'customerName'
                customerEmail: payload.customerEmail,
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
        console.log('Admin chat message request:', { conversationId, text: text?.substring(0, 50), userId: req.user?.id });

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
        const messageId = 'msg_' + uuidv4().substring(0, 8);
        console.log('Creating message with ID:', messageId);

        const newMessage = await ChatRepository.createMessage({
            id: messageId,
            conversationId,
            fromType: 'agent',
            text: text.trim(),
            agentId: req.user.id,
            readByAgent: 1,
            readByUser: 0,
            createdAt: now
        });

        if (!newMessage) {
            console.error('Failed to create message - no message returned');
            return res.status(500).json({ success: false, message: 'Failed to create message' });
        }

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
        console.error('Stack:', error.stack);
        res.status(500).json({ success: false, message: error.message || 'Internal server error' });
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
// INVOICE SETTINGS MANAGEMENT
// ============================================

// Get invoice settings
app.get('/api/admin/invoice-settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = await InvoiceRepository.getSettings();
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Get invoice settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update invoice settings
app.put('/api/admin/invoice-settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = await InvoiceRepository.updateSettings(req.body);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Update invoice settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get payment methods
app.get('/api/admin/payment-methods', authenticateAdmin, async (req, res) => {
    try {
        const methods = await db.dbAll('SELECT * FROM payment_methods ORDER BY display_order');
        res.json({ success: true, payment_methods: methods });
    } catch (error) {
        console.error('Get payment methods error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update payment method
app.put('/api/admin/payment-methods/:id', authenticateAdmin, async (req, res) => {
    try {
        const { enabled, transaction_fee_type, transaction_fee_value, description } = req.body;

        await db.dbRun(`
            UPDATE payment_methods
            SET enabled = ?,
                transaction_fee_type = ?,
                transaction_fee_value = ?,
                description = ?
            WHERE id = ?
        `, [enabled, transaction_fee_type, transaction_fee_value, description, req.params.id]);

        const method = await db.dbGet('SELECT * FROM payment_methods WHERE id = ?', [req.params.id]);
        res.json({ success: true, payment_method: method });
    } catch (error) {
        console.error('Update payment method error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get discount presets
app.get('/api/admin/discount-presets', authenticateAdmin, async (req, res) => {
    try {
        const presets = await db.dbAll('SELECT * FROM discount_presets WHERE enabled = 1 ORDER BY display_order');
        res.json({ success: true, discount_presets: presets });
    } catch (error) {
        console.error('Get discount presets error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create discount preset
app.post('/api/admin/discount-presets', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, requires_approval } = req.body;
        const id = `discount-${Date.now()}`;

        await db.dbRun(`
            INSERT INTO discount_presets (id, name, description, discount_type, discount_value, requires_approval)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, name, description, discount_type, discount_value, requires_approval || 0]);

        const preset = await db.dbGet('SELECT * FROM discount_presets WHERE id = ?', [id]);
        res.json({ success: true, discount_preset: preset });
    } catch (error) {
        console.error('Create discount preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update discount preset
app.put('/api/admin/discount-presets/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, enabled, requires_approval } = req.body;

        await db.dbRun(`
            UPDATE discount_presets
            SET name = ?,
                description = ?,
                discount_type = ?,
                discount_value = ?,
                enabled = ?,
                requires_approval = ?
            WHERE id = ?
        `, [name, description, discount_type, discount_value, enabled, requires_approval, req.params.id]);

        const preset = await db.dbGet('SELECT * FROM discount_presets WHERE id = ?', [req.params.id]);
        res.json({ success: true, discount_preset: preset });
    } catch (error) {
        console.error('Update discount preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete discount preset
app.delete('/api/admin/discount-presets/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.dbRun('DELETE FROM discount_presets WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete discount preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// INVOICE MANAGEMENT
// ============================================

// Create new invoice
app.post('/api/admin/invoices', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoiceData = {
            ...req.body,
            created_by: req.user.id
        };

        const invoice = await InvoiceRepository.create(invoiceData);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List invoices with filters
app.get('/api/admin/invoices', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const filters = {
            status: req.query.status,
            payment_status: req.query.payment_status,
            stylist_id: req.query.stylist_id,
            user_id: req.query.user_id,
            start_date: req.query.start_date,
            end_date: req.query.end_date,
            search: req.query.search,
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0
        };

        const invoices = await InvoiceRepository.list(filters);
        res.json({ success: true, invoices });
    } catch (error) {
        console.error('List invoices error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single invoice
app.get('/api/admin/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Allow user to view their own invoice, or admin/staff to view any
        if (invoice.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'staff') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update draft invoice
app.put('/api/admin/invoices/:id', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.status !== 'draft') {
            return res.status(400).json({ error: 'Can only edit draft invoices' });
        }

        // For simplicity, delete and recreate (in production, you'd update line items)
        await db.dbRun('DELETE FROM invoice_services WHERE invoice_id = ?', [req.params.id]);
        await db.dbRun('DELETE FROM invoice_products WHERE invoice_id = ?', [req.params.id]);
        await db.dbRun('DELETE FROM invoices WHERE id = ?', [req.params.id]);

        const invoiceData = {
            ...req.body,
            created_by: req.user.id
        };

        const newInvoice = await InvoiceRepository.create(invoiceData);
        res.json({ success: true, invoice: newInvoice });
    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete draft invoice
app.delete('/api/admin/invoices/:id', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.status !== 'draft') {
            return res.status(400).json({ error: 'Can only delete draft invoices' });
        }

        await db.dbRun('DELETE FROM invoices WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Finalize invoice (lock and generate invoice number)
app.put('/api/admin/invoices/:id/finalize', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.finalize(req.params.id);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Finalize invoice error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// PAYMENT MANAGEMENT
// ============================================

// Record payment
app.post('/api/admin/invoices/:id/payments', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const paymentData = {
            ...req.body,
            processed_by: req.user.id
        };

        // Get invoice before payment to check if it was already paid
        const invoiceBefore = await InvoiceRepository.getById(req.params.id);
        const wasAlreadyPaid = invoiceBefore && invoiceBefore.payment_status === 'paid';

        const invoice = await InvoiceRepository.recordPayment(req.params.id, paymentData);

        // If invoice just became fully paid, process rewards
        if (!wasAlreadyPaid && invoice.payment_status === 'paid') {
            console.log(`Invoice ${invoice.id} fully paid - processing rewards`);
            try {
                // Get the user and booking associated with this invoice
                const user = await UserRepository.findById(invoice.user_id);
                if (user && invoice.booking_id) {
                    const booking = await BookingRepository.findById(invoice.booking_id);
                    if (booking) {
                        // Mark booking as paid for reward processing
                        const bookingWithPayment = { ...booking, paid: true, final_amount: invoice.total };
                        const rewardsResult = await RewardsService.processCompletedBooking(bookingWithPayment, user, true);
                        console.log('Rewards processed for paid invoice:', rewardsResult);
                    }
                }
            } catch (rewardError) {
                // Don't fail the payment recording if reward processing fails
                console.error('Error processing rewards for paid invoice:', rewardError);
            }
        }

        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get payments for invoice
app.get('/api/admin/invoices/:id/payments', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Allow user to view their own invoice payments, or admin/staff to view any
        if (invoice.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'staff') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, payments: invoice.payments });
    } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// COMMISSION & PAYROLL
// ============================================

// Get commission report
app.get('/api/admin/commissions', authenticateAdmin, async (req, res) => {
    try {
        const { stylist_id, start_date, end_date } = req.query;

        if (!stylist_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'stylist_id, start_date, and end_date are required' });
        }

        const report = await InvoiceRepository.getCommissionReport(stylist_id, start_date, end_date);
        res.json({ success: true, ...report });
    } catch (error) {
        console.error('Commission report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all stylists commission summary
app.get('/api/admin/commissions/summary', authenticateAdmin, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required' });
        }

        const stylists = await StylistRepository.getAll();
        const summaries = [];

        for (let stylist of stylists) {
            const report = await InvoiceRepository.getCommissionReport(stylist.id, start_date, end_date);
            summaries.push({
                stylist_id: stylist.id,
                stylist_name: stylist.name,
                ...report.summary
            });
        }

        res.json({ success: true, summaries });
    } catch (error) {
        console.error('Commission summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mark commissions as paid (bulk operation)
app.post('/api/admin/commissions/mark-paid', authenticateAdmin, async (req, res) => {
    try {
        const { invoice_ids, payment_reference, payment_date } = req.body;

        if (!invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
            return res.status(400).json({ error: 'invoice_ids array is required' });
        }

        await InvoiceRepository.markCommissionsPaid(
            invoice_ids,
            payment_reference || `PAYROLL-${Date.now()}`,
            payment_date || new Date().toISOString()
        );

        res.json({ success: true, count: invoice_ids.length });
    } catch (error) {
        console.error('Mark commissions paid error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CUSTOMER-FACING INVOICE ENDPOINTS
// ============================================

// Get my invoices
app.get('/api/invoices/my-invoices', authenticateToken, async (req, res) => {
    try {
        const invoices = await InvoiceRepository.list({
            user_id: req.user.id,
            status: 'finalized' // Only show finalized invoices to customers
        });

        res.json({ success: true, invoices });
    } catch (error) {
        console.error('Get my invoices error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single invoice (customer view)
app.get('/api/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Only allow customer to view their own invoice
        if (invoice.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Initiate payment for invoice (redirect to PayFast/Yoco)
app.post('/api/invoices/:id/pay', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (invoice.payment_status === 'paid') {
            return res.status(400).json({ error: 'Invoice already paid' });
        }

        const { payment_method } = req.body;

        // For now, return payment URL (integration with PayFast/Yoco would go here)
        // This would use the existing PaymentService logic

        res.json({
            success: true,
            payment_url: `/payment/invoice/${invoice.id}?method=${payment_method}`,
            amount: invoice.amount_due
        });
    } catch (error) {
        console.error('Initiate payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper middleware for admin or staff
function adminOrStaff(req, res, next) {
    if (req.user.role === 'admin' || req.user.role === 'staff') {
        next();
    } else {
        res.status(403).json({ error: 'Admin or staff access required' });
    }
}

// ============================================
// START SERVER
// ============================================

// Async initialization and server startup
(async function startServer() {
    try {
        console.log('🔄 Initializing database and seeding data...');

        // Wait for database initialization and seeding to complete
        await seedAdminUser();

        console.log('✅ Database initialization complete');

        // Now start the server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
    ========================================
    Flirt Hair & Beauty - Backend Server
    ========================================

    Server running on: http://0.0.0.0:${PORT}

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
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
