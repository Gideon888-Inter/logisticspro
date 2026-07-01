-- ============================================================
-- LP2.0 — migration_load_stats_invoiced_value_from_invoices.sql
-- Invoiced Value tile must sum ACTUAL issued invoices (lp_invoices),
-- not lp_movement.m_load_total (which holds stale Sage-import values
-- and is never meaningfully set by the live app).
-- Supabase SQL Editor — safe to run on live DB. Idempotent.
--
-- ROOT CAUSE: get_load_stats() computed invoiced_value as
--   SUM(COALESCE(m_load_total, m_rate, 0)) FILTER (m_status='LOAD_INVOICED')
-- Because m_load_total carries stale Sage figures, this ran to ~R512m
-- all-time. The correct source is lp_invoices.inv_amount_incl over FINAL
-- (issued, non-credited) invoices, scoped by inv_date.
--
-- NOTE: The backend (GET /api/loads/stats/summary) now computes invoiced
-- value/count from lp_invoices directly and OVERRIDES whatever this RPC
-- returns for those two fields, so the tile is already correct on a
-- backend redeploy even before this migration runs. This migration keeps
-- the RPC itself consistent for any other/future caller.
-- ============================================================

DROP FUNCTION IF EXISTS get_load_stats(DATE, DATE);
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
    (SELECT COUNT(*) FROM lp_movement
       WHERE m_status <> 'DELETED'
         AND (date_from IS NULL OR m_date >= date_from)
         AND (date_to   IS NULL OR m_date <= date_to)) AS total,
    (SELECT COUNT(*) FROM lp_movement
       WHERE m_status NOT IN ('LOAD_INVOICED', 'REJECTED', 'DELETED')
         AND (date_from IS NULL OR m_date >= date_from)
         AND (date_to   IS NULL OR m_date <= date_to)) AS active,
    (SELECT COUNT(*) FROM lp_movement
       WHERE m_status = 'EN_ROUTE'
         AND (date_from IS NULL OR m_date >= date_from)
         AND (date_to   IS NULL OR m_date <= date_to)) AS en_route,
    (SELECT COUNT(*) FROM lp_movement
       WHERE m_status = 'WAIT_APPROVAL'
         AND (date_from IS NULL OR m_date >= date_from)
         AND (date_to   IS NULL OR m_date <= date_to)) AS wait_approval,
    -- invoiced count + value now sourced from lp_invoices (FINAL only),
    -- scoped by inv_date to match the tile's date range.
    (SELECT COUNT(*) FROM lp_invoices
       WHERE inv_status = 'FINAL'
         AND (date_from IS NULL OR inv_date >= date_from)
         AND (date_to   IS NULL OR inv_date <= date_to)) AS invoiced,
    (SELECT COALESCE(SUM(inv_amount_incl), 0) FROM lp_invoices
       WHERE inv_status = 'FINAL'
         AND (date_from IS NULL OR inv_date >= date_from)
         AND (date_to   IS NULL OR inv_date <= date_to)) AS invoiced_value;
$$;

-- Helps the date-scoped invoice aggregate stay fast as lp_invoices grows.
CREATE INDEX IF NOT EXISTS idx_invoices_status_date
  ON lp_invoices (inv_status, inv_date);
