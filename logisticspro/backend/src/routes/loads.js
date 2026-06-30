const express = require('express');
const supabase = require('../supabase');
const { fetchChunked } = require('../lib/supabasePaging');
const { listFolderFiles, SP_INVOICE_FOLDER } = require('../lib/msgraph');
const {
  authMiddleware, requireRole,
  ROLES,
  CAN_VIEW_LOADS,
  CAN_CREATE_LOAD,
  CAN_DELETE_LOAD,
  CAN_ADD_COSTS,
  loadUserPermissions,
  requirePermission,
} = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(loadUserPermissions);

// ── Helpers ───────────────────────────────────────────────────

// Queue an Ops Assistant action for Operator approval
async function queueOpsAction(loadNo, actionType, payload, requestedBy, approver) {
  const { data } = await supabase
    .from('lp_ops_assistant_actions')
    .insert([{
      oa_load_no:      loadNo,
      oa_action_type:  actionType,
      oa_payload:      payload,
      oa_requested_by: requestedBy,
      oa_approver:     approver,
      oa_status:       'PENDING',
    }])
    .select()
    .single();

  await supabase.from('lp_notifications').insert([{
    n_user:    approver,
    n_type:    'OPS_ACTION_PENDING',
    n_title:   'Action Approval Required',
    n_message: `${requestedBy} submitted a ${actionType} action on load ${loadNo} requiring your approval.`,
    n_load_no: loadNo,
    n_ref_id:  data?.id,
  }]);

  return data;
}

// Resolve the responsible Operator on a load (for Ops Assistant routing)
async function getLoadOperator(loadNo) {
  const { data } = await supabase
    .from('lp_movement')
    .select('m_responsible_operator, m_operator')
    .eq('m_load_no', loadNo)
    .single();
  return data?.m_responsible_operator || data?.m_operator;
}

// Statuses after which order number changes are locked
const ORDER_NO_LOCKED_STATUSES = [
  'WAIT_APPROVAL', 'WAIT_RATE_CHECK', 'WAIT_INVOICE_NO', 'LOAD_INVOICED', 'REJECTED', 'DELETED',
];

// Supabase/PostgREST projects enforce a project-level "max rows" cap on any
// single response (commonly 1000 by default in the Supabase dashboard under
// Settings → API). This is enforced server-side regardless of what `.range()`
// is requested, and the supabase-js client does NOT surface it as an error —
// it just silently returns fewer rows than asked for. That's why requesting
// limit=2000 (e.g. the Dashboard's monthly "Total Loads" tile) was capped at
// exactly 1000 rows. See lib/supabasePaging.js (fetchChunked) for the fix —
// it fetches in chunks no larger than that cap and concatenates them.

