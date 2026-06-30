-- ============================================================
-- LP2.0 — migration_pickup_offload_dates.sql
-- Adds Pickup Date / Offload Date to loads (lp_movement)
-- Supabase SQL Editor — safe to run on live DB
--
-- WHAT THIS DOES:
--   Adds m_pickup_date and m_offload_date to lp_movement. These sit
--   alongside m_from/m_to on the Load card (Pickup Date under From,
--   Offload Date under To) — separate from m_date, which remains the
--   load's CREATION date and is system-set, not user-entered.
--
--   Both columns are nullable: Pickup Date defaults to "today" in the
--   frontend at creation time but isn't enforced server-side, and
--   Offload Date is typically unknown until the load is created, so
--   it's filled in later rather than required up front.
--
-- SAFE TO RE-RUN — guarded with IF NOT EXISTS.
-- ============================================================

ALTER TABLE lp_movement
  ADD COLUMN IF NOT EXISTS m_pickup_date  DATE;

ALTER TABLE lp_movement
  ADD COLUMN IF NOT EXISTS m_offload_date DATE;
