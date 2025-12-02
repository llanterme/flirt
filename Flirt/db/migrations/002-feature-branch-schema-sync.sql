-- Migration: Sync schema from feature_italo_branch to main
-- This migration brings the main branch database up to compatibility
-- with all features developed in the feature branch.
--
-- Run: node db/run-migration.js 002-feature-branch-schema-sync
--
-- Changes included:
-- 1. Stylists: payroll fields (basic_monthly_pay, commission_rate)
-- 2. Services: image_url, display_order, commission_rate, flexible service_type
-- 3. Bookings: two-step booking flow, commission tracking
-- 4. Orders: payment_status field, 'paid' status
-- 5. Promos: promotional display fields
-- 6. New tables: payment_settings, chat, gallery, hair_tips, hair_tracker_settings, payroll_records

-- ============================================
-- 1. STYLISTS TABLE - Add payroll fields
-- ============================================
ALTER TABLE stylists ADD COLUMN basic_monthly_pay REAL DEFAULT 0;
ALTER TABLE stylists ADD COLUMN commission_rate REAL DEFAULT 0;

-- ============================================
-- 2. SERVICES TABLE - Add new columns
-- ============================================
ALTER TABLE services ADD COLUMN image_url TEXT;
ALTER TABLE services ADD COLUMN display_order INTEGER DEFAULT 0;
ALTER TABLE services ADD COLUMN commission_rate REAL;

-- Note: The CHECK constraint on service_type is being relaxed.
-- SQLite doesn't support ALTER CONSTRAINT, so new service types
-- (spa, nails, etc.) will be validated at the application level.

-- ============================================
-- 3. BOOKINGS TABLE - Two-step booking flow
-- ============================================
-- Add new booking flow columns
ALTER TABLE bookings ADD COLUMN requested_date TEXT;
ALTER TABLE bookings ADD COLUMN requested_time_window TEXT;
ALTER TABLE bookings ADD COLUMN assigned_start_time TEXT;
ALTER TABLE bookings ADD COLUMN assigned_end_time TEXT;

-- Add commission tracking columns
ALTER TABLE bookings ADD COLUMN commission_rate REAL;
ALTER TABLE bookings ADD COLUMN commission_amount REAL;

-- Create new indexes for the two-step booking flow
CREATE INDEX IF NOT EXISTS idx_bookings_requested_date ON bookings(requested_date);
CREATE INDEX IF NOT EXISTS idx_bookings_requested_time_window ON bookings(requested_time_window);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_start_time ON bookings(assigned_start_time);

-- ============================================
-- 4. ORDERS TABLE - Payment status tracking
-- ============================================
ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid';

-- Note: The CHECK constraint on status needs 'paid' added.
-- SQLite doesn't support ALTER CONSTRAINT, so this is validated
-- at the application level. New valid statuses:
-- 'pending', 'processing', 'shipped', 'delivered', 'cancelled', 'paid'

-- ============================================
-- 5. PROMOS TABLE - Promotional display fields
-- ============================================
ALTER TABLE promos ADD COLUMN highlighted INTEGER DEFAULT 0;
ALTER TABLE promos ADD COLUMN badge TEXT;
ALTER TABLE promos ADD COLUMN title TEXT;
ALTER TABLE promos ADD COLUMN subtitle TEXT;
ALTER TABLE promos ADD COLUMN priority INTEGER DEFAULT 0;

-- ============================================
-- 6. NEW TABLE: payment_settings
-- ============================================
CREATE TABLE IF NOT EXISTS payment_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- 7. NEW TABLE: chat_conversations
-- ============================================
CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    guest_id TEXT,
    user_name TEXT NOT NULL,
    user_email TEXT,
    source TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    assigned_to TEXT REFERENCES users(id),
    unread_by_agent INTEGER DEFAULT 0,
    unread_by_user INTEGER DEFAULT 0,
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
-- 8. NEW TABLE: chat_messages
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    from_type TEXT NOT NULL CHECK(from_type IN ('user', 'agent', 'system')),
    text TEXT NOT NULL,
    agent_id TEXT REFERENCES users(id),
    read_by_agent INTEGER DEFAULT 0,
    read_by_user INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_created ON chat_messages(created_at);

-- ============================================
-- 9. NEW TABLE: gallery_items
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

-- ============================================
-- 10. NEW TABLE: gallery_settings
-- ============================================
CREATE TABLE IF NOT EXISTS gallery_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- 11. NEW TABLE: hair_tips
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
-- 12. NEW TABLE: hair_tracker_settings
-- ============================================
CREATE TABLE IF NOT EXISTS hair_tracker_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================
-- 13. NEW TABLE: payroll_records
-- ============================================
CREATE TABLE IF NOT EXISTS payroll_records (
    id TEXT PRIMARY KEY,
    stylist_id TEXT NOT NULL REFERENCES stylists(id),
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    basic_pay REAL NOT NULL,
    commission_rate REAL NOT NULL,
    total_bookings INTEGER DEFAULT 0,
    total_service_revenue REAL DEFAULT 0,
    total_service_revenue_ex_vat REAL DEFAULT 0,
    commission_amount REAL DEFAULT 0,
    gross_pay REAL DEFAULT 0,
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
