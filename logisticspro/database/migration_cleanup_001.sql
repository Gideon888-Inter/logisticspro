-- ============================================================
-- LP2.0 — migration_cleanup_001.sql
-- Live Database Cleanup
-- Supabase SQL Editor — safe to run on live DB
--
-- WHAT THIS DOES:
--   1. Drops orphan Business Unit columns (BU removed from app)
--   2. Drops lp_business_units table
--   3. Drops unused legacy tables (empty, no routes)
--   4. Drops junk columns from lp_anomalies
--   5. Widens narrow VARCHAR columns that could cause issues
--   6. Adds missing n_ref_id column to lp_notifications
--   7. Widens sc_no on service card tables (future-proofing)
--
-- WHAT THIS DOES NOT TOUCH:
--   lp_pod_files — retained (5 historic POD records)
--   All fin_ tables — financial engine, separate concern
--   Any column with live data that is correct as-is
--
-- SAFE TO RE-RUN — every statement uses IF EXISTS guards.
-- ============================================================


-- ============================================================
-- PART 1 — DROP ORPHAN BUSINESS UNIT COLUMNS
-- BU was removed from the entire application.
-- These FK columns serve no purpose and reference a table
-- we are about to drop.
-- ============================================================

ALTER TABLE lp_vehicles
  DROP COLUMN IF EXISTS vh_bus_unit;

ALTER TABLE lp_drivers
  DROP COLUMN IF EXISTS d_bus_unit;

ALTER TABLE lp_movement
  DROP COLUMN IF EXISTS m_bus_unit;

ALTER TABLE lp_users
  DROP COLUMN IF EXISTS u_bus_unit;

ALTER TABLE lp_user_approvals
  DROP COLUMN IF EXISTS ua_bus_unit;

-- lp_preload is being dropped in Part 2, so no need to
-- alter its pl_bus_unit column separately.


-- ============================================================
-- PART 2 — DROP UNUSED LEGACY TABLES
-- All empty (zero rows). No routes, no frontend pages.
-- lp_pod_files is intentionally excluded (5 historic records).
-- ============================================================

-- Sub-contractors (2019 legacy, never implemented in LP2.0)
DROP TABLE IF EXISTS lp_sub_cont CASCADE;

-- Preload workflow (legacy, replaced by live load creation)
DROP TABLE IF EXISTS lp_preload CASCADE;

-- Job card system (legacy, replaced by service cards)
DROP TABLE IF EXISTS lp_jobcards CASCADE;
DROP TABLE IF EXISTS lp_jobcard_header CASCADE;

-- Report queue / scheduler (legacy, never implemented)
DROP TABLE IF EXISTS lp_reports CASCADE;
DROP TABLE IF EXISTS lp_report_schedule CASCADE;

-- Route table (legacy, replaced by lp_client_rates)
DROP TABLE IF EXISTS lp_route CASCADE;

-- Business Units (the table itself — columns dropped in Part 1)
-- CASCADE handles any remaining FK constraints
DROP TABLE IF EXISTS lp_business_units CASCADE;


-- ============================================================
-- PART 3 — CLEAN UP lp_anomalies JUNK COLUMNS
-- The old schema had extra columns the backend never uses.
-- The backend only writes: a_load_no, a_operator, a_dead_km,
-- a_status, a_reviewed_by, a_reviewed_at, a_rejection_reason.
-- ============================================================

ALTER TABLE lp_anomalies
  DROP COLUMN IF EXISTS a_truck;

ALTER TABLE lp_anomalies
  DROP COLUMN IF EXISTS a_type;

ALTER TABLE lp_anomalies
  DROP COLUMN IF EXISTS a_description;

ALTER TABLE lp_anomalies
  DROP COLUMN IF EXISTS a_last_closing;

ALTER TABLE lp_anomalies
  DROP COLUMN IF EXISTS a_new_opening;


-- ============================================================
-- PART 4 — WIDEN ROLE COLUMNS
-- VARCHAR(20) is too narrow for custom roles and WORKSHOP_ASSISTANT
-- sits at 18 chars — one future role could break inserts.
-- Widening VARCHAR never requires a table rewrite in Postgres.
-- ============================================================

ALTER TABLE lp_users
  ALTER COLUMN u_role TYPE VARCHAR(50);

ALTER TABLE lp_user_approvals
  ALTER COLUMN ua_role TYPE VARCHAR(50);


