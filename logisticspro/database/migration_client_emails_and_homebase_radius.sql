-- =====================================================================
-- LP2.0 — Client POD/Invoice emails + Home Base geofence radius fix
-- =====================================================================
-- 1. Adds dedicated email address fields on lp_customers, separate
--    from the existing c_send_pod / c_send_invoice Y/N flags:
--      - c_pod_email      — where POD packs are emailed for this client
--      - c_invoice_email  — where invoices are emailed for this client
--    Either field may hold a comma-separated list of addresses.
--
-- 2. Widens the Home Base geofence radius (lp_addresses.a_radius_km)
--    for HOME_BASE-type rows from 5km to 8km. Reported symptom: MH127
--    parked at "94 Indaba Ln, Krugersdorp" (the JHB yard) was not
--    being matched to "Home Base – JHB" on the Fleet dashboard.
--    The seeded geofence center for JHB is an approximate address
--    lookup, not a pin dropped on the actual yard gate — a wider
--    radius is a safety margin, but the real fix is recalibrating the
--    pin in Clients → Addresses → Home Base – JHB to the actual gate
--    coordinates (the migration that seeded it flagged this as a
--    known follow-up — see migration_stops_and_addresses.sql).
--
-- Idempotent — safe to re-run.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lp_customers' AND column_name = 'c_pod_email'
  ) THEN
    ALTER TABLE lp_customers ADD COLUMN c_pod_email VARCHAR(500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lp_customers' AND column_name = 'c_invoice_email'
  ) THEN
    ALTER TABLE lp_customers ADD COLUMN c_invoice_email VARCHAR(500);
  END IF;
END $$;

-- Widen home base radius as a safety margin (does not touch lat/lng —
-- recalibrate those manually via the UI if the pin is off).
UPDATE lp_addresses
SET a_radius_km = 8
WHERE a_type = 'HOME_BASE' AND a_radius_km < 8;
