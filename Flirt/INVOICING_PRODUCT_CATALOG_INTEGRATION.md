# Invoicing System - Product Catalog Integration
**Date:** December 9, 2025

---

## Current Product Catalog Status

### ✅ Already In Database
- **45 Kevin Murphy products** (R300 - R835 range)
- **5 Moyoko products**
- **Total: 50 active products**

### Sample Kevin Murphy Products
```
Kevin Murphy – Doo.over                          R300
Kevin Murphy – Bedroom.hair                      R325
Kevin Murphy – Session.spray Finishing Spray     R325
Kevin Murphy – Ever.thicken                      R580
Kevin Murphy – Body.mass                         R835
Kevin Murphy Re.store Treatment                  R690
Kevin Murphy Scalp.spa Serum                     R790
```

---

## How Invoicing Integrates with Product Catalog

### 1. Product Master Data (Existing `products` table)

The `products` table serves as the **master product catalog**:

```sql
SELECT id, name, price, category FROM products WHERE active = 1;
```

**This contains:**
- Current pricing
- Product descriptions
- Stock levels
- Product images
- Categories

### 2. Invoice Product Line Items (New `invoice_products` table)

When creating an invoice, products are **copied** from the master catalog:

```sql
-- When adding product to invoice
INSERT INTO invoice_products (
    invoice_id,
    product_id,           -- References master catalog
    product_name,         -- SNAPSHOT of name at time of invoice
    product_category,     -- SNAPSHOT of category
    unit_price,           -- SNAPSHOT of price at time of invoice
    quantity,
    total
) VALUES (...);
```

### 3. Why Snapshot Product Data?

**Critical Reason:** Prices change over time!

**Example Scenario:**
```
January 2025:  Kevin Murphy Body.mass = R835
Invoice created: Client charged R835
March 2025:    Price increases to R895
```

If we didn't snapshot:
- Historical invoices would show R895 (wrong!)
- Commission calculations would be incorrect
- Financial audits would fail

**Solution:** Snapshot product details at invoice time

---

## Product Workflow in Invoicing System

### Scenario 1: Adding Retail Product to Invoice

**Admin creates invoice:**

1. **Click "Add Product"** in invoice form
2. **Product picker** shows all active products from master catalog:
   ```
   ┌─────────────────────────────────────────────────┐
   │ ADD PRODUCT                         [Search...] │
   ├─────────────────────────────────────────────────┤
   │ Kevin Murphy Products (45)                      │
   │ ☐ Body.mass                      R835.00        │
   │ ☐ Scalp.spa Serum               R790.00        │
   │ ☐ Re.store Treatment            R690.00        │
   │ ☐ Ever.thicken                  R580.00        │
   │ ...                                             │
   └─────────────────────────────────────────────────┘
   ```

3. **Select product** (e.g., "Body.mass")
4. **System auto-fills:**
   - Product name: "Kevin Murphy – Body.mass"
   - Unit price: R835.00 (from catalog)
   - Category: "Kevin Murphy"
   - Commission rate: 10% (if set in product catalog)

5. **Admin adjusts:**
   - Quantity: 1
   - Discount: R0 (or apply discount)
   - Type: "Retail" (customer takes home)

6. **Save to invoice:**
   ```json
   {
     "product_id": "prod-km-body-mass",
     "product_name": "Kevin Murphy – Body.mass",
     "unit_price": 835.00,
     "quantity": 1,
     "product_type": "retail",
     "total": 835.00
   }
   ```

### Scenario 2: Adding Service Product to Invoice

**Example:** Hair color used during treatment

1. **Admin adds product** (same flow as above)
2. **Select product type:** "Service Product" (not retail)
3. **System behavior:**
   - Product used during treatment (not sold to client)
   - May have different commission rate (5% vs 10%)
   - Still deducts from inventory
   - Tracks cost of service delivery

---

## Product Updates & Price Changes

### Question: When Kevin Murphy updates prices, what happens?

**Answer:** Two-step process

### Step 1: Update Master Catalog (Admin Action)

Admin updates product prices in **Product Management**:

```sql
UPDATE products
SET price = 895.00, updated_at = datetime('now')
WHERE id = 'prod-km-body-mass';
```

**Where:** Admin Console → Products → Edit Product

### Step 2: New Invoices Use New Price

- **Future invoices:** Automatically use R895.00
- **Historical invoices:** Still show R835.00 (snapshot)

**Example:**
```
Invoice INV-001 (Jan 2025):  Body.mass @ R835  ✅ Correct
Invoice INV-100 (Mar 2025):  Body.mass @ R895  ✅ Correct
```

---

## Enhanced Product Schema for Invoicing

### Recommended Product Table Enhancements