-- ============================================================
-- PART 5 — FIX lp_notifications COLUMN WIDTHS + ADD n_ref_id
-- n_ref_id is used by PO approval notifications to carry the
-- po_id so the frontend can deep-link to the right PO.
-- ============================================================

-- Add missing column (safe if already exists via IF NOT EXISTS workaround)
ALTER TABLE lp_notifications
  ADD COLUMN IF NOT EXISTS n_ref_id INT;

-- Widen n_role so custom role names (up to 50 chars) fit
ALTER TABLE lp_notifications
  ALTER COLUMN n_role TYPE VARCHAR(50);

-- Widen n_type so longer event type codes fit
ALTER TABLE lp_notifications
  ALTER COLUMN n_type TYPE VARCHAR(50);

-- Widen n_message — PO notifications can be verbose
ALTER TABLE lp_notifications
  ALTER COLUMN n_message TYPE VARCHAR(1000);


-- ============================================================
-- PART 6 — WIDEN SERVICE CARD sc_no + ALL FK REFERENCES
-- Current VARCHAR(10) holds S100001 (7 chars) — fine for now
-- but will silently truncate once numbers reach 8+ chars.
-- Widen all four tables together so FKs stay consistent.
-- ============================================================

-- Drop FK constraints first (Postgres requires this before
-- altering the referenced column type)
ALTER TABLE lp_service_audit
  DROP CONSTRAINT IF EXISTS lp_service_audit_sa_service_no_fkey;

ALTER TABLE lp_service_checklist
  DROP CONSTRAINT IF EXISTS lp_service_checklist_sl_service_no_fkey;

ALTER TABLE lp_service_comments
  DROP CONSTRAINT IF EXISTS lp_service_comments_sm_service_no_fkey;

-- Widen the primary key column
ALTER TABLE lp_service_cards
  ALTER COLUMN sc_no TYPE VARCHAR(20);

-- Widen the FK columns on child tables
ALTER TABLE lp_service_audit
  ALTER COLUMN sa_service_no TYPE VARCHAR(20);

ALTER TABLE lp_service_checklist
  ALTER COLUMN sl_service_no TYPE VARCHAR(20);

ALTER TABLE lp_service_comments
  ALTER COLUMN sm_service_no TYPE VARCHAR(20);

-- Widen sc_trigger while we're here — auto-generated text can
-- be long ("Wheel Alignment OVERDUE by 12,345 km")
ALTER TABLE lp_service_cards
  ALTER COLUMN sc_trigger TYPE VARCHAR(300);

-- Re-add FK constraints
ALTER TABLE lp_service_audit
  ADD CONSTRAINT lp_service_audit_sa_service_no_fkey
  FOREIGN KEY (sa_service_no) REFERENCES lp_service_cards(sc_no);

ALTER TABLE lp_service_checklist
  ADD CONSTRAINT lp_service_checklist_sl_service_no_fkey
  FOREIGN KEY (sl_service_no) REFERENCES lp_service_cards(sc_no);

ALTER TABLE lp_service_comments
  ADD CONSTRAINT lp_service_comments_sm_service_no_fkey
  FOREIGN KEY (sm_service_no) REFERENCES lp_service_cards(sc_no);


-- ============================================================
-- PART 7 — WIDEN lp_vehicle_audit va_action
-- Current VARCHAR(20). Backend writes 'CREATED', 'UPDATED' —
-- fine now, but widening to 50 future-proofs it.
-- ============================================================

ALTER TABLE lp_vehicle_audit
  ALTER COLUMN va_action TYPE VARCHAR(50);


-- ============================================================
-- VERIFY — run these SELECTs after to confirm the cleanup
-- ============================================================

-- Should return 0 rows (all legacy tables gone):
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'lp_business_units','lp_sub_cont','lp_preload',
--     'lp_jobcards','lp_jobcard_header',
--     'lp_reports','lp_report_schedule','lp_route'
--   );

-- Should return VARCHAR(50) for both:
-- SELECT column_name, character_maximum_length
-- FROM information_schema.columns
-- WHERE table_name = 'lp_users' AND column_name = 'u_role';

-- Should show n_ref_id exists:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'lp_notifications'
-- ORDER BY ordinal_position;

-- ============================================================
-- DONE
-- ============================================================
-- lp_pod_files was intentionally left in place (5 records).
-- It is no longer written to by the app — SharePoint URLs are
-- stored in lp_movement.m_pod_sharepoint_url instead.
-- You may drop it manually in future once those 5 records are
-- confirmed as no longer needed.
-- ============================================================
