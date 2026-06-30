/**
 * LP2.0 — Microsoft Graph Integration
 * =====================================================================
 * Used for:
 *   1. Sending POD + Invoice emails to clients via the company's actual
 *      Outlook/Microsoft 365 mailbox (Graph /sendMail) — not a
 *      third-party email service. This was a deliberate choice: emails
 *      come from the real Interland mailbox, not a separate vendor.
 *   2. Reading POD files and writing generated invoice PDFs to
 *      SharePoint (same tenant/site already used for POD storage —
 *      see routes/pods.js sharepointLink()).
 *
 * AUTH: OAuth2 client-credentials flow against Azure AD. Requires an
 * Azure AD App Registration with these Application (not Delegated)
 * permissions, admin-consented:
 *   - Mail.Send
 *   - Sites.ReadWrite.All  (or Sites.Selected scoped to the one site)
 *
 * Required environment variables (Render):
 *   GRAPH_TENANT_ID      — Azure AD tenant ID
 *   GRAPH_CLIENT_ID      — App registration (client) ID
 *   GRAPH_CLIENT_SECRET  — App registration client secret
 *   GRAPH_SENDER_EMAIL   — Mailbox to send as, e.g. invoices@interland...
 *
 * Token caching mirrors lib/pulsit.js — single cached bearer token,
 * refreshed shortly before expiry, shared across all callers.
 * =====================================================================
 */
const TENANT_ID     = process.env.GRAPH_TENANT_ID;
const CLIENT_ID     = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const SENDER_EMAIL  = process.env.GRAPH_SENDER_EMAIL;

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Same SharePoint site already used for POD links in routes/pods.js —
// hostname and site path aren't secret, just config (consistent with
// how pods.js hardcodes them).
const SP_HOSTNAME = 'llamahosted.sharepoint.com';
const SP_SITE_PATH = '/sites/Interland';
const SP_POD_FOLDER = '/Interland Distribution/PODS New';
const SP_INVOICE_FOLDER = '/Interland Distribution/INVOICES';

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedSiteId = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function assertConfigured() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SENDER_EMAIL) {
    const err = new Error(
      'Microsoft Graph is not configured — set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, ' +
      'GRAPH_CLIENT_SECRET and GRAPH_SENDER_EMAIL on the server.'
    );
    err.notConfigured = true;
    throw err;
  }
}

async function getToken(forceRefresh = false) {
  assertConfigured();
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const result = await fetchWithTimeout(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
        grant_type:    'client_credentials',
      }).toString(),
    }
  );

  const token = result.ok ? result.data?.access_token : null;
  if (!token) {
    const err = new Error('Microsoft Graph login failed');
    err.details = { status: result.status, response: result.data };
    throw err;
  }
  cachedToken = token;
  // expires_in is seconds (typically 3600) — refresh 5 min early
  tokenExpiresAt = Date.now() + ((result.data.expires_in || 3600) - 300) * 1000;
  return cachedToken;
}

async function graphFetch(path, options = {}, retryOn401 = true) {
  const token = await getToken();
  const result = await fetchWithTimeout(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });

  if (result.status === 401 && retryOn401) {
    cachedToken = null;
    return graphFetch(path, options, false);
  }
  if (!result.ok) {
    const err = new Error(`Graph API error ${result.status} on ${path}`);
    err.details = result.data;
    throw err;
  }
  return result.data;
}

// ── SharePoint site/drive resolution (cached) ───────────────────────────────
async function getSiteId() {
  if (cachedSiteId) return cachedSiteId;
  const data = await graphFetch(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`);
  cachedSiteId = data.id;
  return cachedSiteId;
}

// List files in a SharePoint folder (relative to the document library root).
async function listFolderFiles(folderPath) {
  const siteId = await getSiteId();
  const encoded = encodeURIComponent(folderPath).replace(/%2F/g, '/');
  try {
    const data = await graphFetch(`/sites/${siteId}/drive/root:${encoded}:/children`);
    return (data?.value || []).filter(item => item.file);
  } catch (e) {
    if (e.details?.error?.code === 'itemNotFound') return []; // folder doesn't exist yet
    throw e;
  }
}

// Download a drive item's raw bytes as a base64 string (for email attachments).
async function downloadFileAsBase64(driveItemId) {
  const siteId = await getSiteId();
  const token = await getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let r;
  try {
    r = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive/items/${driveItemId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const err = new Error(`Failed to download file ${driveItemId} (status ${r.status})`);
    throw err;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.toString('base64');
}

// Upload a Buffer to a SharePoint folder (creates/overwrites the file).
// Suitable for files under ~4MB (generated invoice PDFs are tiny).
async function uploadFile(folderPath, filename, buffer, contentType = 'application/pdf') {
  const siteId = await getSiteId();
  const token = await getToken();
  const encodedPath = encodeURIComponent(`${folderPath}/${filename}`).replace(/%2F/g, '/');
  const r = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive/root:${encodedPath}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: buffer,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error('Failed to upload file to SharePoint');
    err.details = data;
    throw err;
  }
  return data;
}

// ── Mail send ────────────────────────────────────────────────────────────────
// attachments: [{ name, contentBytes (base64), contentType }]
async function sendMail({ to, cc, subject, htmlBody, attachments = [] }) {
  assertConfigured();
  const toRecipients = (Array.isArray(to) ? to : String(to).split(','))
    .map(e => e.trim()).filter(Boolean)
    .map(address => ({ emailAddress: { address } }));
  if (toRecipients.length === 0) throw new Error('No recipient email address provided');

  const ccRecipients = cc
    ? (Array.isArray(cc) ? cc : String(cc).split(','))
        .map(e => e.trim()).filter(Boolean)
        .map(address => ({ emailAddress: { address } }))
    : [];

  const message = {
    subject,
    body: { contentType: 'HTML', content: htmlBody },
    toRecipients,
    ...(ccRecipients.length ? { ccRecipients } : {}),
    attachments: attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.contentBytes,
    })),
  };

  await graphFetch(`/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
}

module.exports = {
  sendMail,
  listFolderFiles,
  downloadFileAsBase64,
  uploadFile,
  SP_POD_FOLDER,
  SP_INVOICE_FOLDER,
};