Add these columns to existing `products` table:

```sql
-- Add commission tracking
ALTER TABLE products ADD COLUMN commission_rate REAL DEFAULT 0.10; -- 10% default for retail

-- Categorize product usage
ALTER TABLE products ADD COLUMN is_service_product INTEGER DEFAULT 0;
-- 0 = retail (sold to customer)
-- 1 = service product (used during treatment)

-- Cost tracking (optional - for profit analysis)
ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0;
-- What salon pays supplier
-- Profit = price - cost_price
```

### Example Product Records (Enhanced)

```sql
-- Retail product (customer buys)
INSERT INTO products VALUES (
  'prod-km-body-mass',
  'Kevin Murphy – Body.mass',
  'Kevin Murphy',
  'Volumizing styling cream...',
  835.00,                    -- Retail price
  NULL,                      -- No sale price
  0,                         -- Not on sale
  15,                        -- 15 units in stock
  '/images/km-body-mass.jpg',
  1,                         -- Active
  0.10,                      -- 10% commission
  0,                         -- Retail (not service product)
  450.00                     -- Cost price (R385 profit margin)
);

-- Service product (used in salon)
INSERT INTO products VALUES (
  'prod-hair-color-blonde',
  'Professional Blonde Color',
  'Hair Color',
  'Used for balayage and highlights',
  0,                         -- Not sold retail (price = 0)
  NULL,
  0,
  25,                        -- 25 tubes in stock
  NULL,
  1,                         -- Active
  0.05,                      -- 5% commission (lower for service products)
  1,                         -- Service product (used during treatment)
  120.00                     -- Cost per tube
);
```

---

## Product Picker UI in Invoice Form

### Desktop/Admin Console

```
┌─────────────────────────────────────────────────────────────────┐
│ ADD PRODUCT TO INVOICE                                   [Close] │
├─────────────────────────────────────────────────────────────────┤
│ Search: [kevin murphy body________________________] 🔍          │
│                                                                  │
│ Filter: [All Categories ▾] [Retail Products ▾]                 │
├─────────────────────────────────────────────────────────────────┤
│ RESULTS (2)                                                      │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ ✓ Kevin Murphy – Body.mass                                  ││
│ │   Category: Kevin Murphy                                     ││
│ │   Price: R835.00  |  Stock: 15 units  |  Commission: 10%   ││
│ │   [SELECT]                                                   ││
│ └──────────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────────┐│
│ │   Kevin Murphy – Body.builder                               ││
│ │   Category: Kevin Murphy                                     ││
│ │   Price: R580.00  |  Stock: 8 units   |  Commission: 10%   ││
│ │   [SELECT]                                                   ││
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

AFTER SELECTING PRODUCT:

┌─────────────────────────────────────────────────────────────────┐
│ PRODUCT DETAILS                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Product: Kevin Murphy – Body.mass                               │
│ Price:   R835.00 (from catalog)                                 │
│ ────────────────────────────────────────────────────────────────│
│ Quantity:     [___1___]  units                                  │
│ Discount:     [___0___]  Rands (optional)                       │
│ Product Type: ⚫ Retail    ⚪ Service Product                    │
│ ────────────────────────────────────────────────────────────────│
│ Line Total:   R835.00                                           │
│ Commission:   R83.50 (10%)                                      │
│                                                                  │
│                                    [Cancel]  [Add to Invoice]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Updating Kevin Murphy Price List

### Method 1: Manual Update (Admin Console)

**Steps:**
1. Admin Console → Products
2. Find product (search or filter)
3. Click "Edit"
4. Update price
5. Save

**UI:**
```
┌─────────────────────────────────────────────────────────────────┐
│ EDIT PRODUCT                                                     │
├─────────────────────────────────────────────────────────────────┤
│ Name:        [Kevin Murphy – Body.mass__________________]       │
│ Category:    [Kevin Murphy______________________________]       │
│ Description: [Volumizing styling cream_________________]        │
│ Price:       [___895.00___] ← UPDATED FROM R835                │
│ Cost Price:  [___450.00___] (optional)                          │
│ Stock:       [_____15_____]                                     │
│ Commission:  [____10______] %                                   │
│ Type:        ☑ Retail  ☐ Service Product                        │
│                                                                  │
│                                    [Cancel]  [Save Changes]     │
└─────────────────────────────────────────────────────────────────┘
```

### Method 2: Bulk CSV Import (Recommended for price updates)

**When:** Kevin Murphy releases new price list

**Steps:**

1. **Export current products** to CSV
   ```
   Admin Console → Products → Export CSV
   ```

2. **Update prices** in Excel/Google Sheets
   ```csv
   id,name,category,price,commission_rate
   prod-km-body-mass,Kevin Murphy – Body.mass,Kevin Murphy,895.00,0.10
   prod-km-scalp-spa,Kevin Murphy Scalp.spa Serum,Kevin Murphy,850.00,0.10
   ...
   ```

3. **Import updated CSV**
   ```
   Admin Console → Products → Import CSV
   ```

4. **System updates** matching products by ID or name

**API Endpoint:**
```
POST /api/admin/products/bulk-update
Content-Type: multipart/form-data

