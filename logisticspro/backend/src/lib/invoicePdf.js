/**
 * LP2.0 — Invoice PDF Generator
 * =====================================================================
 * Generates a simple, clean invoice PDF for a single load invoice
 * (lp_invoices is one row per load — no multi-line invoices today).
 *
 * Company letterhead details come from env vars so they can be set
 * without a code deploy — confirm/adjust these on Render:
 *   COMPANY_NAME, COMPANY_ADDRESS, COMPANY_VAT_NO,
 *   COMPANY_BANK_NAME, COMPANY_BANK_ACCOUNT, COMPANY_BANK_BRANCH
 * Defaults below are placeholders — verify before relying on these
 * PDFs for real client invoices.
 *
 * Returns a Promise<Buffer> — caller decides whether to email it,
 * save it to SharePoint, or both.
 * =====================================================================
 */
const PDFDocument = require('pdfkit');

const COMPANY = {
  name:        process.env.COMPANY_NAME        || 'Interland Distribution Cape (Pty) Ltd',
  address:     process.env.COMPANY_ADDRESS     || '[Company address — set COMPANY_ADDRESS env var]',
  vatNo:       process.env.COMPANY_VAT_NO      || '[VAT number — set COMPANY_VAT_NO env var]',
  bankName:    process.env.COMPANY_BANK_NAME   || '[Bank — set COMPANY_BANK_NAME env var]',
  bankAccount: process.env.COMPANY_BANK_ACCOUNT|| '[Account — set COMPANY_BANK_ACCOUNT env var]',
  bankBranch:  process.env.COMPANY_BANK_BRANCH || '[Branch code — set COMPANY_BANK_BRANCH env var]',
};

function fmtR(n) {
  return 'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

// invoice: lp_invoices row; load: lp_movement row (may be partial/null);
// customerName: resolved display name for inv_customer.
function generateInvoicePdfBuffer(invoice, load, customerName) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ──────────────────────────────────────────────
      doc.fontSize(18).fillColor('#005A8E').text(COMPANY.name, { continued: false });
      doc.fontSize(9).fillColor('#555').text(COMPANY.address);
      doc.text(`VAT No: ${COMPANY.vatNo}`);
      doc.moveDown(1);

      doc.fontSize(20).fillColor('#000').text('TAX INVOICE', { align: 'right' });
      doc.fontSize(10).fillColor('#333');
      doc.text(`Invoice No: ${invoice.inv_number}`, { align: 'right' });
      doc.text(`Invoice Date: ${fmtDate(invoice.inv_date)}`, { align: 'right' });
      if (invoice.inv_order_no) doc.text(`Order No: ${invoice.inv_order_no}`, { align: 'right' });
      doc.moveDown(1.5);

      // ── Bill To ─────────────────────────────────────────────
      doc.fontSize(10).fillColor('#005A8E').text('BILL TO', { underline: false });
      doc.fontSize(11).fillColor('#000').text(customerName || invoice.inv_customer || '');
      doc.moveDown(1.5);

      // ── Line item table (single line — load-based invoicing) ─
      const tableTop = doc.y;
      const colDesc = 50, colLoad = 270, colAmt = 340, colVat = 420, colTotal = 480;
      doc.fontSize(9).fillColor('#fff');
      doc.rect(50, tableTop, 500, 20).fill('#005A8E');
      doc.fillColor('#fff');
      doc.text('Description', colDesc + 5, tableTop + 5);
      doc.text('Load No', colLoad, tableTop + 5);
      doc.text('Excl VAT', colAmt, tableTop + 5);
      doc.text('VAT', colVat, tableTop + 5);
      doc.text('Total', colTotal, tableTop + 5);

      const rowY = tableTop + 25;
      doc.fillColor('#000').fontSize(9);
      doc.text(invoice.inv_description || 'TRANSPORT SERVICES', colDesc + 5, rowY, { width: 210 });
      doc.text(invoice.inv_load_no || '', colLoad, rowY, { width: 65 });
      doc.text(fmtR(invoice.inv_amount_excl), colAmt, rowY, { width: 75 });
      doc.text(fmtR(invoice.inv_vat), colVat, rowY, { width: 55 });
      doc.text(fmtR(invoice.inv_amount_incl), colTotal, rowY, { width: 70 });

      if (load && (load.m_from || load.m_to)) {
        doc.fontSize(9).fillColor('#666')
          .text(`Route: ${load.m_from || '—'} - ${load.m_to || '—'}`, colDesc + 5, rowY + 16, { width: 210 });
      }

      doc.moveDown(4);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#ddd').stroke();
      doc.moveDown(0.5);

      // ── Totals ──────────────────────────────────────────────
      doc.fontSize(10).fillColor('#333');
      doc.text(`Subtotal: ${fmtR(invoice.inv_amount_excl)}`, { align: 'right' });
      doc.text(`VAT (15%): ${fmtR(invoice.inv_vat)}`, { align: 'right' });
      doc.fontSize(13).fillColor('#005A8E').text(`Total Due: ${fmtR(invoice.inv_amount_incl)}`, { align: 'right' });

      doc.moveDown(2);

      // ── Banking details ─────────────────────────────────────
      doc.fontSize(9).fillColor('#666');
      doc.text('Banking Details', { underline: true });
      doc.text(`Bank: ${COMPANY.bankName}`);
      doc.text(`Account No: ${COMPANY.bankAccount}`);
      doc.text(`Branch Code: ${COMPANY.bankBranch}`);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateInvoicePdfBuffer };
