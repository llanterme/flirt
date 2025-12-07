-- Migration: Add hair_profile and notification_prefs columns to users table
-- Date: 2025-12-07

-- Add hair_profile column (JSON object for hair profile data)
ALTER TABLE users ADD COLUMN hair_profile TEXT;

-- Add notification_prefs column (JSON object for notification preferences)
ALTER TABLE users ADD COLUMN notification_prefs TEXT;
