-- =====================================================================
-- LP2.0 — Fix Fleet dashboard intermittent failures (perf)
-- =====================================================================
-- Root cause: two endpoints (GET /api/vehicles and GET /api/vehicles/
-- fleet-overview) each computed "most recent load per truck" by pulling
-- EVERY non-deleted row out of lp_movement client-side (chunked 1000
-- rows at a time) and reducing it in Node. With lp_movement now at
-- ~31,000 rows (full historic retention + the Sage import), that's
-- ~31 sequential round-trips to Supabase on every single poll — the
-- Fleet dashboard polls every 20 seconds. Under any latency hiccup
-- this comfortably blows past Render's request timeout, which is
-- exactly the "loads, then fails, then loads again" cycle reported.
--
-- Fix: a single indexed DISTINCT ON query computed in Postgres,
-- returning one row per truck (≈ number of vehicles, not number of
-- loads ever recorded) instead of the whole table.
--
-- Idempotent — safe to re-run.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_movement_truck_date_loadno
  ON lp_movement (m_truck, m_date DESC, m_load_no DESC)
  WHERE m_truck IS NOT NULL AND m_status <> 'DELETED';

CREATE OR REPLACE FUNCTION get_latest_load_per_truck()
RETURNS SETOF lp_movement
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (m_truck) *
  FROM lp_movement
  WHERE m_truck IS NOT NULL AND m_status <> 'DELETED'
  ORDER BY m_truck, m_date DESC, m_load_no DESC;
$$;
