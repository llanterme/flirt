-- Migration: Add fields for client import from legacy system
-- Run this migration before importing clients from CSV

-- Add new columns to users table for legacy data import
ALTER TABLE users ADD COLUMN birthday TEXT;
ALTER TABLE users ADD COLUMN client_source TEXT;
ALTER TABLE users ADD COLUMN preferred_stylist_id TEXT REFERENCES stylists(id);
ALTER TABLE users ADD COLUMN legacy_client_no INTEGER;
ALTER TABLE users ADD COLUMN total_service_revenue REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN total_retail_revenue REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN first_visit TEXT;
ALTER TABLE users ADD COLUMN last_visit TEXT;
ALTER TABLE users ADD COLUMN total_visits INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN service_discount_pct REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN retail_discount_pct REAL DEFAULT 0;

-- Create index on legacy_client_no for lookup during import
CREATE INDEX IF NOT EXISTS idx_users_legacy_client_no ON users(legacy_client_no);

-- Create index on preferred_stylist for queries
CREATE INDEX IF NOT EXISTS idx_users_preferred_stylist ON users(preferred_stylist_id);
