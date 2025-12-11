-- ============================================
-- Migration: Add bookable flag to services
-- Purpose: Distinguish between client-bookable services and invoice-only services
-- Date: 2025-12-11
-- ============================================

-- Add bookable column to services table (defaults to 1 = bookable)
ALTER TABLE services ADD COLUMN bookable INTEGER DEFAULT 1;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_services_bookable ON services(bookable);

-- ============================================
-- Mark non-bookable categories (invoice/admin only)
-- These are NOT available for client appointment booking
-- ============================================

-- Retail products (invoice only)
UPDATE services SET bookable = 0 WHERE category = 'MK Retail';
UPDATE services SET bookable = 0 WHERE category = 'Wella Professional';

-- Session redemptions (internal tracking)
UPDATE services SET bookable = 0 WHERE category = 'Session Redemptions';

-- Training services (internal staff training)
UPDATE services SET bookable = 0 WHERE category = 'TRAINING';

-- Professional/internal services
UPDATE services SET bookable = 0 WHERE category = 'Professional Basin';

-- General category items that are likely internal
UPDATE services SET bookable = 0 WHERE category = 'General' AND (
    name LIKE '%Tip%' OR
    name LIKE '%Gift%' OR
    name LIKE '%Voucher%' OR
    name LIKE '%Credit%' OR
    name LIKE '%Discount%' OR
    name LIKE '%Adjustment%'
);

-- ============================================
-- All other categories remain bookable by default:
-- - Consultation
-- - Cut & Styling (in Colour category)
-- - Colour Services
-- - Lightening Services (in Colour category)
-- - Balayage (in Colour category)
-- - Treatments
-- - Extension Maintenance
-- - Bridal
-- - Brows and Lashes
-- - Extensions Service
-- - Facials
-- - Lash Extensions
-- - Make Up
-- - Male Grooming
-- - Nails
-- - Pedicure
-- - Spraytan
-- - Waxing
-- ============================================
