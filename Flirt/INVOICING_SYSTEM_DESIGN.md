# Flirt Hair & Beauty - Invoicing System Design
**Process & Systems Analysis**
Date: December 9, 2025
Version: 1.0

---

## Executive Summary

This document outlines a comprehensive invoicing system for Flirt Hair & Beauty to address the business requirement that **final service pricing cannot be determined until after treatment completion**. The system decouples payment from booking, introduces post-treatment invoicing, and ensures accurate commission and payroll calculations based on actual services rendered and products used.

---

## 1. Current System Analysis

### 1.1 Current State
- **70 active services** (beauty & hair treatments)
- **50 active products** (retail & professional use)
- **Booking-centric payment**: Clients can pay when booking (before service is rendered)
- **Fixed pricing**: Bookings capture estimated service price upfront
- **Commission calculation**: Currently tied to booking completion, not actual invoice
- **Problem**: Final treatment cost often differs from booking estimate due to:
  - Additional services added during treatment
  - Products used/applied during service
  - Time extensions or treatment modifications
  - Retail products purchased alongside service

### 1.2 Business Requirements
1. ✅ **Flexible pricing**: Final price determined post-treatment
2. ✅ **Invoice-based payment**: Client pays only after invoice is created
3. ✅ **Commission accuracy**: Calculate from actual invoiced amounts
4. ✅ **Product tracking**: Link products used during service and retail sales
5. ✅ **Audit trail**: Clear lineage from booking → service → invoice → payment
6. ✅ **Payroll integration**: Calculate stylist earnings from verified invoices

---

## 2. System Design Overview

### 2.1 Core Workflow

```
BOOKING PHASE (Appointment Scheduling)
    ↓
CLIENT ARRIVES (Check-in)
    ↓
SERVICE DELIVERY (Treatment performed)
    ↓
INVOICE CREATION (Post-treatment, actual services & products)
    ↓
PAYMENT PROCESSING (Client pays based on invoice)
    ↓
COMMISSION CALCULATION (Stylist earns based on paid invoice)
    ↓
PAYROLL PROCESSING (Aggregated from all paid invoices)
```

### 2.2 Key Principles

1. **Booking is Intent, Invoice is Reality**: Bookings are estimates; invoices reflect actual services
2. **Pay What You Get**: Clients only pay for what was actually delivered
3. **Earn What You Deliver**: Stylists earn commission on paid invoices, not bookings
4. **Product Accountability**: Track both service products (used) and retail products (sold)
5. **Audit Everything**: Full traceability for financial accuracy

---

## 3. Database Schema Design

### 3.1 New Tables

#### **invoices** (Core invoice header)
```sql
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,                    -- e.g., 'INV-2025-00001'
    invoice_number TEXT UNIQUE NOT NULL,    -- Human-readable: 'INV-2025-00001'
    booking_id TEXT REFERENCES bookings(id), -- Original booking (nullable for walk-ins)
    user_id TEXT NOT NULL REFERENCES users(id),
    stylist_id TEXT NOT NULL REFERENCES stylists(id),

    -- Financial totals
    services_subtotal REAL DEFAULT 0,       -- Sum of all service line items
    products_subtotal REAL DEFAULT 0,       -- Sum of all product line items
    subtotal REAL NOT NULL,                 -- services_subtotal + products_subtotal

    -- Discounts & adjustments
    discount_type TEXT CHECK(discount_type IN ('percentage', 'fixed', 'loyalty_points', 'promo_code')),
    discount_value REAL DEFAULT 0,          -- Percentage (0-100) or fixed amount
    discount_amount REAL DEFAULT 0,         -- Actual discount applied in Rands
    discount_reason TEXT,                   -- Why discount was applied

    -- Tax (if applicable - SA VAT is 15%)
    tax_rate REAL DEFAULT 0.15,             -- 15% VAT
    tax_amount REAL DEFAULT 0,

    -- Final total
    total REAL NOT NULL,                    -- subtotal - discount_amount + tax_amount

    -- Payment tracking
    payment_status TEXT DEFAULT 'unpaid' CHECK(
        payment_status IN ('unpaid', 'partial', 'paid', 'refunded', 'written_off')
    ),
    amount_paid REAL DEFAULT 0,             -- Total amount received
    amount_due REAL DEFAULT 0,              -- Remaining balance

    -- Commission tracking
    commission_total REAL DEFAULT 0,        -- Total commission for stylist
    commission_paid INTEGER DEFAULT 0,      -- Has commission been paid to stylist?
    commission_paid_date TEXT,              -- When commission was paid

    -- Status and workflow
    status TEXT DEFAULT 'draft' CHECK(
        status IN ('draft', 'finalized', 'sent', 'cancelled', 'void')
    ),

    -- Timestamps
    service_date TEXT NOT NULL,             -- Date service was performed
    invoice_date TEXT DEFAULT (date('now')),
    due_date TEXT,                          -- Payment due date (optional)
    finalized_at TEXT,                      -- When invoice was locked

    -- Notes
    internal_notes TEXT,                    -- Admin/stylist notes (not visible to client)
    client_notes TEXT,                      -- Visible on invoice

    -- Audit
    created_by TEXT REFERENCES users(id),   -- Who created the invoice
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,

    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id)
);

CREATE INDEX idx_invoices_booking ON invoices(booking_id);
CREATE INDEX idx_invoices_user ON invoices(user_id);
CREATE INDEX idx_invoices_stylist ON invoices(stylist_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX idx_invoices_service_date ON invoices(service_date);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
```

