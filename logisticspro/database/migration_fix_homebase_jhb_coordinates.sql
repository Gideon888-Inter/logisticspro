-- =====================================================================
-- LP2.0 — Correct Home Base – JHB geofence coordinates
-- =====================================================================
-- The previous coordinates (-26.0925, 27.7711, near Krugersdorp) were
-- ~12.6km from the actual yard — well outside even the 8km radius set
-- in migration_client_emails_and_homebase_radius.sql. That migration's
-- radius widening was the wrong fix for the wrong problem: this was a
-- bad pin, not a tight radius.
--
-- Confirmed location, per Gideon: vehicles parking at either
--   - Indaba Ln, Roodepoort, 2169          (-26.0618535, 27.8866727)
--   - 100 Beyers Naudé Dr, Randpark Ridge, Randburg, 2169
--                                            (-26.0554530, 27.8958605)
-- are both legitimately "Home Base – JHB" — these two addresses are
-- only ~1.2km apart, so one geofence centered on their midpoint with a
-- 2km radius covers both comfortably without being so wide it starts
-- catching unrelated nearby locations.
--
-- Coordinates sourced from Google Places (not guessed/recalled), to
-- avoid repeating the original imprecise-geocoding mistake.
--
-- Idempotent — safe to re-run.
-- =====================================================================

UPDATE lp_addresses
SET
  a_latitude  = -26.0586533,
  a_longitude = 27.8912666,
  a_radius_km = 2,
  a_address   = 'Indaba Ln / Beyers Naudé Dr area, Roodepoort/Randburg, 2169, South Africa'
WHERE a_type = 'HOME_BASE' AND a_name = 'Home Base – JHB';

-- Safety net: if the row doesn't exist for any reason (e.g. renamed),
-- insert it fresh so this migration is self-sufficient either way.
INSERT INTO lp_addresses (a_name, a_address, a_latitude, a_longitude, a_radius_km, a_type)
SELECT 'Home Base – JHB',
       'Indaba Ln / Beyers Naudé Dr area, Roodepoort/Randburg, 2169, South Africa',
       -26.0586533, 27.8912666, 2, 'HOME_BASE'
WHERE NOT EXISTS (
  SELECT 1 FROM lp_addresses WHERE a_type = 'HOME_BASE' AND a_name = 'Home Base – JHB'
);
