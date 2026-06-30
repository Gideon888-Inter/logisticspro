-- =====================================================================
-- LP2.0 — Fix Loads page stats tiles (perf)
-- =====================================================================
-- Root cause: GET /api/loads/stats/summary already computes the correct
-- "Invoiced Value" figure (sums m_load_total, falling back to m_rate,
-- across LOAD_INVOICED rows only — that correctness fix already landed).
-- What it still does, though, is pull EVERY non-deleted row out of
-- lp_movement via fetchChunked (1000 rows per round-trip) just to filter
-- and sum them in Node. With lp_movement at ~31,000 rows (full historic
-- retention + the Sage import), that's ~31 sequential round-trips to
-- Supabase every time the Loads page tiles load — the actual cause of
-- "the tile information is also taking too long to load".
--
-- Fix: a single aggregate query computed in Postgres (COUNT/SUM with
-- FILTER, one pass over the table) instead of dragging the whole table
-- into the app to reduce client-side. Same pattern already used for the
-- Fleet dashboard's "most recent load per truck" fix — see
-- migration_latest_load_per_truck_perf.sql.
--
-- Idempotent — safe to re-run.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_movement_status_not_deleted
  ON lp_movement (m_status)
  WHERE m_status <> 'DELETED';

CREATE OR REPLACE FUNCTION get_load_stats()
RETURNS TABLE (
  total          bigint,
  active         bigint,
  en_route       bigint,
  wait_approval  bigint,
  invoiced       bigint,
  invoiced_value numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE m_status NOT IN ('LOAD_INVOICED', 'REJECTED')) AS active,
    COUNT(*) FILTER (WHERE m_status = 'EN_ROUTE') AS en_route,
    COUNT(*) FILTER (WHERE m_status = 'WAIT_APPROVAL') AS wait_approval,
    COUNT(*) FILTER (WHERE m_status = 'LOAD_INVOICED') AS invoiced,
    COALESCE(SUM(COALESCE(m_load_total, m_rate, 0)) FILTER (WHERE m_status = 'LOAD_INVOICED'), 0) AS invoiced_value
  FROM lp_movement
  WHERE m_status <> 'DELETED';
$$;