#### **invoice_services** (Service line items)
```sql
CREATE TABLE IF NOT EXISTS invoice_services (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES services(id),            -- Reference to service catalog

    -- Service details (snapshot at time of invoice)
    service_name TEXT NOT NULL,
    service_description TEXT,
    service_category TEXT,

    -- Pricing
    unit_price REAL NOT NULL,               -- Price per unit/hour
    quantity REAL DEFAULT 1,                -- Usually 1, but can be hours or units
    discount REAL DEFAULT 0,                -- Line-item discount
    total REAL NOT NULL,                    -- (unit_price * quantity) - discount

    -- Commission
    commission_rate REAL,                   -- Override rate for this line item
    commission_amount REAL,                 -- Calculated commission for this service

    -- Duration tracking
    duration_minutes INTEGER,               -- Actual time spent on service

    -- Notes
    notes TEXT,                             -- Special notes about this service

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
);

CREATE INDEX idx_invoice_services_invoice ON invoice_services(invoice_id);
CREATE INDEX idx_invoice_services_service ON invoice_services(service_id);
```

#### **invoice_products** (Product line items)
```sql
CREATE TABLE IF NOT EXISTS invoice_products (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),            -- Reference to product catalog

    -- Product details (snapshot at time of invoice)
    product_name TEXT NOT NULL,
    product_category TEXT,
    product_type TEXT CHECK(product_type IN ('service_product', 'retail')),
    -- 'service_product' = used during treatment (e.g., hair color)
    -- 'retail' = sold to customer to take home

    -- Pricing
    unit_price REAL NOT NULL,               -- Price per unit
    quantity REAL NOT NULL,                 -- Number of units
    discount REAL DEFAULT 0,                -- Line-item discount
    total REAL NOT NULL,                    -- (unit_price * quantity) - discount

    -- Commission
    commission_rate REAL,                   -- Product commission rate (usually different from service)
    commission_amount REAL,                 -- Calculated commission for this product

    -- Inventory tracking
    deducted_from_stock INTEGER DEFAULT 0,  -- Has this been deducted from inventory?

    -- Notes
    notes TEXT,                             -- E.g., "Used for balayage"

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX idx_invoice_products_invoice ON invoice_products(invoice_id);
CREATE INDEX idx_invoice_products_product ON invoice_products(product_id);
CREATE INDEX idx_invoice_products_type ON invoice_products(product_type);
```

#### **invoice_payments** (Payment transactions linked to invoices)
```sql
CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,

    -- Payment details
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(
        payment_method IN ('payfast', 'yoco', 'cash', 'card_on_site', 'eft', 'loyalty_points')
    ),
    payment_reference TEXT,                 -- Transaction ID, receipt number, etc.
    payment_date TEXT DEFAULT (datetime('now')),

    -- Payment processor details
    processor_transaction_id TEXT,          -- External payment gateway ID
    processor_status TEXT,                  -- Gateway status
    processor_response TEXT,                -- Full response (JSON)

    -- Notes
    notes TEXT,

    -- Audit
    processed_by TEXT REFERENCES users(id), -- Staff who processed payment
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
    FOREIGN KEY (processed_by) REFERENCES users(id)
);

CREATE INDEX idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_date ON invoice_payments(payment_date);
CREATE INDEX idx_invoice_payments_method ON invoice_payments(payment_method);
```

#### **invoice_commissions** (Commission tracking per invoice)
```sql
CREATE TABLE IF NOT EXISTS invoice_commissions (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    stylist_id TEXT NOT NULL REFERENCES stylists(id),

    -- Commission breakdown
    services_commission REAL DEFAULT 0,     -- Commission from service line items
    products_commission REAL DEFAULT 0,     -- Commission from product line items
    total_commission REAL NOT NULL,         -- services_commission + products_commission

    -- Payment tracking
    payment_status TEXT DEFAULT 'pending' CHECK(
        payment_status IN ('pending', 'approved', 'paid', 'cancelled')
    ),
    payment_date TEXT,                      -- When commission was paid
    payment_reference TEXT,                 -- Payroll reference

    -- Audit
    approved_by TEXT REFERENCES users(id),  -- Admin who approved commission
    approved_at TEXT,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (stylist_id) REFERENCES stylists(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX idx_invoice_commissions_invoice ON invoice_commissions(invoice_id);
CREATE INDEX idx_invoice_commissions_stylist ON invoice_commissions(stylist_id);
CREATE INDEX idx_invoice_commissions_status ON invoice_commissions(payment_status);
CREATE INDEX idx_invoice_commissions_date ON invoice_commissions(payment_date);
```

### 3.2 Modified Tables

