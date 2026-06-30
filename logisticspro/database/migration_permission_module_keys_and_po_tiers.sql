-- ============================================================
-- migration_permission_module_keys_and_po_tiers.sql
-- ============================================================
-- Two independent fixes, safe to run together or separately,
-- fully idempotent (safe to re-run).
--
-- PART 1 — Module key case reconciliation
-- ------------------------------------------------------------
-- lp_modules / lp_role_permissions were seeded with lowercase
-- module_key values ('loads', 'fleet', 'purchase_orders', ...).
-- The actual backend permission map (auth.js BUILTIN_PERMISSION_MAP)
-- and every requirePermission()/hasPermission() call added across
-- the app uses UPPERCASE keys ('LOADS', 'FLEET', 'PURCHASE_ORDERS').
-- Until this migration, a custom role configured via the Role
-- Manager UI would silently never match any actual permission
-- check — the two systems were never speaking the same language.
--
-- This migrates lp_modules to uppercase keys matching the backend,
-- re-points any existing lp_role_permissions rows so no configured
-- data is lost, adds the modules that existed in code but were
-- never exposed in the Role Manager UI (COSTS, KM, ROUTES, PODS,
-- REPORTS), and consolidates the seven separate finance_* module
-- rows into one FINANCE key — matching how finance.js actually
-- enforces access today (one gate for the whole module, not
-- per-sub-area). True per-area finance granularity would require
-- further backend route changes and is not done here.
--
-- PART 2 — PO approval hierarchy made DB-driven
-- ------------------------------------------------------------
-- New lp_po_approval_tiers table replaces the hardcoded role
-- checks in inventory.js's PO approval routes. Seeded to exactly
-- reproduce current behaviour for all 11 built-in roles — this
-- is a zero-behaviour-change migration on its own; the DB-driven
-- backend code changes are a separate commit.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1a — Insert the new uppercase module rows (parents first,
-- so re-pointing child rows in 1b never violates the FK).
-- ────────────────────────────────────────────────────────────
INSERT INTO lp_modules (module_key, module_label, module_group, sort_order) VALUES
  ('LOADS',           'Loads',           'Operations', 10),
  ('APPROVALS',       'Approvals',       'Operations', 20),
  ('DRIVERS',         'Drivers',         'Operations', 30),
  ('CLIENTS',         'Clients',         'Operations', 40),
  ('ROUTES',          'Freight Routes',  'Operations', 45),
  ('RATES',           'Rate Cards',      'Operations', 50),
  ('FLEET',           'Fleet',           'Workshop',   60),
  ('WORKSHOP',        'Service Cards',   'Workshop',   70),
  ('INVENTORY',       'Inventory',       'Workshop',   80),
  ('PURCHASE_ORDERS', 'Purchase Orders', 'Workshop',   90),
  ('KM',              'KM / Anomalies',  'Operations', 95),
  ('PODS',            'PODs',            'Operations', 96),
  ('USERS',           'Users',           'Admin',     100),
  ('ROLES',           'Role Manager',    'Admin',     110),
  ('INVOICES',        'Invoices',        'Finance',   120),
  ('FINANCE',         'Finance Module',  'Finance',   130),
  ('REPORTS',         'Reports',         'Admin',     200)
