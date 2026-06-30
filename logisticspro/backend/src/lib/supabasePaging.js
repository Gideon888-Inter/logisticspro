// ── Supabase/PostgREST "max rows" workaround ────────────────────────────────
// Every Supabase project enforces a project-level cap on how many rows a
// single PostgREST response can contain (Project Settings → API → "Max
// Rows", commonly defaulting to 1000). This cap applies even when a caller
// explicitly requests a larger range via `.range(from, to)` — PostgREST
// just silently returns fewer rows than asked for, and supabase-js does NOT
// surface this as an error. The only visible symptom is a row count that's
// suspiciously capped at a round number (1000) regardless of how much data
// actually exists or what limit/range was requested.
//
// This bit LP2.0 in two places already: the Dashboard's "Total Loads" tile
// (asking for limit=2000) and /loads/stats/summary (asking for everything,
// no range at all) both silently capped at 1000 once lp_movement grew past
// that size. Any other endpoint that selects a large unranged/under-ranged
// slice of a growing table (lp_movement in particular, given the "no hard
// deletion, full historic retention" principle) is exposed to the same bug
// as the table keeps growing.
//
// fetchChunked() works around it by never asking Supabase for more than
// SUPABASE_MAX_ROWS in a single request, looping and concatenating until
// either `limit` rows have been collected or the table is exhausted.

const SUPABASE_MAX_ROWS = 1000;

// buildQuery: () => SupabaseQueryBuilder — must be a function that builds a
//   FRESH query (same filters/order every time) so `.range()` can be
//   applied per-chunk. The query MUST include a stable, deterministic
//   `.order()` (ties broken by a unique column) — without one, rows can be
//   skipped or duplicated across chunk boundaries.
// offset: starting row offset (for page/limit-style pagination)
// limit: total rows desired across all chunks. Pass Infinity /
//   Number.MAX_SAFE_INTEGER to fetch everything.
async function fetchChunked(buildQuery, offset, limit) {
  let rows = [];
  let count = null;
  let fetched = 0;
  while (fetched < limit) {
    const chunkSize = Math.min(SUPABASE_MAX_ROWS, limit - fetched);
    const from = offset + fetched;
    const to = from + chunkSize - 1;
    const { data, error, count: c } = await buildQuery().range(from, to);
    if (error) throw error;
    if (count === null) count = c;
    rows = rows.concat(data || []);
    fetched += (data || []).length;
    if (!data || data.length < chunkSize) break; // exhausted — no more rows
  }
  return { rows, count };
}

module.exports = { fetchChunked, SUPABASE_MAX_ROWS };
