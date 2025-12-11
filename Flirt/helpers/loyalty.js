// Flirt Hair & Beauty - Loyalty System Helper
// Centralized loyalty configuration and calculation logic

const fs = require('fs');
const path = require('path');

const LOYALTY_FILE = path.join(__dirname, '..', 'data', 'loyalty.json');

// Default loyalty configuration
const DEFAULT_CONFIG = {
    pointsRules: {
        bookingPoints: 50,      // Points earned per booking
        spendRand: 10,          // Spend X Rands to earn 1 point
        reviewPoints: 25,       // Points for leaving a review
        referralPoints: 100,    // Points for successful referral (both parties)
        socialSharePoints: 10   // Points for sharing on social media
    },
    tierThresholds: {
        bronze: 0,
        silver: 500,
        gold: 1500,
        platinum: 5000
    },
    // Referral program settings - controls client display and share message
    referral: {
        enabled: true,
        discountType: 'percent',    // 'percent' or 'amount'
        discountValue: 10,          // 10% or R10 depending on type
        headline: 'Rewards & Referrals',
        subheading: 'Share your code and you both save!',
        shareMessageTemplate: 'Check out Flirt Hair Extensions! Use my code {code} for {discount} off your first booking! 💇✨'
    },
    // Configurable "Ways to Earn" display rules
    earnRulesDisplay: [
        { id: 'booking', label: 'Book an appointment', pointsKey: 'bookingPoints' },
        { id: 'spend', label: 'Every R{spendRand} spent', pointsKey: 'spendRand', isSpendRule: true },
        { id: 'referral', label: 'Successful referral', pointsKey: 'referralPoints' }
    ]
};

// Cache for loyalty config (refreshed on updates)
let configCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000; // 5 seconds cache

/**
 * Load loyalty configuration from file
 * @returns {Object} Loyalty configuration
 */
function loadLoyaltyConfig() {
    try {
        const data = fs.readFileSync(LOYALTY_FILE, 'utf8');
        const parsed = JSON.parse(data);

        // Ensure all required fields exist (merge with defaults)
        return {
            transactions: parsed.transactions || [],
            pointsRules: {
                ...DEFAULT_CONFIG.pointsRules,
                ...parsed.pointsRules
            },
            tierThresholds: {
                ...DEFAULT_CONFIG.tierThresholds,
                ...parsed.tierThresholds
            },
            // Referral program config
            referral: {
                ...DEFAULT_CONFIG.referral,
                ...parsed.referral
            },
            // Earn rules display config
            earnRulesDisplay: parsed.earnRulesDisplay || DEFAULT_CONFIG.earnRulesDisplay
        };
    } catch (error) {
        console.error('Error loading loyalty config:', error.message);
        return {
            transactions: [],
            ...DEFAULT_CONFIG
        };
    }
}

/**
 * Get loyalty configuration (with caching)
 * @param {boolean} forceRefresh - Force refresh the cache
 * @returns {Object} Loyalty configuration
 */
function getLoyaltyConfig(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && configCache && (now - cacheTimestamp) < CACHE_TTL) {
        return configCache;
    }

    configCache = loadLoyaltyConfig();
    cacheTimestamp = now;
    return configCache;
}

/**
 * Get points rules only
 * @returns {Object} Points rules configuration
 */
function getPointsRules() {
    const config = getLoyaltyConfig();
    return config.pointsRules;
}

/**
 * Get tier thresholds only
 * @returns {Object} Tier thresholds
 */
function getTierThresholds() {
    const config = getLoyaltyConfig();
    return config.tierThresholds;
}

/**
 * Save loyalty configuration to file
 * @param {Object} config - Configuration to save
 * @returns {boolean} Success status
 */
