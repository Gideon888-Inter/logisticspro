/**
 * LP2.0 — Inventory & Purchase Orders Route
 * ==========================================
 * Handles:
 *   - Inventory item CRUD + approval workflow
 *   - Purchase Order CRUD + 4-level approval hierarchy
 *   - Attachment upload → OneDrive offload (link-based, like PODs)
 *   - GL allocation logic (vehicle expense vs inventory)
 *   - Notification triggers at each approval stage
 *
 * Role mapping:
 *   CONTROL_ROOM  → can create POs (VEHICLE only), no inventory access
 *   ACCOUNTING    → Stock Controller: L1 approver, can create POs
 *   OPS_ASSISTANT → Workshop Assistant: L2 approver, can create POs, can approve inventory
 *   WORKSHOP      → Workshop Manager: L3 approver, can create inventory items, full PO access
 *   ADMIN         → Financial user: financial approver, GL journal access, all access
 *   MANAGER       → View only for POs/inventory
 *
 * PO status flow:
 *   PARKED → PENDING_L1 → PENDING_L2 → PENDING_L3 → PENDING_FINANCIAL → APPROVED → ...
 *   Workshop Manager's own POs skip L1/L2/L3 → go straight to PENDING_FINANCIAL.
 *
 * OneDrive folder structure:
 *   {base}/Supplier Invoices/{FY e.g. FY2026}/{Month e.g. 2026-02}/{SupplierCode_SupplierName}/
 */

const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { authMiddleware, requireRole, ROLES } = require('../middleware/auth');

// Lazy supabase client — avoids crash if env vars not loaded at require() time
let _supabase = null;
function supabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
}

