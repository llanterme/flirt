-- Flirt Hair & Beauty Database Schema
-- SQLite3 Database

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'admin', 'staff')),
    points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'bronze' CHECK(tier IN ('bronze', 'silver', 'gold', 'platinum')),
    referral_code TEXT UNIQUE,
    referred_by TEXT REFERENCES users(id),
    must_change_password INTEGER DEFAULT 0,
    hair_profile TEXT, -- JSON object for hair profile data
    notification_prefs TEXT, -- JSON object for notification preferences
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- ============================================
-- HAIR TRACKER TABLE (normalized from users)
-- ============================================
CREATE TABLE IF NOT EXISTS hair_tracker (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_install_date TEXT,
    extension_type TEXT,
    maintenance_interval_days INTEGER DEFAULT 42,
    next_maintenance_date TEXT,
    last_deep_condition_date TEXT,
    last_wash_date TEXT,
    hair_health_score INTEGER DEFAULT 100,
    wash_history TEXT, -- JSON array of wash entries
    products_used TEXT, -- JSON array of products
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- STYLISTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS stylists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    tagline TEXT,
    rating REAL DEFAULT 5.0,
    review_count INTEGER DEFAULT 0,
    clients_count INTEGER DEFAULT 0,
    years_experience INTEGER DEFAULT 0,
    instagram TEXT,
    color TEXT DEFAULT '#FF6B9D',
    available INTEGER DEFAULT 1,
    image_url TEXT,
    basic_monthly_pay REAL DEFAULT 0,
    commission_rate REAL DEFAULT 0, -- e.g., 0.30 for 30%
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- SERVICES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    cost_price REAL, -- cost price for profit calculation
    duration INTEGER, -- in minutes
    service_type TEXT NOT NULL, -- e.g., 'hair', 'beauty', 'spa', 'nails' (validated in application)
    category TEXT,
    supplier TEXT, -- supplier name
    image_url TEXT,
    display_order INTEGER DEFAULT 0,
    commission_rate REAL, -- per-service commission rate (e.g., 0.30 for 30%), NULL = use stylist default
    active INTEGER DEFAULT 1,
    bookable INTEGER DEFAULT 1, -- 1 = available for client booking, 0 = invoice/admin only (retail, redemptions, training)
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type);
-- NOTE: idx_services_bookable is created via ensureIndex in database.js after migration

-- ============================================
-- SERVICE TYPES (Admin-configurable service types)
-- ============================================
CREATE TABLE IF NOT EXISTS service_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_types_active ON service_types(active);

-- ============================================
-- SERVICE CATEGORIES (Admin-configurable categories per type)
-- ============================================
CREATE TABLE IF NOT EXISTS service_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    service_type_id TEXT NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(name, service_type_id)
);

CREATE INDEX IF NOT EXISTS idx_service_categories_type ON service_categories(service_type_id);
CREATE INDEX IF NOT EXISTS idx_service_categories_active ON service_categories(active);

-- ============================================
-- BOOKINGS TABLE (Redesigned for two-step booking flow)
-- ============================================
CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    booking_type TEXT NOT NULL CHECK(booking_type IN ('hair', 'beauty')),
    stylist_id TEXT REFERENCES stylists(id),
    service_id TEXT NOT NULL REFERENCES services(id),
    service_name TEXT NOT NULL,
    service_price REAL NOT NULL,

    -- New two-step booking fields
    requested_date TEXT NOT NULL,
    requested_time_window TEXT CHECK(requested_time_window IN ('MORNING', 'MIDDAY', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING')),
    assigned_start_time TEXT,
    assigned_end_time TEXT,
    status TEXT DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'No Status', 'To Be Confirmed', 'Online Booking', 'Paid', 'New Extentions', 'Late', 'No Show', 'Cancelled')),

    -- Legacy fields (kept for backward compatibility during migration)
    date TEXT,
    preferred_time_of_day TEXT,
    time TEXT,
    confirmed_time TEXT,

    -- Commission tracking
    commission_rate REAL, -- override commission rate for this booking, NULL = use service/stylist default
    commission_amount REAL, -- calculated commission amount (snapshot when completed)

    -- Payment tracking
    payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'pending', 'paid', 'refunded')),
    payment_method TEXT CHECK(payment_method IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft')),
    payment_reference TEXT, -- for manual payments (receipt number, EFT reference, etc.)
    payment_date TEXT, -- when payment was received
    payment_amount REAL, -- actual amount paid (may differ from service_price with discounts)

    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_requested_date ON bookings(requested_date);
CREATE INDEX IF NOT EXISTS idx_bookings_requested_time_window ON bookings(requested_time_window);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_start_time ON bookings(assigned_start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_stylist ON bookings(stylist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
-- NOTE: idx_bookings_payment_status is created via ensureIndex in database.js after migration

-- Legacy indexes (can be removed after migration)
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);

-- ============================================
-- PRODUCTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    cost_price REAL, -- cost price for profit calculation
    sale_price REAL,
    on_sale INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 0,
    supplier TEXT, -- supplier name
    commission_rate REAL, -- commission rate for product sales
    is_service_product INTEGER DEFAULT 0, -- 1 = used during treatments, 0 = retail product
    image_url TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_on_sale ON products(on_sale);

-- ============================================
-- ORDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    subtotal REAL NOT NULL,
    delivery_method TEXT DEFAULT 'pickup',
    delivery_fee REAL DEFAULT 0,
    delivery_address TEXT, -- JSON string for address details
    promo_code TEXT,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'paid')),
    payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================
