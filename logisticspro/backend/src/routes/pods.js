const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES, CAN_VIEW_LOADS, CAN_ADD_COSTS } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// Base SharePoint PODs folder URL — set in Render environment variables
const SHAREPOINT_BASE = process.env.SHAREPOINT_PODS_URL || '';

// Roles that can mark a POD as received
const CAN_MARK_POD = CAN_ADD_COSTS; // ADMIN, OPERATOR, OPS_ASSISTANT, CONTROL_ROOM

// ── Helper: build SharePoint folder link for a load ──────────
function sharepointLink(loadNo) {
  if (!SHAREPOINT_BASE) return null;
  // Appends the load number as a subfolder path parameter
  return `${SHAREPOINT_BASE}&id=${encodeURIComponent(loadNo)}`;
}


// ============================================================
// GET /api/pods/pending
// Loads currently sitting in WAIT_POD_SCAN — need a POD.
// ============================================================
router.get('/pending', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
  const { bus_unit } = req.query;

  let q = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_order_no, m_bus_unit')
    .eq('m_status', 'WAIT_POD_SCAN')
    .order('m_date', { ascending: false });

  if (bus_unit) q = q.eq('m_bus_unit', bus_unit);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Attach SharePoint link to each load
  const result = (data || []).map(load => ({
    ...load,
    sharepoint_url: sharepointLink(load.m_load_no),
  }));

  res.json(result);
});


// ============================================================
// GET /api/pods/received
// Loads that have been marked as POD received (m_pod_received = true).
// ============================================================
router.get('/received', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
  const { bus_unit, search } = req.query;

  let q = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_status, m_order_no, m_bus_unit')
    .eq('m_pod_received', true)
    .neq('m_status', 'DELETED')
    .order('m_date', { ascending: false });

  if (bus_unit) q = q.eq('m_bus_unit', bus_unit);
  if (search)   q = q.or(`m_load_no.ilike.%${search}%,m_customer.ilike.%${search}%,m_truck.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Attach SharePoint link to each load
  const result = (data || []).map(load => ({
    ...load,
    sharepoint_url: sharepointLink(load.m_load_no),
  }));

  res.json(result);
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
    // Verify load exists
    const { data: load, error: loadErr } = await supabase
      .from('lp_movement')
      .select('m_status, m_load_no')
      .eq('m_load_no', loadNo)
      .single();

    if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

    // Mark POD received
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

    // Audit comment
    await supabase.from('lp_comments').insert([{
      c_load:      loadNo,
      c_comment:   `POD marked as received in SharePoint by ${req.user.username}`,
      c_logged_by: req.user.username,
    }]);

    // Auto-advance: WAIT_POD_SCAN -> WAIT_APPROVAL
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
