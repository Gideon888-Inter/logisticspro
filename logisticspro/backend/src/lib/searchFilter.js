// ── PostgREST .or() search-filter safety ─────────────────────────────────
// Several routes build a Supabase .or() filter string by directly
// interpolating raw user search input, e.g.:
//   q.or(`m_load_no.ilike.%${search}%,m_truck.ilike.%${search}%`)
//
// PostgREST's filter-string syntax uses comma to separate conditions and
// parentheses for and()/or() grouping. A search value containing a comma,
// parenthesis, or double quote can therefore break out of the intended
// single-column condition and be interpreted as additional filter syntax
// (e.g. `foo,and(m_status.eq.DELETED)`) — not classic SQL injection, but a
// PostgREST filter-injection / query-corruption bug. Malformed input can
// also just 400 the request (accidental DoS via crafted search terms).
//
// Fix: PostgREST lets a value contain otherwise-reserved characters if it's
// wrapped in double quotes, with internal backslashes/quotes escaped
// (RFC-ish string quoting) — see PostgREST docs on "Column filters" value
// quoting. Wrapping every search value this way means literal commas,
// parens, periods, etc. in what a user types are always treated as literal
// value content, never as filter syntax.
//
// sanitizeSearch() also clamps length — an unbounded search string is a
// cheap way to bloat every request built from it.
const MAX_SEARCH_LEN = 100;

function sanitizeSearch(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.slice(0, MAX_SEARCH_LEN);
  // Escape backslashes first, then double quotes, per PostgREST quoted-value rules.
  return trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Builds a single `column.ilike."%value%"` clause with the value safely quoted.
function ilikeClause(column, rawSearch) {
  const safe = sanitizeSearch(rawSearch);
  return `${column}.ilike."%${safe}%"`;
}

// Builds a full comma-joined .or() filter string across multiple columns,
// e.g. orSearchFilter(['m_load_no','m_truck'], search) ->
//   'm_load_no.ilike."%abc%",m_truck.ilike."%abc%"'
function orSearchFilter(columns, rawSearch) {
  const safe = sanitizeSearch(rawSearch);
  return columns.map(c => `${c}.ilike."%${safe}%"`).join(',');
}

module.exports = { sanitizeSearch, ilikeClause, orSearchFilter, MAX_SEARCH_LEN };