#### **bookings** (Add invoice relationship)
```sql
-- Add to existing bookings table:
ALTER TABLE bookings ADD COLUMN invoice_id TEXT REFERENCES invoices(id);
ALTER TABLE bookings ADD COLUMN invoiced INTEGER DEFAULT 0; -- Quick flag for filtering

CREATE INDEX idx_bookings_invoice ON bookings(invoice_id);
CREATE INDEX idx_bookings_invoiced ON bookings(invoiced);
```

#### **products** (Add commission rate)
```sql
-- Add to existing products table:
ALTER TABLE products ADD COLUMN commission_rate REAL DEFAULT 0; -- e.g., 0.10 for 10%
ALTER TABLE products ADD COLUMN is_service_product INTEGER DEFAULT 0; -- Used during services vs retail
```

---

## 4. Business Process Flows

### 4.1 Booking Phase (No Payment)

**Steps:**
1. Customer books appointment online or in-salon
2. System creates booking record with **estimated** service price
3. Booking status: `REQUESTED` → `CONFIRMED`
4. **No payment collected** (or optional deposit)
5. Customer receives confirmation email

**Booking State:**
```json
{
  "status": "CONFIRMED",
  "service_price": 500.00,  // Estimate only
  "payment_status": "unpaid",
  "invoiced": false
}
```

### 4.2 Service Delivery Phase

**Steps:**
1. Customer arrives at salon
2. Stylist performs service
3. During service:
   - May add additional services
   - May use professional products
   - May extend service time
4. Service completed, booking status → `COMPLETED`

**Booking State:**
```json
{
  "status": "COMPLETED",
  "payment_status": "unpaid",
  "invoiced": false  // Still not invoiced
}
```

### 4.3 Invoice Creation Phase (Critical)

**Who:** Stylist or Admin
**When:** Immediately after service completion
**Where:** Admin console or stylist tablet

**Steps:**

1. **Initiate Invoice:**
   - Admin/stylist clicks "Create Invoice" from completed booking
   - System pre-populates invoice with booking details

2. **Add Services:**
   - Add booked service (pre-populated)
   - Add any additional services performed
   - Adjust quantities/durations if needed
   - Set per-service pricing (may differ from catalog)

3. **Add Products:**
   - Add service products used (e.g., hair color, treatments)
   - Add retail products purchased
   - Set quantities and prices

4. **Apply Discounts:**
   - Loyalty points redemption
   - Promotional codes
   - Manual discount (with reason)

5. **Review Totals:**
   - Services subtotal
   - Products subtotal
   - Discounts
   - Tax (15% VAT)
   - **Final total**

6. **Add Notes:**
   - Client-visible notes
   - Internal notes

7. **Save as Draft** or **Finalize:**
   - Draft: Can be edited
   - Finalized: Locked, generates invoice number

8. **System Actions on Finalize:**
   - Generate invoice number (e.g., `INV-2025-00001`)
   - Calculate commissions per line item
   - Update booking: `invoiced = 1`, `invoice_id = xxx`
   - Deduct retail products from inventory
   - Send invoice to customer (email/SMS)

**Invoice State:**
```json
{
  "invoice_number": "INV-2025-00001",
  "status": "finalized",
  "subtotal": 850.00,
  "discount_amount": 85.00,
  "tax_amount": 114.75,
  "total": 879.75,
  "payment_status": "unpaid",
  "commission_total": 263.93
}
```

### 4.4 Payment Processing Phase

**Steps:**

1. **Customer Pays:**
   - At reception: Cash, card on-site
   - Online: PayFast, Yoco link
   - Later: Invoice sent via email/SMS with payment link

2. **Record Payment:**
   - Admin/stylist enters payment in system
   - Creates `invoice_payments` record
   - Updates invoice: `amount_paid`, `payment_status`

3. **Payment Status Logic:**
   - `unpaid`: amount_paid = 0
   - `partial`: 0 < amount_paid < total
   - `paid`: amount_paid >= total

4. **System Actions:**
   - Update booking: `payment_status = 'paid'`
   - Send payment receipt to customer
   - Update stylist commission status to `approved`

**Payment Record:**
```json
{
  "invoice_id": "INV-2025-00001",
  "amount": 879.75,
  "payment_method": "card_on_site",
  "payment_date": "2025-01-15 14:30:00",
  "processed_by": "admin-001"
}
```

### 4.5 Commission & Payroll Phase

**Commission Calculation (Automatic):**

For each invoice line item:
```
Service Commission = service_total × commission_rate
Product Commission = product_total × commission_rate
Total Commission = Σ(services) + Σ(products)
```

**Payroll Processing (Monthly):**

1. **Generate Payroll Report:**
   - Filter: `invoice_commissions.payment_status = 'approved'`
   - Date range: e.g., 2025-01-01 to 2025-01-31
   - Group by stylist

2. **Stylist Earnings Breakdown:**
   ```
   Base Pay: R8,000
   Commission (Services): R12,500
   Commission (Products): R2,300
   Total Earnings: R22,800
   ```

3. **Mark as Paid:**
   - Update `invoice_commissions.payment_status = 'paid'`
   - Set `payment_date` and `payment_reference`
   - Update `invoices.commission_paid = 1`

---

## 5. Commission Structure

### 5.1 Commission Hierarchy (Override Logic)

