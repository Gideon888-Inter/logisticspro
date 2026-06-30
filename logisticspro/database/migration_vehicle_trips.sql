-- ============================================================
-- LP2.0 — migration_vehicle_trips.sql
-- Stores Pulsit "Trip Report" exports — the actual format Gideon can pull
-- from Pulsit (sample confirmed: Company, Fleet, Vehicle No, Description,
-- Driver, Start/End Time, Start/End Location, Elapsed Time, Distance(Kms),
-- Ave/Max Speed, Cost). This is trip-level, not raw position pings — each
-- row is one completed trip with distance already computed by Pulsit, so
-- the monthly vehicle KM report can just SUM(distance_km) grouped by
-- vehicle + month directly off this table.
--
-- This is separate from lp_vehicle_tracking_history (point-in-time GPS
-- snapshots from the live /ingest-snapshot poller) — the two serve
-- different purposes: trips give clean per-trip distance/duration,
-- position history gives live map tracking continuity.
--
-- Supabase SQL Editor — safe to run on live DB. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS lp_vehicle_trips (
  id                 BIGSERIAL     PRIMARY KEY,
  vh_code            VARCHAR(10)   REFERENCES lp_vehicles(vh_code),
  pulsit_vehicle_no  VARCHAR(20),
  pulsit_description VARCHAR(20),
  driver             VARCHAR(90),
  start_time         TIMESTAMPTZ   NOT NULL,
  start_location     VARCHAR(255),
  end_time           TIMESTAMPTZ   NOT NULL,
  end_location       VARCHAR(255),
  elapsed_minutes    INT,
  distance_km        NUMERIC(8,2)  DEFAULT 0,
  avg_speed          NUMERIC(6,2),
  max_speed          NUMERIC(6,2),
  cost               NUMERIC(10,2) DEFAULT 0,
  source_file        VARCHAR(200),
  imported_by        VARCHAR(45),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Pulsit trip exports have no trip ID of their own — this is the
  -- natural dedup key, so re-importing an overlapping date range (e.g.
  -- exporting "last 7 days" weekly) is a safe no-op for trips already loaded.
  UNIQUE (vh_code, start_time, end_time)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_trips_vehicle_time
  ON lp_vehicle_trips (vh_code, start_time DESC);

ALTER TABLE lp_vehicle_trips ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lp_vehicle_trips' AND policyname = 'Allow authenticated') THEN
    CREATE POLICY "Allow authenticated" ON lp_vehicle_trips FOR ALL TO authenticated USING (true);
  END IF;
END $$;
