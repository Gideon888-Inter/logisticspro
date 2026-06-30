// ── Shared Google Maps loader ───────────────────────────────────────────────
// Single source of truth — loaded once regardless of which page needs it
// (Loads.jsx map picker, Fleet.jsx live tracking map, etc). Google explicitly
// warns against including the Maps script more than once per page, so this
// must not be duplicated per-file.
//
// Reports failures through the callback instead of failing silently:
// missing key, invalid key, billing disabled, Places not enabled, blocked
// referrer, or network failure. window.gm_authFailure is the global Google
// Maps calls when the key/billing/referrer check fails — there is no
// exception to catch for that case.
const MAPS_KEY = import.meta.env.VITE_MAPS_KEY || '';

let mapsLoaded = false;
let mapsLoading = false;
let mapsError = null;
const mapsCallbacks = []; // each: (error: string|null) => void

export function resetGoogleMapsLoader() {
  mapsLoaded = false;
  mapsLoading = false;
  mapsError = null;
  delete window.gm_authFailure;
  const existing = document.getElementById('lp-google-maps-script');
  if (existing) existing.remove();
}

export function loadGoogleMaps(cb) {
  if (mapsLoaded) return cb(null);
  if (mapsError) return cb(mapsError);
  if (!MAPS_KEY) {
    const msg = 'Map is not configured (missing Google Maps API key). Contact your administrator.';
    console.warn(msg);
    mapsError = msg;
    return cb(msg);
  }

  mapsCallbacks.push(cb);
  if (mapsLoading) return;
  mapsLoading = true;

  // Fires if the key is invalid, billing is disabled, or the referrer
  // (domain) isn't on the allowed list for this key.
  window.gm_authFailure = () => {
    mapsLoading = false;
    mapsError = 'Google Maps rejected this site — check the API key, billing status, or allowed domains in Google Cloud Console.';
    mapsCallbacks.forEach(f => f(mapsError));
    mapsCallbacks.length = 0;
  };

  const script = document.createElement('script');
  script.id = 'lp-google-maps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&loading=async`;
  script.async = true;
  script.onload = () => {
    // gm_authFailure (if it fires) does so asynchronously right after load —
    // give it a brief window before declaring success.
    setTimeout(() => {
      if (mapsError) return; // already handled by gm_authFailure above
      mapsLoaded = true;
      mapsLoading = false;
      mapsCallbacks.forEach(f => f(null));
      mapsCallbacks.length = 0;
    }, 300);
  };
  script.onerror = () => {
    mapsLoading = false;
    mapsError = 'Could not reach Google Maps — check your internet connection.';
    mapsCallbacks.forEach(f => f(mapsError));
    mapsCallbacks.length = 0;
  };
  document.head.appendChild(script);
}