**Priority (highest to lowest):**
1. **Invoice line item** commission rate (if set)
2. **Service/Product** commission rate (in catalog)
3. **Stylist** default commission rate
4. **System default** (30%)

### 5.2 Example Commission Rates

| Item Type | Commission Rate | Example |
|-----------|----------------|---------|
| Hair Extensions | 30% | R1,500 service → R450 commission |
| Beauty Services | 25% | R400 facial → R100 commission |
| Retail Products | 10% | R300 shampoo → R30 commission |
| Service Products | 5% | R200 hair color → R10 commission |

### 5.3 Commission Calculation Logic

```javascript
function calculateLineItemCommission(lineItem, service, stylist) {
  // Determine commission rate (hierarchy)
  let rate = lineItem.commission_rate
    || service.commission_rate
    || stylist.commission_rate
    || 0.30; // 30% default

  // Calculate commission
  let commission = lineItem.total * rate;

  return {
    rate: rate,
    amount: commission
  };
}
```

---

## 6. User Interface Design

### 6.1 Admin Console - Invoice Management

#### **Invoice List View**
```
┌─────────────────────────────────────────────────────────────────┐
│ INVOICES                                    [+ Create Invoice]  │
├─────────────────────────────────────────────────────────────────┤
│ Filters: [All Status ▾] [All Stylists ▾] [Date Range ▾]        │
├────────┬────────────┬──────────┬──────────┬──────────┬─────────┤
│ Invoice│ Date       │ Client   │ Stylist  │ Total    │ Status  │
├────────┼────────────┼──────────┼──────────┼──────────┼─────────┤
│ INV-001│ 2025-01-15│ Sarah J. │ Thandi   │ R879.75  │ ⚠ Unpaid│
│ INV-002│ 2025-01-15│ Mike K.  │ Zinhle   │ R1,250.00│ ✓ Paid  │
│ INV-003│ 2025-01-14│ Lisa M.  │ Thandi   │ R650.00  │ 📝 Draft│
└────────┴────────────┴──────────┴──────────┴──────────┴─────────┘
```

#### **Create/Edit Invoice Form**

```
┌─────────────────────────────────────────────────────────────────┐
│ CREATE INVOICE                                   [Save Draft] [Finalize] │
├─────────────────────────────────────────────────────────────────┤
│ Client: Sarah Johnson                    Booking: BKG-2025-0045 │
│ Stylist: Thandi Nkosi                    Date: 2025-01-15       │
├─────────────────────────────────────────────────────────────────┤
│ SERVICES                                          [+ Add Service]│
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ ✓ Lash Lift & Tint               R490.00 × 1    R490.00    ││
│ │ ✓ Brow Lamination                R400.00 × 1    R400.00    ││
│ │                                                              ││
│ └──────────────────────────────────────────────────────────────┘│
│                                        Services Total: R890.00   │
├─────────────────────────────────────────────────────────────────┤
│ PRODUCTS                                         [+ Add Product]│
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ 🛍 Kevin Murphy Shimmer Spray    R580.00 × 1    R580.00    ││
│ │   Type: Retail                                              ││
│ └──────────────────────────────────────────────────────────────┘│
│                                        Products Total: R580.00   │
├─────────────────────────────────────────────────────────────────┤
│ ADJUSTMENTS                                                      │
│ Discount Type: [Loyalty Points ▾]                               │
│ Discount Amount: R85.00                                          │
│ Reason: VIP client - 10% loyalty discount                       │
├─────────────────────────────────────────────────────────────────┤
│ TOTALS                                                           │
│ Subtotal:              R1,470.00                                 │
│ Discount:              -R85.00                                   │
│ Tax (15% VAT):         +R207.75                                  │
│ ─────────────────────────────────                               │
│ TOTAL:                 R1,592.75                                 │
│                                                                  │
│ Stylist Commission: R441.00 (30%)                               │
├─────────────────────────────────────────────────────────────────┤
│ NOTES                                                            │
│ Client Notes: Thank you for your visit! 💕                      │
│ Internal Notes: Client requested extra time for application     │
└─────────────────────────────────────────────────────────────────┘
```

#### **Invoice Detail View**

