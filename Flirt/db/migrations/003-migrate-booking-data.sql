-- Migration: Migrate existing booking data to new schema
-- This migration converts existing booking data to the new two-step booking flow format.
--
-- Run AFTER: 002-feature-branch-schema-sync.sql
-- Run: node db/run-migration.js 003-migrate-booking-data
--
-- Changes:
-- 1. Populate requested_date from legacy date field
-- 2. Convert status values to uppercase format
-- 3. Map preferred_time_of_day to requested_time_window

-- ============================================
-- 1. Populate requested_date from date field
-- ============================================
UPDATE bookings
SET requested_date = date
WHERE requested_date IS NULL AND date IS NOT NULL;

-- ============================================
-- 2. Convert status values to uppercase
-- ============================================
-- pending -> REQUESTED
UPDATE bookings SET status = 'REQUESTED' WHERE LOWER(status) = 'pending';

-- confirmed -> CONFIRMED
UPDATE bookings SET status = 'CONFIRMED' WHERE LOWER(status) = 'confirmed';

-- completed -> COMPLETED
UPDATE bookings SET status = 'COMPLETED' WHERE LOWER(status) = 'completed';

-- cancelled -> CANCELLED
UPDATE bookings SET status = 'CANCELLED' WHERE LOWER(status) = 'cancelled';

-- ============================================
-- 3. Map preferred_time_of_day to requested_time_window
-- ============================================
-- Convert common time preferences to the new window format
UPDATE bookings
SET requested_time_window = 'MORNING'
WHERE requested_time_window IS NULL
  AND (LOWER(preferred_time_of_day) LIKE '%morning%'
       OR LOWER(preferred_time_of_day) LIKE '%am%'
       OR preferred_time_of_day = 'MORNING');

UPDATE bookings
SET requested_time_window = 'AFTERNOON'
WHERE requested_time_window IS NULL
  AND (LOWER(preferred_time_of_day) LIKE '%afternoon%'
       OR preferred_time_of_day = 'AFTERNOON');

UPDATE bookings
SET requested_time_window = 'LATE_AFTERNOON'
WHERE requested_time_window IS NULL
  AND (LOWER(preferred_time_of_day) LIKE '%late afternoon%'
       OR preferred_time_of_day = 'LATE_AFTERNOON');

UPDATE bookings
SET requested_time_window = 'EVENING'
WHERE requested_time_window IS NULL
  AND (LOWER(preferred_time_of_day) LIKE '%evening%'
       OR LOWER(preferred_time_of_day) LIKE '%pm%'
       OR preferred_time_of_day = 'EVENING');

-- ============================================
-- 4. Set assigned times from confirmed_time for confirmed/completed bookings
-- ============================================
UPDATE bookings
SET assigned_start_time = confirmed_time
WHERE assigned_start_time IS NULL
  AND confirmed_time IS NOT NULL
  AND status IN ('CONFIRMED', 'COMPLETED');

-- Also use legacy time field if confirmed_time is not set
UPDATE bookings
SET assigned_start_time = time
WHERE assigned_start_time IS NULL
  AND time IS NOT NULL
  AND status IN ('CONFIRMED', 'COMPLETED');
