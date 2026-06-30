// ── Vehicle code normalization ──────────────────────────────────────────────
// Historic data (Sage Evolution exports / CSV loads) sometimes encodes the
// same vehicle with a different numeric zero-padding than the canonical
// lp_vehicles.vh_code, e.g. Supabase holds "BT001" but an imported load row
// has "BT01" or "BT1". A plain string/exact `.eq()` or `.in()` match against
// these values silently misses the row (no error — it just doesn't join),
// which is what previously caused fields like "Loads by Region" / operator
// data to show as "Unknown" or "—" for affected vehicles.
//
// normalizeVehicleKey() reduces any code to a canonical comparison key by
// upper-casing, trimming, and stripping leading zeros from the trailing
// numeric portion. It is ONLY meant for matching/lookups — never write this
// key back as if it were the real vh_code; always resolve through
// lp_vehicles to get the authoritative vh_code.
//
//   normalizeVehicleKey('BT001') === normalizeVehicleKey('BT01')  // true
//   normalizeVehicleKey('BT01')  === normalizeVehicleKey('BT1')   // true
//   normalizeVehicleKey('MH140') === normalizeVehicleKey('mh140') // true

function normalizeVehicleKey(code) {
  if (code === null || code === undefined) return '';
  const trimmed = String(code).trim().toUpperCase();
  if (!trimmed) return '';
  const match = trimmed.match(/^([A-Z]+)0*(\d+)$/);
  if (match) return `${match[1]}${match[2]}`;
  // No letter+digit pattern recognised (unusual code) — fall back to the
  // trimmed/uppercased value so at least casing/whitespace differences
  // still match.
  return trimmed;
}

// Build a Map of normalizeVehicleKey(vh_code) -> vh_code (or full row, if
// `keepRow` is true) from a list of vehicle rows. Used to resolve
// possibly-mismatched historic codes back to the authoritative vh_code.
function buildVehicleKeyMap(vehicles, keepRow = false) {
  const map = new Map();
  (vehicles || []).forEach(v => {
    const key = normalizeVehicleKey(v.vh_code);
    if (key && !map.has(key)) map.set(key, keepRow ? v : v.vh_code);
  });
  return map;
}

// Resolve a possibly-mismatched code (e.g. "BT01") to the authoritative
// vh_code (e.g. "BT001") using a key map built with buildVehicleKeyMap().
// Returns the original code untouched if no match is found, so callers can
// decide how to handle a genuinely unknown vehicle.
function resolveVehicleCode(code, keyMap) {
  if (!code) return code;
  const key = normalizeVehicleKey(code);
  return keyMap.has(key) ? keyMap.get(key) : code;
}

module.exports = { normalizeVehicleKey, buildVehicleKeyMap, resolveVehicleCode };