```
┌─────────────────────────────────────────────────────────────────┐
│ INVOICE INV-2025-00001                          [Print] [Email] │
├─────────────────────────────────────────────────────────────────┤
│ Status: ⚠ UNPAID                        [Record Payment]        │
│ Date: January 15, 2025                                           │
│ Client: Sarah Johnson (sarah@email.com)                         │
│ Stylist: Thandi Nkosi                                           │
│ Booking: BKG-2025-0045                                          │
├─────────────────────────────────────────────────────────────────┤
│ SERVICES RENDERED                                                │
│   Lash Lift & Tint                              R490.00         │
│   Brow Lamination                               R400.00         │
│                                        Subtotal: R890.00         │
├─────────────────────────────────────────────────────────────────┤
│ PRODUCTS                                                         │
│   Kevin Murphy Shimmer Spray (Retail)           R580.00         │
│                                        Subtotal: R580.00         │
├─────────────────────────────────────────────────────────────────┤
│ Subtotal:                                      R1,470.00         │
│ Loyalty Discount (10%):                          -R85.00         │
│ Tax (15% VAT):                                  +R207.75         │
│ ═══════════════════════════════════════════════════════         │
│ TOTAL:                                         R1,592.75         │
│                                                                  │
│ Amount Paid:                                      R0.00          │
│ Amount Due:                                   R1,592.75          │
├─────────────────────────────────────────────────────────────────┤
│ COMMISSION BREAKDOWN                                             │
│   Services (30%):                               R267.00         │
│   Products (10%):                                R58.00         │
│   Total Commission:                             R325.00         │
│   Status: Pending Payment                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Payment Recording Interface

```
┌─────────────────────────────────────────────────────────────────┐
│ RECORD PAYMENT - Invoice INV-2025-00001                         │
├─────────────────────────────────────────────────────────────────┤
│ Invoice Total: R1,592.75                                         │
│ Amount Paid: R0.00                                               │
│ Amount Due: R1,592.75                                            │
├─────────────────────────────────────────────────────────────────┤
│ Payment Amount: [________________] R1,592.75                     │
│ Payment Method: [Card on Site    ▾]                             │
│ Payment Date:   [2025-01-15      📅]                             │
│ Reference:      [________________] (optional)                    │
│ Notes:          [________________________________]               │
│                                                                  │
│                                    [Cancel]  [Record Payment]   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Commission Report View

