-- ============================================================
-- LP2.0 — audit_vehicle_code_mismatches.sql
-- READ-ONLY audit — Supabase SQL Editor
--
-- Finds m_truck / m_trailer1 / m_trailer2 values in lp_movement that do
-- NOT exactly match any lp_vehicles.vh_code, but DO match once leading
-- zeros are stripped from the trailing digits (e.g. CSV/Sage import wrote
-- "BT01" while lp_vehicles holds the canonical "BT001").
--
-- The app's backend (lib/vehicleCode.js) already matches these
-- normalized variants when reading data, so dashboards/fleet views won't
-- silently show "Unknown" for them. This script is for Gideon to review
-- and, if desired, run the companion UPDATE statements (commented out
-- below) to normalize the stored values to the canonical vh_code.
--
-- SAFE — this file only SELECTs. Nothing is changed unless you
-- uncomment and run the UPDATE statements at the bottom yourself.
-- ============================================================

-- Normalizes a code the same way lib/vehicleCode.js does:
-- uppercase, trim, strip leading zeros after the letter prefix.
CREATE OR REPLACE FUNCTION lp_normalize_vehicle_key(code TEXT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN code IS NULL THEN ''
    WHEN UPPER(TRIM(code)) ~ '^[A-Z]+0*[0-9]+$' THEN
      regexp_replace(UPPER(TRIM(code)), '^([A-Z]+)0*([0-9]+)$', '\1\2')
    ELSE UPPER(TRIM(code))
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ── m_truck mismatches ──────────────────────────────────────────────────
SELECT DISTINCT m.m_truck AS stored_code,
       v.vh_code          AS canonical_code,
       'm_truck'          AS column_name
FROM lp_movement m
LEFT JOIN lp_vehicles v
  ON lp_normalize_vehicle_key(v.vh_code) = lp_normalize_vehicle_key(m.m_truck)
WHERE m.m_truck IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lp_vehicles vv WHERE vv.vh_code = m.m_truck)
  AND v.vh_code IS NOT NULL

UNION ALL

-- ── m_trailer1 mismatches ───────────────────────────────────────────────
SELECT DISTINCT m.m_trailer1, v.vh_code, 'm_trailer1'
FROM lp_movement m
LEFT JOIN lp_vehicles v
  ON lp_normalize_vehicle_key(v.vh_code) = lp_normalize_vehicle_key(m.m_trailer1)
WHERE m.m_trailer1 IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lp_vehicles vv WHERE vv.vh_code = m.m_trailer1)
  AND v.vh_code IS NOT NULL

UNION ALL

-- ── m_trailer2 mismatches ───────────────────────────────────────────────
SELECT DISTINCT m.m_trailer2, v.vh_code, 'm_trailer2'
FROM lp_movement m
LEFT JOIN lp_vehicles v
  ON lp_normalize_vehicle_key(v.vh_code) = lp_normalize_vehicle_key(m.m_trailer2)
WHERE m.m_trailer2 IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM lp_vehicles vv WHERE vv.vh_code = m.m_trailer2)
  AND v.vh_code IS NOT NULL;

-- ============================================================
-- OPTIONAL FIX — review the results above first, then uncomment to
-- normalize stored values to the canonical vh_code. Idempotent (re-running
-- after fix finds zero rows).
-- ============================================================

-- UPDATE lp_movement m
-- SET m_truck = v.vh_code
-- FROM lp_vehicles v
-- WHERE lp_normalize_vehicle_key(v.vh_code) = lp_normalize_vehicle_key(m.m_truck)
--   AND m.m_truck IS DISTINCT FROM v.vh_code;

-- UPDATE lp_movement m
-- SET m_trailer1 = v.vh_code
-- FROM lp_vehicles v
-- WHERE lp_normalize_vehicle_key(v.vh_code) = lp_normalize_vehicle_key(m.m_trailer1)
--   AND m.m_trailer1 IS DISTINCT FROM v.vh_code;

-- UPDATE lp_movement m
-- SET m_trailer2 = v.vh_code
-- FROM lp_vehicles v
-- WHERE lp_normalize_vehicle_key(v.vh_code) = lp_normalize_vehicle_key(m.m_trailer2)
--   AND m.m_trailer2 IS DISTINCT FROM v.vh_code;
