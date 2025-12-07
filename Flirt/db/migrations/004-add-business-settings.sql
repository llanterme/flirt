-- Migration: Add business settings and delivery config tables
-- Date: 2024-12-07

-- ============================================
-- BUSINESS SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS business_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton table
    business_name TEXT DEFAULT 'Flirt Hair Extensions',
    email TEXT DEFAULT 'hello@flirthair.co.za',
    phone TEXT DEFAULT '+27 71 617 8519',
    address TEXT DEFAULT '58 Nuwe Hoop St, Maroelana, Pretoria, 0081, South Africa',
    hours_json TEXT DEFAULT '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":{"open":"09:00","close":"16:00"},"sun":null}',
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default row if not exists
INSERT OR IGNORE INTO business_settings (id) VALUES (1);

-- ============================================
-- DELIVERY CONFIG TABLE
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
