-- ============================================================
-- LP2.0 — migration_vehicle_links.sql
-- Trailer-link pairing: columns + DB-level invariants
-- Supabase SQL Editor — safe to run on live DB
--
-- WHAT THIS DOES:
--   1. Adds vh_is_link / vh_link_pair to lp_vehicles if not already
--      present (they may already exist live — guarded with IF NOT EXISTS)
--   2. Adds a CHECK so a trailer can never be paired with itself
--   3. Adds a partial UNIQUE index so one rear trailer can never be the
--      vh_link_pair of more than one front trailer at the same time
--
-- These mirror the invariants now enforced in
-- backend/src/routes/vehicles.js (PATCH /:code/link) — this is
-- defense-in-depth at the DB layer, not a replacement for the API checks
-- (the API also validates both vehicles are type 'Trailer', which a plain
-- CHECK constraint can't easily express without a function/trigger).
--
-- SAFE TO RE-RUN — every statement uses IF NOT EXISTS / DO blocks.
-- ============================================================

ALTER TABLE lp_vehicles
  ADD COLUMN IF NOT EXISTS vh_is_link   CHAR(1) DEFAULT 'N';

ALTER TABLE lp_vehicles
  ADD COLUMN IF NOT EXISTS vh_link_pair VARCHAR(10);

-- No self-link
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lp_vehicles_no_self_link'
  ) THEN
    ALTER TABLE lp_vehicles
      ADD CONSTRAINT lp_vehicles_no_self_link
      CHECK (vh_link_pair IS DISTINCT FROM vh_code);
  END IF;
END $$;

-- One rear cannot be assigned to multiple fronts
CREATE UNIQUE INDEX IF NOT EXISTS lp_vehicles_link_pair_unique
  ON lp_vehicles (vh_link_pair)
  WHERE vh_is_link = 'Y' AND vh_link_pair IS NOT NULL;