// ── Multer: temp disk storage for attachments ──────────────────────────────
const TEMP_UPLOAD_DIR = path.join(__dirname, '../../temp_attachments');
if (!fs.existsSync(TEMP_UPLOAD_DIR)) fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ts = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${ts}_${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Apply auth to all routes
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Return config values from lp_config */
async function getConfig(...keys) {
  const { data } = await supabase
    .from('lp_config')
    .select('cfg_key, cfg_value')
    .in('cfg_key', keys);
  return Object.fromEntries((data || []).map(r => [r.cfg_key, r.cfg_value]));
}

/** Send notification to a role or user */
async function notify({ user, role, type, title, message, po_id }) {
  await supabase().from('lp_notifications').insert({
    n_user:    user  || null,
    n_role:    role  || null,
    n_type:    type,
    n_title:   title,
    n_message: message,
    n_ref_id:  po_id || null,
  });
}

/** Log PO approval action */
async function logPOAction({ po_id, po_number, action, by, from_status, to_status, notes, attachment_url }) {
  await supabase().from('lp_po_approval_log').insert({
    po_id, po_number, action,
    actioned_by: by,
    from_status: from_status || null,
    to_status:   to_status   || null,
    notes:       notes       || null,
    attachment_url: attachment_url || null,
  });
}

/**
 * Determine approval level required based on creator role.
 * Returns the first status the PO should enter after submission.
 */
function firstApprovalStatus(creatorRole) {
  // Workshop Manager's own POs skip L1/L2/L3 — straight to Finance
  if (creatorRole === ROLES.WORKSHOP_MANAGER) return 'PENDING_FINANCIAL';
  // Workshop Assistant's own POs skip L1/L2 — start at L3
  if (creatorRole === ROLES.WORKSHOP_ASSISTANT) return 'PENDING_L3';
  // Stock Controller's own POs skip L1 — start at L2
  if (creatorRole === ROLES.STOCK_CONTROLLER) return 'PENDING_L2';
  // Control Room, Finance start at L1
  return 'PENDING_L1';
}

/**
 * Build OneDrive folder path using configured rule.
 * Pattern: {base_path}/{FY}/{YYYY-MM}/{supplier_code}_{supplier_name}
 */
function buildOneDrivePath(config, supplier_code, supplier_name, po_date) {
  const d = new Date(po_date || Date.now());
  const month = d.toISOString().slice(0, 7); // YYYY-MM
  // Financial year: Mar-Feb cycle
  const fyYear = d.getMonth() >= 2  // March = month index 2
    ? d.getFullYear() + 1
    : d.getFullYear();
  const fy = `FY${fyYear}`;
  const safeName = `${supplier_code}_${supplier_name}`.replace(/[^a-zA-Z0-9_\- ]/g, '');
  const base = config['onedrive_po_base_path'] || 'https://llamahosted.sharepoint.com/sites/Interland/Shared%20Documents/Supplier%20Invoices';
  return `${base}/${fy}/${month}/${encodeURIComponent(safeName)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIERS (workshop-allowed — proxies fin_suppliers for PO module)
// ─────────────────────────────────────────────────────────────────────────────

// GET /stock/suppliers — returns suppliers allowed for Workshop, used by PO creation form
router.get('/suppliers',
  requireRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER),
  async (req, res) => {
    const { data, error } = await supabase
      .from('fin_suppliers')
      .select('supplier_id,supplier_code,supplier_name,payment_terms_days,telephone,email')
      .eq('workshop_allowed', true)
      .eq('active', true)
      .order('supplier_name');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY ITEMS
// ─────────────────────────────────────────────────────────────────────────────

// GET /inventory/items — list inventory items
// CONTROL_ROOM: not accessible (403)
// All other roles: can view ACTIVE items; WORKSHOP/ADMIN see pending too
router.get('/items',
  requireRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
             ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP),
  async (req, res) => {
    const { role } = req.user;
    let query = supabase().from('lp_inventory_items').select('*').order('item_code');
    // Non-workshop users only see ACTIVE items
    if (![ROLES.ADMIN, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER].includes(role)) {
      query = query.eq('status', 'ACTIVE');
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }
);

// POST /inventory/items — create new inventory item (WORKSHOP only)
router.post('/items',
  requireRole(ROLES.ADMIN, ROLES.WORKSHOP_MANAGER),
  async (req, res) => {
    const { item_name, item_description, item_category, unit_of_measure,
            gl_account_code, reorder_level, reorder_qty, supplier_code, notes } = req.body;

    if (!item_name) return res.status(400).json({ error: 'item_name is required' });

    // Generate item code
    const { data: codeData, error: codeErr } = await supabase
      .rpc('next_inventory_item_code');
    if (codeErr) return res.status(500).json({ error: codeErr.message });

    const config = await getConfig('workshop_assistant_username');

    const { data, error } = await supabase().from('lp_inventory_items').insert({
      item_code:        codeData,
      item_name,
      item_description: item_description || null,
      item_category:    item_category || 'Other',
      unit_of_measure:  unit_of_measure || 'Each',
      gl_account_code:  gl_account_code || '7700',
      reorder_level:    reorder_level || 0,
      reorder_qty:      reorder_qty || 0,
      supplier_code:    supplier_code || null,
      notes:            notes || null,
      status:           ROLES.ADMIN === req.user.role ? 'ACTIVE' : 'PENDING_APPROVAL',
      created_by:       req.user.username,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Notify Workshop Assistant for approval (unless Admin created it — auto-approved)
    if (![ROLES.ADMIN, ROLES.WORKSHOP_MANAGER].includes(req.user.role)) {
      await notify({
        user:    config['workshop_assistant_username'],
        type:    'INVENTORY_APPROVAL_REQUIRED',
        title:   'New Inventory Item Requires Approval',
        message: `New item "${item_name}" (${codeData}) created by ${req.user.username} — awaiting your approval.`,
      });
    }

    res.status(201).json(data);
  }
);

// PATCH /inventory/items/:id/approve — Workshop Assistant or Admin approves a pending item
router.patch('/items/:id/approve',
  requireRole(ROLES.ADMIN, ROLES.WORKSHOP_ASSISTANT),
  async (req, res) => {
    const { id } = req.params;
    const { action, rejection_reason } = req.body; // action: 'APPROVE' | 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ error: "action must be 'APPROVE' or 'REJECT'" });
    }
    if (action === 'REJECT' && !rejection_reason) {
      return res.status(400).json({ error: 'rejection_reason required when rejecting' });
    }

    const newStatus = action === 'APPROVE' ? 'ACTIVE' : 'SUSPENDED';
    const { data: item, error } = await supabase
      .from('lp_inventory_items')
      .update({
        status:           newStatus,
        approved_by:      action === 'APPROVE' ? req.user.username : null,
        approved_at:      action === 'APPROVE' ? new Date().toISOString() : null,
        rejection_reason: action === 'REJECT' ? rejection_reason : null,
        updated_at:       new Date().toISOString(),
      })
      .eq('item_id', id)
      .eq('status', 'PENDING_APPROVAL')
      .select().single();

    if (error || !item) return res.status(404).json({ error: 'Item not found or not pending' });

    await notify({
      role:    ROLES.WORKSHOP_MANAGER,
      type:    action === 'APPROVE' ? 'INVENTORY_APPROVED' : 'INVENTORY_REJECTED',
      title:   action === 'APPROVE' ? `Inventory item approved: ${item.item_code}` : `Inventory item rejected: ${item.item_code}`,
      message: action === 'APPROVE'
        ? `${item.item_name} is now active and available for purchase orders.`
        : `${item.item_name} was rejected: ${rejection_reason}`,
    });

    res.json({ success: true, item });
  }
);

// GET /inventory/items/:id — detail with transactions
router.get('/items/:id',
  requireRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
             ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP),
  async (req, res) => {
    const { data: item, error } = await supabase
      .from('lp_inventory_items')
      .select('*')
      .eq('item_id', req.params.id)
      .single();
    if (error || !item) return res.status(404).json({ error: 'Item not found' });

    const { data: txns } = await supabase
      .from('lp_inventory_transactions')
      .select('*')
      .eq('item_id', req.params.id)
      .eq('reversed', 'N')
      .order('txn_date', { ascending: false })
      .limit(50);

    res.json({ item, transactions: txns || [] });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────────────────────────────────────

// GET /inventory/po — list POs visible to user's role
router.get('/po',
  requireRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
              ROLES.CONTROL_ROOM, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
              ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP),
  async (req, res) => {
    const { status, vehicle_code, supplier_code } = req.query;
    let query = supabase
      .from('lp_purchase_orders')
      .select(`
        po_id, po_number, supplier_code, supplier_name,
        allocation_type, vehicle_code, vehicle_name,
        po_description, subtotal_excl_vat, vat_amount, total_incl_vat,
        status, is_capital, attachment_filename, onedrive_url, onedrive_offloaded,
        created_by, created_at, submitted_at,
        l1_approver, l1_approved_at, l2_approver, l2_approved_at,
        l3_approver, l3_approved_at, financial_approver, financial_approved_at,
        rejected_by, rejection_reason, rejection_stage
      `)
      .order('created_at', { ascending: false });

    if (status)       query = query.eq('status', status);
    if (vehicle_code) query = query.eq('vehicle_code', vehicle_code);
    if (supplier_code) query = query.eq('supplier_code', supplier_code);

    // Control Room only sees their own POs
    if (req.user.role === ROLES.CONTROL_ROOM) {
      query = query.eq('created_by', req.user.username);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }
);

// POST /inventory/po — create new PO
// Roles: CONTROL_ROOM, ACCOUNTING, OPS_ASSISTANT, WORKSHOP, ADMIN
router.post('/po',
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER,
             ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER),
  async (req, res) => {
    const {
      supplier_code, supplier_name,
      allocation_type, vehicle_code, vehicle_name,
      po_description, lines, notes,
    } = req.body;

    // Validate required fields
    if (!supplier_code) return res.status(400).json({ error: 'supplier_code is required' });
    if (!allocation_type || !['VEHICLE','INVENTORY'].includes(allocation_type)) {
      return res.status(400).json({ error: "allocation_type must be 'VEHICLE' or 'INVENTORY'" });
    }
    if (allocation_type === 'VEHICLE' && !vehicle_code) {
      return res.status(400).json({ error: 'vehicle_code is required for VEHICLE POs' });
    }
    if (allocation_type === 'INVENTORY' && !lines?.length) {
      return res.status(400).json({ error: 'At least one inventory line item is required' });
    }

    // Control Room cannot create INVENTORY type POs
    const config = await getConfig('po_control_room_can_inventory');
    if ([ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER].includes(req.user.role) && allocation_type === 'INVENTORY') {
      return res.status(403).json({ error: 'Control Room and Stock Controller users cannot create inventory POs' });
    }

    // Capital purchases — check if enabled
    if (req.body.is_capital === 'Y') {
      const capConf = await getConfig('po_capital_enabled');
      if (capConf['po_capital_enabled'] !== 'Y' && req.user.role !== ROLES.ADMIN) {
        return res.status(403).json({ error: 'Capital purchase option is not enabled. Contact Admin.' });
      }
      if (![ROLES.WORKSHOP_MANAGER, ROLES.ADMIN].includes(req.user.role)) {
        return res.status(403).json({ error: 'Only Workshop Manager or Admin can create capital POs' });
      }
    }

    // Generate PO number
    const { data: poNum } = await supabase().rpc('next_po_number');

    const { data: po, error: poErr } = await supabase
      .from('lp_purchase_orders')
      .insert({
        po_number:       poNum,
        supplier_code,
        supplier_name:   supplier_name || supplier_code,
        allocation_type,
        vehicle_code:    vehicle_code || null,
        vehicle_name:    vehicle_name || null,
        po_description:  po_description || '',
        status:          'PARKED',
        is_capital:      req.body.is_capital === 'Y' ? 'Y' : 'N',
        created_by:      req.user.username,
        notes:           notes || null,
      })
      .select().single();

    if (poErr) return res.status(500).json({ error: poErr.message });

    // Insert lines if provided
    if (lines && lines.length > 0) {
      const lineRows = lines.map((l, idx) => ({
        po_id:           po.po_id,
        line_number:     idx + 1,
        line_type:       l.line_type || (allocation_type === 'INVENTORY' ? 'INVENTORY' : 'COST'),
        gl_account_code: l.gl_account_code || null,
        item_id:         l.item_id || null,
        item_code:       l.item_code || null,
        item_name:       l.item_name || null,
        description:     l.description || '',
        quantity:        l.quantity || 1,
        unit_of_measure: l.unit_of_measure || 'Each',
        unit_price_excl: l.unit_price_excl || 0,
        vat_type:        l.vat_type || 'IN_STD',
        vat_amount:      l.vat_amount || 0,
        line_total_excl: l.line_total_excl || 0,
        line_total_incl: l.line_total_incl || 0,
        qty_outstanding: l.quantity || 1,
      }));
      await supabase().from('lp_po_lines').insert(lineRows);
    }

    await logPOAction({
      po_id: po.po_id, po_number: poNum,
      action: 'CREATED', by: req.user.username,
      from_status: null, to_status: 'PARKED',
    });

    res.status(201).json(po);
  }
);

// GET /inventory/po/:id — PO detail with lines and approval log
router.get('/po/:id',
  requireRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.FINANCE, ROLES.OPERATOR, ROLES.OPS_ASSISTANT,
              ROLES.CONTROL_ROOM, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT,
              ROLES.STOCK_CONTROLLER, ROLES.WORKSHOP),
  async (req, res) => {
    const { data: po, error } = await supabase
      .from('lp_purchase_orders')
      .select('*')
      .eq('po_id', req.params.id)
      .single();
    if (error || !po) return res.status(404).json({ error: 'PO not found' });

    const [{ data: lines }, { data: log }] = await Promise.all([
      supabase().from('lp_po_lines').select('*').eq('po_id', po.po_id).order('line_number'),
      supabase().from('lp_po_approval_log').select('*').eq('po_id', po.po_id).order('actioned_at'),
    ]);

    res.json({ po, lines: lines || [], log: log || [] });
  }
);

// PATCH /inventory/po/:id — update a PARKED PO (before submission)
router.patch('/po/:id',
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER,
             ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER),
  async (req, res) => {
    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('po_id, po_number, status, created_by')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'PARKED') {
      return res.status(400).json({ error: 'Only PARKED POs can be edited' });
    }
    // Only creator or Admin can edit
    if (po.created_by !== req.user.username && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ error: 'Only the creator or Admin can edit a PO' });
    }

    const allowed = ['supplier_code','supplier_name','vehicle_code','vehicle_name',
                     'po_description','notes','subtotal_excl_vat','vat_amount','total_incl_vat'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('lp_purchase_orders')
      .update(updates)
      .eq('po_id', req.params.id)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }
);

// ── ATTACHMENT UPLOAD ──────────────────────────────────────────────────────

// POST /inventory/po/:id/attachment — upload attachment to temp storage
// Attachment stays local until PO is PAID, then offloaded to OneDrive
router.post('/po/:id/attachment',
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER,
             ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER),
  upload.single('attachment'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('po_id, po_number, status, supplier_code, supplier_name, created_by')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });

    // Build a serving URL for the temp file
    const tempUrl = `/temp-attachments/${req.file.filename}`;

    const { data, error } = await supabase
      .from('lp_purchase_orders')
      .update({
        attachment_filename: req.file.originalname,
        attachment_url:      tempUrl,
        updated_at:          new Date().toISOString(),
      })
      .eq('po_id', po.po_id)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    await logPOAction({
      po_id: po.po_id, po_number: po.po_number,
      action: 'ATTACHMENT_ADDED', by: req.user.username,
      notes: req.file.originalname,
      attachment_url: tempUrl,
    });

    res.json({ success: true, filename: req.file.originalname, url: tempUrl });
  }
);

// POST /inventory/po/:id/offload-attachment
// Called when PO is marked PAID — moves attachment link to OneDrive
// This simulates the SharePoint link generation (same as POD system)
router.post('/po/:id/offload-attachment',
  requireRole(ROLES.ADMIN),
  async (req, res) => {
    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('*')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (!po.attachment_filename) return res.status(400).json({ error: 'No attachment to offload' });
    if (po.onedrive_offloaded === 'Y') return res.json({ message: 'Already offloaded', url: po.onedrive_url });

    const config = await getConfig('onedrive_po_base_path');

    // Build the OneDrive deep-link path
    const onedrivePath = buildOneDrivePath(
      config,
      po.supplier_code,
      po.supplier_name || po.supplier_code,
      po.created_at
    );
    const onedriveUrl = `${onedrivePath}/${encodeURIComponent(po.attachment_filename)}`;

    // Delete temp file from local disk
    const tempFilePath = path.join(TEMP_UPLOAD_DIR, path.basename(po.attachment_url || ''));
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) { /* non-fatal */ }
    }

    const { data, error } = await supabase
      .from('lp_purchase_orders')
      .update({
        onedrive_url:       onedriveUrl,
        onedrive_offloaded: 'Y',
        offloaded_at:       new Date().toISOString(),
        attachment_url:     null, // clear temp URL
        updated_at:         new Date().toISOString(),
      })
      .eq('po_id', po.po_id)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    await logPOAction({
      po_id: po.po_id, po_number: po.po_number,
      action: 'ONEDRIVE_OFFLOADED', by: req.user.username,
      notes: `Offloaded to: ${onedriveUrl}`,
      attachment_url: onedriveUrl,
    });

    res.json({ success: true, onedrive_url: onedriveUrl });
  }
);

// ── SUBMIT FOR APPROVAL ────────────────────────────────────────────────────

// POST /inventory/po/:id/submit — submit a PARKED PO for approval
// Requires: value must be set (subtotal_excl_vat > 0)
// Workshop Manager submitting: requires attachment before submit
router.post('/po/:id/submit',
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.CONTROL_ROOM, ROLES.STOCK_CONTROLLER,
             ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER),
  async (req, res) => {
    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('*')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'PARKED') {
      return res.status(400).json({ error: `Cannot submit — PO is ${po.status}` });
    }
    if (po.created_by !== req.user.username && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({ error: 'Only the creator can submit this PO' });
    }

    // Value is required before submission
    if (!po.subtotal_excl_vat || po.subtotal_excl_vat <= 0) {
      return res.status(400).json({ error: 'A value must be entered before submitting for approval' });
    }

    // Workshop Manager MUST have an attachment before submitting
    if (req.user.role === ROLES.WORKSHOP_MANAGER && !po.attachment_filename) {
      return res.status(400).json({
        error: 'An attachment (supplier quote/invoice) is required before Workshop Manager can submit for approval'
      });
    }

    const config = await getConfig(
      'po_l1_role', 'po_l2_role', 'po_l3_role',
      'workshop_manager_username', 'workshop_assistant_username'
    );

    const newStatus = firstApprovalStatus(req.user.role);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('lp_purchase_orders')
      .update({
        status:       newStatus,
        submitted_by: req.user.username,
        submitted_at: now,
        updated_at:   now,
      })
      .eq('po_id', po.po_id)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    await logPOAction({
      po_id: po.po_id, po_number: po.po_number,
      action: 'SUBMITTED', by: req.user.username,
      from_status: 'PARKED', to_status: newStatus,
    });

    // Notify the right approver
    const approverRoleMap = {
      'PENDING_L1':          config['po_l1_role'],
      'PENDING_L2':          config['po_l2_role'],
      'PENDING_L3':          config['po_l3_role'],
      'PENDING_FINANCIAL':   config['po_financial_role'] || ROLES.FINANCE, // notify FINANCE, not just ADMIN
    };
    const notifyRole = approverRoleMap[newStatus];
    if (notifyRole) {
      await notify({
        role:    notifyRole,
        type:    'PO_SUBMITTED',
        title:   `PO Requires Approval: ${po.po_number}`,
        message: `${po.po_description} — Supplier: ${po.supplier_name} — R${Number(po.total_incl_vat || 0).toFixed(2)}`,
        po_id:   po.po_id,
      });
    }

    res.json({ success: true, po: data });
  }
);

// ── APPROVAL ACTIONS ───────────────────────────────────────────────────────

// POST /inventory/po/:id/approve — approve or reject a PO at current stage
router.post('/po/:id/approve',
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.STOCK_CONTROLLER,
             ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER),
  async (req, res) => {
    const { action, notes } = req.body; // action: 'APPROVE' | 'REJECT'
    if (!['APPROVE','REJECT'].includes(action)) {
      return res.status(400).json({ error: "action must be 'APPROVE' or 'REJECT'" });
    }
    if (action === 'REJECT' && !notes) {
      return res.status(400).json({ error: 'A rejection reason is required' });
    }

    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('*')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });

    const role = req.user.role;
    const now  = new Date().toISOString();

    // Map current status to: who can approve it, what action to log, what next status is
    const stageMap = {
      'PENDING_L1':        { roles: [ROLES.STOCK_CONTROLLER, ROLES.ADMIN],     action_ok: 'L1_APPROVED',        action_rej: 'L1_REJECTED',        next: 'PENDING_L2',        stage: 'L1' },
      'PENDING_L2':        { roles: [ROLES.WORKSHOP_ASSISTANT, ROLES.ADMIN], action_ok: 'L2_APPROVED',        action_rej: 'L2_REJECTED',        next: 'PENDING_L3',        stage: 'L2' },
      'PENDING_L3':        { roles: [ROLES.WORKSHOP_MANAGER, ROLES.ADMIN],   action_ok: 'L3_APPROVED',        action_rej: 'L3_REJECTED',        next: 'PENDING_FINANCIAL', stage: 'L3' },
      'PENDING_FINANCIAL': { roles: [ROLES.FINANCE, ROLES.ADMIN],             action_ok: 'FINANCIAL_APPROVED', action_rej: 'FINANCIAL_REJECTED',  next: 'APPROVED',          stage: 'FINANCIAL' },
    };

    const stage = stageMap[po.status];
    if (!stage) {
      return res.status(400).json({ error: `PO is ${po.status} — not awaiting approval` });
    }
    if (!stage.roles.includes(role)) {
      return res.status(403).json({ error: `Your role cannot approve at this stage (${po.status})` });
    }

    const logAction  = action === 'APPROVE' ? stage.action_ok : stage.action_rej;
    const newStatus  = action === 'APPROVE' ? stage.next : 'REJECTED';

    // Build update fields for this stage
    const updates = { status: newStatus, updated_at: now };
    if (stage.stage === 'L1' && action === 'APPROVE') {
      updates.l1_approver = req.user.username;
      updates.l1_approved_at = now;
    } else if (stage.stage === 'L2' && action === 'APPROVE') {
      updates.l2_approver = req.user.username;
      updates.l2_approved_at = now;
    } else if (stage.stage === 'L3' && action === 'APPROVE') {
      updates.l3_approver = req.user.username;
      updates.l3_approved_at = now;
    } else if (stage.stage === 'FINANCIAL' && action === 'APPROVE') {
      updates.financial_approver = req.user.username;
      updates.financial_approved_at = now;
    }
    if (action === 'REJECT') {
      updates.rejected_by      = req.user.username;
      updates.rejected_at      = now;
      updates.rejection_reason  = notes;
      updates.rejection_stage   = stage.stage;
    }

    const { data, error } = await supabase
      .from('lp_purchase_orders')
      .update(updates)
      .eq('po_id', po.po_id)
      .select().single();

    if (error) return res.status(500).json({ error: error.message });

    await logPOAction({
      po_id: po.po_id, po_number: po.po_number,
      action: logAction, by: req.user.username,
      from_status: po.status, to_status: newStatus,
      notes,
    });

    // Notify creator of rejection
    if (action === 'REJECT') {
      await notify({
        user:    po.created_by,
        type:    'PO_REJECTED',
        title:   `PO Rejected: ${po.po_number}`,
        message: `Your PO was rejected at stage ${stage.stage} by ${req.user.username}. Reason: ${notes}`,
        po_id:   po.po_id,
      });
    } else {
      // Notify next approver
      const nextNotifyRoleMap = {
        'PENDING_L2':        ROLES.WORKSHOP_ASSISTANT,
        'PENDING_L3':        ROLES.WORKSHOP_MANAGER,
        'PENDING_FINANCIAL': ROLES.FINANCE,
        'APPROVED':          null, // notify creator
      };
      const nextRole = nextNotifyRoleMap[newStatus];
      if (nextRole) {
        await notify({
          role:    nextRole,
          type:    `PO_APPROVED_${stage.stage}`,
          title:   `PO Requires Your Approval: ${po.po_number}`,
          message: `${po.po_description} — Supplier: ${po.supplier_name} — R${Number(po.total_incl_vat || 0).toFixed(2)}`,
          po_id:   po.po_id,
        });
      }
      if (newStatus === 'APPROVED') {
        await notify({
          user:    po.created_by,
          type:    'PO_FINANCIAL_APPROVED',
          title:   `PO Approved: ${po.po_number}`,
          message: `Your purchase order has been fully approved and committed. Total: R${Number(po.total_incl_vat || 0).toFixed(2)}`,
          po_id:   po.po_id,
        });
      }
    }

    res.json({ success: true, po: data });
  }
);

// POST /inventory/po/:id/receive — mark goods received (inventory POs)
// Updates inventory transactions and qty_on_hand
router.post('/po/:id/receive',
  requireRole(ROLES.ADMIN, ROLES.WORKSHOP_MANAGER, ROLES.WORKSHOP_ASSISTANT, ROLES.STOCK_CONTROLLER),
  async (req, res) => {
    const { received_lines } = req.body;
    // received_lines: [{po_line_id, qty_received, unit_cost_excl}]
    if (!received_lines?.length) {
      return res.status(400).json({ error: 'received_lines required' });
    }

    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('*')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (po.status !== 'APPROVED') {
      return res.status(400).json({ error: 'PO must be APPROVED before receiving goods' });
    }
    if (po.allocation_type !== 'INVENTORY') {
      return res.status(400).json({ error: 'Only INVENTORY POs have goods receipt' });
    }

    const txns = [];
    for (const recv of received_lines) {
      const { data: line } = await supabase
        .from('lp_po_lines')
        .select('*, lp_inventory_items(item_id, qty_on_hand, qty_on_order, average_cost, last_cost)')
        .eq('po_line_id', recv.po_line_id)
        .single();
      if (!line || !line.item_id) continue;

      const qty   = Number(recv.qty_received);
      const cost  = Number(recv.unit_cost_excl || line.unit_price_excl || 0);
      const total = qty * cost;

      // Update inventory qty
      const item = line.lp_inventory_items;
      const newQty    = Number(item.qty_on_hand || 0) + qty;
      const newOnOrder = Math.max(0, Number(item.qty_on_order || 0) - qty);
      // Weighted average cost
      const oldCost   = Number(item.average_cost || 0);
      const oldQty    = Number(item.qty_on_hand || 0);
      const avgCost   = newQty > 0 ? (oldCost * oldQty + cost * qty) / newQty : cost;

      await supabase().from('lp_inventory_items').update({
        qty_on_hand:  newQty,
        qty_on_order: newOnOrder,
        last_cost:    cost,
        average_cost: Math.round(avgCost * 100) / 100,
        updated_at:   new Date().toISOString(),
      }).eq('item_id', line.item_id);

      // Update line qty_received
      await supabase().from('lp_po_lines').update({
        qty_received:   (Number(line.qty_received || 0)) + qty,
        qty_outstanding: Math.max(0, Number(line.qty_outstanding || line.quantity) - qty),
      }).eq('po_line_id', recv.po_line_id);

      // Create inventory transaction
      const { data: txn } = await supabase().from('lp_inventory_transactions').insert({
        txn_type:      'PO_RECEIPT',
        item_id:       line.item_id,
        qty,
        unit_cost_excl: cost,
        total_cost_excl: total,
        po_id:         po.po_id,
        po_line_id:    recv.po_line_id,
        txn_date:      new Date().toISOString().slice(0, 10),
        txn_ref:       `${po.po_number}-RECV`,
        created_by:    req.user.username,
      }).select().single();

      txns.push(txn);
    }

    // Update PO status to GOODS_RECEIVED
    await supabase().from('lp_purchase_orders').update({
      status:    'GOODS_RECEIVED',
      updated_at: new Date().toISOString(),
    }).eq('po_id', po.po_id);

    await logPOAction({
      po_id: po.po_id, po_number: po.po_number,
      action: 'GOODS_RECEIVED', by: req.user.username,
      from_status: 'APPROVED', to_status: 'GOODS_RECEIVED',
      notes: `${txns.length} lines received`,
    });

    res.json({ success: true, transactions: txns });
  }
);

// POST /inventory/po/:id/close — mark PO PAID and trigger attachment offload
router.post('/po/:id/close',
  requireRole(ROLES.ADMIN),
  async (req, res) => {
    const { data: po } = await supabase
      .from('lp_purchase_orders')
      .select('*')
      .eq('po_id', req.params.id)
      .single();

    if (!po) return res.status(404).json({ error: 'PO not found' });

    await supabase().from('lp_purchase_orders').update({
      status:     'PAID',
      updated_at: new Date().toISOString(),
    }).eq('po_id', po.po_id);

    await logPOAction({
      po_id: po.po_id, po_number: po.po_number,
      action: 'PAID', by: req.user.username,
      from_status: po.status, to_status: 'PAID',
    });

    // Auto-trigger OneDrive offload if attachment exists
    if (po.attachment_filename && po.onedrive_offloaded !== 'Y') {
      const config = await getConfig('onedrive_po_base_path');
      const onedriveUrl = buildOneDrivePath(config, po.supplier_code, po.supplier_name, po.created_at)
        + '/' + encodeURIComponent(po.attachment_filename);

      const tempFilePath = path.join(TEMP_UPLOAD_DIR, path.basename(po.attachment_url || ''));
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) { /* non-fatal */ }
      }

      await supabase().from('lp_purchase_orders').update({
        onedrive_url:       onedriveUrl,
        onedrive_offloaded: 'Y',
        offloaded_at:       new Date().toISOString(),
        attachment_url:     null,
      }).eq('po_id', po.po_id);

      await logPOAction({
        po_id: po.po_id, po_number: po.po_number,
        action: 'ONEDRIVE_OFFLOADED', by: 'SYSTEM',
        notes: onedriveUrl, attachment_url: onedriveUrl,
      });
    }

    res.json({ success: true, status: 'PAID' });
  }
);

// GET /inventory/po/pending-approval — POs awaiting my action
router.get('/po/pending-approval',
  requireRole(ROLES.ADMIN, ROLES.FINANCE, ROLES.STOCK_CONTROLLER,
             ROLES.WORKSHOP_ASSISTANT, ROLES.WORKSHOP_MANAGER),
  async (req, res) => {
    const roleStatusMap = {
      [ROLES.STOCK_CONTROLLER]:   ['PENDING_L1'],
      [ROLES.WORKSHOP_ASSISTANT]: ['PENDING_L2'],
      [ROLES.WORKSHOP_MANAGER]:   ['PENDING_L3'],
      [ROLES.ADMIN]:         ['PENDING_FINANCIAL'],
    };
    const myStatuses = roleStatusMap[req.user.role] || [];
    if (!myStatuses.length) return res.json([]);

    const { data, error } = await supabase
      .from('lp_purchase_orders')
      .select('po_id, po_number, supplier_name, po_description, total_incl_vat, status, created_by, submitted_at, attachment_filename')
      .in('status', myStatuses)
      .order('submitted_at');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  }
);

module.exports = router;


