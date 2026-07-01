-- ============================================================
-- LP2.0 — migration_index_unindexed_fks.sql
-- Fixes Supabase Performance Advisor: unindexed foreign keys.
-- App-facing examples flagged: lp_customer_contact_cc_customer_fkey,
-- lp_extras_x_load_fkey, lp_inventory_transactions_reversal_of_fkey,
-- lp_leave_l_driver_fkey, lp_maintenance_ma_vehicle_fkey,
-- lp_vehicles_vh_link_pair_fkey (plus more across the finance tables per
-- the advisor's full list — add those constraint names to the array below
-- as needed, same pattern).
--
-- Missing indexes on FK columns slow down joins, filtered lookups, and
-- cascading deletes/updates on the referenced side — a growing cost as
-- lp_movement/lp_vehicles/finance tables keep accumulating history under
-- the "no hard deletion" policy.
--
-- WHY DYNAMIC LOOKUP: rather than guessing each FK's column name from its
-- constraint name (I don't have live DB access from this sandbox to
-- confirm), this resolves the actual referencing column(s) for each named
-- constraint from pg_constraint/pg_attribute, then creates the index —
-- correct regardless of whether the naming convention holds everywhere.
--
-- Supabase SQL Editor — safe to re-run (checks for equivalent coverage
-- before creating).
-- ============================================================

DO $$
DECLARE
  fk RECORD;
  idx_name TEXT;
  target_constraints TEXT[] := ARRAY[
    'lp_customer_contact_cc_customer_fkey',
    'lp_extras_x_load_fkey',
    'lp_inventory_transactions_reversal_of_fkey',
    'lp_leave_l_driver_fkey',
    'lp_maintenance_ma_vehicle_fkey',
    'lp_vehicles_vh_link_pair_fkey'
    -- Add more flagged constraint names here as needed, e.g. finance FKs.
  ];
BEGIN
  FOR fk IN
    SELECT
      con.conname,
      rel.relname AS table_name,
      (
        SELECT string_agg(quote_ident(att.attname), ', ' ORDER BY ord.n)
        FROM unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n)
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
      ) AS columns
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND con.conname = ANY(target_constraints)
  LOOP
    idx_name := 'idx_' || fk.table_name || '_' || replace(fk.columns, ', ', '_');
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = fk.table_name
        AND indexdef ILIKE '%(' || fk.columns || ')%'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
                      idx_name, fk.table_name, fk.columns);
      RAISE NOTICE 'Created index % on %(%)', idx_name, fk.table_name, fk.columns;
    ELSE
      RAISE NOTICE 'Skipped % on %(%) — equivalent index already exists', fk.conname, fk.table_name, fk.columns;
    END IF;
  END LOOP;
END $$;