function saveLoyaltyConfig(config) {
    try {
        // Load existing data to preserve transactions
        const existingData = loadLoyaltyConfig();

        const dataToSave = {
            transactions: existingData.transactions,
            pointsRules: {
                bookingPoints: parseInt(config.pointsRules?.bookingPoints) || DEFAULT_CONFIG.pointsRules.bookingPoints,
                spendRand: parseInt(config.pointsRules?.spendRand) || DEFAULT_CONFIG.pointsRules.spendRand,
                reviewPoints: parseInt(config.pointsRules?.reviewPoints) || DEFAULT_CONFIG.pointsRules.reviewPoints,
                referralPoints: parseInt(config.pointsRules?.referralPoints) || DEFAULT_CONFIG.pointsRules.referralPoints,
                socialSharePoints: parseInt(config.pointsRules?.socialSharePoints) || DEFAULT_CONFIG.pointsRules.socialSharePoints
            },
            tierThresholds: {
                bronze: parseInt(config.tierThresholds?.bronze) || 0,
                silver: parseInt(config.tierThresholds?.silver) || DEFAULT_CONFIG.tierThresholds.silver,
                gold: parseInt(config.tierThresholds?.gold) || DEFAULT_CONFIG.tierThresholds.gold,
                platinum: parseInt(config.tierThresholds?.platinum) || DEFAULT_CONFIG.tierThresholds.platinum
            },
            // Save referral config if provided
            referral: config.referral ? {
                enabled: config.referral.enabled !== false,
                discountType: config.referral.discountType === 'amount' ? 'amount' : 'percent',
                discountValue: parseInt(config.referral.discountValue) || DEFAULT_CONFIG.referral.discountValue,
                headline: (config.referral.headline || DEFAULT_CONFIG.referral.headline).trim(),
                subheading: (config.referral.subheading || DEFAULT_CONFIG.referral.subheading).trim(),
                shareMessageTemplate: (config.referral.shareMessageTemplate || DEFAULT_CONFIG.referral.shareMessageTemplate).trim()
            } : existingData.referral,
            // Save earn rules display if provided
            earnRulesDisplay: Array.isArray(config.earnRulesDisplay) ? config.earnRulesDisplay : existingData.earnRulesDisplay
        };

        fs.writeFileSync(LOYALTY_FILE, JSON.stringify(dataToSave, null, 2));

        // Clear cache to force reload
        configCache = null;
        cacheTimestamp = 0;

        return true;
    } catch (error) {
        console.error('Error saving loyalty config:', error.message);
        return false;
    }
}

/**
 * Validate loyalty configuration
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateLoyaltyConfig(config) {
    const errors = [];
    const warnings = [];

    // Validate points rules
    if (config.pointsRules) {
        const { bookingPoints, spendRand, reviewPoints, referralPoints, socialSharePoints } = config.pointsRules;

        if (bookingPoints !== undefined && (isNaN(bookingPoints) || bookingPoints < 0)) {
            errors.push('Booking points must be a positive number');
        }
        if (spendRand !== undefined && (isNaN(spendRand) || spendRand < 1)) {
            errors.push('Spend per point must be at least R1');
        }
        if (reviewPoints !== undefined && (isNaN(reviewPoints) || reviewPoints < 0)) {
            errors.push('Review points must be a positive number');
        }
        if (referralPoints !== undefined && (isNaN(referralPoints) || referralPoints < 0)) {
            errors.push('Referral points must be a positive number');
        }
        if (socialSharePoints !== undefined && (isNaN(socialSharePoints) || socialSharePoints < 0)) {
            errors.push('Social share points must be a positive number');
        }
    }

    // Validate tier thresholds
    if (config.tierThresholds) {
        const { bronze, silver, gold, platinum } = config.tierThresholds;

        const bronzeVal = parseInt(bronze) || 0;
        const silverVal = parseInt(silver);
        const goldVal = parseInt(gold);
        const platinumVal = parseInt(platinum);

        if (bronzeVal !== 0) {
            errors.push('Bronze tier must start at 0 points');
        }
        if (isNaN(silverVal) || silverVal < 0) {
            errors.push('Silver threshold must be a positive number');
        }
        if (isNaN(goldVal) || goldVal < 0) {
            errors.push('Gold threshold must be a positive number');
        }
        if (isNaN(platinumVal) || platinumVal < 0) {
            errors.push('Platinum threshold must be a positive number');
        }

        // Check ascending order
        if (silverVal <= bronzeVal) {
            errors.push('Silver threshold must be greater than Bronze');
        }
        if (goldVal <= silverVal) {
            errors.push('Gold threshold must be greater than Silver');
        }
        if (platinumVal <= goldVal) {
            errors.push('Platinum threshold must be greater than Gold');
        }
    }

    // Validate referral config
    if (config.referral) {
        const { discountType, discountValue, headline, subheading, shareMessageTemplate } = config.referral;

        if (discountType && discountType !== 'percent' && discountType !== 'amount') {
            errors.push('Discount type must be "percent" or "amount"');
        }
        if (discountValue !== undefined && (isNaN(discountValue) || discountValue < 0)) {
            errors.push('Discount value must be a non-negative number');
        }
        if (discountType === 'percent' && discountValue > 100) {
            errors.push('Percent discount cannot exceed 100%');
        }
        if (headline !== undefined && (!headline || headline.trim() === '')) {
            errors.push('Referral headline cannot be empty');
        }
        if (subheading !== undefined && (!subheading || subheading.trim() === '')) {
            errors.push('Referral subheading cannot be empty');
        }
        if (shareMessageTemplate && !shareMessageTemplate.includes('{code}')) {
            warnings.push('Share message template should include {code} placeholder');
        }
    }

    // Validate earnRulesDisplay
    if (config.earnRulesDisplay && Array.isArray(config.earnRulesDisplay)) {
        config.earnRulesDisplay.forEach((rule, index) => {
            if (!rule.label || rule.label.trim() === '') {
                errors.push(`Earn rule ${index + 1}: Label cannot be empty`);
            }
            if (!rule.pointsKey) {
                errors.push(`Earn rule ${index + 1}: Points key is required`);
            } else if (config.pointsRules && !config.pointsRules[rule.pointsKey]) {
                warnings.push(`Earn rule "${rule.label}": Points key "${rule.pointsKey}" not found in points rules`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Calculate user's tier based on points
 * @param {number} points - User's total points
 * @returns {string} Tier name (bronze, silver, gold, platinum)
 */