// ============================================================
// GET /api/loads — list with filters
// ============================================================
router.get('/', requirePermission('LOADS', 'view'), async (req, res) => {
  const {
    status, customer, truck,
    date_from, date_to, search,
    page = 1, limit = 100,
  } = req.query;

  const offset = (page - 1) * limit;

  // Rebuilt fresh for each chunk request — same filters every time, only
  // the .range() differs. A stable secondary sort key (m_load_no) is
  // required alongside m_date so that paginating across multiple chunk
  // requests can't skip or duplicate rows that share the same date.
  const buildQuery = () => {
    let q = supabase
      .from('lp_movement')
      .select(
        'm_load_no, m_date, m_customer, m_truck, m_driver_id, m_from, m_to, ' +
        'm_rate, m_status, m_invoice, m_opening_km, m_closing_km, ' +
        'm_trailer1, m_trailer2, m_responsible_operator, m_operator, ' +
        'm_order_no, m_order_no_pending, m_order_no_requested_by, ' +
        'm_loading_address, m_offloading_address, ' +
        'm_pod_received, m_pod_received_by, m_pod_received_at, m_pod_sharepoint_url',
        { count: 'exact' }
      )
      .neq('m_status', 'DELETED')
      .order('m_date', { ascending: false })
      .order('m_load_no', { ascending: false });

    if (status)    q = q.eq('m_status', status);
    if (customer)  q = q.eq('m_customer', customer);
    if (truck)     q = q.eq('m_truck', truck);
    if (date_from) q = q.gte('m_date', date_from);
    if (date_to)   q = q.lte('m_date', date_to);
    if (search) {
      q = q.or(
        `m_load_no.ilike.%${search}%,m_truck.ilike.%${search}%,` +
        `m_customer.ilike.%${search}%,m_from.ilike.%${search}%,` +
        `m_to.ilike.%${search}%,m_driver_id.ilike.%${search}%,` +
        `m_order_no.ilike.%${search}%`
      );
    }
    return q;
  };

  try {
    const { rows, count } = await fetchChunked(buildQuery, offset, Number(limit));
    res.json({ data: rows, total: count, page: Number(page), limit: Number(limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// GET /api/loads/stats/summary
// ============================================================
router.get('/stats/summary', requirePermission('LOADS', 'view'), async (req, res) => {
  // Same date_from/date_to the Loads page list already filters on (see
  // GET / below) — without this, the tiles silently computed an all-time
  // total across the ENTIRE table (years of Sage-imported history) while
  // the list directly below them showed only the selected date range.
  // That mismatch — not a calculation bug — was what produced numbers
  // like "4954 Active Loads" / "R512m Invoiced Value" sitting above a
  // list of 999 loads for the visible month. See
  // database/migration_load_stats_date_scope.sql.
  const { date_from, date_to } = req.query;

  // Prefers a single aggregate query computed in Postgres — see
  // database/migration_load_stats_perf.sql /
  // migration_load_stats_date_scope.sql. Falls back to the old
  // chunked-fetch-and-reduce-in-JS approach only if those migrations
  // haven't been run yet, so this degrades gracefully rather than
  // breaking during rollout (same fallback pattern as
  // getLatestLoadPerTruck in vehicles.js).
  try {
    const { data, error } = await supabase.rpc('get_load_stats', {
      date_from: date_from || null,
      date_to:   date_to   || null,
    });
    if (error) throw error;
    const row = data?.[0];
    if (row) {
      return res.json({
        total:          Number(row.total) || 0,
        active:         Number(row.active) || 0,
        en_route:       Number(row.en_route) || 0,
        wait_approval:  Number(row.wait_approval) || 0,
        invoiced:       Number(row.invoiced) || 0,
        invoiced_value: Number(row.invoiced_value) || 0,
      });
    }
  } catch (e) {
    console.error(
      '[loads/stats/summary] RPC unavailable, falling back to full table scan — ' +
      'run database/migration_load_stats_date_scope.sql to fix this:', e.message
    );
  }

  const buildQuery = () => {
    let q = supabase
      .from('lp_movement')
      .select('m_status, m_load_total, m_rate', { count: 'exact' })
      .neq('m_status', 'DELETED')
      .order('m_load_no', { ascending: false });
    if (date_from) q = q.gte('m_date', date_from);
    if (date_to)   q = q.lte('m_date', date_to);
    return q;
  };

  try {
    // No upper bound here (unlike GET /) — this needs every active load to
    // compute accurate totals, so keep chunking until exhausted. Uses the
    // same chunked-fetch workaround as GET / for Supabase's project-level
    // max-rows cap — see fetchChunked for why a plain unranged select
    // silently truncates once the table grows past that cap.
    //
    // NOTE: `total` here is every non-DELETED load matching the date range
    // (full historic retention means that range can still be large for an
    // established operation). It is NOT "active loads" — the frontend's
    // "Active Loads" tile previously displayed this raw count by mistake.
    // `active` below is the correct figure: anything still in the pipeline
    // (not yet LOAD_INVOICED or REJECTED).
    const { rows: data } = await fetchChunked(buildQuery, 0, Number.MAX_SAFE_INTEGER);

    const invoicedRows = data.filter(r => r.m_status === 'LOAD_INVOICED');

    res.json({
      total:          data.length,
      active:         data.filter(r => !['LOAD_INVOICED', 'REJECTED'].includes(r.m_status)).length,
      en_route:       data.filter(r => r.m_status === 'EN_ROUTE').length,
      wait_approval:  data.filter(r => r.m_status === 'WAIT_APPROVAL').length,
      invoiced:       invoicedRows.length,
      // NOTE: this used to sum m_rate across ALL non-deleted loads (every
      // historic load ever recorded, ~31k rows) and the frontend displayed
      // it as "Invoiced Value" — wildly overstated. Now correctly sums only
      // LOAD_INVOICED rows within the selected date range, using
      // m_load_total (the actual amount an invoice is generated from —
      // see POST /api/invoices) falling back to m_rate for older rows
      // that predate m_load_total being populated.
      invoiced_value: invoicedRows.reduce((s, r) => s + Number(r.m_load_total || r.m_rate || 0), 0),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// GET /api/loads/pending-order-nos
// ============================================================
router.get('/pending-order-nos', requirePermission('LOADS', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_movement')
    .select(
      'm_load_no, m_date, m_customer, m_truck, m_order_no, ' +
      'm_order_no_pending, m_order_no_requested_by, m_order_no_request_time'
    )
    .not('m_order_no_pending', 'is', null)
    .order('m_order_no_request_time', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// GET /api/loads/:loadNo/invoice-link
// Resolves the REAL SharePoint file link for a load's invoice, the same
// way pods.js does for PODs.
//
// Why this exists: the invoice number is NOT necessarily the exact
// filename on SharePoint (extension, casing, and naming are whatever the
// person who saved/uploaded the invoice used — the app itself only
// generates the PDF in-memory to email it, it doesn't upload a copy to
// SharePoint). The frontend used to build the link by guessing
// `${m_invoice}` as the literal filename, which produced a dead link
// whenever that guess didn't match. This instead lists the real INVOICES
// folder via Graph and finds whichever file actually contains the invoice
// number, returning its real webUrl — same verified-link approach as POD.
//
// NOTE: registered before /:id below per the project's route-ordering
// rule, though it wouldn't collide anyway (different segment count).
// ============================================================
router.get('/:loadNo/invoice-link', requirePermission('LOADS', 'view'), async (req, res) => {
  const { loadNo } = req.params;
  try {
    const { data: load, error } = await supabase
      .from('lp_movement')
      .select('m_invoice')
      .eq('m_load_no', loadNo)
      .single();

    if (error || !load || !load.m_invoice) return res.json({ found: false });

    const files = await listFolderFiles(SP_INVOICE_FOLDER);
    const needle = String(load.m_invoice).toLowerCase();
    const match = files.find(f => f.name?.toLowerCase().includes(needle));

    if (!match) return res.json({ found: false, invoice_no: load.m_invoice });

    res.json({ found: true, invoice_no: load.m_invoice, sharepoint_url: match.webUrl });
  } catch (err) {
    console.error('[INVOICE LINK ERROR]', err);
    // Non-fatal — frontend falls back to opening the INVOICES folder listing
    res.json({ found: false });
  }
});


// ============================================================
// GET /api/loads/pending-ops-actions — Ops Asst actions awaiting approval
// ============================================================
router.get('/pending-ops-actions', requirePermission('LOADS', 'approve'), async (req, res) => {
  let query = supabase
    .from('lp_ops_assistant_actions')
    .select('*')
    .eq('oa_status', 'PENDING')
    .order('created_at', { ascending: false });

  // Operators only see actions where they are the named approver
  if (req.user.role === ROLES.OPERATOR) {
    query = query.eq('oa_approver', req.user.username);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// PATCH /api/loads/ops-actions/:id — approve or reject
// ============================================================
router.patch('/ops-actions/:id', requirePermission('LOADS', 'approve'), async (req, res) => {
  const { action, rejection_reason } = req.body;

  const { data: opsAction } = await supabase
    .from('lp_ops_assistant_actions')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!opsAction) return res.status(404).json({ error: 'Action not found' });

  if (req.user.role === ROLES.OPERATOR && opsAction.oa_approver !== req.user.username)
    return res.status(403).json({ error: 'This action is not assigned to you' });

  if (opsAction.oa_status !== 'PENDING')
    return res.status(400).json({ error: 'This action has already been actioned' });

  if (action === 'approve') {
    const payload = opsAction.oa_payload;

    if (opsAction.oa_action_type === 'STATUS_CHANGE') {
      await supabase.from('lp_movement')
        .update({ m_status: payload.new_status, updated_at: new Date().toISOString() })
        .eq('m_load_no', opsAction.oa_load_no);
    } else if (opsAction.oa_action_type === 'ADD_COST') {
      await supabase.from('lp_costs').insert([{
        c_load:        opsAction.oa_load_no,
        c_description: payload.description,
        c_amount:      payload.amount,
        c_code:        payload.code,
        c_operator:    opsAction.oa_requested_by,
      }]);
    } else if (opsAction.oa_action_type === 'DELETE_COST') {
      await supabase.from('lp_costs').delete().eq('c_cost_no', payload.cost_id);
    } else if (opsAction.oa_action_type === 'SET_ORDER_NO') {
      await supabase.from('lp_movement')
        .update({ m_order_no: payload.order_no, updated_at: new Date().toISOString() })
        .eq('m_load_no', opsAction.oa_load_no);
    }

    await supabase.from('lp_comments').insert([{
      c_load:      opsAction.oa_load_no,
      c_comment:   `Ops Assistant action approved by ${req.user.username}: ${opsAction.oa_action_type} — ${JSON.stringify(payload)}`,
      c_logged_by: req.user.username,
    }]);

    await supabase.from('lp_notifications').insert([{
      n_user:    opsAction.oa_requested_by,
      n_type:    'OPS_ACTION_APPROVED',
      n_title:   'Action Approved',
      n_message: `Your ${opsAction.oa_action_type} action on load ${opsAction.oa_load_no} has been approved.`,
      n_load_no: opsAction.oa_load_no,
    }]);
  } else {
    if (!rejection_reason?.trim())
      return res.status(400).json({ error: 'A rejection reason is required' });

    await supabase.from('lp_notifications').insert([{
      n_user:    opsAction.oa_requested_by,
      n_type:    'OPS_ACTION_REJECTED',
      n_title:   'Action Rejected',
      n_message: `Your ${opsAction.oa_action_type} action on load ${opsAction.oa_load_no} was rejected. Reason: ${rejection_reason}`,
      n_load_no: opsAction.oa_load_no,
    }]);
  }

  await supabase.from('lp_ops_assistant_actions').update({
    oa_status:           action === 'approve' ? 'APPROVED' : 'REJECTED',
    oa_rejection_reason: rejection_reason || null,
    oa_actioned_by:      req.user.username,
    oa_actioned_at:      new Date().toISOString(),
  }).eq('id', req.params.id);

  res.json({ success: true, action });
});


// ============================================================
// GET /api/loads/:id
// ============================================================
router.get('/:id', requirePermission('LOADS', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_movement')
    .select('*, lp_customers(c_name), lp_vehicles(vh_type)')
    .eq('m_load_no', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Load not found' });
  res.json(data);
});


// ============================================================
// GET /api/loads/:id/comments
// ============================================================
router.get('/:id/comments', requirePermission('LOADS', 'view'), async (req, res) => {
  const { data, error } = await supabase
    .from('lp_comments')
    .select('*')
    .eq('c_load', req.params.id)
    .order('c_time', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


// ============================================================
// POST /api/loads/:id/comments
// ============================================================
router.post('/:id/comments', requirePermission('LOADS', 'view'), async (req, res) => {
  const { comment } = req.body;
  const { data, error } = await supabase
    .from('lp_comments')
    .insert([{ c_load: req.params.id, c_comment: comment, c_logged_by: req.user.username }])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});


// ============================================================
// POST /api/loads — create new load
// ============================================================
router.post('/', requirePermission('LOADS', 'edit'), async (req, res) => {
  try {
    const { data: allLast } = await supabase
      .from('lp_movement')
      .select('m_load_no')
      .order('created_at', { ascending: false })
      .limit(200);

    let nextNum = 100001;
    if (allLast?.length > 0) {
      let maxSeen = 0;
      for (const row of allLast) {
        const raw = (row.m_load_no || '').replace(/^A/i, '');
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n > maxSeen) maxSeen = n;
      }
      if (maxSeen >= nextNum) nextNum = maxSeen + 1;
    }
    const m_load_no = 'A' + String(nextNum).padStart(6, '0');

    const load = {
      ...req.body,
      m_load_no,
      m_operator:              req.user.username,
      m_responsible_operator:  req.body.m_responsible_operator || req.user.username,
      m_status:                'PRELOAD',
      m_app_time:              new Date().toISOString(),
      m_date:                  new Date().toISOString().split('T')[0],
    };

    const { data, error } = await supabase
      .from('lp_movement')
      .insert([load])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('lp_comments').insert([{
      c_load:      data.m_load_no,
      c_comment:   `Load created by ${req.user.username}. Truck: ${load.m_truck}, Customer: ${load.m_customer}, Route: ${load.m_from} → ${load.m_to}, Rate: R ${Number(load.m_rate || 0).toLocaleString('en-ZA')}`,
      c_logged_by: req.user.username,
    }]);

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// PATCH /api/loads/:id — update status or fields
// ============================================================
router.patch('/:id', requirePermission('LOADS', 'view'), async (req, res) => {
  const role = req.user.role;
  const newStatus = req.body.m_status;

  // ── Status transition enforcement ──────────────────────────
  if (newStatus) {
    const { data: load } = await supabase
      .from('lp_movement')
      .select('m_status, m_responsible_operator, m_operator')
      .eq('m_load_no', req.params.id)
      .single();

    if (!load) return res.status(404).json({ error: 'Load not found' });

    const currentStatus = load.m_status;

    // Workshop role — read only, no status changes ever
    if ([
      ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
      ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP,
      ROLES.READONLY,
    ].includes(role))
      return res.status(403).json({ error: 'You do not have permission to change load status' });

    // Manager: can approve WAIT_RATE_CHECK or reject
    if (role === ROLES.MANAGER) {
      if (currentStatus === 'WAIT_RATE_CHECK' && newStatus === 'WAIT_INVOICE_NO') {
        // allowed — manager confirms rate is correct
      } else if (newStatus === 'REJECTED') {
        // allowed — manager can reject
      } else {
        return res.status(403).json({ error: 'Managers can only confirm the rate check or reject a load' });
      }
    }

    // Control Room: max status is OFFLOADED, cannot reject
    if (role === ROLES.CONTROL_ROOM) {
      const allowedForCR = ['EN_ROUTE', 'OFFLOADED'];
      if (!allowedForCR.includes(newStatus))
        return res.status(403).json({ error: 'Control Room can only advance to EN_ROUTE or OFFLOADED' });
      if (newStatus === 'REJECTED')
        return res.status(403).json({ error: 'Control Room cannot reject loads' });
    }

    // Accounting: cannot change status manually — invoice flow only
    if (role === ROLES.FINANCE) {
      return res.status(403).json({ error: 'Finance cannot change load status manually. Use the Invoices page.' });
    }

    // Block manual set to LOAD_INVOICED for everyone — invoice flow only
    if (newStatus === 'LOAD_INVOICED') {
      return res.status(403).json({ error: 'LOAD_INVOICED is set by the invoice approval flow. Use the Invoices page.' });
    }

    // Ops Assistant — queue the status change for Operator approval
    if (role === ROLES.OPS_ASSISTANT) {
      const operator = load.m_responsible_operator || load.m_operator;
      if (!operator)
        return res.status(400).json({ error: 'No responsible operator found on this load' });

      await queueOpsAction(
        req.params.id,
        'STATUS_CHANGE',
        { current_status: currentStatus, new_status: newStatus },
        req.user.username,
        operator
      );

      await supabase.from('lp_comments').insert([{
        c_load:      req.params.id,
        c_comment:   `Status change to ${newStatus} requested by ${req.user.username} (Ops Assistant) — awaiting Operator approval`,
        c_logged_by: req.user.username,
      }]);

      return res.json({ pending: true, message: 'Status change submitted for Operator approval' });
    }
  }

  // ── Apply the update directly ───────────────────────────────
  const updates = { ...req.body, updated_at: new Date().toISOString() };

  // Fields read-only for all but Admin/Operator/OpsAsst
  if ([ROLES.CONTROL_ROOM, ROLES.FINANCE, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP, ROLES.READONLY, ROLES.MANAGER].includes(role)) {
    delete updates.m_rate;
    delete updates.m_customer;
    delete updates.m_from;
    delete updates.m_to;
    delete updates.m_truck;
    delete updates.m_driver_id;
  }

  const { data, error } = await supabase
    .from('lp_movement')
    .update(updates)
    .eq('m_load_no', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (req.body.m_status) {
    await supabase.from('lp_comments').insert([{
      c_load:      req.params.id,
      c_comment:   `Status changed to ${req.body.m_status} by ${req.user.username}`,
      c_logged_by: req.user.username,
    }]);
  }

  res.json(data);
});


// ============================================================
// DELETE /api/loads/:id — soft delete (Operator + Admin only)
// ============================================================
router.delete('/:id', requirePermission('LOADS', 'delete'), async (req, res) => {
  const { reason } = req.body || {};

  const { error } = await supabase
    .from('lp_movement')
    .update({
      m_status:         'DELETED',
      m_rate:           0,
      m_extras:         0,
      m_load_total:     0,
      m_deleted_by:     req.user.username,
      m_deleted_at:     new Date().toISOString(),
      m_deleted_reason: reason || null,
      updated_at:       new Date().toISOString(),
    })
    .eq('m_load_no', req.params.id);

  if (error) return res.status(400).json({ error: error.message });

  await supabase.from('lp_comments').insert([{
    c_load:      req.params.id,
    c_comment:   `Load deleted by ${req.user.username}. Values zeroed.${reason ? ' Reason: ' + reason : ''}`,
    c_logged_by: req.user.username,
  }]);

  // Also zero out costs linked to this load
  await supabase.from('lp_costs')
    .update({ c_amount: 0 })
    .eq('c_load', req.params.id);

  res.json({ message: 'Load deleted and values zeroed' });
});


// ============================================================
// POST /api/loads/:id/request-order-no
// ── FIX: blocked after WAIT_APPROVAL status ──
// ============================================================
router.post('/:id/request-order-no', requirePermission('LOADS', 'edit'), async (req, res) => {
  const { order_no } = req.body;
  if (!order_no?.trim())
    return res.status(400).json({ error: 'Please provide an order number' });

  const { data: load } = await supabase
    .from('lp_movement')
    .select('m_status, m_order_no, m_order_no_pending, m_responsible_operator, m_operator')
    .eq('m_load_no', req.params.id)
    .single();

  if (!load) return res.status(404).json({ error: 'Load not found' });

  // ── Status guard: order number locked after WAIT_APPROVAL ──
  if (ORDER_NO_LOCKED_STATUSES.includes(load.m_status)) {
    return res.status(403).json({
      error: `Order number cannot be changed once a load has reached ${load.m_status} status.`,
    });
  }

  // Control Room — always goes to approval even if no existing order no
  if (req.user.role === ROLES.CONTROL_ROOM) {
    const operator = load.m_responsible_operator || load.m_operator;
    await queueOpsAction(
      req.params.id,
      'SET_ORDER_NO',
      { order_no },
      req.user.username,
      operator
    );
    await supabase.from('lp_comments').insert([{
      c_load:      req.params.id,
      c_comment:   `Order number "${order_no}" submitted by Control Room — awaiting Operator approval`,
      c_logged_by: req.user.username,
    }]);
    return res.json({ pending: true, message: 'Order number submitted for Operator approval' });
  }

  // Ops Assistant — queue via ops action
  if (req.user.role === ROLES.OPS_ASSISTANT) {
    const operator = load.m_responsible_operator || load.m_operator;
    const actionType = (load.m_order_no && load.m_order_no.trim() && load.m_order_no !== '0')
      ? 'CHANGE_ORDER_NO' : 'SET_ORDER_NO';
    await queueOpsAction(req.params.id, actionType, { order_no }, req.user.username, operator);
    await supabase.from('lp_comments').insert([{
      c_load:      req.params.id,
      c_comment:   `Order number "${order_no}" submitted by Ops Assistant — awaiting Operator approval`,
      c_logged_by: req.user.username,
    }]);
    return res.json({ pending: true, message: 'Order number submitted for Operator approval' });
  }

  // Operator / Admin — direct save (or approval flow for changes)
  if (!load.m_order_no || load.m_order_no.trim() === '' || load.m_order_no === '0') {
    await supabase.from('lp_movement')
      .update({ m_order_no: order_no, updated_at: new Date().toISOString() })
      .eq('m_load_no', req.params.id);
    await supabase.from('lp_comments').insert([{
      c_load:      req.params.id,
      c_comment:   `Order number set to: ${order_no}`,
      c_logged_by: req.user.username,
    }]);
    return res.json({ saved: true, message: 'Order number saved' });
  }

  // Changing an existing order number — pending approval
  await supabase.from('lp_movement').update({
    m_order_no_pending:      order_no,
    m_order_no_requested_by: req.user.username,
    m_order_no_request_time: new Date().toISOString(),
    updated_at:              new Date().toISOString(),
  }).eq('m_load_no', req.params.id);

  await supabase.from('lp_comments').insert([{
    c_load:      req.params.id,
    c_comment:   `Order number change requested: "${load.m_order_no}" → "${order_no}" — awaiting approval`,
    c_logged_by: req.user.username,
  }]);

  await supabase.from('lp_notifications').insert([{
    n_role:    ROLES.OPERATOR,
    n_type:    'ORDER_NO_CHANGE',
    n_title:   'Order Number Change Approval Required',
    n_message: `${req.user.username} requested order number change on load ${req.params.id}: "${load.m_order_no}" → "${order_no}"`,
    n_load_no: req.params.id,
  }]);

  res.json({ saved: false, pending: true, message: 'Change submitted for approval' });
});


// ============================================================
// PATCH /api/loads/:id/approve-order-no
// ============================================================
router.patch('/:id/approve-order-no', requirePermission('LOADS', 'approve'), async (req, res) => {
  const { action, rejection_reason } = req.body;

  const { data: load } = await supabase
    .from('lp_movement')
    .select('m_order_no, m_order_no_pending, m_order_no_requested_by')
    .eq('m_load_no', req.params.id)
    .single();

  if (!load) return res.status(404).json({ error: 'Load not found' });

  if (action === 'approve') {
    await supabase.from('lp_movement').update({
      m_order_no:              load.m_order_no_pending,
      m_order_no_pending:      null,
      m_order_no_requested_by: null,
      m_order_no_request_time: null,
      updated_at:              new Date().toISOString(),
    }).eq('m_load_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load:      req.params.id,
      c_comment:   `Order number change approved by ${req.user.username}: "${load.m_order_no}" → "${load.m_order_no_pending}"`,
      c_logged_by: req.user.username,
    }]);

    await supabase.from('lp_notifications').insert([{
      n_user:    load.m_order_no_requested_by,
      n_type:    'ORDER_NO_APPROVED',
      n_title:   'Order Number Change Approved',
      n_message: `Your order number change on load ${req.params.id} was approved.`,
      n_load_no: req.params.id,
    }]);
  } else {
    await supabase.from('lp_movement').update({
      m_order_no_pending:      null,
      m_order_no_requested_by: null,
      m_order_no_request_time: null,
      updated_at:              new Date().toISOString(),
    }).eq('m_load_no', req.params.id);

    await supabase.from('lp_comments').insert([{
      c_load:      req.params.id,
      c_comment:   `Order number change rejected by ${req.user.username}. Reason: ${rejection_reason || 'No reason given'}`,
      c_logged_by: req.user.username,
    }]);

    await supabase.from('lp_notifications').insert([{
      n_user:    load.m_order_no_requested_by,
      n_type:    'ORDER_NO_REJECTED',
      n_title:   'Order Number Change Rejected',
      n_message: `Your order number change on load ${req.params.id} was rejected. Reason: ${rejection_reason || 'No reason given'}`,
      n_load_no: req.params.id,
    }]);
  }

  res.json({ success: true, action });
});


module.exports = router;

