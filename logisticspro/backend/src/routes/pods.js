const express = require('express');
const supabase = require('../supabase');
const { authMiddleware, requireRole, ROLES, CAN_VIEW_LOADS, CAN_ADD_COSTS } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const BUCKET = 'pods';

// Roles that can upload PODs (same as who can add costs to a load)
const CAN_UPLOAD_POD = CAN_ADD_COSTS;   // ADMIN, OPERATOR, OPS_ASSISTANT, CONTROL_ROOM

// ── Helper: build the storage path for a load ────────────────
function storagePath(loadNo, fileName) {
  // Sanitise filename — strip anything that isn't alphanumeric, dash, dot, underscore
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${loadNo}/${Date.now()}_${safe}`;
}


// ============================================================
// GET /api/pods/pending
// Loads currently sitting in WAIT_POD_SCAN — need a POD uploaded.
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
  res.json(data || []);
});


// ============================================================
// GET /api/pods/received
// Loads that have at least one POD file uploaded, across all statuses.
// ============================================================
router.get('/received', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
  const { bus_unit, search } = req.query;

  // Get all loads that have pod files, joining to movement for load details
  const { data: podFiles, error: pfErr } = await supabase
    .from('lp_pod_files')
    .select('pf_load_no')
    .order('created_at', { ascending: false });

  if (pfErr) return res.status(500).json({ error: pfErr.message });

  const loadNos = [...new Set((podFiles || []).map(p => p.pf_load_no))];
  if (loadNos.length === 0) return res.json([]);

  let q = supabase
    .from('lp_movement')
    .select('m_load_no, m_date, m_customer, m_truck, m_from, m_to, m_rate, m_status, m_order_no, m_bus_unit')
    .in('m_load_no', loadNos)
    .neq('m_status', 'DELETED')
    .order('m_date', { ascending: false });

  if (bus_unit) q = q.eq('m_bus_unit', bus_unit);
  if (search)   q = q.or(`m_load_no.ilike.%${search}%,m_customer.ilike.%${search}%,m_truck.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});


// ============================================================
// GET /api/pods/:loadNo
// All POD files for a specific load, with signed download URLs.
// ============================================================
router.get('/:loadNo', requireRole(...CAN_VIEW_LOADS), async (req, res) => {
  const { loadNo } = req.params;

  const { data: files, error } = await supabase
    .from('lp_pod_files')
    .select('*')
    .eq('pf_load_no', loadNo)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  if (!files || files.length === 0) return res.json([]);

  // Generate a signed URL for each file (valid for 1 hour)
  const result = await Promise.all(files.map(async (f) => {
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(f.pf_file_path, 3600);

    return {
      ...f,
      signed_url: signErr ? null : signed?.signedUrl,
    };
  }));

  res.json(result);
});


// ============================================================
// POST /api/pods/:loadNo/upload
// Upload a POD file for a load.
// Body: multipart/form-data with fields:
//   file       — the binary file
//   file_name  — original filename
//   mime_type  — e.g. application/pdf
//   note       — optional note
//
// After the first upload, the load status advances from
// WAIT_POD_SCAN → WAIT_INVOICE_NO automatically.
// ============================================================
router.post('/:loadNo/upload', requireRole(...CAN_UPLOAD_POD), async (req, res) => {
  const { loadNo } = req.params;
  const { file_base64, file_name, mime_type, note } = req.body;

  if (!file_base64 || !file_name || !mime_type) {
    return res.status(400).json({ error: 'file_base64, file_name, and mime_type are required' });
  }

  // Allowed types
  const ALLOWED = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!ALLOWED.includes(mime_type.toLowerCase())) {
    return res.status(400).json({ error: 'Only PDF, JPEG, PNG, and WebP files are accepted' });
  }

  // Verify load exists and is in the right status (or already has files)
  const { data: load, error: loadErr } = await supabase
    .from('lp_movement')
    .select('m_status, m_load_no')
    .eq('m_load_no', loadNo)
    .single();

  if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

  // Convert base64 to buffer
  let buffer;
  try {
    buffer = Buffer.from(file_base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  const path = storagePath(loadNo, file_name);

  // Upload to Supabase Storage
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mime_type,
      upsert: false,
    });

  if (uploadErr) return res.status(500).json({ error: `Storage upload failed: ${uploadErr.message}. Make sure the "pods" bucket exists in Supabase Storage.` });

  // Record in database
  const { data: podFile, error: dbErr } = await supabase
    .from('lp_pod_files')
    .insert([{
      pf_load_no:     loadNo,
      pf_file_path:   path,
      pf_file_name:   file_name,
      pf_file_size:   buffer.length,
      pf_mime_type:   mime_type,
      pf_uploaded_by: req.user.username,
      pf_note:        note || null,
    }])
    .select()
    .single();

  if (dbErr) return res.status(500).json({ error: `Database error: ${dbErr.message}. Make sure migration_002_pod_storage.sql has been run in Supabase.` });

  // Audit comment on the load
  await supabase.from('lp_comments').insert([{
    c_load:      loadNo,
    c_comment:   `POD uploaded: ${file_name} by ${req.user.username}`,
    c_logged_by: req.user.username,
  }]);

  // Auto-advance load status from WAIT_POD_SCAN → WAIT_INVOICE_NO
  if (load.m_status === 'WAIT_POD_SCAN') {
    await supabase.from('lp_movement')
      .update({ m_status: 'WAIT_INVOICE_NO', updated_at: new Date().toISOString() })
      .eq('m_load_no', loadNo);

    await supabase.from('lp_comments').insert([{
      c_load:      loadNo,
      c_comment:   `Status auto-advanced to WAIT_INVOICE_NO after POD upload`,
      c_logged_by: 'SYSTEM',
    }]);
  }

  res.status(201).json({ ...podFile, status_advanced: load.m_status === 'WAIT_POD_SCAN' });
});


// ============================================================
// DELETE /api/pods/file/:fileId
// Remove a POD file (Operator/Admin only — irreversible).
// ============================================================
router.delete('/file/:fileId', requireRole(ROLES.ADMIN, ROLES.OPERATOR), async (req, res) => {
  const { fileId } = req.params;

  const { data: file, error: fetchErr } = await supabase
    .from('lp_pod_files')
    .select('*')
    .eq('id', fileId)
    .single();

  if (fetchErr || !file) return res.status(404).json({ error: 'File not found' });

  // Remove from storage
  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .remove([file.pf_file_path]);

  if (storageErr) return res.status(500).json({ error: `Storage delete failed: ${storageErr.message}` });

  // Remove database record
  await supabase.from('lp_pod_files').delete().eq('id', fileId);

  // Audit comment
  await supabase.from('lp_comments').insert([{
    c_load:      file.pf_load_no,
    c_comment:   `POD file deleted: ${file.pf_file_name} by ${req.user.username}`,
    c_logged_by: req.user.username,
  }]);

  res.json({ success: true });
});


module.exports = router;