function calculateTier(points) {
    const thresholds = getTierThresholds();

    if (points >= thresholds.platinum) return 'platinum';
    if (points >= thresholds.gold) return 'gold';
    if (points >= thresholds.silver) return 'silver';
    return 'bronze';
}

/**
 * Calculate points earned from spending
 * @param {number} amount - Amount spent in Rands
 * @returns {number} Points earned
 */
function calculateSpendPoints(amount) {
    const rules = getPointsRules();
    return Math.floor(amount / rules.spendRand);
}

/**
 * Get points for a booking
 * @returns {number} Points for booking
 */
function getBookingPoints() {
    return getPointsRules().bookingPoints;
}

/**
 * Get points for a review
 * @returns {number} Points for review
 */
function getReviewPoints() {
    return getPointsRules().reviewPoints;
}

/**
 * Get points for referral
 * @returns {number} Points for referral
 */
function getReferralPoints() {
    return getPointsRules().referralPoints;
}

/**
 * Get default configuration
 * @returns {Object} Default loyalty configuration
 */
function getDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Get tier benefits description
 * @param {string} tier - Tier name
 * @returns {Object} Tier benefits
 */
function getTierBenefits(tier) {
    const benefits = {
        bronze: {
            discount: 0,
            perks: ['Earn points on every visit', 'Birthday surprise']
        },
        silver: {
            discount: 5,
            perks: ['5% off all services', 'Priority booking', 'Birthday surprise', 'Early access to sales']
        },
        gold: {
            discount: 15,
            perks: ['15% off all services', 'Free birthday blowout', 'Priority booking', 'Exclusive events', 'Free product samples']
        },
        platinum: {
            discount: 20,
            perks: ['20% off all services', 'Free monthly treatment', 'VIP parking', 'Personal stylist', 'Exclusive events', 'Complimentary refreshments']
        }
    };

    return benefits[tier] || benefits.bronze;
}

module.exports = {
    getLoyaltyConfig,
    getPointsRules,
    getTierThresholds,
    saveLoyaltyConfig,
    validateLoyaltyConfig,
    calculateTier,
    calculateSpendPoints,
    getBookingPoints,
    getReviewPoints,
    getReferralPoints,
    getDefaultConfig,
    getTierBenefits,
    DEFAULT_CONFIG
};
