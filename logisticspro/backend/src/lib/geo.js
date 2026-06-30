// ── Great-circle distance helper ─────────────────────────────────────────────
// Used to: (1) match a vehicle's live Pulsit position against named
// addresses/home-base geofences (Fleet dashboard), and (2) confirm a
// linked trailer is actually with its horse by comparing their reported
// positions (Fleet dashboard trailer-link confirmation).

const EARTH_RADIUS_KM = 6371;

function toRad(deg) { return (deg * Math.PI) / 180; }

// Returns distance in km between two lat/lng points.
function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v == null || isNaN(v))) return null;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Given a position and a list of named address rows (a_latitude, a_longitude,
// a_radius_km, a_name), returns the closest one the position falls within
// the radius of, or null if none match. Picks the nearest if multiple
// geofences overlap.
function matchAddress(lat, lng, addresses) {
  if (lat == null || lng == null || !addresses?.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const a of addresses) {
    const d = distanceKm(lat, lng, a.a_latitude, a.a_longitude);
    if (d == null) continue;
    const radius = a.a_radius_km != null ? Number(a.a_radius_km) : 2;
    if (d <= radius && d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best ? { ...best, distance_km: Number(bestDist.toFixed(2)) } : null;
}

// Like matchAddress, but ignores the radius cutoff entirely — always
// returns the single closest address plus its distance. Used to diagnose
// "this vehicle should be Home Base X but isn't matching" cases: if the
// returned distance is small, the radius is too tight; if it's large
// (tens of km), the geofence's lat/lng itself is wrong, not the radius.
function nearestAddress(lat, lng, addresses) {
  if (lat == null || lng == null || !addresses?.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const a of addresses) {
    const d = distanceKm(lat, lng, a.a_latitude, a.a_longitude);
    if (d == null) continue;
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best ? { ...best, distance_km: Number(bestDist.toFixed(2)) } : null;
}

module.exports = { distanceKm, matchAddress, nearestAddress };
