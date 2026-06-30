-- ============================================================
-- LP2.0 — migration_load_stats_date_scope.sql
-- Scope the Loads page stat tiles to the same date range as the list
-- Supabase SQL Editor — safe to run on live DB
--
-- ROOT CAUSE: GET /api/loads/stats/summary (and get_load_stats()) computed
-- an all-time aggregate across the ENTIRE lp_movement table — every load
-- ever recorded, including years of Sage-imported history — with no date
-- scoping at all. The Loads page list right below the tiles, meanwhile,
-- defaults to "this month" via its date range picker. The result: tiles
-- showing values like "4954 Active Loads" / "R512m Invoiced Value" sitting
-- directly above a list showing 999 loads for the selected date range —
-- two completely different scopes on the same screen. That mismatch is
-- what was actually being reported as "revenue still not appearing
-- correctly", not a calculation error in the sum itself.
--
-- FIX: get_load_stats() now takes optional date_from/date_to bounds
-- (matching the m_date range the list already filters on) and applies
-- them the same way GET /api/loads does. Old zero-arg version is dropped
-- so there's no ambiguity between two overloads — every caller must pass
-- through the (possibly null) date range explicitly.
--
-- SAFE TO RE-RUN — idempotent.
-- ============================================================

DROP FUNCTION IF EXISTS get_load_stats();

CREATE OR REPLACE FUNCTION get_load_stats(date_from DATE DEFAULT NULL, date_to DATE DEFAULT NULL)
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
  WHERE m_status <> 'DELETED'
    AND (date_from IS NULL OR m_date >= date_from)
    AND (date_to   IS NULL OR m_date <= date_to);
$$;

-- Composite index so date-bounded aggregates stay fast as the table grows
-- (the status-only index from the previous migration still helps the
-- no-date-filter case).
CREATE INDEX IF NOT EXISTS idx_movement_date_status_not_deleted
  ON lp_movement (m_date, m_status)
  WHERE m_status <> 'DELETED';