{
  "csv_file": <uploaded file>,
  "update_mode": "prices_only" // Only update prices, not other fields
}
```

### Method 3: API Integration (Future Enhancement)

If Kevin Murphy has an API:
```
POST /api/admin/products/sync-from-supplier
{
  "supplier": "kevin_murphy",
  "sync_fields": ["price", "stock"]
}
```

---

## Product Inventory Integration

### Retail Products (Stock Deduction)

When invoice is **finalized**:

```javascript
// For each retail product in invoice
for (let product of invoice.products) {
  if (product.product_type === 'retail') {
    // Deduct from stock
    await db.run(`
      UPDATE products
      SET stock = stock - ?
      WHERE id = ?
    `, [product.quantity, product.product_id]);

    // Mark as deducted
    await db.run(`
      UPDATE invoice_products
      SET deducted_from_stock = 1
      WHERE id = ?
    `, [product.id]);
  }
}
```

### Low Stock Alerts

When creating invoice, warn if stock is low:

```
⚠️ WARNING: Only 2 units of "Body.mass" in stock!
   Order more inventory soon.
```

---

## Commission Structure for Products

### Retail Products (Higher Commission)
- Customer buys product
- Higher margin → higher commission
- **Recommended:** 10-15%

### Service Products (Lower Commission)
- Used during treatment
- Cost of doing business
- **Recommended:** 5-10%

### Example Commission Calculation

**Invoice:**
```
Services:
  Balayage Treatment        R1,500  @ 30% = R450 commission

Products (Retail):
  Body.mass                   R835  @ 10% = R83.50 commission

Products (Service):
  Blonde Hair Color           R0    @ 5%  = R0 (cost, not revenue)

TOTAL COMMISSION: R533.50
```

---

## Product Discounts on Invoices

### Scenario: Bundle Deal

**Client books:**
- Lash Lift (R490)
- Buys lash serum (R450)

**Admin creates invoice:**
- Add both items
- Apply 10% discount to serum only
- Line item discount: R45
- Final serum price: R405

**Invoice Line Item:**
```json
{
  "product_name": "Lash Growth Serum",
  "unit_price": 450.00,
  "quantity": 1,
  "discount": 45.00,
  "total": 405.00,
  "commission_amount": 40.50  // 10% of R405 (after discount)
}
```

---

## Product Search & Filtering

### Quick Add (Barcode Scanner - Future)

```
Admin scans product barcode
→ System finds product
→ Auto-adds to invoice
→ Quantity = 1
```

### Favorites/Recent Products

```
┌─────────────────────────────────────────────────────────────────┐
│ ADD PRODUCT                                                      │
├─────────────────────────────────────────────────────────────────┤
│ RECENTLY USED (This Week)                                       │
│ • Body.mass (used 8 times)                                      │
│ • Scalp.spa Serum (used 6 times)                                │
│ • Re.store Treatment (used 5 times)                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary: Product Catalog Integration

### ✅ YES - Products Will Be Updated

1. **Master catalog** (`products` table) stores current prices
2. **Kevin Murphy price updates** → Update master catalog
3. **New invoices** automatically use updated prices
4. **Historical invoices** preserve original prices (snapshot)

### ✅ How to Update Prices

1. **Manual:** Edit individual products in admin console
2. **Bulk:** CSV import for multiple products
3. **API:** Future integration with supplier systems

### ✅ Product Features in Invoicing

- ✅ Product picker from master catalog
- ✅ Auto-fill price, commission, description
- ✅ Retail vs Service product types
- ✅ Stock deduction on finalized invoices
- ✅ Line-item discounts
- ✅ Commission tracking per product
- ✅ Historical price preservation

---

## Next Steps

### Recommended Actions:

1. **Add commission rates** to existing products:
   ```sql
   UPDATE products SET commission_rate = 0.10 WHERE category = 'Kevin Murphy';
   ```

2. **Tag service products:**
   ```sql
   UPDATE products SET is_service_product = 1
   WHERE name LIKE '%Hair Color%' OR name LIKE '%Professional%';
   ```

3. **Verify product prices** are current (last Kevin Murphy update)

4. **Set up CSV import** for future bulk price updates

---

**END OF DOCUMENT**
