-- ============================================================
-- LP2.0 — migration_tighten_permissive_rls.sql
-- Fixes Supabase Security Advisor: overly permissive "Allow authenticated"
-- RLS policies (effectively USING (true) / WITH CHECK (true) for ALL
-- commands) on:
--   lp_fuel_log, lp_user_audit, lp_vehicle_tracking_history, lp_vehicle_trips
--
-- CONTEXT: the backend always connects with the Supabase service-role key,
-- which bypasses RLS entirely — so these policies do not currently gate
-- any real traffic; the Express permission layer (middleware/auth.js) is
-- the actual enforcement point. The frontend never talks to Supabase
-- directly (see frontend/src/lib/api.js — everything goes through the
-- backend). So these blanket policies aren't being exploited today, but
-- they're a live landmine: if a Supabase anon/authenticated key were ever
-- exposed, or if a future feature queries Supabase directly from the
-- client, these 4 tables (audit trail + live GPS/tracking history) would
-- be fully readable/writable by any authenticated Supabase user.
--
-- FIX: drop the blanket ALL/true policies on these tables. Nothing in the
-- current architecture depends on direct authenticated access to them
-- (only the backend, via service-role, touches them) — this migration
-- makes that assumption explicit and enforced at the DB level too.
--
-- Dynamic DO block, not hardcoded DROP POLICY names — I could not query
-- live Supabase from this sandbox to confirm the exact policy names, so
-- this looks them up from pg_policies and only touches ones matching the
-- "ALL command + true qualifier" pattern the advisor flagged.
--
-- IMPORTANT: before running, confirm nothing in the app queries these 4
-- tables using anything other than the backend's service-role client —
-- if that assumption is wrong, dropping these policies will start
-- returning empty results / permission errors for that path instead of
-- data, rather than silently failing anywhere else.
--
-- Supabase SQL Editor — safe to re-run.
-- ============================================================

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'lp_fuel_log',
        'lp_user_audit',
        'lp_vehicle_tracking_history',
        'lp_vehicle_trips'
      )
      AND cmd = 'ALL'
      AND (qual IN ('true', '(true)') OR with_check IN ('true', '(true)'))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    RAISE NOTICE 'Dropped permissive policy % on %', pol.policyname, pol.tablename;
  END LOOP;
END $$;

-- RLS stays enabled on these tables (it already is) with no permissive
-- policy left — meaning only the service-role key (which bypasses RLS)
-- can touch them going forward. If a legitimate need for direct
-- authenticated access surfaces later, add a narrowly-scoped policy then
-- (e.g. SELECT-only, filtered to the requesting user's own records)
-- rather than restoring a blanket ALL/true policy.