```
┌─────────────────────────────────────────────────────────────────┐
│ COMMISSION REPORT - January 2025                                │
├─────────────────────────────────────────────────────────────────┤
│ Stylist: Thandi Nkosi                                           │
│ Period: 2025-01-01 to 2025-01-31                               │
├─────────────────────────────────────────────────────────────────┤
│ EARNINGS SUMMARY                                                 │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ Paid Invoices:        25 invoices                           ││
│ │ Total Sales:          R42,500.00                            ││
│ │ Services Commission:  R12,750.00                            ││
│ │ Products Commission:  R1,250.00                             ││
│ │ ─────────────────────────────────────                      ││
│ │ TOTAL COMMISSION:     R14,000.00                            ││
│ │                                                              ││
│ │ Commission Status:    ⚠ Pending Payment                     ││
│ └──────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│ COMMISSION BREAKDOWN                                    [Export] │
│ ┌────────┬────────────┬──────────┬──────────┬─────────────────┐│
│ │Invoice │ Date       │ Client   │ Total    │ Commission      ││
│ ├────────┼────────────┼──────────┼──────────┼─────────────────┤│
│ │INV-001 │ 2025-01-15│ Sarah J. │R1,592.75 │ R325.00 ✓ Paid││
│ │INV-003 │ 2025-01-14│ Lisa M.  │  R650.00 │ R195.00 ✓ Paid││
│ │INV-007 │ 2025-01-13│ Jane D.  │R2,100.00 │ R630.00 ✓ Paid││
│ └────────┴────────────┴──────────┴──────────┴─────────────────┘│
│                                                                  │
│                                    [Mark All as Paid]           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. API Endpoints

### 7.1 Invoice CRUD Operations

#### **POST /api/admin/invoices**
Create new invoice

**Request:**
```json
{
  "booking_id": "bkg-001",
  "user_id": "user-123",
  "stylist_id": "stylist-001",
  "service_date": "2025-01-15",
  "services": [
    {
      "service_id": "svc-lash-lift",
      "quantity": 1,
      "unit_price": 490,
      "commission_rate": 0.30
    }
  ],
  "products": [
    {
      "product_id": "prod-shimmer",
      "quantity": 1,
      "unit_price": 580,
      "product_type": "retail",
      "commission_rate": 0.10
    }
  ],
  "discount_type": "loyalty_points",
  "discount_value": 85,
  "client_notes": "Thank you!"
}
```

**Response:**
```json
{
  "success": true,
  "invoice": {
    "id": "inv-001",
    "invoice_number": null,
    "status": "draft",
    "subtotal": 1470.00,
    "total": 1592.75,
    "commission_total": 325.00
  }
}
```

#### **PUT /api/admin/invoices/:id/finalize**
Finalize invoice (lock and generate invoice number)

**Response:**
```json
{
  "success": true,
  "invoice": {
    "id": "inv-001",
    "invoice_number": "INV-2025-00001",
    "status": "finalized",
    "finalized_at": "2025-01-15T14:30:00Z"
  }
}
```

#### **GET /api/admin/invoices**
List all invoices with filters

**Query Params:**
- `status`: draft, finalized, sent, cancelled
- `payment_status`: unpaid, partial, paid
- `stylist_id`: Filter by stylist
- `start_date`, `end_date`: Date range
- `page`, `limit`: Pagination

#### **GET /api/admin/invoices/:id**
Get single invoice with all line items

#### **PUT /api/admin/invoices/:id**
Update invoice (only if status = 'draft')

#### **DELETE /api/admin/invoices/:id**
Delete invoice (only if status = 'draft')

### 7.2 Payment Operations

#### **POST /api/admin/invoices/:id/payments**
Record payment against invoice

**Request:**
```json
{
  "amount": 1592.75,
  "payment_method": "card_on_site",
  "payment_reference": "TXN-12345",
  "notes": "Paid in full at reception"
}
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pmt-001",
    "invoice_id": "inv-001",
    "amount": 1592.75,
    "payment_date": "2025-01-15T14:45:00Z"
  },
  "invoice": {
    "payment_status": "paid",
    "amount_paid": 1592.75,
    "amount_due": 0
  }
}
```

#### **GET /api/admin/invoices/:id/payments**
Get all payments for an invoice

### 7.3 Commission & Payroll

#### **GET /api/admin/commissions**
Get commission report

**Query Params:**
- `stylist_id`: Filter by stylist
- `start_date`, `end_date`: Date range
- `payment_status`: pending, approved, paid

**Response:**
```json
{
  "stylist_id": "stylist-001",
  "stylist_name": "Thandi Nkosi",
  "period": {
    "start": "2025-01-01",
    "end": "2025-01-31"
  },
  "summary": {
    "invoices_count": 25,
    "total_sales": 42500.00,
    "services_commission": 12750.00,
    "products_commission": 1250.00,
    "total_commission": 14000.00
  },
  "invoices": [...]
}
```

#### **POST /api/admin/commissions/mark-paid**
Mark commissions as paid (bulk operation)

**Request:**
```json
{
  "invoice_ids": ["inv-001", "inv-002", "inv-003"],
  "payment_reference": "PAYROLL-2025-01",
  "payment_date": "2025-02-01"
}
```

### 7.4 Customer-Facing Endpoints

#### **GET /api/invoices/my-invoices**
Get current user's invoices (authenticated)

#### **GET /api/invoices/:id**
Get single invoice (customer view)

#### **POST /api/invoices/:id/pay**
Initiate payment for invoice (redirect to PayFast/Yoco)

---

## 8. Business Rules & Validations

### 8.1 Invoice Creation Rules

1. ✅ **Booking Link Optional**: Walk-in clients don't need bookings
2. ✅ **At Least One Line Item**: Must have services or products
3. ✅ **Status Workflow**: Draft → Finalized → Sent (one-way)
4. ✅ **Edit Restrictions**: Can only edit if status = 'draft'
5. ✅ **Finalize Checks**:
   - All required fields present
   - All calculations correct
   - Invoice number generated
   - Commission calculated

### 8.2 Payment Rules

1. ✅ **Partial Payments Allowed**: Can pay in installments
2. ✅ **Overpayment Prevented**: amount_paid ≤ total
3. ✅ **Payment Methods**: Cash, card, EFT, PayFast, Yoco, loyalty points
4. ✅ **Payment Status Auto-Update**:
   ```javascript
   if (amount_paid === 0) status = 'unpaid'
   else if (amount_paid < total) status = 'partial'
   else if (amount_paid >= total) status = 'paid'
   ```

### 8.3 Commission Rules

1. ✅ **No Commission Until Paid**: Commission status = 'pending' until invoice paid
2. ✅ **Commission Approved on Payment**: Auto-approve when invoice fully paid
3. ✅ **Commission Rate Hierarchy**: Line item > Service/Product > Stylist > Default
4. ✅ **Refunds Reverse Commission**: If invoice refunded, commission reversed
5. ✅ **Payroll Batch Processing**: Mark multiple commissions as paid together

### 8.4 Inventory Rules

1. ✅ **Retail Products**: Deduct from stock when invoice finalized
2. ✅ **Service Products**: Optionally track usage (for cost accounting)
3. ✅ **Stock Check**: Warn if product quantity > available stock
4. ✅ **Refund Handling**: Return items to stock if invoice cancelled/refunded

---

## 9. Migration Strategy

### 9.1 Phase 1: Schema Migration (Week 1)

**Tasks:**
1. Create new tables: `invoices`, `invoice_services`, `invoice_products`, `invoice_payments`, `invoice_commissions`
2. Alter existing tables: Add `invoice_id`, `invoiced` to `bookings`
3. Alter products: Add `commission_rate`, `is_service_product`
4. Run migration script with rollback capability

**SQL Script:**
```sql
-- Execute schema changes
-- Test on staging database first
-- Backup production before migration
```

### 9.2 Phase 2: Backend Implementation (Week 2-3)

**Tasks:**
1. Create `InvoiceRepository` in `db/database.js`
2. Implement invoice CRUD operations
3. Implement payment recording
4. Implement commission calculations
5. Add API endpoints to `server.js`
6. Write unit tests for invoice logic

### 9.3 Phase 3: Admin UI (Week 4-5)

**Tasks:**
1. Add Invoice Management section to admin console
2. Create invoice list view
3. Create invoice creation form
4. Create payment recording interface
5. Create commission report view
6. Test all workflows end-to-end

### 9.4 Phase 4: Customer UI (Week 6)

**Tasks:**
1. Add "My Invoices" section to customer app
2. Display invoice details
3. Enable online payment for unpaid invoices
4. Send invoice via email/SMS
5. PDF invoice generation (optional)

### 9.5 Phase 5: Payroll Integration (Week 7)

**Tasks:**
1. Build payroll report generation
2. Integrate with existing payroll tracking
3. Export commission data to CSV/Excel
4. Mark commissions as paid in bulk

### 9.6 Phase 6: Historical Data (Optional)

**Decision Point:** Do we create invoices for historical bookings?

**Option A: Forward-Looking Only**
- Only new bookings (post-migration) use invoicing
- Historical data remains as-is
- Simpler migration

**Option B: Backfill Historical Invoices**
- Create invoices for recent completed bookings
- Use booking data to populate invoice fields
- Enables historical commission recalculation

---

## 10. Reporting & Analytics

### 10.1 Key Reports

#### **Invoice Summary Report**
- Total invoices by status
- Total revenue by period
- Average invoice value
- Payment method breakdown

#### **Stylist Performance Report**
- Revenue per stylist
- Commission earned vs paid
- Service mix analysis
- Product sales by stylist

#### **Financial Health Report**
- Outstanding invoices (aging report)
- Paid vs unpaid ratio
- Revenue trends over time
- Tax collected (VAT report)

#### **Product Usage Report**
- Service products used per treatment
- Retail product sales
- Commission from products
- Inventory turnover

### 10.2 Dashboard Widgets

```
┌─────────────────────────────────────────────────────────────────┐
│ INVOICING DASHBOARD                                             │
├─────────────────────────────────────────────────────────────────┤
│ ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│ │ Unpaid Invoices│  │ Revenue (MTD)  │  │ Avg Invoice    │    │
│ │                │  │                │  │                │    │
│ │     ⚠ 12       │  │  R125,400.00   │  │   R1,254.00    │    │
│ │                │  │                │  │                │    │
│ │ Total: R15,200 │  │ ↑ 15% vs last  │  │ ↑ 8% vs last   │    │
│ └────────────────┘  └────────────────┘  └────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│ PENDING COMMISSIONS                                             │
│ ┌────────────────┬───────────────────────────────────────────┐ │
│ │ Thandi Nkosi   │ R14,000.00 (25 invoices)    [Mark Paid] │ │
│ │ Zinhle Dlamini │ R12,500.00 (22 invoices)    [Mark Paid] │ │
│ │ Nombuso Khumalo│ R11,200.00 (19 invoices)    [Mark Paid] │ │
│ └────────────────┴───────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ RECENT INVOICES                                     [View All]  │
│ INV-00045  Sarah Johnson    R1,592.75  ⚠ Unpaid   10 min ago  │
│ INV-00044  Mike Khumalo     R1,250.00  ✓ Paid     1 hour ago  │
│ INV-00043  Lisa Mdlalose      R650.00  ✓ Paid     2 hours ago │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Edge Cases & Error Handling

