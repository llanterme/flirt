-- ============================================
-- BUSINESS RULES CONFIGURATION TABLE
-- Allows admin to configure invoicing rules from admin console
-- ============================================

CREATE TABLE IF NOT EXISTS invoice_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1), -- Only one row allowed

    -- Tax Configuration
    tax_enabled INTEGER DEFAULT 1,
    tax_rate REAL DEFAULT 0.15,           -- 15% VAT (South Africa)
    tax_name TEXT DEFAULT 'VAT',
    tax_inclusive INTEGER DEFAULT 0,      -- 0 = tax added to subtotal, 1 = tax included in prices

    -- Commission Defaults
    default_service_commission_rate REAL DEFAULT 0.30,     -- 30% for services
    default_product_commission_rate REAL DEFAULT 0.10,     -- 10% for retail products
    default_service_product_commission_rate REAL DEFAULT 0.05, -- 5% for products used in services

    -- Invoice Numbering
    invoice_number_prefix TEXT DEFAULT 'INV',
    invoice_number_format TEXT DEFAULT '{PREFIX}-{YEAR}-{NUMBER}', -- e.g. INV-2025-00001
    next_invoice_number INTEGER DEFAULT 1,

    -- Payment Settings
    allow_partial_payments INTEGER DEFAULT 1,
    payment_due_days INTEGER DEFAULT 0,   -- 0 = immediate, 7 = due in 7 days, etc.

    -- Discount Settings
    max_discount_percentage REAL DEFAULT 100,  -- Max % discount allowed
    require_discount_reason INTEGER DEFAULT 1, -- Require reason for discounts

    -- Stock Management
    deduct_stock_on_finalize INTEGER DEFAULT 1, -- Deduct stock when invoice finalized
    allow_negative_stock INTEGER DEFAULT 0,     -- Allow selling when out of stock

    -- Booking Integration
    auto_create_invoice_on_completion INTEGER DEFAULT 0, -- Auto-create invoice when booking completed
    require_booking_for_invoice INTEGER DEFAULT 0,       -- Must have booking to create invoice

    -- Commission Approval
    auto_approve_commission_on_payment INTEGER DEFAULT 1, -- Auto-approve when invoice paid
    require_admin_commission_approval INTEGER DEFAULT 0,  -- Admin must manually approve

    -- Email Settings
    auto_send_invoice_email INTEGER DEFAULT 0,
    invoice_email_template TEXT DEFAULT 'default',

    -- Metadata
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now')),

    CHECK(tax_rate >= 0 AND tax_rate <= 1),
    CHECK(default_service_commission_rate >= 0 AND default_service_commission_rate <= 1),
    CHECK(default_product_commission_rate >= 0 AND default_product_commission_rate <= 1)
);

-- Insert default settings
INSERT OR IGNORE INTO invoice_settings (id) VALUES (1);

-- ============================================
-- PAYMENT METHOD CONFIGURATION
-- Allows admin to enable/disable payment methods and set fees
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

-- Insert default payment methods
INSERT OR IGNORE INTO payment_methods (id, name, description, display_order) VALUES
('cash', 'Cash', 'Cash payment at reception', 1),
('card_on_site', 'Card (On Site)', 'Card payment at salon using card machine', 2),
('eft', 'EFT', 'Electronic Funds Transfer', 3),
('payfast', 'PayFast', 'Online payment via PayFast', 4),
('yoco', 'Yoco', 'Online payment via Yoco', 5),
('loyalty_points', 'Loyalty Points', 'Pay using loyalty points', 6);

-- ============================================
-- DISCOUNT PRESETS
-- Pre-configured discount options for quick selection
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

-- Insert default discount presets
INSERT OR IGNORE INTO discount_presets (id, name, description, discount_type, discount_value, display_order) VALUES
('vip-10', 'VIP Client (10%)', '10% discount for VIP clients', 'percentage', 10, 1),
('vip-15', 'VIP Client (15%)', '15% discount for VIP clients', 'percentage', 15, 2),
('first-time', 'First Time Client', 'R50 off for first-time clients', 'fixed', 50, 3),
('staff-discount', 'Staff Discount (20%)', '20% discount for staff members', 'percentage', 20, 4),
('loyalty-reward', 'Loyalty Reward', 'Reward for loyal customers', 'percentage', 5, 5);

CREATE INDEX IF NOT EXISTS idx_payment_methods_enabled ON payment_methods(enabled);
CREATE INDEX IF NOT EXISTS idx_discount_presets_enabled ON discount_presets(enabled);
