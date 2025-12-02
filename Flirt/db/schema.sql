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
    duration INTEGER, -- in minutes
    service_type TEXT NOT NULL, -- e.g., 'hair', 'beauty', 'spa', 'nails' (validated in application)
    category TEXT,
    image_url TEXT,
    display_order INTEGER DEFAULT 0,
    commission_rate REAL, -- per-service commission rate (e.g., 0.30 for 30%), NULL = use stylist default
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type);

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
    requested_time_window TEXT CHECK(requested_time_window IN ('MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING')),
    assigned_start_time TEXT,
    assigned_end_time TEXT,
    status TEXT DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),

    -- Legacy fields (kept for backward compatibility during migration)
    date TEXT,
    preferred_time_of_day TEXT,
    time TEXT,
    confirmed_time TEXT,

    -- Commission tracking
    commission_rate REAL, -- override commission rate for this booking, NULL = use service/stylist default
    commission_amount REAL, -- calculated commission amount (snapshot when completed)

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
    sale_price REAL,
    on_sale INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 0,
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
    payment_provider TEXT NOT NULL CHECK(payment_provider IN ('payfast', 'yoco', 'cash', 'card_on_site')),
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