### 11.1 Scenario: Walk-In Client (No Booking)

**Solution:**
- Allow invoice creation without `booking_id`
- Admin manually selects client, stylist, services
- Flow: Service → Invoice → Payment

### 11.2 Scenario: Partial Payment

**Example:**
- Invoice total: R1,500
- Customer pays: R1,000 today
- Remaining: R500 (pay later)

**Handling:**
- Create first payment record: R1,000
- Invoice status: `partial`
- Send reminder for remaining R500
- Create second payment record when paid

### 11.3 Scenario: Refund

**Steps:**
1. Admin clicks "Refund Invoice"
2. Enter refund amount and reason
3. System:
   - Updates payment_status: `refunded`
   - Reverses commission (status: `cancelled`)
   - Returns retail products to stock
   - Records refund transaction

### 11.4 Scenario: Invoice Dispute

**Steps:**
1. Customer disputes charge
2. Admin adds internal notes to invoice
3. Admin can void invoice
4. Create new corrected invoice if needed

### 11.5 Scenario: Service Product Tracking

**Question:** Do we track cost of service products?

**Answer:** Optional - can add `cost_price` to products table
- Track product usage cost
- Calculate profit margin per service
- Enables true profitability analysis

---

## 12. Security & Permissions

### 12.1 Role-Based Access

| Action | Customer | Staff | Admin |
|--------|----------|-------|-------|
| View own invoices | ✅ | ❌ | ✅ |
| View all invoices | ❌ | ❌ | ✅ |
| Create invoice | ❌ | ✅* | ✅ |
| Edit draft invoice | ❌ | ✅* | ✅ |
| Finalize invoice | ❌ | ❌ | ✅ |
| Record payment | ❌ | ✅ | ✅ |
| Refund invoice | ❌ | ❌ | ✅ |
| View commissions | ❌ | Own only | All |
| Mark commission paid | ❌ | ❌ | ✅ |

*Staff can only manage invoices for their own clients

### 12.2 Audit Trail

**Log all invoice operations:**
- Who created/edited/finalized
- Payment processor details
- Commission approval chain
- Refund authorization

---

## 13. Integration Points

### 13.1 Existing Systems

**Bookings:**
- Link invoice to original booking
- Update booking payment status when invoice paid

**Loyalty Points:**
- Allow points redemption as payment
- Award points when invoice paid

**Inventory:**
- Deduct retail products from stock
- Track service product usage

**Email/SMS:**
- Send invoice to customer
- Send payment reminders
- Send receipt on payment

**Push Notifications:**
- Notify customer: "Your invoice is ready"
- Notify admin: "Payment received"

### 13.2 Payment Gateways

