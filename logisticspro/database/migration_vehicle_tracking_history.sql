-- ============================================================
-- LP2.0 — migration_vehicle_tracking_history.sql
-- Stores Pulsit GPS/odometer snapshots in our own database instead of
-- only ever holding live data in memory — the foundation for: monthly
-- vehicle KM reports off Pulsit data (not Loads data), a real KM-per-load
-- log to check opening/closing odometer readings against, and historical
-- tracking history on the Fleet card.
-- Supabase SQL Editor — safe to run on live DB
--
-- SOURCES OF DATA (three, all writing into the same table):
--   1. LIVE_POLL        — an external scheduler hits a new backend
--                          endpoint every N minutes, which calls Pulsit's
--                          live /Vehicles endpoint and logs one row per
--                          vehicle. This is what keeps the table current
--                          going forward.
--   2. HISTORICAL_IMPORT — Gideon exports historical reports directly
--                          from Pulsit's own UI and uploads them; a
--                          dedicated import endpoint parses and loads
--                          them. Built once the actual export format is
--                          confirmed — this migration just reserves the
--                          'source' value for it.
--   3. FUEL_IMPORT       — same idea for fuel consumption data, which
--                          has to be imported for now (no live telemetry
--                          source exists yet) — see lp_fuel_log below.
--
-- SAFE TO RE-RUN — idempotent.
-- ============================================================

-- ── Position/odometer history (GPS + fuel telemetry, if Pulsit exposes
--    it once confirmed) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_vehicle_tracking_history (
  id           BIGSERIAL     PRIMARY KEY,
  vh_code      VARCHAR(10)   NOT NULL REFERENCES lp_vehicles(vh_code),
  recorded_at  TIMESTAMPTZ   NOT NULL,
  latitude     NUMERIC(10,6),
  longitude    NUMERIC(10,6),
  speed        NUMERIC(6,2),
  heading      NUMERIC(5,1),
  odometer     NUMERIC(10,1),
  ignition     SMALLINT,
  source       VARCHAR(20)   NOT NULL DEFAULT 'LIVE_POLL'
                              CHECK (source IN ('LIVE_POLL', 'HISTORICAL_IMPORT')),
  imported_by  VARCHAR(45),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- One row per vehicle per timestamp — re-running an import or a
  -- scheduler double-fire is a no-op rather than a duplicate.
  UNIQUE (vh_code, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_tracking_history_vehicle_time
  ON lp_vehicle_tracking_history (vh_code, recorded_at DESC);

ALTER TABLE lp_vehicle_tracking_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lp_vehicle_tracking_history' AND policyname = 'Allow authenticated') THEN
    CREATE POLICY "Allow authenticated" ON lp_vehicle_tracking_history FOR ALL TO authenticated USING (true);
  END IF;
END $$;

-- ── Fuel log (imported, not live — see note above) ──────────────────
-- Deliberately generic/minimal until the actual import file format is
-- confirmed: a date, a vehicle, litres, and cost covers a typical fuel
-- card or fuel purchase export. Extra columns can be added later
-- (ALTER TABLE ... ADD COLUMN IF NOT EXISTS) without breaking anything
-- already imported.
CREATE TABLE IF NOT EXISTS lp_fuel_log (
  id            BIGSERIAL     PRIMARY KEY,
  vh_code       VARCHAR(10)   REFERENCES lp_vehicles(vh_code),
  fuel_date     DATE          NOT NULL,
  litres        NUMERIC(8,2),
  cost          NUMERIC(10,2),
  odometer      NUMERIC(10,1),
  source_file   VARCHAR(200),
  imported_by   VARCHAR(45),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fuel_log_vehicle_date ON lp_fuel_log (vh_code, fuel_date);

ALTER TABLE lp_fuel_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lp_fuel_log' AND policyname = 'Allow authenticated') THEN
    CREATE POLICY "Allow authenticated" ON lp_fuel_log FOR ALL TO authenticated USING (true);
  END IF;
END $$;
