-- migration_finance_posting_backfill.sql
-- =============================================================================
-- One-off backfill: post any lp_invoices that are already FINAL but were
-- approved before the finance posting migration (migration_finance_posting_core)
-- was applied, and therefore have no fin_ar_invoice_id.
--
-- Safe to re-run: fin_post_lp_invoice returns {already_posted:true} and does
-- nothing if the invoice already has a fin_ar_invoice_id.
--
-- Run in Supabase SQL Editor AFTER migration_finance_posting_core.sql.
-- Expected result: one JSON row per unposted FINAL invoice. Check each row
-- shows "success": true. If any show an error, fix the underlying issue
-- (e.g. missing fin_ar_customers mapping) and re-run.
-- =============================================================================

-- Step 1: show what will be posted (read-only preview)
select id, inv_number, inv_customer, inv_date,
       inv_amount_excl, inv_vat, inv_amount_incl,
       inv_status, fin_ar_invoice_id
  from public.lp_invoices
 where inv_status = 'FINAL'
   and fin_ar_invoice_id is null
 order by inv_date, id;

-- Step 2: post each unposted FINAL invoice
-- fin_post_lp_invoice is called once per invoice row via a lateral join.
-- p_posted_by is recorded as 'system-backfill' in the AR and GL records.
select inv.id,
       inv.inv_number,
       result.*
  from public.lp_invoices inv
 cross join lateral (
   select public.fin_post_lp_invoice(
     p_lp_invoice_id => inv.id,
     p_posted_by     => 'system-backfill',
     p_revenue_account => null,   -- uses fin_posting_config.transport_revenue_account (1000)
     p_vat_code        => null,   -- uses fin_posting_config.default_output_vat_code
     p_entity_id       => 1
   ) as result
 ) r
 where inv.inv_status = 'FINAL'
   and inv.fin_ar_invoice_id is null
 order by inv.inv_date, inv.id;

-- Step 3: confirm — should return 0 rows after a successful backfill
select 'Remaining unposted FINAL invoices' as check_name, count(*) as remaining
  from public.lp_invoices
 where inv_status = 'FINAL'
   and fin_ar_invoice_id is null;
