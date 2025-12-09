-- ============================================
-- INVOICES TABLE (Main invoice header)
-- ============================================
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE,
    booking_id TEXT REFERENCES bookings(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    stylist_id TEXT NOT NULL REFERENCES stylists(id),

    -- Financial totals
    services_subtotal REAL DEFAULT 0,
    products_subtotal REAL DEFAULT 0,
    subtotal REAL NOT NULL,

    -- Discounts & adjustments
    discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'loyalty_points', 'promo_code', 'manual')),
    discount_value REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_reason TEXT,

    -- Tax (SA VAT is 15%)
    tax_rate REAL DEFAULT 0.15,
    tax_amount REAL DEFAULT 0,

    -- Final total
    total REAL NOT NULL,

    -- Payment tracking
    payment_status TEXT DEFAULT 'unpaid' CHECK(
        payment_status IN ('unpaid', 'partial', 'paid', 'refunded', 'written_off')
    ),
    amount_paid REAL DEFAULT 0,
    amount_due REAL DEFAULT 0,

    -- Commission tracking
    commission_total REAL DEFAULT 0,
    commission_paid INTEGER DEFAULT 0,
    commission_paid_date TEXT,

    -- Status and workflow
    status TEXT DEFAULT 'draft' CHECK(
        status IN ('draft', 'finalized', 'sent', 'cancelled', 'void')
    ),

    -- Timestamps
    service_date TEXT NOT NULL,
    invoice_date TEXT DEFAULT (date('now')),
    due_date TEXT,
    finalized_at TEXT,

    -- Notes
    internal_notes TEXT,
    client_notes TEXT,

    -- Audit
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,

    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_stylist ON invoices(stylist_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_service_date ON invoices(service_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);

-- ============================================
-- INVOICE_SERVICES TABLE (Service line items)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_services (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES services(id),

    -- Service details (snapshot at time of invoice)
    service_name TEXT NOT NULL,
    service_description TEXT,
    service_category TEXT,

    -- Pricing
    unit_price REAL NOT NULL,
    quantity REAL DEFAULT 1,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,

    -- Commission
    commission_rate REAL,
    commission_amount REAL,

    -- Duration tracking
    duration_minutes INTEGER,

    -- Notes
    notes TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_services_invoice ON invoice_services(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_services_service ON invoice_services(service_id);

-- ============================================
-- INVOICE_PRODUCTS TABLE (Product line items)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_products (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),

    -- Product details (snapshot at time of invoice)
    product_name TEXT NOT NULL,
    product_category TEXT,
    product_type TEXT CHECK(product_type IN ('service_product', 'retail')),

    -- Pricing
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    discount REAL DEFAULT 0,
    total REAL NOT NULL,

    -- Commission
    commission_rate REAL,
    commission_amount REAL,

    -- Inventory tracking
    deducted_from_stock INTEGER DEFAULT 0,

    -- Notes
    notes TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_products_invoice ON invoice_products(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_products_product ON invoice_products(product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_products_type ON invoice_products(product_type);

-- ============================================
-- INVOICE_PAYMENTS TABLE (Payment transactions)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,

    -- Payment details
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(
        payment_method IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft', 'loyalty_points')
    ),
    payment_reference TEXT,
    payment_date TEXT DEFAULT (datetime('now')),

    -- Payment processor details
    processor_transaction_id TEXT,
    processor_status TEXT,
    processor_response TEXT,

    -- Notes
    notes TEXT,

    -- Audit
    processed_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
    FOREIGN KEY (processed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_date ON invoice_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_method ON invoice_payments(payment_method);

-- ============================================
-- INVOICE_COMMISSIONS TABLE (Commission tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS invoice_commissions (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    stylist_id TEXT NOT NULL REFERENCES stylists(id),

    -- Commission breakdown
    services_commission REAL DEFAULT 0,
    products_commission REAL DEFAULT 0,
    total_commission REAL NOT NULL,

    -- Payment tracking
    payment_status TEXT DEFAULT 'pending' CHECK(
        payment_status IN ('pending', 'approved', 'paid', 'cancelled')
    ),
    payment_date TEXT,
    payment_reference TEXT,

    -- Audit
    approved_by TEXT REFERENCES users(id),
    approved_at TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (stylist_id) REFERENCES stylists(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_commissions_invoice ON invoice_commissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_stylist ON invoice_commissions(stylist_id);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_status ON invoice_commissions(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoice_commissions_date ON invoice_commissions(payment_date);

-- ============================================
-- BOOKINGS TABLE UPDATES (Add invoice link)
-- ============================================
ALTER TABLE bookings ADD COLUMN invoice_id TEXT REFERENCES invoices(id);
ALTER TABLE bookings ADD COLUMN invoiced INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_invoice ON bookings(invoice_id);
CREATE INDEX IF NOT EXISTS idx_bookings_invoiced ON bookings(invoiced);
