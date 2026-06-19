-- ============================================================
-- SCHEMA UPDATE — Fix 6
-- Adds all missing tables so a fresh install works completely.
--
-- HOW TO USE:
--   1. Go to your Supabase project at supabase.com
--   2. Click "SQL Editor" in the left menu
--   3. Paste this entire file into the editor
--   4. Click "Run"
--
-- Safe to run more than once — every statement uses
-- IF NOT EXISTS so nothing breaks if a table already exists.
-- ============================================================


-- ============================================================
-- PART A — Tables from migration_001 (already in your database
--           if you ran that migration, but missing from schema.sql)
-- ============================================================


-- ── lp_notifications ────────────────────────────────────────
-- Stores in-app alerts sent to users or broadcast to a role.
-- e.g. "Your approval request was accepted"

CREATE TABLE IF NOT EXISTS lp_notifications (
  id          SERIAL        PRIMARY KEY,
  n_user      VARCHAR(45),                  -- specific username (null = broadcast to role)
  n_role      VARCHAR(20),                  -- role broadcast (null = specific user only)
  n_type      VARCHAR(50)   NOT NULL,       -- e.g. ORDER_NO_CHANGE, USER_APPROVAL_REQUIRED
  n_title     VARCHAR(200)  NOT NULL,
  n_message   VARCHAR(1000) NOT NULL,
  n_load_no   VARCHAR(20),                  -- linked load (optional)
  n_ref_id    INT,                          -- generic reference id (invoice, approval, etc.)
  n_read      CHAR(1)       DEFAULT 'N',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON lp_notifications(n_user);
CREATE INDEX IF NOT EXISTS idx_notifications_role ON lp_notifications(n_role);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON lp_notifications(n_read);


-- ── lp_user_approvals ───────────────────────────────────────
-- When a Manager creates certain user roles, the request lands
-- here and waits for the designated approver to accept or reject.

CREATE TABLE IF NOT EXISTS lp_user_approvals (
  id                  SERIAL        PRIMARY KEY,
  ua_username         VARCHAR(45)   NOT NULL,
  ua_password_hash    VARCHAR(200)  NOT NULL,   -- pre-hashed; applied only on approval
  ua_name             VARCHAR(100),
  ua_email            VARCHAR(150),
  ua_role             VARCHAR(20)   NOT NULL,
  ua_bus_unit         VARCHAR(10),
  ua_region           VARCHAR(50),
  ua_requested_by     VARCHAR(45)   NOT NULL,   -- Manager who submitted the request
  ua_approver         VARCHAR(45)   NOT NULL,   -- username who must approve
  ua_status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                    CHECK (ua_status IN ('PENDING','APPROVED','REJECTED')),
  ua_rejection_reason VARCHAR(300),
  ua_actioned_by      VARCHAR(45),
  ua_actioned_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_approvals_status   ON lp_user_approvals(ua_status);
CREATE INDEX IF NOT EXISTS idx_user_approvals_approver ON lp_user_approvals(ua_approver);


-- ── lp_ops_assistant_actions ────────────────────────────────
-- When an Ops Assistant makes a change (status, cost, order no),
-- the action is held here until the responsible Operator approves it.

CREATE TABLE IF NOT EXISTS lp_ops_assistant_actions (
  id                  SERIAL        PRIMARY KEY,
  oa_load_no          VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  oa_action_type      VARCHAR(50)   NOT NULL,
  -- action types: STATUS_CHANGE, ADD_COST, DELETE_COST, SET_ORDER_NO, CHANGE_ORDER_NO
  oa_payload          JSONB         NOT NULL,   -- the full change stored as JSON
  oa_requested_by     VARCHAR(45)   NOT NULL,   -- Ops Assistant username
  oa_approver         VARCHAR(45)   NOT NULL,   -- Operator on the load
  oa_status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                    CHECK (oa_status IN ('PENDING','APPROVED','REJECTED')),
  oa_rejection_reason VARCHAR(300),
  oa_actioned_by      VARCHAR(45),
  oa_actioned_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_actions_load     ON lp_ops_assistant_actions(oa_load_no);
CREATE INDEX IF NOT EXISTS idx_ops_actions_approver ON lp_ops_assistant_actions(oa_approver);
CREATE INDEX IF NOT EXISTS idx_ops_actions_status   ON lp_ops_assistant_actions(oa_status);


-- ── lp_invoices ─────────────────────────────────────────────
-- Invoice register. Each row is one invoice raised against a load.

CREATE TABLE IF NOT EXISTS lp_invoices (
  id              SERIAL        PRIMARY KEY,
  inv_number      VARCHAR(20)   UNIQUE NOT NULL,  -- e.g. IN100001 (auto-generated)
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


-- ── lp_credit_notes ─────────────────────────────────────────
-- Credit note register. Linked to an invoice when a reversal is needed.

CREATE TABLE IF NOT EXISTS lp_credit_notes (
  id              SERIAL        PRIMARY KEY,
  cn_number       VARCHAR(20)   UNIQUE NOT NULL,  -- e.g. IC100001 (auto-generated)
  cn_invoice_id   INT           REFERENCES lp_invoices(id),
  cn_invoice_no   VARCHAR(20),                    -- stored directly for easy display
  cn_load_no      VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  cn_customer     VARCHAR(10)   REFERENCES lp_customers(c_code),
  cn_date         DATE          NOT NULL DEFAULT CURRENT_DATE,
  cn_description  VARCHAR(200)  NOT NULL DEFAULT 'TRANSPORT SERVICES',
  cn_amount_excl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_vat          NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_amount_incl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_reason       VARCHAR(500)  NOT NULL,          -- mandatory: why the credit was raised
  cn_created_by   VARCHAR(45)   NOT NULL,
  cn_approved_by  VARCHAR(45),
  cn_approved_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice  ON lp_credit_notes(cn_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_load     ON lp_credit_notes(cn_load_no);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer ON lp_credit_notes(cn_customer);


-- ── lp_config ───────────────────────────────────────────────
-- Simple key-value store for app settings (e.g. approver usernames, VAT rate).
-- Change values here instead of in code.

CREATE TABLE IF NOT EXISTS lp_config (
  cfg_key    VARCHAR(100) PRIMARY KEY,
  cfg_value  VARCHAR(200) NOT NULL,
  cfg_note   VARCHAR(300)
);

-- !! IMPORTANT — change these usernames to match your actual user accounts !!
INSERT INTO lp_config (cfg_key, cfg_value, cfg_note) VALUES
  ('approver_ops_users',      'sharon.mitchell',  'Username who approves new Operator / OPS_ASSISTANT / CONTROL_ROOM users'),
  ('approver_workshop_users', 'workshop.manager', 'Username who approves new WORKSHOP users'),
  ('vat_rate',                '0.15',             'VAT rate applied to invoices — 15%')
ON CONFLICT (cfg_key) DO NOTHING;


-- ── Auto-number sequences ────────────────────────────────────
-- These guarantee that invoice and credit note numbers never repeat,
-- even if two people create one at the same moment.

CREATE SEQUENCE IF NOT EXISTS seq_invoice_number    START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS seq_credit_note_number START 100001 INCREMENT 1;

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS VARCHAR AS $$
DECLARE
  next_val  BIGINT;
  candidate VARCHAR(20);
BEGIN
  LOOP
    next_val  := nextval('seq_invoice_number');
    candidate := 'IN' || LPAD(next_val::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM lp_invoices WHERE inv_number = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION next_credit_note_number()
RETURNS VARCHAR AS $$
DECLARE
  next_val  BIGINT;
  candidate VARCHAR(20);
BEGIN
  LOOP
    next_val  := nextval('seq_credit_note_number');
    candidate := 'IC' || LPAD(next_val::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM lp_credit_notes WHERE cn_number = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;


-- ── Row Level Security for Part A tables ────────────────────
-- Role enforcement happens in the Express backend.
-- These policies just let authenticated users through.

ALTER TABLE lp_notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_user_approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_ops_assistant_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_credit_notes           ENABLE ROW LEVEL SECURITY;

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
-- PART B — Tables used by the app but missing from BOTH files
--           (these did not exist anywhere — this creates them
--            for the first time)
-- ============================================================


-- ── lp_client_rates ─────────────────────────────────────────
-- Rate cards per client. Each row is one route/rate combination.
-- Used by the Rates page and the KM closing validation.

CREATE TABLE IF NOT EXISTS lp_client_rates (
  id              SERIAL        PRIMARY KEY,
  rc_client_code  VARCHAR(10)   NOT NULL REFERENCES lp_customers(c_code),
  rc_from         VARCHAR(100)  NOT NULL,         -- departure location name
  rc_to           VARCHAR(100)  NOT NULL,         -- destination location name
  rc_kms          NUMERIC(8,1),                   -- standard route distance in km
  rc_rate_15m     NUMERIC(10,2),                  -- rate for 15-metre trailer (excl. VAT)
  rc_rate_18m     NUMERIC(10,2),                  -- rate for 18-metre trailer (excl. VAT)
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_rates_client ON lp_client_rates(rc_client_code);
CREATE INDEX IF NOT EXISTS idx_client_rates_from   ON lp_client_rates(rc_from);
CREATE INDEX IF NOT EXISTS idx_client_rates_to     ON lp_client_rates(rc_to);

ALTER TABLE lp_client_rates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_client_rates;
  CREATE POLICY "Allow authenticated" ON lp_client_rates
    FOR ALL TO authenticated USING (true);
END $$;


-- ── lp_service_cards ────────────────────────────────────────
-- One row per vehicle service event (routine service or wheel alignment).
-- Status moves: PENDING_SERVICE → SERVICE_ACCEPTED → COMPLETE (or REJECTED).

CREATE TABLE IF NOT EXISTS lp_service_cards (
  sc_no               VARCHAR(20)   PRIMARY KEY,   -- e.g. S100001 (auto-generated)
  sc_vehicle          VARCHAR(10)   NOT NULL REFERENCES lp_vehicles(vh_code),
  sc_status           VARCHAR(30)   NOT NULL DEFAULT 'PENDING_SERVICE'
                                    CHECK (sc_status IN (
                                      'PENDING_SERVICE',   -- just raised, not accepted yet
                                      'SERVICE_ACCEPTED',  -- workshop accepted the job
                                      'WAITING_FOR_PART',  -- part on order, vehicle blocked
                                      'COMPLETE',          -- service done, vehicle released
                                      'REJECTED'           -- service rejected (not needed)
                                    )),
  sc_trigger          VARCHAR(300),                -- what triggered the card (auto or manual text)
  sc_odometer         INT,                         -- odometer reading when card was raised
  sc_completion_km    INT,                         -- odometer at service completion
  sc_operator         VARCHAR(45)   NOT NULL,      -- user who created the card
  sc_date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  sc_rejected_reason  VARCHAR(500),                -- populated on rejection
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_cards_vehicle ON lp_service_cards(sc_vehicle);
CREATE INDEX IF NOT EXISTS idx_service_cards_status  ON lp_service_cards(sc_status);

ALTER TABLE lp_service_cards ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_cards;
  CREATE POLICY "Allow authenticated" ON lp_service_cards
    FOR ALL TO authenticated USING (true);
END $$;


-- ── lp_service_audit ────────────────────────────────────────
-- Audit trail for every action taken on a service card.
-- One row per action — never updated, only inserted.

CREATE TABLE IF NOT EXISTS lp_service_audit (
  id              SERIAL        PRIMARY KEY,
  sa_service_no   VARCHAR(20)   NOT NULL REFERENCES lp_service_cards(sc_no),
  sa_action       VARCHAR(50)   NOT NULL,   -- e.g. CREATED, STATUS_CHANGED, COMPLETED
  sa_detail       VARCHAR(500),             -- human-readable description of what changed
  sa_operator     VARCHAR(45)   NOT NULL,   -- username (or SYSTEM for auto-created)
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_audit_service_no ON lp_service_audit(sa_service_no);

ALTER TABLE lp_service_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_audit;
  CREATE POLICY "Allow authenticated" ON lp_service_audit
    FOR ALL TO authenticated USING (true);
END $$;


-- ── lp_service_checklist ────────────────────────────────────
-- Optional checklist items attached to a service card.
-- Workshop users tick items off as they complete each task.

CREATE TABLE IF NOT EXISTS lp_service_checklist (
  id              SERIAL        PRIMARY KEY,
  sl_service_no   VARCHAR(20)   NOT NULL REFERENCES lp_service_cards(sc_no),
  sl_label        VARCHAR(200)  NOT NULL,           -- e.g. "Check oil level"
  sl_order        INT           NOT NULL DEFAULT 0, -- display order
  sl_checked      BOOLEAN       NOT NULL DEFAULT false,
  sl_checked_by   VARCHAR(45),                      -- username who ticked it
  sl_checked_at   TIMESTAMPTZ,                      -- when it was ticked
  sl_operator     VARCHAR(45)   NOT NULL,            -- user who added the item
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_checklist_service_no ON lp_service_checklist(sl_service_no);

ALTER TABLE lp_service_checklist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_checklist;
  CREATE POLICY "Allow authenticated" ON lp_service_checklist
    FOR ALL TO authenticated USING (true);
END $$;


-- ── lp_service_comments ─────────────────────────────────────
-- Comments thread on a service card (separate from the main
-- load comments so workshop notes stay isolated).

CREATE TABLE IF NOT EXISTS lp_service_comments (
  id              SERIAL        PRIMARY KEY,
  sm_service_no   VARCHAR(20)   NOT NULL REFERENCES lp_service_cards(sc_no),
  sm_comment      VARCHAR(2000) NOT NULL,
  sm_operator     VARCHAR(45)   NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_comments_service_no ON lp_service_comments(sm_service_no);

ALTER TABLE lp_service_comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_comments;
  CREATE POLICY "Allow authenticated" ON lp_service_comments
    FOR ALL TO authenticated USING (true);
END $$;


-- ── lp_vehicle_audit ────────────────────────────────────────
-- Audit log for vehicle record changes (who changed what and when).
-- One row per change — never updated, only inserted.

CREATE TABLE IF NOT EXISTS lp_vehicle_audit (
  id          SERIAL        PRIMARY KEY,
  va_vehicle  VARCHAR(10)   NOT NULL REFERENCES lp_vehicles(vh_code),
  va_action   VARCHAR(50)   NOT NULL,    -- e.g. CREATED, UPDATED
  va_fields   TEXT,                      -- JSON string of which fields changed
  va_operator VARCHAR(45)   NOT NULL,    -- username who made the change
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_audit_vehicle ON lp_vehicle_audit(va_vehicle);

ALTER TABLE lp_vehicle_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_vehicle_audit;
  CREATE POLICY "Allow authenticated" ON lp_vehicle_audit
    FOR ALL TO authenticated USING (true);
END $$;


-- ── lp_anomalies ────────────────────────────────────────────
-- KM anomaly flags. Raised when a truck's opening KM is more than
-- 500 km above the last recorded closing KM (dead km threshold).
-- Operator must approve or reject before the load can proceed.

CREATE TABLE IF NOT EXISTS lp_anomalies (
  id                  SERIAL        PRIMARY KEY,
  a_load_no           VARCHAR(20)   NOT NULL REFERENCES lp_movement(m_load_no),
  a_operator          VARCHAR(45)   NOT NULL,        -- user who created the load
  a_dead_km           INT           NOT NULL,         -- how many dead km were recorded
  a_status            VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                    CHECK (a_status IN ('PENDING','APPROVED','REJECTED')),
  a_reviewed_by       VARCHAR(45),                   -- who approved/rejected
  a_reviewed_at       TIMESTAMPTZ,
  a_rejection_reason  VARCHAR(300),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_load_no ON lp_anomalies(a_load_no);
CREATE INDEX IF NOT EXISTS idx_anomalies_status  ON lp_anomalies(a_status);

ALTER TABLE lp_anomalies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_anomalies;
  CREATE POLICY "Allow authenticated" ON lp_anomalies
    FOR ALL TO authenticated USING (true);
END $$;


-- ============================================================
-- PART C — Load number sequence (Fix 3 from the bug report)
-- Prevents duplicate load numbers when two users create a load
-- at the same moment.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS seq_load_number START 100001 INCREMENT 1;

-- After running this, find your current highest load number in
-- lp_movement (e.g. A100247 → 100247) and run:
--
--   SELECT setval('seq_load_number', 100247);
--
-- Replace 100247 with your actual highest number.
-- This makes sure the sequence starts after your existing data.


-- ============================================================
-- DONE
-- ============================================================
-- After running this script:
--
--   1. Update lp_config with your real approver usernames:
--
--      UPDATE lp_config SET cfg_value = 'actual.username'
--      WHERE cfg_key = 'approver_ops_users';
--
--      UPDATE lp_config SET cfg_value = 'actual.username'
--      WHERE cfg_key = 'approver_workshop_users';
--
--   2. Set the load number sequence to your current highest load:
--
--      SELECT setval('seq_load_number', <your highest number here>);
--
--   3. Restart your backend server so changes take effect.
-- ============================================================