ON CONFLICT (module_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- PART 1b — Re-point any existing lp_role_permissions rows from
-- the old lowercase keys onto the new uppercase keys. The seven
-- finance_* rows are merged into one FINANCE row per role, using
-- an OR-merge (most-permissive-wins) so no previously granted
-- access is silently dropped by the consolidation.
-- ────────────────────────────────────────────────────────────

-- Simple 1:1 renames first (safe even if no rows exist yet)
DO $$
DECLARE
  rename_pair RECORD;
BEGIN
  FOR rename_pair IN
    SELECT * FROM (VALUES
      ('loads',           'LOADS'),
      ('approvals',       'APPROVALS'),
      ('drivers',         'DRIVERS'),
      ('clients',         'CLIENTS'),
      ('rates',           'RATES'),
      ('fleet',           'FLEET'),
      ('service',         'WORKSHOP'),
      ('inventory',       'INVENTORY'),
      ('purchase_orders', 'PURCHASE_ORDERS'),
      ('users',           'USERS'),
      ('roles',           'ROLES'),
      ('invoices',        'INVOICES')
    ) AS t(old_key, new_key)
  LOOP
    UPDATE lp_role_permissions
    SET module_key = rename_pair.new_key
    WHERE module_key = rename_pair.old_key
      AND NOT EXISTS (
        SELECT 1 FROM lp_role_permissions p2
        WHERE p2.role_key = lp_role_permissions.role_key
          AND p2.module_key = rename_pair.new_key
      );
    -- If a row for the new key already exists for that role (re-run safety),
    -- just drop the stale old-key row instead of violating the PK.
    DELETE FROM lp_role_permissions
    WHERE module_key = rename_pair.old_key;
  END LOOP;
END $$;

-- Consolidate the seven finance_* sub-modules into one FINANCE row per role
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT role_key,
           bool_or(can_view)    AS can_view,
           bool_or(can_edit)    AS can_edit,
           bool_or(can_delete)  AS can_delete,
           bool_or(can_approve) AS can_approve
    FROM lp_role_permissions
    WHERE module_key IN ('finance_ar','finance_ap','finance_gl','finance_cashbook','finance_vat','finance_periods','finance_assets')
    GROUP BY role_key
  LOOP
    INSERT INTO lp_role_permissions (role_key, module_key, can_view, can_edit, can_delete, can_approve)
    VALUES (r.role_key, 'FINANCE', r.can_view, r.can_edit, r.can_delete, r.can_approve)
    ON CONFLICT (role_key, module_key) DO UPDATE SET
      can_view    = lp_role_permissions.can_view    OR EXCLUDED.can_view,
      can_edit    = lp_role_permissions.can_edit    OR EXCLUDED.can_edit,
      can_delete  = lp_role_permissions.can_delete  OR EXCLUDED.can_delete,
      can_approve = lp_role_permissions.can_approve OR EXCLUDED.can_approve;
  END LOOP;

  DELETE FROM lp_role_permissions
  WHERE module_key IN ('finance_ar','finance_ap','finance_gl','finance_cashbook','finance_vat','finance_periods','finance_assets');
END $$;

-- 'entities' was a legacy catch-all superseded by separate DRIVERS/CLIENTS/ROUTES —
-- drop any leftover permission rows against it (nothing in code reads this key)
DELETE FROM lp_role_permissions WHERE module_key = 'entities';

-- ────────────────────────────────────────────────────────────
-- PART 1c — Now safe to remove the old lowercase module rows
-- (no lp_role_permissions rows reference them any more).
-- 'dashboard' is left in place — it has no backend enforcement
-- and isn't required by any requirePermission() call, but it's
-- harmless to keep for now.
-- ────────────────────────────────────────────────────────────
DELETE FROM lp_modules
WHERE module_key IN (
  'loads','approvals','drivers','clients','rates','fleet','service',
  'inventory','purchase_orders','users','roles','invoices',
  'finance_ar','finance_ap','finance_gl','finance_cashbook',
  'finance_vat','finance_periods','finance_assets','entities'
);

-- ────────────────────────────────────────────────────────────
-- PART 2a — PO approval tier table
-- tier: 0 = no PO approval duties
--       1 = approves PENDING_L1   (own POs start at PENDING_L2)
--       2 = approves PENDING_L1/L2 (own POs start at PENDING_L3)
--       3 = approves PENDING_L1/L2/L3, jumps straight to
--           PENDING_FINANCIAL (own POs start at PENDING_FINANCIAL)
--       4 = financial approval — same gate as tier 3 plus acts on
--           PENDING_FINANCIAL itself (own POs start at PENDING_FINANCIAL)
-- can_use_capital_po: separate flag, independent of tier.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lp_po_approval_tiers (
  role_key            VARCHAR(50)  PRIMARY KEY,
  tier                INT          NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 4),
  can_use_capital_po  BOOLEAN      NOT NULL DEFAULT false,
  updated_by          VARCHAR(45),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed exactly matching today's hardcoded behaviour (zero-change baseline) —
-- ON CONFLICT DO NOTHING so re-running this never clobbers a value Gideon
-- has since changed via the Role Manager.
INSERT INTO lp_po_approval_tiers (role_key, tier, can_use_capital_po) VALUES
  ('ADMIN',              4, true),
  ('FINANCE',            4, false),
  ('WORKSHOP_MANAGER',   3, true),
  ('WORKSHOP_ASSISTANT', 2, false),
  ('STOCK_CONTROLLER',   1, false),
  ('MANAGER',            0, false),
  ('OPERATOR',           0, false),
  ('OPS_ASSISTANT',      0, false),
  ('CONTROL_ROOM',       0, false),
  ('WORKSHOP',           0, false),
  ('READONLY',           0, false)
ON CONFLICT (role_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- PART 2b — PO stage notification-routing config (the underlying
-- table/columns already existed and were partially read by
-- inventory.js; po_financial_role was referenced in code but never
-- actually seeded or fetched — this completes it).
-- ────────────────────────────────────────────────────────────
INSERT INTO lp_config (cfg_key, cfg_value, cfg_note) VALUES
  ('po_l1_role',        'STOCK_CONTROLLER',   'Role notified when a PO reaches PENDING_L1'),
  ('po_l2_role',        'WORKSHOP_ASSISTANT', 'Role notified when a PO reaches PENDING_L2'),
  ('po_l3_role',        'WORKSHOP_MANAGER',   'Role notified when a PO reaches PENDING_L3'),
  ('po_financial_role', 'FINANCE',            'Role notified when a PO reaches PENDING_FINANCIAL')
ON CONFLICT (cfg_key) DO NOTHING;
