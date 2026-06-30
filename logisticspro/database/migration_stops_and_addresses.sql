-- ============================================================
-- LP2.0 — migration_stops_and_addresses.sql
-- Extra Stops (load cards) + Addresses (Clients page / Fleet dashboard)
-- Supabase SQL Editor — safe to run on live DB
--
-- WHAT THIS DOES:
--   1. Creates lp_load_stops — extra dropoff stops on a load, each with
--      an optional cost, mirroring the existing lp_costs add/soft-delete/
--      approval pattern (no hard deletion).
--   2. Creates lp_addresses — named locations (client sites, depots, and
--      the two "Home Base" geofences) used to:
--        a) resolve a vehicle's live GPS position to a friendly name on
--           the Fleet dashboard instead of a raw reverse-geocoded string
--        b) power the Fleet dashboard's "Home Base" filter
--   3. Seeds the two Home Base addresses requested. IMPORTANT: the
--      coordinates below are APPROXIMATE (based on the general area, not
--      a precise geocode of the exact street address) since this
--      environment has no access to a geocoding service. Please verify/
--      correct these via the new Clients → Addresses tab (drag the pin
--      or re-search the address) before relying on the Home Base filter
--      for anything precision-sensitive.
--
-- SAFE TO RE-RUN — every statement uses IF NOT EXISTS / ON CONFLICT guards.
-- ============================================================

-- ============================================================
-- PART 1 — EXTRA STOPS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_load_stops (
  stop_no               SERIAL        PRIMARY KEY,
  s_load                VARCHAR(20)   NOT NULL REFERENCES lp_movement(m_load_no),
  s_order               INT           DEFAULT 0,
  s_address             VARCHAR(255)  NOT NULL,
  s_latitude            NUMERIC(10,6),
  s_longitude           NUMERIC(10,6),
  s_amount              NUMERIC(10,2) DEFAULT 0,
  s_description         VARCHAR(255),
  s_operator            VARCHAR(45),
  s_deleted             CHAR(1)       DEFAULT 'N',
  s_delete_requested    CHAR(1)       DEFAULT 'N',
  s_delete_requested_by VARCHAR(45),
  s_delete_reason       VARCHAR(255),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_load_stops_load ON lp_load_stops(s_load);

ALTER TABLE lp_load_stops ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 2 — ADDRESSES
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_addresses (
  address_id    SERIAL        PRIMARY KEY,
  a_name        VARCHAR(100)  NOT NULL,
  a_address     VARCHAR(255),
  a_latitude    NUMERIC(10,6) NOT NULL,
  a_longitude   NUMERIC(10,6) NOT NULL,
  a_radius_km   NUMERIC(6,2)  DEFAULT 2,
  a_type        VARCHAR(20)   DEFAULT 'CLIENT' CHECK (a_type IN ('CLIENT','HOME_BASE','DEPOT','OTHER')),
  a_client_code VARCHAR(10)   REFERENCES lp_customers(c_code),
  a_active      CHAR(1)       DEFAULT 'Y',
  created_by    VARCHAR(45),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_addresses_client ON lp_addresses(a_client_code);
CREATE INDEX IF NOT EXISTS idx_addresses_type   ON lp_addresses(a_type);

ALTER TABLE lp_addresses ENABLE ROW LEVEL SECURITY;

-- ── Seed the two Home Base geofences ──────────────────────────
-- NOTE: approximate coordinates — verify/correct in Clients → Addresses.
INSERT INTO lp_addresses (a_name, a_address, a_latitude, a_longitude, a_radius_km, a_type)
SELECT 'Home Base – JHB', 'Indaba Ln, Krugersdorp, South Africa', -26.0925, 27.7711, 5, 'HOME_BASE'
WHERE NOT EXISTS (SELECT 1 FROM lp_addresses WHERE a_name = 'Home Base – JHB');

INSERT INTO lp_addresses (a_name, a_address, a_latitude, a_longitude, a_radius_km, a_type)
SELECT 'Home Base – CT', 'Tekstiel St, Parow Industrial, Cape Town, 7493, South Africa', -33.9070, 18.6020, 5, 'HOME_BASE'
WHERE NOT EXISTS (SELECT 1 FROM lp_addresses WHERE a_name = 'Home Base – CT');
