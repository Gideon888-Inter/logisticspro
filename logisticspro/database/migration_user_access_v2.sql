-- ============================================================
-- LP2.0 — migration_user_access_v2.sql
-- Individual user access overrides (personal custom roles),
-- password reset hardening, and a user audit trail.
-- Supabase SQL Editor — safe to run on live DB
--
-- WHAT THIS DOES
-- ──────────────
-- 1. Replaces the hardcoded CHECK constraint on lp_users.u_role (and
--    lp_user_approvals.ua_role) with a trigger that accepts any of the
--    11 built-in roles OR any ACTIVE row in lp_custom_roles. Without
--    this, every personal custom role created by the new "individually
--    editable user access" feature would need its own manual SQL
--    migration to even be assignable — exactly the kind of code-deploy-
--    per-operational-change this system is meant to avoid. This also
--    retroactively removes the need for the "generate-migration"
--    workaround in roles_admin.js for ordinary custom roles too.
--
-- 2. Adds is_personal / personal_for_user to lp_custom_roles, so
--    per-user customization clones are distinguishable from
--    Admin-authored, reusable custom roles in the Role Manager UI.
--
-- 3. Adds a one-time-use flag to the existing password reset columns
--    (u_reset_used) so a temp password can't be reused after the
--    holder has changed it, and a column to record who last reset a
--    user's password and when, for traceability.
--
-- 4. Creates lp_user_audit — a generic audit log for sensitive
--    user-account actions (password resets, access/role changes),
--    mirroring the existing lp_vehicle_audit pattern.
--
-- SAFE TO RE-RUN — idempotent.
-- ============================================================

-- ── 1. Open up u_role / ua_role to accept active custom roles ──────────────

ALTER TABLE lp_users               DROP CONSTRAINT IF EXISTS lp_users_u_role_check;
ALTER TABLE lp_user_approvals      DROP CONSTRAINT IF EXISTS lp_user_approvals_ua_role_check;

CREATE OR REPLACE FUNCTION lp_validate_role_key(role_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF role_key IN (
    'ADMIN','MANAGER','OPERATOR','OPS_ASSISTANT','CONTROL_ROOM','FINANCE',
    'WORKSHOP_MANAGER','WORKSHOP_ASSISTANT','STOCK_CONTROLLER','WORKSHOP','READONLY'
  ) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM lp_custom_roles WHERE role_key = $1 AND is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION lp_check_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT lp_validate_role_key(NEW.u_role) THEN
    RAISE EXCEPTION 'Invalid role: % is not a built-in role or an active custom role', NEW.u_role;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lp_check_user_approval_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT lp_validate_role_key(NEW.ua_role) THEN
    RAISE EXCEPTION 'Invalid role: % is not a built-in role or an active custom role', NEW.ua_role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lp_users_role_check ON lp_users;
CREATE TRIGGER trg_lp_users_role_check
  BEFORE INSERT OR UPDATE OF u_role ON lp_users
  FOR EACH ROW EXECUTE FUNCTION lp_check_user_role();

DROP TRIGGER IF EXISTS trg_lp_user_approvals_role_check ON lp_user_approvals;
CREATE TRIGGER trg_lp_user_approvals_role_check
  BEFORE INSERT OR UPDATE OF ua_role ON lp_user_approvals
  FOR EACH ROW EXECUTE FUNCTION lp_check_user_approval_role();

-- ── 2. Mark personal (per-user) custom roles distinctly ────────────────────

ALTER TABLE lp_custom_roles
  ADD COLUMN IF NOT EXISTS is_personal        BOOLEAN DEFAULT false;

ALTER TABLE lp_custom_roles
  ADD COLUMN IF NOT EXISTS personal_for_user  VARCHAR(45);

CREATE INDEX IF NOT EXISTS idx_custom_roles_personal_for_user
  ON lp_custom_roles (personal_for_user) WHERE is_personal = true;

-- ── 3. Password reset hardening ─────────────────────────────────────────────

ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_reset_used    BOOLEAN DEFAULT false;

ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_password_set_by  VARCHAR(45);

ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_password_set_at  TIMESTAMPTZ;

-- ── 4. User audit log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lp_user_audit (
  id           SERIAL        PRIMARY KEY,
  aud_username VARCHAR(45)   NOT NULL,
  aud_action   VARCHAR(50)   NOT NULL,
  aud_detail   TEXT,
  aud_operator VARCHAR(45)   NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_audit_username ON lp_user_audit(aud_username);

ALTER TABLE lp_user_audit ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lp_user_audit' AND policyname = 'Allow authenticated') THEN
    CREATE POLICY "Allow authenticated" ON lp_user_audit FOR ALL TO authenticated USING (true);
  END IF;
END $$;
