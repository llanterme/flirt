-- =====================================================
-- BOOKING FLOW REDESIGN - DATABASE MIGRATION
-- =====================================================
-- This migration updates the bookings table to support the new two-step booking flow:
-- 1. Client requests with time window
-- 2. Admin assigns exact time
--
-- Run this migration BEFORE deploying new code
-- =====================================================

-- Step 1: Add new columns
ALTER TABLE bookings ADD COLUMN requested_date TEXT;
ALTER TABLE bookings ADD COLUMN requested_time_window TEXT CHECK(requested_time_window IN ('MORNING', 'AFTERNOON', 'LATE_AFTERNOON', 'EVENING', NULL));
ALTER TABLE bookings ADD COLUMN assigned_start_time TEXT;
ALTER TABLE bookings ADD COLUMN assigned_end_time TEXT;
ALTER TABLE bookings ADD COLUMN new_status TEXT CHECK(new_status IN ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'));

-- Step 2: Migrate existing data
-- 2a. Migrate requested_date from existing date field
UPDATE bookings SET requested_date = date WHERE requested_date IS NULL;

-- 2b. Migrate requested_time_window from preferred_time_of_day
-- Map old values to new enum (handle case variations)
UPDATE bookings
SET requested_time_window =
  CASE
    WHEN LOWER(preferred_time_of_day) IN ('morning', 'am', 'early') THEN 'MORNING'
    WHEN LOWER(preferred_time_of_day) IN ('afternoon', 'pm', 'midday') THEN 'AFTERNOON'
    WHEN LOWER(preferred_time_of_day) IN ('late afternoon', 'late', 'late_afternoon') THEN 'LATE_AFTERNOON'
    WHEN LOWER(preferred_time_of_day) IN ('evening', 'night', 'late evening') THEN 'EVENING'
    ELSE 'AFTERNOON' -- default fallback
  END
WHERE requested_time_window IS NULL AND preferred_time_of_day IS NOT NULL;

-- 2c. For bookings with no time preference, default to AFTERNOON
UPDATE bookings
SET requested_time_window = 'AFTERNOON'
WHERE requested_time_window IS NULL;

-- 2d. Migrate assigned_start_time from confirmed_time
-- If there's a confirmed_time, it means admin has assigned an exact time
UPDATE bookings
SET assigned_start_time =
  CASE
    -- If confirmed_time has a date, use it directly
    WHEN confirmed_time LIKE '%-%-%T%:%' THEN confirmed_time
    -- If confirmed_time is just time (HH:MM), combine with date
    WHEN confirmed_time LIKE '__:__' THEN requested_date || 'T' || confirmed_time || ':00.000Z'
    -- If time field exists and looks like HH:MM, use it
    WHEN time LIKE '__:__' THEN requested_date || 'T' || time || ':00.000Z'
    ELSE NULL
  END
WHERE assigned_start_time IS NULL;

-- 2e. Calculate assigned_end_time (add 1-2 hours based on service type)
-- This is a rough estimate - you may want to use actual service duration
UPDATE bookings
SET assigned_end_time =
  datetime(assigned_start_time, '+2 hours')
WHERE assigned_start_time IS NOT NULL
  AND assigned_end_time IS NULL;

-- 2f. Migrate status to new enum
UPDATE bookings
SET new_status =
  CASE status
    -- If status is 'pending' but has assigned time → CONFIRMED
    WHEN 'pending' THEN
      CASE
        WHEN assigned_start_time IS NOT NULL THEN 'CONFIRMED'
        ELSE 'REQUESTED'
      END
    -- confirmed → CONFIRMED
    WHEN 'confirmed' THEN 'CONFIRMED'
    -- completed → COMPLETED
    WHEN 'completed' THEN 'COMPLETED'
    -- cancelled → CANCELLED
    WHEN 'cancelled' THEN 'CANCELLED'
    ELSE 'REQUESTED'
  END
WHERE new_status IS NULL;

-- Step 3: Verify migration (optional - for logging/debugging)
-- SELECT
--   id,
--   status as old_status,
--   new_status,
--   date as old_date,
--   requested_date,
--   preferred_time_of_day as old_time_window,
--   requested_time_window,
--   confirmed_time as old_confirmed,
--   assigned_start_time,
--   assigned_end_time
-- FROM bookings
-- LIMIT 10;

-- Step 4: Drop old columns (run this AFTER verifying migration)
-- IMPORTANT: Comment out until you've verified the migration!
-- ALTER TABLE bookings DROP COLUMN preferred_time_of_day;
-- ALTER TABLE bookings DROP COLUMN time;
-- ALTER TABLE bookings DROP COLUMN confirmed_time;
-- ALTER TABLE bookings DROP COLUMN date;
-- ALTER TABLE bookings DROP COLUMN status;

-- Step 5: Rename new_status to status (after dropping old status)
-- ALTER TABLE bookings RENAME COLUMN new_status TO status;

-- Step 6: Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_bookings_requested_date ON bookings(requested_date);
CREATE INDEX IF NOT EXISTS idx_bookings_requested_time_window ON bookings(requested_time_window);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_start_time ON bookings(assigned_start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_new_status ON bookings(new_status);

-- =====================================================
-- ROLLBACK PLAN (if needed)
-- =====================================================
-- If you need to rollback:
-- 1. Restore from backup
-- OR
-- 2. Drop new columns:
--    ALTER TABLE bookings DROP COLUMN requested_date;
--    ALTER TABLE bookings DROP COLUMN requested_time_window;
--    ALTER TABLE bookings DROP COLUMN assigned_start_time;
--    ALTER TABLE bookings DROP COLUMN assigned_end_time;
--    ALTER TABLE bookings DROP COLUMN new_status;
-- =====================================================

-- =====================================================
-- POST-MIGRATION NOTES
-- =====================================================
-- After running this migration:
-- 1. Verify data integrity with sample queries
-- 2. Update application code to use new columns
-- 3. Run Step 4 to drop old columns (only after code is deployed and verified)
-- 4. Monitor for any issues in first few days
-- =====================================================