**PayFast & Yoco:**
- Generate payment link from invoice
- Handle webhook callbacks
- Update invoice on payment success/failure

---

## 14. Testing Strategy

### 14.1 Unit Tests

- Invoice calculation logic
- Commission calculation
- Payment status transitions
- Inventory deduction

### 14.2 Integration Tests

- Full invoice creation flow
- Payment recording and status updates
- Commission calculation from paid invoices
- Booking → Invoice → Payment → Commission

### 14.3 User Acceptance Testing

**Test Scenarios:**
1. Create invoice for simple booking (1 service)
2. Create invoice with multiple services + products
3. Apply loyalty discount
4. Record partial payment
5. Record full payment
6. Generate commission report
7. Mark commissions as paid
8. Refund invoice
9. Walk-in client (no booking)
10. Online payment via PayFast

---

## 15. Success Metrics

### 15.1 Business KPIs

- **Invoice Turnaround Time:** Time from service completion to invoice creation
  - Target: < 10 minutes

- **Payment Collection Rate:** % of invoices paid within 7 days
  - Target: > 90%

- **Commission Accuracy:** % of commissions correctly calculated
  - Target: 100%

- **Payroll Processing Time:** Time to generate monthly payroll
  - Target: < 30 minutes

### 15.2 System Performance

- Invoice creation: < 2 seconds
- Invoice list page load: < 1 second
- Payment recording: < 2 seconds
- Commission report generation: < 5 seconds

---

## 16. Next Steps & Recommendations

### 16.1 Immediate Actions

1. ✅ **Approve Design:** Review and approve this document
2. ✅ **Prioritize Features:** Must-have vs nice-to-have
3. ✅ **Assign Resources:** Developer(s) and timeline
4. ✅ **Set Up Staging:** Test environment for development

### 16.2 Design Decisions Needed

**Question 1:** Should we backfill historical invoices?
- Recommendation: **No** - forward-looking only for simplicity

**Question 2:** Do we track service product costs?
- Recommendation: **Phase 2** - start with retail only

**Question 3:** PDF invoice generation?
- Recommendation: **Phase 2** - HTML invoice sufficient for now

**Question 4:** Multiple stylists per invoice?
- Recommendation: **No** - one stylist per invoice (split into multiple invoices if needed)

**Question 5:** Deposits on booking?
- Recommendation: **Yes** - allow optional deposit, deduct from final invoice

### 16.3 Training Plan

**Staff Training (1 hour session):**
- How to create invoices after service
- Adding services and products
- Recording payments
- Understanding commission reports

**Admin Training (2 hour session):**
- Full invoice management
- Refund handling
- Commission approval and payroll
- Report generation

---

## 17. Appendix

### 17.1 Sample Invoice (PDF Output)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                    FLIRT HAIR & BEAUTY                          │
│                     Invoice INV-2025-00001                      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Invoice Date: January 15, 2025                                  │
│ Service Date: January 15, 2025                                  │
│                                                                  │
│ Bill To:                      Stylist:                          │
│ Sarah Johnson                 Thandi Nkosi                      │
│ sarah@email.com              thandi@flirt.co.za                │
│ +27 82 123 4567                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ SERVICES                                                         │
│ ─────────────────────────────────────────────────────────────── │
│ Lash Lift & Tint                                     R490.00    │
│ Brow Lamination                                      R400.00    │
│                                                                  │
│ PRODUCTS                                                         │
│ ─────────────────────────────────────────────────────────────── │
│ Kevin Murphy Shimmer Spray                           R580.00    │
│                                                                  │
│                                        ─────────────────────────│
│                                        Subtotal:     R1,470.00  │
│                                        Discount:        -R85.00  │
│                                        Tax (15%):     +R207.75  │
│                                        ═════════════════════════│
│                                        TOTAL:        R1,592.75  │
│                                                                  │
│                                        Amount Paid:      R0.00  │
│                                        Amount Due:   R1,592.75  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ PAYMENT METHODS                                                  │
│ • Cash/Card at reception                                        │
│ • Online: https://pay.flirt.co.za/inv/INV-2025-00001          │
│                                                                  │
│ Thank you for choosing Flirt Hair & Beauty! 💕                  │
│                                                                  │
│ Questions? Contact us: info@flirt.co.za | +27 11 123 4567      │
└─────────────────────────────────────────────────────────────────┘
```

### 17.2 Database Size Estimates

**Assumptions:**
- 100 invoices/month
- Avg 2 services per invoice
- Avg 1 product per invoice
- 2 payments per invoice (avg)

**Annual Storage:**
```
invoices:           1,200 rows × 1 KB  = 1.2 MB
invoice_services:   2,400 rows × 0.5 KB = 1.2 MB
invoice_products:   1,200 rows × 0.5 KB = 0.6 MB
invoice_payments:   2,400 rows × 0.5 KB = 1.2 MB
invoice_commissions: 1,200 rows × 0.3 KB = 0.4 MB
─────────────────────────────────────────────
TOTAL:                                 4.6 MB/year
```

Conclusion: Negligible storage impact.

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-09 | Systems Analyst | Initial design document |

---

**END OF DOCUMENT**
