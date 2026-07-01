const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, loadUserPermissions, requirePermission } = require('../middleware/auth');
const { fetchChunked } = require('../lib/supabasePaging');
const { orSearchFilter } = require('../lib/searchFilter');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// Roles that can mark a POD as received

// ── Helper: build SharePoint folder link for a load ──────────
function sharepointLink(loadNo) {
  // Deep link directly to the subfolder for this load in SharePoint
  const folderPath = `/sites/Interland/Shared Documents/Interland Distribution/PODS New/A${loadNo}`;
  const listUrl = 'https://llamahosted.sharepoint.com/sites/Interland/Shared Documents';
  return `https://llamahosted-my.sharepoint.com/shared?id=${encodeURIComponent(folderPath)}&listurl=${encodeURIComponent(listUrl)}`;
}

// ============================================================
// GET /api/pods/pending
// Loads currently sitting in WAIT_POD_SCAN — need a POD.
// NOTE: Must be registered BEFORE /:loadNo routes to avoid
//       Express treating "pending" as a loadNo parameter.
// ============================================================
router.get('/pending', requirePermission('PODS', 'view'), async (req, res) => {
  let q = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_order_no')
    .eq('m_status', 'WAIT_POD_SCAN')
    .order('m_date', { ascending: false });

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data || []).map(load => ({
    ...load,
    sharepoint_url: sharepointLink(load.m_load_no),
  }));

  res.json(result);
});


// ============================================================
// GET /api/pods/received
// Loads that have been marked as POD received (m_pod_received = true).
// NOTE: Must be registered BEFORE /:loadNo routes.
// ============================================================
router.get('/received', requirePermission('PODS', 'view'), async (req, res) => {
  const { search } = req.query;

  // This dataset only grows (every load that ever gets a POD stays on this
  // list forever, per the no-hard-deletion principle) and supports search
  // across the full history, so it must NOT be silently capped at Supabase's
  // project-level max-rows limit — see lib/supabasePaging.js.
  const buildQuery = () => {
    let q = supabase
      .from('lp_movement')
      .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_status, m_order_no', { count: 'exact' })
      .eq('m_pod_received', true)
      .neq('m_status', 'DELETED')
      .order('m_date', { ascending: false })
      .order('m_load_no', { ascending: false });
    if (search) q = q.or(orSearchFilter(['m_load_no', 'm_customer', 'm_truck'], search));
    return q;
  };

  try {
    const { rows: data } = await fetchChunked(buildQuery, 0, Number.MAX_SAFE_INTEGER);
    const result = data.map(load => ({
      ...load,
      sharepoint_url: sharepointLink(load.m_load_no),
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// GET /api/pods/:loadNo/check
// Called by the Loads page when a load is in WAIT_POD_SCAN.
// Checks if a POD folder exists in SharePoint (via the m_pod_received flag
// or a future direct SharePoint API call). If found, advances the status
// automatically to WAIT_APPROVAL and returns the SharePoint link.
// ============================================================
router.get('/:loadNo/check', requirePermission('PODS', 'view'), async (req, res) => {
  const { loadNo } = req.params;

  try {
    const { data: load, error } = await supabase
      .from('lp_movement')
      .select('m_status, m_pod_received, m_pod_sharepoint_url')
      .eq('m_load_no', loadNo)
      .single();

    if (error || !load) return res.json({ found: false });

    // If already marked received (manually or previously auto-detected)
    if (load.m_pod_received) {
      return res.json({
        found: true,
        sharepoint_url: load.m_pod_sharepoint_url || sharepointLink(loadNo),
      });
    }

    // Not yet found
    return res.json({ found: false });

  } catch (err) {
    console.error('[POD CHECK ERROR]', err);
    res.json({ found: false });
  }
});


// ============================================================
// POST /api/pods/:loadNo/mark-received
// Mark a POD as received — records in the database and advances
// the load status from WAIT_POD_SCAN -> WAIT_APPROVAL.
// No file is uploaded. The POD lives in SharePoint.
// ============================================================
router.post('/:loadNo/mark-received', requirePermission('PODS', 'edit'), async (req, res) => {
  const { loadNo } = req.params;

  try {
    const { data: load, error: loadErr } = await supabase
      .from('lp_movement')
      .select('m_status, m_load_no')
      .eq('m_load_no', loadNo)
      .single();

    if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

    const { error: updateErr } = await supabase
      .from('lp_movement')
      .update({
        m_pod_received:    true,
        m_pod_received_by: req.user.username,
        m_pod_received_at: new Date().toISOString(),
        updated_at:        new Date().toISOString(),
      })
      .eq('m_load_no', loadNo);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    await supabase.from('lp_comments').insert([{
      c_load:      loadNo,
      c_comment:   `POD marked as received in SharePoint by ${req.user.username}`,
      c_logged_by: req.user.username,
    }]);

    if (load.m_status === 'WAIT_POD_SCAN') {
      await supabase.from('lp_movement')
        .update({ m_status: 'WAIT_APPROVAL', updated_at: new Date().toISOString() })
        .eq('m_load_no', loadNo);

      await supabase.from('lp_comments').insert([{
        c_load:      loadNo,
        c_comment:   `Status advanced to WAIT_APPROVAL — Operator to review POD in SharePoint`,
        c_logged_by: 'SYSTEM',
      }]);
    }

    res.json({
      success: true,
      sharepoint_url: sharepointLink(loadNo),
      status_advanced: load.m_status === 'WAIT_POD_SCAN',
    });

  } catch (err) {
    console.error('[POD MARK-RECEIVED ERROR]', err);
    res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});


module.exports = router;
