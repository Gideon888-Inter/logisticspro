const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole, CAN_VIEW_LOADS, CAN_MARK_POD } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

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
router.get('/pending', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
  const { bus_unit } = req.query;

  let q = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_order_no')
    .eq('m_status', 'WAIT_POD_SCAN')
    .order('m_date', { ascending: false });

  // bus_unit filter removed — column dropped

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
router.get('/received', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
  const { bus_unit, search } = req.query;

  let q = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_status, m_order_no')
    .eq('m_pod_received', true)
    .neq('m_status', 'DELETED')
    .order('m_date', { ascending: false });

  // bus_unit filter removed — column dropped
  if (search)   q = q.or(`m_load_no.ilike.%${search}%,m_customer.ilike.%${search}%,m_truck.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const result = (data || []).map(load => ({
    ...load,
    sharepoint_url: sharepointLink(load.m_load_no),
  }));

  res.json(result);
});


// ============================================================
// GET /api/pods/:loadNo/check
// Called by the Loads page when a load is in WAIT_POD_SCAN.
// Checks if a POD folder exists in SharePoint (via the m_pod_received flag
// or a future direct SharePoint API call). If found, advances the status
// automatically to WAIT_APPROVAL and returns the SharePoint link.
// ============================================================
router.get('/:loadNo/check', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
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
router.post('/:loadNo/mark-received', requireRole(...CAN_MARK_POD), async (req, res) => {
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
