-- ============================================================
-- MIGRATION 001 — Roles, Invoices, Credit Notes, User Approvals
-- Run this in the Supabase SQL Editor (supabase.com → SQL Editor)
-- Safe to run more than once — uses IF NOT EXISTS / DO blocks
-- ============================================================


-- ============================================================
-- 1. EXTEND lp_users — new roles + missing columns
-- ============================================================

-- Drop the old role constraint and replace with the full set
ALTER TABLE lp_users
  DROP CONSTRAINT IF EXISTS lp_users_u_role_check;

ALTER TABLE lp_users
  ADD CONSTRAINT lp_users_u_role_check
  CHECK (u_role IN (
    'ADMIN',          -- Full access to everything
    'MANAGER',        -- Senior management — view loads/fleet/workshop, full clients/rates/drivers/users
    'OPERATOR',       -- Operations — full loads, fleet, drivers, clients; no rates, no users
    'OPS_ASSISTANT',  -- Same as Operator but all changes need Operator approval
    'CONTROL_ROOM',   -- Loads only: add loads, change status up to OFFLOADED; costs/order nos go to Operator
    'ACCOUNTING',     -- View loads, can set to WAIT_INVOICE_NO or REJECT; runs invoices
    'WORKSHOP',       -- View loads (no changes); full workshop access
    'READONLY'        -- View only — no changes anywhere
  ));

-- Add u_region if it doesn't exist (was in code but missing from schema)
ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_region VARCHAR(50);

-- Add u_first_login if it doesn't exist
ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_first_login CHAR(1) DEFAULT 'Y';

-- Add reset token columns if missing
ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_reset_token VARCHAR(100);

ALTER TABLE lp_users
  ADD COLUMN IF NOT EXISTS u_reset_token_expiry TIMESTAMPTZ;


-- ============================================================
-- 2. EXTEND lp_movement — confirm DELETED status + PENDING_DELETE
-- ============================================================

-- Drop old status constraint and replace (adds PENDING_DELETE for Ops Assistant delete requests)
ALTER TABLE lp_movement
  DROP CONSTRAINT IF EXISTS lp_movement_m_status_check;

ALTER TABLE lp_movement
  ADD CONSTRAINT lp_movement_m_status_check
  CHECK (m_status IN (
    'PRELOAD',              -- Newly created load
    'EN_ROUTE',             -- Truck dispatched
    'OFFLOADED',            -- Delivery complete, awaiting Operator
    'WAIT_ORDER_NO',        -- Operator requested PO number from client
    'WAIT_APPROVAL',        -- Awaiting Operator final approval before POD
    'WAIT_POD_SCAN',        -- Approved; waiting for POD documents to be uploaded
    'WAIT_INVOICE_NO',      -- PODs uploaded; ready for invoicing
    'LOAD_INVOICED',        -- Invoice raised
    'WAIT_PROCESSING',      -- Legacy / system status
    'REJECTED',             -- Rejected by Operator or Admin
    'DELETED',              -- Soft-deleted by Operator (values zeroed)
    'PENDING_KM_APPROVAL',  -- KM anomaly flagged, awaiting Operator/Ops Asst approval
    'KM_CORRECTION_NEEDED'  -- KM rejected, driver/operator must correct
  ));

-- Track who deleted and when
ALTER TABLE lp_movement
  ADD COLUMN IF NOT EXISTS m_deleted_by    VARCHAR(45);

ALTER TABLE lp_movement
  ADD COLUMN IF NOT EXISTS m_deleted_at    TIMESTAMPTZ;

ALTER TABLE lp_movement
  ADD COLUMN IF NOT EXISTS m_deleted_reason VARCHAR(300);


-- ============================================================
-- 3. lp_notifications — ensure table exists with full structure
-- ============================================================