-- ORDER ITEMS TABLE (normalized from orders)
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ============================================
-- PROMOS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS promos (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage', 'fixed')),
    discount_value REAL NOT NULL,
    min_order REAL DEFAULT 0,
    expires_at TEXT,
    usage_limit INTEGER,
    times_used INTEGER DEFAULT 0,
    highlighted INTEGER DEFAULT 0,
    badge TEXT,
    title TEXT,
    subtitle TEXT,
    priority INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_promos_code ON promos(code);
CREATE INDEX IF NOT EXISTS idx_promos_active ON promos(active);

-- ============================================
-- LOYALTY TRANSACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    points INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('earned', 'redeemed', 'expired', 'adjusted')),
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_transactions(user_id);

-- ============================================
-- LOYALTY SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS loyalty_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Insert default loyalty settings
INSERT OR IGNORE INTO loyalty_settings (key, value) VALUES
    ('tier_bronze', '0'),
    ('tier_silver', '500'),
    ('tier_gold', '1500'),
    ('tier_platinum', '5000'),
    ('spend_rand', '10'),
    ('booking_points', '50'),
    ('review_points', '25'),
    ('referral_points', '100');

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'promo',
    action TEXT,
    action_text TEXT DEFAULT 'View',
    active INTEGER DEFAULT 1,
    starts_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(active);

