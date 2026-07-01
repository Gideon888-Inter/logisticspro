-- ============================================================
-- LP2.0 — migration_function_search_path.sql
-- Fixes Supabase Security Advisor: "Function search_path mutable"
-- Affected: get_load_stats, lp_validate_role_key, lp_check_user_role,
--           lp_check_user_approval_role
--
-- WHY THIS MATTERS: a function without a fixed search_path resolves
-- unqualified object names (tables, other functions) using whatever
-- search_path is active at CALL time, not DEFINITION time. For a
-- SECURITY DEFINER function especially, a caller could manipulate their
-- session search_path to point an unqualified name at a different
-- schema/object than the function author intended (schema-shadowing
-- attack). Pinning search_path closes that off.
--
-- Dynamic DO block (not hardcoded ALTER FUNCTION signatures) because I
-- could not query live Supabase to confirm each function's exact
-- parameter list from this sandbox (no network egress to the DB) —
-- this looks up the real signature from pg_proc so it works regardless
-- of overloads or parameter types.
--
-- Supabase SQL Editor — safe to re-run (idempotent; ALTER is not additive).
-- ============================================================

DO $$
DECLARE
  func RECORD;
BEGIN
  FOR func IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_load_stats',
        'lp_validate_role_key',
        'lp_check_user_role',
        'lp_check_user_approval_role'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
      func.proname, func.args
    );
    RAISE NOTICE 'Pinned search_path on public.%(%)', func.proname, func.args;
  END LOOP;
END $$;