CREATE TABLE IF NOT EXISTS lp_notifications (
  id          SERIAL        PRIMARY KEY,
  n_user      VARCHAR(45),                  -- specific username (null = broadcast to role)
  n_role      VARCHAR(20),                  -- role broadcast (null = specific user only)
  n_type      VARCHAR(50)   NOT NULL,       -- e.g. ORDER_NO_CHANGE, USER_APPROVAL_REQUIRED
  n_title     VARCHAR(200)  NOT NULL,
  n_message   VARCHAR(1000) NOT NULL,
  n_load_no   VARCHAR(20),                  -- linked load (optional)
  n_ref_id    INT,                          -- generic reference id (invoice id, approval id, etc.)
  n_read      CHAR(1)       DEFAULT 'N',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON lp_notifications(n_user);
CREATE INDEX IF NOT EXISTS idx_notifications_role ON lp_notifications(n_role);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON lp_notifications(n_read);


-- ============================================================
-- 4. lp_user_approvals — pending user creation requests
-- ============================================================
-- When a Manager creates an Operator/OPS_ASSISTANT/CONTROL_ROOM user,
-- it lands here for Sharon Mitchell to approve.
-- Workshop users go to Workshop Manager.
-- Manager users go to Admin.

CREATE TABLE IF NOT EXISTS lp_user_approvals (
  id              SERIAL        PRIMARY KEY,
  ua_username     VARCHAR(45)   NOT NULL,
  ua_password_hash VARCHAR(200) NOT NULL,   -- pre-hashed, applied on approval
  ua_name         VARCHAR(100),
  ua_email        VARCHAR(150),
  ua_role         VARCHAR(20)   NOT NULL,
  ua_bus_unit     VARCHAR(10),
  ua_region       VARCHAR(50),
  ua_requested_by VARCHAR(45)   NOT NULL,   -- Manager who submitted
  ua_approver     VARCHAR(45)   NOT NULL,   -- username who must approve
  ua_status       VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                CHECK (ua_status IN ('PENDING','APPROVED','REJECTED')),
  ua_rejection_reason VARCHAR(300),
  ua_actioned_by  VARCHAR(45),
  ua_actioned_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_approvals_status   ON lp_user_approvals(ua_status);
CREATE INDEX IF NOT EXISTS idx_user_approvals_approver ON lp_user_approvals(ua_approver);


-- ============================================================
-- 5. lp_ops_assistant_actions — Ops Assistant pending changes
-- ============================================================
-- When an Ops Assistant takes an action on a load, it is held
-- here for the Operator named on the load (m_responsible_operator)
-- to approve before the change is applied.

CREATE TABLE IF NOT EXISTS lp_ops_assistant_actions (
  id              SERIAL        PRIMARY KEY,
  oa_load_no      VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  oa_action_type  VARCHAR(50)   NOT NULL,
  -- action types: STATUS_CHANGE, ADD_COST, DELETE_COST, SET_ORDER_NO, CHANGE_ORDER_NO
  oa_payload      JSONB         NOT NULL,   -- full change details as JSON
  oa_requested_by VARCHAR(45)   NOT NULL,   -- Ops Assistant username
  oa_approver     VARCHAR(45)   NOT NULL,   -- Operator on the load
  oa_status       VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                CHECK (oa_status IN ('PENDING','APPROVED','REJECTED')),
  oa_rejection_reason VARCHAR(300),
  oa_actioned_by  VARCHAR(45),
  oa_actioned_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_actions_load     ON lp_ops_assistant_actions(oa_load_no);
CREATE INDEX IF NOT EXISTS idx_ops_actions_approver ON lp_ops_assistant_actions(oa_approver);
CREATE INDEX IF NOT EXISTS idx_ops_actions_status   ON lp_ops_assistant_actions(oa_status);


-- ============================================================
-- 6. lp_invoices — invoice register
-- ============================================================

CREATE TABLE IF NOT EXISTS lp_invoices (
  id              SERIAL        PRIMARY KEY,
  inv_number      VARCHAR(20)   UNIQUE NOT NULL,  -- e.g. IN246837 (auto-generated)
  inv_load_no     VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  inv_customer    VARCHAR(10)   REFERENCES lp_customers(c_code),
  inv_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  inv_description VARCHAR(200)  NOT NULL DEFAULT 'TRANSPORT SERVICES',
  inv_amount_excl NUMERIC(12,2) NOT NULL DEFAULT 0,
  inv_vat         NUMERIC(12,2) NOT NULL DEFAULT 0,
  inv_amount_incl NUMERIC(12,2) NOT NULL DEFAULT 0,
  inv_order_no    VARCHAR(45),
  inv_status      VARCHAR(20)   NOT NULL DEFAULT 'DRAFT'
                                CHECK (inv_status IN ('DRAFT','FINAL','CREDITED')),
  inv_created_by  VARCHAR(45)   NOT NULL,
  inv_approved_by VARCHAR(45),
  inv_approved_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_load     ON lp_invoices(inv_load_no);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON lp_invoices(inv_customer);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON lp_invoices(inv_status);
CREATE INDEX IF NOT EXISTS idx_invoices_number   ON lp_invoices(inv_number);


-- ============================================================
-- 7. lp_credit_notes — credit note register
-- ============================================================

CREATE TABLE IF NOT EXISTS lp_credit_notes (
  id              SERIAL        PRIMARY KEY,
  cn_number       VARCHAR(20)   UNIQUE NOT NULL,  -- e.g. IC102293 (auto-generated)
  cn_invoice_id   INT           REFERENCES lp_invoices(id),
  cn_invoice_no   VARCHAR(20),                    -- denormalised for display
  cn_load_no      VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  cn_customer     VARCHAR(10)   REFERENCES lp_customers(c_code),
  cn_date         DATE          NOT NULL DEFAULT CURRENT_DATE,
  cn_description  VARCHAR(200)  NOT NULL DEFAULT 'TRANSPORT SERVICES',
  cn_amount_excl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_vat          NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_amount_incl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_reason       VARCHAR(500)  NOT NULL,          -- mandatory reason
  cn_created_by   VARCHAR(45)   NOT NULL,
  cn_approved_by  VARCHAR(45),
  cn_approved_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice  ON lp_credit_notes(cn_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_load     ON lp_credit_notes(cn_load_no);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer ON lp_credit_notes(cn_customer);


-- ============================================================
-- 8. Auto-number sequences for invoices and credit notes
-- ============================================================
-- Invoices: IN + 6 digits starting from 100001 (or continue from last)
-- Credit notes: IC + 6 digits starting from 100001

CREATE SEQUENCE IF NOT EXISTS seq_invoice_number START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS seq_credit_note_number START 100001 INCREMENT 1;

-- Helper functions to generate the next invoice / credit note number
-- These guarantee no gaps or duplicates even under concurrent load

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS VARCHAR AS $$
DECLARE
  next_val BIGINT;
  candidate VARCHAR(20);
BEGIN
  LOOP
    next_val := nextval('seq_invoice_number');
    candidate := 'IN' || LPAD(next_val::TEXT, 6, '0');
    -- Exit if not already used (handles edge case of old imported data)
    EXIT WHEN NOT EXISTS (SELECT 1 FROM lp_invoices WHERE inv_number = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION next_credit_note_number()
RETURNS VARCHAR AS $$
DECLARE
  next_val BIGINT;
  candidate VARCHAR(20);
BEGIN
  LOOP
    next_val := nextval('seq_credit_note_number');
    candidate := 'IC' || LPAD(next_val::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM lp_credit_notes WHERE cn_number = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 9. Row Level Security for new tables
-- ============================================================

ALTER TABLE lp_notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_user_approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_ops_assistant_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_credit_notes           ENABLE ROW LEVEL SECURITY;

-- Allow all for authenticated (same pattern as existing tables — role
-- enforcement is handled in the Express backend, not in Supabase RLS)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_notifications;
  CREATE POLICY "Allow authenticated" ON lp_notifications
    FOR ALL TO authenticated USING (true);

  DROP POLICY IF EXISTS "Allow authenticated" ON lp_user_approvals;
  CREATE POLICY "Allow authenticated" ON lp_user_approvals
    FOR ALL TO authenticated USING (true);

  DROP POLICY IF EXISTS "Allow authenticated" ON lp_ops_assistant_actions;
  CREATE POLICY "Allow authenticated" ON lp_ops_assistant_actions
    FOR ALL TO authenticated USING (true);

  DROP POLICY IF EXISTS "Allow authenticated" ON lp_invoices;
  CREATE POLICY "Allow authenticated" ON lp_invoices
    FOR ALL TO authenticated USING (true);

  DROP POLICY IF EXISTS "Allow authenticated" ON lp_credit_notes;
  CREATE POLICY "Allow authenticated" ON lp_credit_notes
    FOR ALL TO authenticated USING (true);
END $$;


-- ============================================================
-- 10. Seed — identify Sharon Mitchell as the approver for
--     Operator/OPS_ASSISTANT/CONTROL_ROOM user creation.
--     This is stored in a simple config table so it can be
--     changed without a code deploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS lp_config (
  cfg_key    VARCHAR(100) PRIMARY KEY,
  cfg_value  VARCHAR(200) NOT NULL,
  cfg_note   VARCHAR(300)
);

INSERT INTO lp_config (cfg_key, cfg_value, cfg_note) VALUES
  ('approver_ops_users',      'sharon.mitchell',  'Username who approves new Operator/OPS_ASSISTANT/CONTROL_ROOM users'),
  ('approver_workshop_users', 'workshop.manager', 'Username who approves new WORKSHOP users'),
  ('vat_rate',                '0.15',             'VAT rate applied to invoices (15%)')
ON CONFLICT (cfg_key) DO NOTHING;


-- ============================================================
-- DONE
-- ============================================================
-- After running this script:
--   1. Update the approver usernames in lp_config to match your
--      actual Supabase user accounts for Sharon Mitchell and the
--      Workshop Manager.
--   2. Proceed to deploy the backend (Phase 2).
-- ============================================================