-- ============================================
-- PUSH SUBSCRIPTIONS TABLE (for Web Push)
-- ============================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- ============================================
-- PAYMENT SETTINGS TABLE (for admin-managed gateway keys)
-- ============================================
CREATE TABLE IF NOT EXISTS payment_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- PAYMENT TRANSACTIONS TABLE (for PayFast/Yoco)
-- ============================================
CREATE TABLE IF NOT EXISTS payment_transactions (
    id TEXT PRIMARY KEY,
    order_id TEXT REFERENCES orders(id),
    booking_id TEXT REFERENCES bookings(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'ZAR',
    payment_provider TEXT NOT NULL CHECK(payment_provider IN ('payfast', 'yoco', 'float', 'cash', 'card_on_site', 'eft')),
    provider_transaction_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
    metadata TEXT, -- JSON string for provider-specific data
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_transactions(status);

-- ============================================
-- CHAT CONVERSATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    guest_id TEXT, -- For non-logged-in users
    user_name TEXT NOT NULL,
    user_email TEXT,
    source TEXT DEFAULT 'general', -- 'general', 'stylist', 'booking', etc.
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    assigned_to TEXT REFERENCES users(id), -- Staff/stylist assigned to conversation
    unread_by_agent INTEGER DEFAULT 0, -- Count of unread messages by agent
    unread_by_user INTEGER DEFAULT 0, -- Count of unread messages by user
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_message_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_guest ON chat_conversations(guest_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_status ON chat_conversations(status);
CREATE INDEX IF NOT EXISTS idx_chat_conv_assigned ON chat_conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chat_conv_last_msg ON chat_conversations(last_message_at);

-- ============================================
-- CHAT MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    from_type TEXT NOT NULL CHECK(from_type IN ('user', 'agent', 'system')),
    text TEXT NOT NULL,
    agent_id TEXT REFERENCES users(id), -- Which agent sent this (if from_type='agent')
    read_by_agent INTEGER DEFAULT 0, -- Has agent read this message
    read_by_user INTEGER DEFAULT 0, -- Has user read this message
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_created ON chat_messages(created_at);

-- ============================================
-- GALLERY TABLES (persist gallery items + Instagram config)
-- ============================================
CREATE TABLE IF NOT EXISTS gallery_items (
    id TEXT PRIMARY KEY,
    image_url TEXT NOT NULL,
    alt_text TEXT,
    label TEXT,
    category TEXT,
    order_num INTEGER,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gallery_order ON gallery_items(order_num);
CREATE INDEX IF NOT EXISTS idx_gallery_active ON gallery_items(active);

CREATE TABLE IF NOT EXISTS gallery_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- HAIR TIPS TABLE (persisted tips for customer/admin)
-- ============================================
CREATE TABLE IF NOT EXISTS hair_tips (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    priority INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hair_tips_active ON hair_tips(active);
CREATE INDEX IF NOT EXISTS idx_hair_tips_priority ON hair_tips(priority DESC, created_at DESC);

-- ============================================
-- HAIR TRACKER SETTINGS TABLE (admin-configurable)
-- ============================================
CREATE TABLE IF NOT EXISTS hair_tracker_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- PAYROLL RECORDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS payroll_records (
    id TEXT PRIMARY KEY,
    stylist_id TEXT NOT NULL REFERENCES stylists(id),
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL, -- 1-12
    basic_pay REAL NOT NULL,
    commission_rate REAL NOT NULL, -- snapshot of rate at time of calculation
    total_bookings INTEGER DEFAULT 0,
    total_service_revenue REAL DEFAULT 0, -- VAT-inclusive total
    total_service_revenue_ex_vat REAL DEFAULT 0, -- pre-VAT total
    commission_amount REAL DEFAULT 0,
    gross_pay REAL DEFAULT 0, -- basic + commission
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'finalized', 'paid')),
    finalized_at TEXT,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(stylist_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_stylist ON payroll_records(stylist_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_records(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_records(status);

-- ============================================
-- STAFF SERVICES JUNCTION TABLE
-- Links staff members to services they offer with optional custom pricing
-- ============================================
CREATE TABLE IF NOT EXISTS staff_services (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL REFERENCES stylists(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    custom_price REAL,           -- Override price for this staff-service combination
    custom_duration INTEGER,     -- Override duration in minutes
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_services_staff ON staff_services(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_services_service ON staff_services(service_id);

-- ============================================
-- USER INSPO PHOTOS TABLE
-- Stores user-uploaded hair inspiration photos
-- ============================================
CREATE TABLE IF NOT EXISTS user_inspo_photos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_data TEXT NOT NULL, -- Base64 encoded image
    label TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inspo_photos_user ON user_inspo_photos(user_id);

-- ============================================
-- BUSINESS SETTINGS TABLE (singleton for business info)
-- ============================================
CREATE TABLE IF NOT EXISTS business_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton table
    business_name TEXT DEFAULT 'Flirt Hair & Beauty Bar',
    address TEXT DEFAULT '58 Nuwe Hoop St, Maroelana, Pretoria, 0081, South Africa',
    address_line1 TEXT DEFAULT 'Shop 5, Lifestyle Centre',
    address_line2 TEXT DEFAULT 'Corner Witkoppen & Cedar Road',
    address_city TEXT DEFAULT 'Fourways, Johannesburg',
    address_postal TEXT DEFAULT '2191',
    email TEXT DEFAULT 'hello@flirthair.co.za',
    phone TEXT DEFAULT '+27 71 617 8519',
    website TEXT DEFAULT '',
    vat_registered TEXT DEFAULT 'false',
    vat_number TEXT DEFAULT '',
    hours_json TEXT DEFAULT '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":{"open":"09:00","close":"16:00"},"sun":null}',
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default row if not exists
INSERT OR IGNORE INTO business_settings (id) VALUES (1);

-- ============================================
-- DELIVERY CONFIG TABLE (singleton for delivery fees)
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton table
    standard_fee REAL DEFAULT 65,
    express_fee REAL DEFAULT 120,
    free_threshold REAL DEFAULT 500,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default row if not exists
INSERT OR IGNORE INTO delivery_config (id) VALUES (1);

-- ============================================
-- REFERRALS (User referral tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired')),
    referee_first_booking_value REAL,
    reward_issued INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    UNIQUE(referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);

-- ============================================
-- REWARDS PROGRAMME CONFIGURATION (Admin-configurable)
-- ============================================
CREATE TABLE IF NOT EXISTS rewards_config (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton
    programme_enabled INTEGER DEFAULT 1,
    programme_name TEXT DEFAULT 'Salon Rewards',
    terms_conditions TEXT,
    terms_version TEXT DEFAULT '1.0',
    -- Nails track config
    nails_enabled INTEGER DEFAULT 1,
    nails_milestone_1_count INTEGER DEFAULT 6,
    nails_milestone_1_discount REAL DEFAULT 10,
    nails_milestone_2_count INTEGER DEFAULT 12,
    nails_milestone_2_discount REAL DEFAULT 50,
    nails_reward_expiry_days INTEGER DEFAULT 90,
    -- Maintenance track config
    maintenance_enabled INTEGER DEFAULT 1,
    maintenance_milestone_count INTEGER DEFAULT 6,
    maintenance_discount REAL DEFAULT 10,
    maintenance_reward_expiry_days INTEGER DEFAULT 90,
    -- Spend track config
    spend_enabled INTEGER DEFAULT 1,
    spend_threshold REAL DEFAULT 10000,
    spend_discount REAL DEFAULT 20,
    spend_reward_expiry_days INTEGER DEFAULT 90,
    -- Referral config
    referral_enabled INTEGER DEFAULT 1,
    referral_min_booking_value REAL DEFAULT 1000,
    referral_reward_service_id TEXT,
    referral_reward_description TEXT DEFAULT 'Complimentary wash & blow-dry',
    -- Package config
    packages_enabled INTEGER DEFAULT 1,
    wash_blowdry_package_sessions INTEGER DEFAULT 4,
    wash_blowdry_package_discount REAL DEFAULT 20,
    wash_blowdry_service_id TEXT,
    -- General
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO rewards_config (id) VALUES (1);

-- ============================================
-- REWARD TRACKS (User progress tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS reward_tracks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_type TEXT NOT NULL CHECK(track_type IN ('nails', 'maintenance', 'spend')),
    current_count INTEGER DEFAULT 0,
    current_amount REAL DEFAULT 0,
    lifetime_count INTEGER DEFAULT 0,
    lifetime_amount REAL DEFAULT 0,
    last_milestone_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, track_type)
);

CREATE INDEX IF NOT EXISTS idx_reward_tracks_user ON reward_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_tracks_type ON reward_tracks(track_type);

-- ============================================
-- USER REWARDS (Earned vouchers/discounts)
-- ============================================
CREATE TABLE IF NOT EXISTS user_rewards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_type TEXT NOT NULL CHECK(reward_type IN ('percentage_discount', 'fixed_discount', 'free_service')),
    reward_value REAL NOT NULL,
    applicable_to TEXT, -- NULL=any, 'nails', 'maintenance', 'hair', or specific service_id
    description TEXT NOT NULL,
    source_track TEXT NOT NULL, -- 'nails', 'maintenance', 'spend', 'referral', 'manual', 'package'
    source_milestone TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'redeemed', 'expired', 'voided')),
    expires_at TEXT,
    redeemed_at TEXT,
    redeemed_booking_id TEXT REFERENCES bookings(id),
    voided_by TEXT REFERENCES users(id),
    voided_reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_rewards_user ON user_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_rewards_status ON user_rewards(status);
CREATE INDEX IF NOT EXISTS idx_user_rewards_expires ON user_rewards(expires_at);

-- ============================================
-- SERVICE PACKAGES (Purchasable bundles)
-- ============================================
CREATE TABLE IF NOT EXISTS service_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    service_type TEXT NOT NULL,
    applicable_service_id TEXT REFERENCES services(id),
    total_sessions INTEGER NOT NULL,
    base_price REAL NOT NULL,
    discount_percent REAL NOT NULL,
    final_price REAL NOT NULL,
    validity_type TEXT DEFAULT 'calendar_month' CHECK(validity_type IN ('calendar_month', 'days_from_purchase')),
    validity_days INTEGER,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_packages_active ON service_packages(active);

-- ============================================
-- USER PACKAGES (Purchased bundles)
-- ============================================
CREATE TABLE IF NOT EXISTS user_packages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    package_id TEXT NOT NULL REFERENCES service_packages(id),
    package_name TEXT NOT NULL,
    total_sessions INTEGER NOT NULL,
    sessions_used INTEGER DEFAULT 0,
    purchase_price REAL NOT NULL,
    valid_from TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'fully_used', 'expired')),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_packages_user ON user_packages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_packages_status ON user_packages(status);

-- ============================================
-- PACKAGE SESSIONS (Usage log)
-- ============================================
CREATE TABLE IF NOT EXISTS package_sessions (
    id TEXT PRIMARY KEY,
    user_package_id TEXT NOT NULL REFERENCES user_packages(id) ON DELETE CASCADE,
    booking_id TEXT REFERENCES bookings(id),
    used_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_package_sessions_package ON package_sessions(user_package_id);

-- ============================================
-- INVOICE SETTINGS (Business rules configuration)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    tax_enabled INTEGER DEFAULT 1,
    tax_rate REAL DEFAULT 0.15,
    tax_name TEXT DEFAULT 'VAT',
    tax_inclusive INTEGER DEFAULT 0,
    default_service_commission_rate REAL DEFAULT 0.30,
    default_product_commission_rate REAL DEFAULT 0.10,
    default_service_product_commission_rate REAL DEFAULT 0.05,
    invoice_number_prefix TEXT DEFAULT 'INV',
    invoice_number_format TEXT DEFAULT '{PREFIX}-{YEAR}-{NUMBER}',
    next_invoice_number INTEGER DEFAULT 1,
    allow_partial_payments INTEGER DEFAULT 1,
    payment_due_days INTEGER DEFAULT 0,
    max_discount_percentage REAL DEFAULT 100,
    require_discount_reason INTEGER DEFAULT 1,
    deduct_stock_on_finalize INTEGER DEFAULT 1,
    allow_negative_stock INTEGER DEFAULT 0,
    auto_create_invoice_on_completion INTEGER DEFAULT 0,
    require_booking_for_invoice INTEGER DEFAULT 0,
    auto_approve_commission_on_payment INTEGER DEFAULT 1,
    require_admin_commission_approval INTEGER DEFAULT 0,
    auto_send_invoice_email INTEGER DEFAULT 0,
    invoice_email_template TEXT DEFAULT 'default',
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO invoice_settings (id) VALUES (1);

-- ============================================
-- INVOICES TABLE (Main invoice header)
-- ============================================
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE,
    booking_id TEXT REFERENCES bookings(id),
    order_id TEXT REFERENCES orders(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    stylist_id TEXT REFERENCES stylists(id),
    services_subtotal REAL DEFAULT 0,
    products_subtotal REAL DEFAULT 0,
    subtotal REAL NOT NULL,
    discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'loyalty_points', 'promo_code', 'manual')),
    discount_value REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_reason TEXT,
    tax_rate REAL DEFAULT 0.15,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid', 'partial', 'paid', 'refunded', 'written_off')),
    amount_paid REAL DEFAULT 0,
    amount_due REAL DEFAULT 0,
    commission_total REAL DEFAULT 0,
    commission_paid INTEGER DEFAULT 0,
    commission_paid_date TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'finalized', 'sent', 'cancelled', 'void')),
    service_date TEXT NOT NULL,
    invoice_date TEXT DEFAULT (date('now')),
    due_date TEXT,
    finalized_at TEXT,
    internal_notes TEXT,
    client_notes TEXT,
    customer_type TEXT DEFAULT 'individual' CHECK(customer_type IN ('individual', 'company')),
    company_name TEXT,
    business_address TEXT,
    vat_number TEXT,
    company_reg TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- NOTE: Invoice indexes are created via ensureIndex in database.js after migrations
-- to handle cases where columns may not exist on older databases

-- ============================================
-- INVOICE_SERVICES TABLE (Service line items)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_services (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES services(id),
    service_name TEXT NOT NULL,
    service_description TEXT,
    service_category TEXT,
    unit_price REAL NOT NULL,
    quantity REAL DEFAULT 1,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    commission_rate REAL,
    commission_amount REAL,
    duration_minutes INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_services_invoice ON invoice_services(invoice_id);

-- ============================================
-- INVOICE_PRODUCTS TABLE (Product line items)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_products (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_category TEXT,
    product_type TEXT CHECK(product_type IN ('service_product', 'retail')),
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    commission_rate REAL,
    commission_amount REAL,
    deducted_from_stock INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_products_invoice ON invoice_products(invoice_id);

-- ============================================
-- INVOICE_PAYMENTS TABLE (Payment transactions)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft', 'loyalty_points')),
    payment_reference TEXT,
    payment_date TEXT DEFAULT (datetime('now')),
    processor_transaction_id TEXT,
    processor_status TEXT,
    processor_response TEXT,
    notes TEXT,
    processed_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

-- ============================================
-- INVOICE_COMMISSIONS TABLE (Commission tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_commissions (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    stylist_id TEXT NOT NULL REFERENCES stylists(id),
    services_commission REAL DEFAULT 0,
    products_commission REAL DEFAULT 0,
    total_commission REAL NOT NULL,
    payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'approved', 'paid', 'cancelled')),
    payment_date TEXT,
    payment_reference TEXT,
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_commissions_invoice ON invoice_commissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_stylist ON invoice_commissions(stylist_id);

-- ============================================
-- PAYMENT METHODS (Configurable payment options)
-- ============================================
CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER DEFAULT 1,
    transaction_fee_type TEXT DEFAULT 'none' CHECK(transaction_fee_type IN ('none', 'percentage', 'fixed')),
    transaction_fee_value REAL DEFAULT 0,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES
('cash', 'Cash', 'Cash payment at reception', 1),
('card_on_site', 'Card (On Site)', 'Card payment at salon', 2),
('eft', 'EFT', 'Electronic Funds Transfer', 3),
('payfast', 'PayFast', 'Online payment via PayFast', 4),
('yoco', 'Yoco', 'Online payment via Yoco', 5),
('loyalty_points', 'Loyalty Points', 'Pay using loyalty points', 6);

-- ============================================
-- DISCOUNT PRESETS (Quick discount templates)
-- ============================================
CREATE TABLE IF NOT EXISTS discount_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage', 'fixed')),
    discount_value REAL NOT NULL,
    enabled INTEGER DEFAULT 1,
    requires_approval INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO discount_presets (id, name, discount_type, discount_value, display_order) VALUES
('staff', 'Staff Discount', 'percentage', 20, 1),
('loyalty_gold', 'Gold Member', 'percentage', 10, 2),
('loyalty_platinum', 'Platinum Member', 'percentage', 15, 3),
('first_time', 'First Visit', 'percentage', 10, 4),
('referral', 'Referral Bonus', 'fixed', 50, 5);

-- ============================================
-- QUOTES TABLE (Quote/Estimate header)
-- ============================================
CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    quote_number TEXT UNIQUE,
    user_id TEXT REFERENCES users(id),
    stylist_id TEXT REFERENCES stylists(id),
    services_subtotal REAL DEFAULT 0,
    products_subtotal REAL DEFAULT 0,
    subtotal REAL NOT NULL,
    discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'loyalty_points', 'promo_code', 'manual')),
    discount_value REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_reason TEXT,
    tax_rate REAL DEFAULT 0.15,
    tax_amount REAL DEFAULT 0,
    total REAL NOT NULL,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'converted')),
    valid_until TEXT,
    quote_date TEXT DEFAULT (date('now')),
    accepted_at TEXT,
    converted_invoice_id TEXT REFERENCES invoices(id),
    internal_notes TEXT,
    client_notes TEXT,
    customer_type TEXT DEFAULT 'individual' CHECK(customer_type IN ('individual', 'company')),
    company_name TEXT,
    business_address TEXT,
    vat_number TEXT,
    company_reg TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_stylist ON quotes(stylist_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_valid_until ON quotes(valid_until);

-- ============================================
-- QUOTE_SERVICES TABLE (Service line items for quotes)
-- ============================================
CREATE TABLE IF NOT EXISTS quote_services (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES services(id),
    service_name TEXT NOT NULL,
    service_description TEXT,
    service_category TEXT,
    unit_price REAL NOT NULL,
    quantity REAL DEFAULT 1,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    duration_minutes INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quote_services_quote ON quote_services(quote_id);

-- ============================================
-- QUOTE_PRODUCTS TABLE (Product line items for quotes)
-- ============================================
CREATE TABLE IF NOT EXISTS quote_products (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_category TEXT,
    product_type TEXT CHECK(product_type IN ('service_product', 'retail')),
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quote_products_quote ON quote_products(quote_id);
