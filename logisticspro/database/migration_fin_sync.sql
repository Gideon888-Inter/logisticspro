-- LP2.0 Migration: Finance → Loads/Workshop sync columns
-- Run in Supabase SQL Editor
-- All statements are IF NOT EXISTS safe — can be re-run safely

-- ─── fin_suppliers: workshop_allowed flag ────────────────────
ALTER TABLE fin_suppliers
  ADD COLUMN IF NOT EXISTS workshop_allowed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN fin_suppliers.workshop_allowed IS
  'When true, this supplier appears in the Workshop PO creation dropdown. Toggle: ADMIN, FINANCE, WORKSHOP_MANAGER.';

-- ─── fin_ar_customers: loads sync columns ────────────────────
ALTER TABLE fin_ar_customers
  ADD COLUMN IF NOT EXISTS loads_allowed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE fin_ar_customers
  ADD COLUMN IF NOT EXISTS lp_synced BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE fin_ar_customers
  ADD COLUMN IF NOT EXISTS lp_client_code VARCHAR(20);

COMMENT ON COLUMN fin_ar_customers.loads_allowed IS
  'When true, customer is active in the Loads module.';
COMMENT ON COLUMN fin_ar_customers.lp_synced IS
  'True once this customer has been synced to lp_customers and a rate card created.';
COMMENT ON COLUMN fin_ar_customers.lp_client_code IS
  'The c_code value in lp_customers that this AR customer maps to.';

-- ─── fin_suppliers: created_by (if not present) ──────────────
ALTER TABLE fin_suppliers
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(50);

ALTER TABLE fin_ar_customers
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(50);

ALTER TABLE fin_assets
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(50);

ALTER TABLE fin_gl_accounts
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(50);

-- ─── Index for quick workshop supplier lookup ─────────────────
CREATE INDEX IF NOT EXISTS idx_fin_suppliers_workshop
  ON fin_suppliers (workshop_allowed) WHERE workshop_allowed = TRUE;

CREATE INDEX IF NOT EXISTS idx_fin_ar_customers_loads
  ON fin_ar_customers (loads_allowed) WHERE loads_allowed = TRUE;
