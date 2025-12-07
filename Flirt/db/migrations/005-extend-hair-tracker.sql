-- Migration: Extend hair_tracker table with additional fields
-- Date: 2025-12-07

-- Add new columns to hair_tracker table (SQLite uses ALTER TABLE ADD COLUMN)
-- These columns store additional tracker data

-- Add maintenance_interval_days column
ALTER TABLE hair_tracker ADD COLUMN maintenance_interval_days INTEGER DEFAULT 42;

-- Add next_maintenance_date column
ALTER TABLE hair_tracker ADD COLUMN next_maintenance_date TEXT;

-- Add last_deep_condition_date column
ALTER TABLE hair_tracker ADD COLUMN last_deep_condition_date TEXT;

-- Add last_wash_date column
ALTER TABLE hair_tracker ADD COLUMN last_wash_date TEXT;

-- Add hair_health_score column
ALTER TABLE hair_tracker ADD COLUMN hair_health_score INTEGER DEFAULT 100;

-- Add wash_history column (JSON array)
ALTER TABLE hair_tracker ADD COLUMN wash_history TEXT;

-- Add products_used column (JSON array)
ALTER TABLE hair_tracker ADD COLUMN products_used TEXT;
