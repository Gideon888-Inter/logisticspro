-- ============================================================
-- LP2.0 — BASELINE SCHEMA
-- Supabase PostgreSQL
--
-- HOW TO USE (FRESH INSTALL ONLY):
--   Run in Supabase SQL Editor before any migration_XXX files.
--   If your database already has data, do NOT re-run this.
--   All statements use IF NOT EXISTS — safe to verify against
--   a live DB but will not alter existing columns or constraints.
--
-- Business Unit (bu_code / bus_unit) has been permanently
-- removed from LP2.0. It does not appear anywhere in this file.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Customers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_customers (
  c_code         VARCHAR(10)  PRIMARY KEY,
  c_name         VARCHAR(100) NOT NULL,
  c_active       CHAR(1)      NOT NULL DEFAULT 'Y',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_customer_contact (
  cc_no          SERIAL       PRIMARY KEY,
  cc_customer    VARCHAR(10)  NOT NULL REFERENCES lp_customers(c_code),
  cc_name        VARCHAR(100),
  cc_email       VARCHAR(150),
  cc_cell        VARCHAR(20),
  cc_pod         CHAR(1)      DEFAULT 'N'
);

-- ── Vehicles ─────────────────────────────────────────────────
-- vh_in_service: set to 'Y' when a service card is ACCEPTED or WAITING_FOR_PART.
CREATE TABLE IF NOT EXISTS lp_vehicles (
  vh_code           VARCHAR(10)  PRIMARY KEY,
  vh_type           VARCHAR(20)  NOT NULL CHECK (vh_type IN ('Horse','Trailer','Rigid')),
  vh_active         CHAR(1)      NOT NULL DEFAULT 'Y',
  vh_odometer       INT          DEFAULT 0,
  vh_next_service   INT          DEFAULT 0,
  vh_next_wheel     INT          DEFAULT 0,
  vh_status         VARCHAR(30)  DEFAULT 'AVAILABLE',
  vh_status_load    VARCHAR(20),
  vh_last_location  VARCHAR(100),
  vh_last_location_date DATE,
  vh_cell           VARCHAR(20),
  vh_in_service     CHAR(1)      DEFAULT 'N',
  vh_disposal_date  DATE
);

-- ── Drivers ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_drivers (
  d_id           VARCHAR(20)  PRIMARY KEY,
  d_nickname     VARCHAR(90)  NOT NULL,
  d_cell         VARCHAR(20),
  d_active       CHAR(1)      NOT NULL DEFAULT 'Y',
  d_receipt      CHAR(1)      DEFAULT 'N'
);

-- ── Loads / Movement ─────────────────────────────────────────
-- WAIT_RATE_CHECK: approved, rate verified before invoicing.
-- LOAD_INVOICED / WAIT_INVOICE_NO are system-driven only — blocked
-- from manual status changes in the backend.
CREATE TABLE IF NOT EXISTS lp_movement (
  m_load_no        VARCHAR(20)  PRIMARY KEY,
  m_load_suffix    INT          DEFAULT 0,
  m_date           DATE         NOT NULL DEFAULT CURRENT_DATE,
  m_truck          VARCHAR(10)  REFERENCES lp_vehicles(vh_code),
  m_driver_id      VARCHAR(90),
  m_customer       VARCHAR(10)  REFERENCES lp_customers(c_code),
  m_from           VARCHAR(100),
  m_to             VARCHAR(100),
  m_route_code     VARCHAR(10),
  m_starting_km    INT          DEFAULT 0,
  m_complete_km    INT          DEFAULT 0,
  m_total_km       INT          DEFAULT 0,
  m_rate           NUMERIC(10,2) DEFAULT 0,
  m_extras         NUMERIC(10,2) DEFAULT 0,
  m_load_total     NUMERIC(10,2) DEFAULT 0,
  m_order_no       VARCHAR(45),
  m_invoice        VARCHAR(45),
  m_jobcard        VARCHAR(15),
  m_status         VARCHAR(30)  NOT NULL DEFAULT 'PRELOAD'
                                CHECK (m_status IN (
                                  'PRELOAD','EN_ROUTE','OFFLOADED',
                                  'WAIT_ORDER_NO','WAIT_APPROVAL','WAIT_POD_SCAN',
                                  'WAIT_RATE_CHECK','WAIT_INVOICE_NO','LOAD_INVOICED',
                                  'WAIT_PROCESSING','REJECTED','DELETED',
                                  'PENDING_KM_APPROVAL','KM_CORRECTION_NEEDED'
                                )),
  m_comment        VARCHAR(500),
  m_external       VARCHAR(5),
  m_external_client VARCHAR(3),
  m_operator       VARCHAR(45),
  m_a_offloaded_time TIMESTAMPTZ,
  m_s_offload_time   TIMESTAMPTZ,
  m_app_time         TIMESTAMPTZ  DEFAULT NOW(),
  m_deleted_by     VARCHAR(45),
  m_deleted_at     TIMESTAMPTZ,
  m_deleted_reason VARCHAR(300),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Costs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_costs (
  c_cost_no      SERIAL       PRIMARY KEY,
  c_load         VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  c_description  VARCHAR(200),
  c_amount       NUMERIC(10,2) DEFAULT 0,
  c_code         VARCHAR(10),
  c_operator     VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Extras ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_extras (
  x_id           SERIAL       PRIMARY KEY,
  x_load         VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  x_description  VARCHAR(200),
  x_amount       NUMERIC(10,2) DEFAULT 0,
  x_operator     VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Comments (load audit trail) ──────────────────────────────
CREATE TABLE IF NOT EXISTS lp_comments (
  id             SERIAL       PRIMARY KEY,
  c_load         VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  c_comment      VARCHAR(500),
  c_time         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  c_logged_by    VARCHAR(45)
);

-- ── Events (incidents / fuel) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_events (
  id              SERIAL       PRIMARY KEY,
  e_load_no       VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  e_driver_name   VARCHAR(90),
  e_type          VARCHAR(50),
  e_vehicle       VARCHAR(10),
  e_date          DATE,
  e_time          TIMESTAMPTZ,
  e_description   VARCHAR(500),
  e_user          VARCHAR(45),
  e_operator      VARCHAR(45),
  e_station       VARCHAR(100),
  e_order_no      VARCHAR(45),
  e_litres        NUMERIC(8,2),
  e_severity      VARCHAR(45),
  e_status        VARCHAR(20)  DEFAULT 'OPEN'
);

-- ── Maintenance ──────────────────────────────────────────────
-- Written by service card completion endpoint so next-service
-- intervals recalculate correctly.
CREATE TABLE IF NOT EXISTS lp_maintenance (
  ma_incident_no  SERIAL       PRIMARY KEY,
  ma_vehicle      VARCHAR(10)  REFERENCES lp_vehicles(vh_code),
  ma_date         DATE         DEFAULT CURRENT_DATE,
  ma_service_type VARCHAR(100),
  ma_supplier     VARCHAR(100),
  ma_km           INT          DEFAULT 0,
  ma_labour       NUMERIC(10,2) DEFAULT 0,
  ma_markup       NUMERIC(10,2) DEFAULT 0,
  ma_next_service INT          DEFAULT 0,
  ma_status       VARCHAR(20)  DEFAULT 'OPEN',
  ma_operator     VARCHAR(45),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Inventory (legacy parts store) ───────────────────────────
-- This is the original basic inventory table.
-- The newer lp_inventory_items / lp_purchase_orders tables below
-- are the active module. This table is retained for historic data.
CREATE TABLE IF NOT EXISTS lp_inventory (
  l_id           SERIAL       PRIMARY KEY,
  p_partno       VARCHAR(50)  UNIQUE,
  p_description  VARCHAR(200),
  p_qty          INT          DEFAULT 0,
  p_min          INT          DEFAULT 0,
  p_max          INT          DEFAULT 0,
  p_suppliera    VARCHAR(50),
  p_supplierb    VARCHAR(50),
  p_leadtime     INT          DEFAULT 0,
  p_invoice      VARCHAR(20),
  p_row          VARCHAR(10),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Leave ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_leave (
  id             SERIAL       PRIMARY KEY,
  l_driver       VARCHAR(20)  REFERENCES lp_drivers(d_id),
  l_from         DATE,
  l_to           DATE,
  l_reason       VARCHAR(200),
  l_approved     CHAR(1)      DEFAULT 'N',
  l_operator     VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Users ────────────────────────────────────────────────────
-- u_role is VARCHAR(50) to accommodate custom roles created via
-- the RoleManager page. The CHECK here covers the 11 built-in roles.
-- Custom roles require a separate migration generated by the app.
CREATE TABLE IF NOT EXISTS lp_users (
  u_id           SERIAL       PRIMARY KEY,
  u_username     VARCHAR(45)  UNIQUE NOT NULL,
  u_password     VARCHAR(200) NOT NULL,
  u_name         VARCHAR(100),
  u_email        VARCHAR(150),
  u_role         VARCHAR(50)  NOT NULL DEFAULT 'OPERATOR'
                              CHECK (u_role IN (
                                'ADMIN','MANAGER','OPERATOR','OPS_ASSISTANT',
                                'CONTROL_ROOM','FINANCE','WORKSHOP_MANAGER',
                                'WORKSHOP_ASSISTANT','STOCK_CONTROLLER',
                                'WORKSHOP','READONLY'
                              )),
  u_region       VARCHAR(50),
  u_active       CHAR(1)      DEFAULT 'Y',
  u_first_login  CHAR(1)      DEFAULT 'Y',
  u_reset_token  VARCHAR(100),
  u_reset_token_expiry TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Client Rate Cards ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_client_rates (
  id              SERIAL        PRIMARY KEY,
  rc_client_code  VARCHAR(10)   NOT NULL REFERENCES lp_customers(c_code),
  rc_from         VARCHAR(100)  NOT NULL,
  rc_to           VARCHAR(100)  NOT NULL,
  rc_kms          NUMERIC(8,1),
  rc_rate_15m     NUMERIC(10,2),
  rc_rate_18m     NUMERIC(10,2),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_notifications (
  id          SERIAL        PRIMARY KEY,
  n_user      VARCHAR(45),
  n_role      VARCHAR(50),
  n_type      VARCHAR(50)   NOT NULL,
  n_title     VARCHAR(200)  NOT NULL,
  n_message   VARCHAR(1000) NOT NULL,
  n_load_no   VARCHAR(20),
  n_ref_id    INT,
  n_read      CHAR(1)       DEFAULT 'N',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── User Approvals ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_user_approvals (
  id                  SERIAL        PRIMARY KEY,
  ua_username         VARCHAR(45)   NOT NULL,
  ua_password_hash    VARCHAR(200)  NOT NULL,
  ua_name             VARCHAR(100),
  ua_email            VARCHAR(150),
  ua_role             VARCHAR(50)   NOT NULL,
  ua_region           VARCHAR(50),
  ua_requested_by     VARCHAR(45)   NOT NULL,
  ua_approver         VARCHAR(45)   NOT NULL,
  ua_status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                    CHECK (ua_status IN ('PENDING','APPROVED','REJECTED')),
  ua_rejection_reason VARCHAR(300),
  ua_actioned_by      VARCHAR(45),
  ua_actioned_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Ops Assistant Actions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_ops_assistant_actions (
  id                  SERIAL        PRIMARY KEY,
  oa_load_no          VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  oa_action_type      VARCHAR(50)   NOT NULL,
  oa_payload          JSONB         NOT NULL,
  oa_requested_by     VARCHAR(45)   NOT NULL,
  oa_approver         VARCHAR(45)   NOT NULL,
  oa_status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                    CHECK (oa_status IN ('PENDING','APPROVED','REJECTED')),
  oa_rejection_reason VARCHAR(300),
  oa_actioned_by      VARCHAR(45),
  oa_actioned_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Invoices ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_invoices (
  id              SERIAL        PRIMARY KEY,
  inv_number      VARCHAR(20)   UNIQUE NOT NULL,
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

-- ── Credit Notes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_credit_notes (
  id              SERIAL        PRIMARY KEY,
  cn_number       VARCHAR(20)   UNIQUE NOT NULL,
  cn_invoice_id   INT           REFERENCES lp_invoices(id),
  cn_invoice_no   VARCHAR(20),
  cn_load_no      VARCHAR(20)   REFERENCES lp_movement(m_load_no),
  cn_customer     VARCHAR(10)   REFERENCES lp_customers(c_code),
  cn_date         DATE          NOT NULL DEFAULT CURRENT_DATE,
  cn_description  VARCHAR(200)  NOT NULL DEFAULT 'TRANSPORT SERVICES',
  cn_amount_excl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_vat          NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_amount_incl  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cn_reason       VARCHAR(500)  NOT NULL,
  cn_created_by   VARCHAR(45)   NOT NULL,
  cn_approved_by  VARCHAR(45),
  cn_approved_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Config ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_config (
  cfg_key    VARCHAR(100) PRIMARY KEY,
  cfg_value  VARCHAR(200) NOT NULL,
  cfg_note   VARCHAR(300)
);

-- ── KM Anomalies ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_anomalies (
  id                  SERIAL        PRIMARY KEY,
  a_load_no           VARCHAR(20)   NOT NULL REFERENCES lp_movement(m_load_no),
  a_operator          VARCHAR(45)   NOT NULL,
  a_dead_km           INT           NOT NULL,
  a_status            VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                                    CHECK (a_status IN ('PENDING','APPROVED','REJECTED')),
  a_reviewed_by       VARCHAR(45),
  a_reviewed_at       TIMESTAMPTZ,
  a_rejection_reason  VARCHAR(300),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Vehicle Audit ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_vehicle_audit (
  id          SERIAL        PRIMARY KEY,
  va_vehicle  VARCHAR(10)   NOT NULL REFERENCES lp_vehicles(vh_code),
  va_action   VARCHAR(50)   NOT NULL,
  va_fields   TEXT,
  va_operator VARCHAR(45)   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Service Cards ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_service_cards (
  sc_no               VARCHAR(20)   PRIMARY KEY,
  sc_vehicle          VARCHAR(10)   NOT NULL REFERENCES lp_vehicles(vh_code),
  sc_status           VARCHAR(30)   NOT NULL DEFAULT 'PENDING_SERVICE'
                                    CHECK (sc_status IN (
                                      'PENDING_SERVICE','SERVICE_ACCEPTED',
                                      'WAITING_FOR_PART','COMPLETE','REJECTED'
                                    )),
  sc_trigger          VARCHAR(300),
  sc_odometer         INT,
  sc_completion_km    INT,
  sc_operator         VARCHAR(45)   NOT NULL,
  sc_date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  sc_rejected_reason  VARCHAR(500),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_service_audit (
  id              SERIAL        PRIMARY KEY,
  sa_service_no   VARCHAR(20)   NOT NULL REFERENCES lp_service_cards(sc_no),
  sa_action       VARCHAR(50)   NOT NULL,
  sa_detail       VARCHAR(500),
  sa_operator     VARCHAR(45)   NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_service_checklist (
  id              SERIAL        PRIMARY KEY,
  sl_service_no   VARCHAR(20)   NOT NULL REFERENCES lp_service_cards(sc_no),
  sl_label        VARCHAR(200)  NOT NULL,
  sl_order        INT           NOT NULL DEFAULT 0,
  sl_checked      BOOLEAN       NOT NULL DEFAULT false,
  sl_checked_by   VARCHAR(45),
  sl_checked_at   TIMESTAMPTZ,
  sl_operator     VARCHAR(45)   NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_service_comments (
  id              SERIAL        PRIMARY KEY,
  sm_service_no   VARCHAR(20)   NOT NULL REFERENCES lp_service_cards(sc_no),
  sm_comment      VARCHAR(2000) NOT NULL,
  sm_operator     VARCHAR(45)   NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Inventory Items & Purchase Orders ────────────────────────
CREATE TABLE IF NOT EXISTS lp_inventory_items (
  item_id           SERIAL        PRIMARY KEY,
  item_code         VARCHAR(20)   UNIQUE NOT NULL,
  item_name         VARCHAR(200)  NOT NULL,
  item_description  VARCHAR(500),
  item_category     VARCHAR(100)  DEFAULT 'Other',
  unit_of_measure   VARCHAR(20)   DEFAULT 'Each',
  gl_account_code   VARCHAR(20)   DEFAULT '7700',
  reorder_level     INT           DEFAULT 0,
  reorder_qty       INT           DEFAULT 0,
  qty_on_hand       INT           NOT NULL DEFAULT 0,
  qty_on_order      INT           NOT NULL DEFAULT 0,
  average_cost      NUMERIC(12,4) DEFAULT 0,
  last_cost         NUMERIC(12,4) DEFAULT 0,
  supplier_code     VARCHAR(20),
  notes             TEXT,
  status            VARCHAR(30)   NOT NULL DEFAULT 'ACTIVE'
                                  CHECK (status IN ('ACTIVE','PENDING_APPROVAL','SUSPENDED')),
  approved_by       VARCHAR(45),
  approved_at       TIMESTAMPTZ,
  rejection_reason  VARCHAR(300),
  created_by        VARCHAR(45)   NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_inventory_transactions (
  txn_id          SERIAL        PRIMARY KEY,
  txn_type        VARCHAR(30)   NOT NULL
                                CHECK (txn_type IN (
                                  'PO_RECEIPT','ISSUE','RETURN','ADJUSTMENT','COUNT'
                                )),
  item_id         INT           NOT NULL REFERENCES lp_inventory_items(item_id),
  qty             NUMERIC(10,3) NOT NULL,
  unit_cost_excl  NUMERIC(12,4) DEFAULT 0,
  total_cost_excl NUMERIC(12,4) DEFAULT 0,
  po_id           INT,
  po_line_id      INT,
  load_no         VARCHAR(20),
  txn_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  txn_ref         VARCHAR(50),
  reversed        CHAR(1)       DEFAULT 'N',
  reversal_of     INT,
  notes           TEXT,
  created_by      VARCHAR(45)   NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_purchase_orders (
  po_id               SERIAL        PRIMARY KEY,
  po_number           VARCHAR(20)   UNIQUE NOT NULL,
  supplier_code       VARCHAR(20)   NOT NULL,
  supplier_name       VARCHAR(200),
  allocation_type     VARCHAR(20)   NOT NULL DEFAULT 'VEHICLE'
                                    CHECK (allocation_type IN ('VEHICLE','INVENTORY')),
  vehicle_code        VARCHAR(10),
  vehicle_name        VARCHAR(100),
  po_description      TEXT,
  subtotal_excl_vat   NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_incl_vat      NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_capital          CHAR(1)       DEFAULT 'N',
  status              VARCHAR(30)   NOT NULL DEFAULT 'PARKED'
                                    CHECK (status IN (
                                      'PARKED','PENDING_L1','PENDING_L2','PENDING_L3',
                                      'PENDING_FINANCIAL','APPROVED','GOODS_RECEIVED',
                                      'PAID','REJECTED','CANCELLED'
                                    )),
  submitted_by        VARCHAR(45),
  submitted_at        TIMESTAMPTZ,
  l1_approver         VARCHAR(45),
  l1_approved_at      TIMESTAMPTZ,
  l2_approver         VARCHAR(45),
  l2_approved_at      TIMESTAMPTZ,
  l3_approver         VARCHAR(45),
  l3_approved_at      TIMESTAMPTZ,
  financial_approver  VARCHAR(45),
  financial_approved_at TIMESTAMPTZ,
  rejected_by         VARCHAR(45),
  rejected_at         TIMESTAMPTZ,
  rejection_reason    VARCHAR(500),
  rejection_stage     VARCHAR(20),
  attachment_filename VARCHAR(300),
  attachment_url      VARCHAR(500),
  onedrive_url        VARCHAR(500),
  onedrive_offloaded  CHAR(1)       DEFAULT 'N',
  offloaded_at        TIMESTAMPTZ,
  notes               TEXT,
  created_by          VARCHAR(45)   NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_po_lines (
  po_line_id      SERIAL        PRIMARY KEY,
  po_id           INT           NOT NULL REFERENCES lp_purchase_orders(po_id),
  line_number     INT           NOT NULL,
  line_type       VARCHAR(20)   DEFAULT 'COST'
                                CHECK (line_type IN ('COST','INVENTORY')),
  gl_account_code VARCHAR(20),
  item_id         INT           REFERENCES lp_inventory_items(item_id),
  item_code       VARCHAR(20),
  item_name       VARCHAR(200),
  description     TEXT          NOT NULL,
  quantity        NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_of_measure VARCHAR(20)   DEFAULT 'Each',
  unit_price_excl NUMERIC(12,4) NOT NULL DEFAULT 0,
  vat_type        VARCHAR(20)   DEFAULT 'IN_STD',
  vat_amount      NUMERIC(12,4) NOT NULL DEFAULT 0,
  line_total_excl NUMERIC(12,4) NOT NULL DEFAULT 0,
  line_total_incl NUMERIC(12,4) NOT NULL DEFAULT 0,
  qty_received    NUMERIC(10,3) DEFAULT 0,
  qty_outstanding NUMERIC(10,3) DEFAULT 0,
  UNIQUE (po_id, line_number)
);

CREATE TABLE IF NOT EXISTS lp_po_approval_log (
  log_id          SERIAL        PRIMARY KEY,
  po_id           INT           NOT NULL REFERENCES lp_purchase_orders(po_id),
  po_number       VARCHAR(20),
  action          VARCHAR(50)   NOT NULL,
  actioned_by     VARCHAR(45)   NOT NULL,
  from_status     VARCHAR(30),
  to_status       VARCHAR(30),
  notes           TEXT,
  attachment_url  VARCHAR(500),
  actioned_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Role / Permission System ──────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_modules (
  module_key    VARCHAR(50)   PRIMARY KEY,
  module_label  VARCHAR(100)  NOT NULL,
  module_group  VARCHAR(50),
  sort_order    INT           NOT NULL DEFAULT 0,
  is_active     BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS lp_custom_roles (
  role_key      VARCHAR(50)   PRIMARY KEY,
  role_label    VARCHAR(100)  NOT NULL,
  role_group    VARCHAR(50)   DEFAULT 'Custom',
  badge_color   VARCHAR(30)   DEFAULT 'badge-gray',
  description   TEXT,
  base_role     VARCHAR(50),
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_by    VARCHAR(45),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_role_permissions (
  role_key      VARCHAR(50)   NOT NULL,
  module_key    VARCHAR(50)   NOT NULL REFERENCES lp_modules(module_key),
  can_view      BOOLEAN       NOT NULL DEFAULT false,
  can_edit      BOOLEAN       NOT NULL DEFAULT false,
  can_delete    BOOLEAN       NOT NULL DEFAULT false,
  can_approve   BOOLEAN       NOT NULL DEFAULT false,
  extra_flags   JSONB,
  updated_by    VARCHAR(45),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_key, module_key)
);

-- ────────────────────────────────────────────────────────────
-- SEQUENCES
-- ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS seq_load_number        START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS seq_invoice_number     START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS seq_credit_note_number START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS seq_po_number          START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS seq_inventory_item     START 1000   INCREMENT 1;

-- ── Invoice number generator ──────────────────────────────────
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

-- ── Credit note number generator ─────────────────────────────
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

-- ── PO number generator ───────────────────────────────────────
CREATE OR REPLACE FUNCTION next_po_number()
RETURNS VARCHAR AS $$
DECLARE
  next_val  BIGINT;
  candidate VARCHAR(20);
BEGIN
  LOOP
    next_val  := nextval('seq_po_number');
    candidate := 'PO-' || to_char(CURRENT_DATE, 'YYYY') || '-' || LPAD(next_val::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM lp_purchase_orders WHERE po_number = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- ── Inventory item code generator ────────────────────────────
CREATE OR REPLACE FUNCTION next_inventory_item_code()
RETURNS VARCHAR AS $$
DECLARE
  next_val  BIGINT;
  candidate VARCHAR(20);
BEGIN
  LOOP
    next_val  := nextval('seq_inventory_item');
    candidate := 'ITEM-' || LPAD(next_val::TEXT, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM lp_inventory_items WHERE item_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_movement_status       ON lp_movement(m_status);
CREATE INDEX IF NOT EXISTS idx_movement_date         ON lp_movement(m_date);
CREATE INDEX IF NOT EXISTS idx_movement_truck        ON lp_movement(m_truck);
CREATE INDEX IF NOT EXISTS idx_movement_customer     ON lp_movement(m_customer);
CREATE INDEX IF NOT EXISTS idx_comments_load         ON lp_comments(c_load);
CREATE INDEX IF NOT EXISTS idx_events_load           ON lp_events(e_load_no);
CREATE INDEX IF NOT EXISTS idx_costs_load            ON lp_costs(c_load);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON lp_notifications(n_user);
CREATE INDEX IF NOT EXISTS idx_notifications_role    ON lp_notifications(n_role);
CREATE INDEX IF NOT EXISTS idx_notifications_read    ON lp_notifications(n_read);
CREATE INDEX IF NOT EXISTS idx_user_approvals_status   ON lp_user_approvals(ua_status);
CREATE INDEX IF NOT EXISTS idx_user_approvals_approver ON lp_user_approvals(ua_approver);
CREATE INDEX IF NOT EXISTS idx_ops_actions_load      ON lp_ops_assistant_actions(oa_load_no);
CREATE INDEX IF NOT EXISTS idx_ops_actions_approver  ON lp_ops_assistant_actions(oa_approver);
CREATE INDEX IF NOT EXISTS idx_ops_actions_status    ON lp_ops_assistant_actions(oa_status);
CREATE INDEX IF NOT EXISTS idx_invoices_load         ON lp_invoices(inv_load_no);
CREATE INDEX IF NOT EXISTS idx_invoices_customer     ON lp_invoices(inv_customer);
CREATE INDEX IF NOT EXISTS idx_invoices_status       ON lp_invoices(inv_status);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice  ON lp_credit_notes(cn_invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer ON lp_credit_notes(cn_customer);
CREATE INDEX IF NOT EXISTS idx_anomalies_load_no     ON lp_anomalies(a_load_no);
CREATE INDEX IF NOT EXISTS idx_anomalies_status      ON lp_anomalies(a_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_audit         ON lp_vehicle_audit(va_vehicle);
CREATE INDEX IF NOT EXISTS idx_service_cards_vehicle ON lp_service_cards(sc_vehicle);
CREATE INDEX IF NOT EXISTS idx_service_cards_status  ON lp_service_cards(sc_status);
CREATE INDEX IF NOT EXISTS idx_service_audit         ON lp_service_audit(sa_service_no);
CREATE INDEX IF NOT EXISTS idx_service_checklist     ON lp_service_checklist(sl_service_no);
CREATE INDEX IF NOT EXISTS idx_service_comments      ON lp_service_comments(sm_service_no);
CREATE INDEX IF NOT EXISTS idx_client_rates_client   ON lp_client_rates(rc_client_code);
CREATE INDEX IF NOT EXISTS idx_po_lines_po           ON lp_po_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_approval_log_po    ON lp_po_approval_log(po_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_status      ON lp_inventory_items(status);
CREATE INDEX IF NOT EXISTS idx_inv_txn_item          ON lp_inventory_transactions(item_id);

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
-- Role enforcement is in Express/auth.js. RLS here is a safety net
-- ensuring only authenticated Supabase sessions reach any table.

ALTER TABLE lp_movement              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_vehicles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_drivers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_user_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_ops_assistant_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_credit_notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_client_rates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_service_cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_service_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_service_checklist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_service_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_vehicle_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_anomalies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_inventory_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_purchase_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_po_lines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_po_approval_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_role_permissions      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_movement;
  CREATE POLICY "Allow authenticated" ON lp_movement FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_vehicles;
  CREATE POLICY "Allow authenticated" ON lp_vehicles FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_drivers;
  CREATE POLICY "Allow authenticated" ON lp_drivers FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_customers;
  CREATE POLICY "Allow authenticated" ON lp_customers FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_users;
  CREATE POLICY "Allow authenticated" ON lp_users FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_notifications;
  CREATE POLICY "Allow authenticated" ON lp_notifications FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_user_approvals;
  CREATE POLICY "Allow authenticated" ON lp_user_approvals FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_ops_assistant_actions;
  CREATE POLICY "Allow authenticated" ON lp_ops_assistant_actions FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_invoices;
  CREATE POLICY "Allow authenticated" ON lp_invoices FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_credit_notes;
  CREATE POLICY "Allow authenticated" ON lp_credit_notes FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_client_rates;
  CREATE POLICY "Allow authenticated" ON lp_client_rates FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_cards;
  CREATE POLICY "Allow authenticated" ON lp_service_cards FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_audit;
  CREATE POLICY "Allow authenticated" ON lp_service_audit FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_checklist;
  CREATE POLICY "Allow authenticated" ON lp_service_checklist FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_service_comments;
  CREATE POLICY "Allow authenticated" ON lp_service_comments FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_vehicle_audit;
  CREATE POLICY "Allow authenticated" ON lp_vehicle_audit FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_anomalies;
  CREATE POLICY "Allow authenticated" ON lp_anomalies FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_inventory_items;
  CREATE POLICY "Allow authenticated" ON lp_inventory_items FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_purchase_orders;
  CREATE POLICY "Allow authenticated" ON lp_purchase_orders FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_po_lines;
  CREATE POLICY "Allow authenticated" ON lp_po_lines FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_po_approval_log;
  CREATE POLICY "Allow authenticated" ON lp_po_approval_log FOR ALL TO authenticated USING (true);
  DROP POLICY IF EXISTS "Allow authenticated" ON lp_role_permissions;
  CREATE POLICY "Allow authenticated" ON lp_role_permissions FOR ALL TO authenticated USING (true);
END $$;

-- ────────────────────────────────────────────────────────────
-- SEED DATA
-- ────────────────────────────────────────────────────────────

-- Config defaults (update approver usernames to match real accounts)
INSERT INTO lp_config (cfg_key, cfg_value, cfg_note) VALUES
  ('approver_ops_users',      'sharon.mitchell',  'Username who approves new Operator/OPS_ASSISTANT/CONTROL_ROOM users'),
  ('approver_workshop_users', 'workshop.manager', 'Username who approves new WORKSHOP role users'),
  ('vat_rate',                '0.15',             'VAT rate applied to invoices (15%)'),
  ('po_capital_enabled',      'N',                'Set to Y to enable capital purchase flag on POs'),
  ('onedrive_po_base_path',   'https://llamahosted.sharepoint.com/sites/Interland/Shared%20Documents/Supplier%20Invoices', 'OneDrive base path for PO attachments')
ON CONFLICT (cfg_key) DO NOTHING;

-- Module definitions for the Role Manager
INSERT INTO lp_modules (module_key, module_label, module_group, sort_order) VALUES
  ('loads',           'Loads',           'Operations', 10),
  ('approvals',       'Approvals',       'Operations', 20),
  ('drivers',         'Drivers',         'Operations', 30),
  ('clients',         'Clients',         'Operations', 40),
  ('rates',           'Rate Cards',      'Operations', 50),
  ('fleet',           'Fleet',           'Workshop',   60),
  ('service',         'Service Cards',   'Workshop',   70),
  ('inventory',       'Inventory',       'Workshop',   80),
  ('purchase_orders', 'Purchase Orders', 'Workshop',   90),
  ('users',           'Users',           'Admin',     100),
  ('roles',           'Role Manager',    'Admin',     110),
  ('invoices',        'Invoices',        'Finance',   120),
  ('finance_ar',      'AR / Debtors',    'Finance',   130),
  ('finance_ap',      'AP / Creditors',  'Finance',   140),
  ('finance_gl',      'GL Journals',     'Finance',   150),
  ('finance_cashbook','Cashbook',         'Finance',   160),
  ('finance_vat',     'VAT',             'Finance',   170),
  ('finance_periods', 'Periods',         'Finance',   180),
  ('finance_assets',  'Fixed Assets',    'Finance',   190),
  ('entities',        'Entities',        'Finance',   200),
  ('dashboard',       'Dashboard',       'System',    210)
ON CONFLICT (module_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- AFTER RUNNING THIS FILE:
--
--   1. Set load number sequence to your highest existing load:
--        SELECT setval('seq_load_number', <highest number>);
--
--   2. Update approver usernames in lp_config:
--        UPDATE lp_config SET cfg_value = 'actual.username'
--        WHERE cfg_key = 'approver_ops_users';
--
--   3. Run migration_fin_sync.sql if the financial engine
--      fin_ tables already exist in this database.
-- ────────────────────────────────────────────────────────────
