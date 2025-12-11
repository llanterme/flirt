-- ============================================
-- Migration: Add Service-to-Reward-Track Mappings
-- Purpose: Allow admin to configure which services trigger which reward tracks
-- Date: 2025-12-11
-- ============================================

-- ============================================
-- REWARD TRACK DEFINITIONS (Admin-configurable tracks)
-- Replaces hardcoded track types with dynamic definitions
-- ============================================
CREATE TABLE IF NOT EXISTS reward_track_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,                    -- 'nails', 'maintenance', 'spend', or custom
    display_name TEXT NOT NULL,                   -- 'Nails Rewards', 'Extensions Maintenance'
    description TEXT,
    track_type TEXT NOT NULL CHECK(track_type IN ('visit_count', 'spend_amount')),  -- How progress is measured
    icon TEXT DEFAULT '🎁',                       -- Emoji or icon code

    -- Milestone configuration (stored as JSON for flexibility)
    milestones TEXT NOT NULL DEFAULT '[]',        -- JSON: [{"count": 6, "reward_type": "percentage_discount", "reward_value": 10}]

    -- Reward defaults
    reward_expiry_days INTEGER DEFAULT 90,
    reward_applicable_to TEXT,                    -- NULL=any, 'same_category', or specific restriction

    -- Status
    active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reward_track_defs_active ON reward_track_definitions(active);

-- ============================================
-- SERVICE-TO-REWARD-TRACK MAPPINGS
-- Links services to reward tracks for automatic progress tracking
-- ============================================
CREATE TABLE IF NOT EXISTS service_reward_mappings (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES reward_track_definitions(id) ON DELETE CASCADE,

    -- Optional overrides for this specific service-track combination
    points_multiplier REAL DEFAULT 1.0,           -- 1.5 = 150% credit toward track
    require_payment INTEGER DEFAULT 1,            -- 1 = Only count if invoice is paid

    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),

    UNIQUE(service_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_service_reward_map_service ON service_reward_mappings(service_id);
CREATE INDEX IF NOT EXISTS idx_service_reward_map_track ON service_reward_mappings(track_id);

-- ============================================
-- CATEGORY-TO-REWARD-TRACK MAPPINGS (Bulk assignment)
-- Allows mapping entire categories to tracks
-- ============================================
CREATE TABLE IF NOT EXISTS category_reward_mappings (
    id TEXT PRIMARY KEY,
    category_name TEXT NOT NULL,                  -- Matches services.category
    track_id TEXT NOT NULL REFERENCES reward_track_definitions(id) ON DELETE CASCADE,

    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),

    UNIQUE(category_name, track_id)
);

CREATE INDEX IF NOT EXISTS idx_category_reward_map_category ON category_reward_mappings(category_name);

-- ============================================
-- Update reward_tracks to allow dynamic track types
-- ============================================
-- Note: SQLite doesn't support ALTER COLUMN, so we'll handle this in code
-- by allowing any track_type that exists in reward_track_definitions

-- ============================================
-- SEED DEFAULT TRACK DEFINITIONS
-- Migrate existing hardcoded tracks to database
-- ============================================
INSERT OR IGNORE INTO reward_track_definitions (id, name, display_name, description, track_type, icon, milestones, reward_expiry_days, reward_applicable_to)
VALUES
(
    'track_nails',
    'nails',
    'Nails Rewards',
    'Earn discounts on nail services by visiting regularly',
    'visit_count',
    '💅',
    '[{"count": 6, "reward_type": "percentage_discount", "reward_value": 10, "description": "10% off your next nail service"}, {"count": 12, "reward_type": "percentage_discount", "reward_value": 50, "description": "50% off your next nail service"}]',
    90,
    'same_category'
),
(
    'track_maintenance',
    'maintenance',
    'Extensions Maintenance',
    'Earn rewards for regular hair extension maintenance',
    'visit_count',
    '✨',
    '[{"count": 6, "reward_type": "percentage_discount", "reward_value": 10, "description": "10% off your next maintenance service", "repeating": true}]',
    90,
    'same_category'
),
(
    'track_spend',
    'spend',
    'Spend & Save',
    'Earn rewards based on total spend across all services',
    'spend_amount',
    '💰',
    '[{"amount": 10000, "reward_type": "percentage_discount", "reward_value": 20, "description": "20% off any service", "repeating": true}]',
    90,
    NULL
);

-- ============================================
-- SEED CATEGORY MAPPINGS for existing behavior
-- Maps categories that contain keywords to tracks
-- ============================================
INSERT OR IGNORE INTO category_reward_mappings (id, category_name, track_id)
SELECT
    'catmap_' || lower(replace(category, ' ', '_')) || '_nails',
    category,
    'track_nails'
FROM services
WHERE active = 1
AND (
    lower(category) LIKE '%nail%'
    OR lower(category) LIKE '%manicure%'
    OR lower(category) LIKE '%pedicure%'
    OR lower(category) LIKE '%gel%'
    OR lower(category) LIKE '%acrylic%'
)
GROUP BY category;

INSERT OR IGNORE INTO category_reward_mappings (id, category_name, track_id)
SELECT
    'catmap_' || lower(replace(category, ' ', '_')) || '_maintenance',
    category,
    'track_maintenance'
FROM services
WHERE active = 1
AND (
    lower(category) LIKE '%maintenance%'
    OR lower(category) LIKE '%extension%'
    OR lower(category) LIKE '%weave%'
    OR lower(category) LIKE '%tape%'
    OR lower(category) LIKE '%keratin%'
    OR lower(category) LIKE '%weft%'
)
GROUP BY category;
