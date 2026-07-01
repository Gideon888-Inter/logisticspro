-- LP2 Finance posting core
-- Purpose:
--   Move financial posting out of multi-step Express code and into atomic
--   Postgres functions. A function call is one database transaction: either
--   all journal/sub-ledger/VAT/source-document writes commit, or none do.
--
-- Review before production:
--   1. Confirm chart-of-accounts defaults in fin_posting_config.
--   2. Confirm table/column names against the live Supabase project.
--   3. Run tests/finance_posting_smoke_checks.sql in a non-production DB.
--
-- Security:
--   Functions are intentionally public-schema RPC functions for Supabase
--   compatibility, but execute grants are revoked from PUBLIC/anon/authenticated
--   and granted only to service_role. The backend should call them with the
--   server-side service client, never from browser code.

begin;

create table if not exists public.fin_posting_config (
  config_key text primary key,
  config_value text not null,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.fin_posting_config enable row level security;

insert into public.fin_posting_config (config_key, config_value, notes)
values
  ('transport_revenue_account', '1000', 'Transport revenue account — Interland Distribution Cape. Sage cutover value: 1000 - Sales.'),
  ('debtors_control_account', '8200', 'Fallback AR control if customer control account is blank.'),
  ('creditors_control_account', '9200', 'Fallback AP control if supplier control account is blank.'),
  ('vat_control_account', '9500', 'VAT control account.'),
  ('default_bank_account', '8400', 'Fallback bank/cashbook account.'),
  ('default_output_vat_code', 'OUT_STD', 'Standard output VAT code.'),
  ('default_input_vat_code', 'IN_STD', 'Standard input VAT code.')
on conflict (config_key) do nothing;

create table if not exists public.fin_doc_sequences (
  seq_key text not null,
  period_key text not null,
  last_no integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (seq_key, period_key)
);

alter table public.fin_doc_sequences enable row level security;

alter table public.lp_invoices
  add column if not exists fin_ar_invoice_id integer,
  add column if not exists fin_journal_id integer,
  add column if not exists fin_posted_at timestamptz,
  add column if not exists fin_posted_by varchar(45),
  add column if not exists fin_posting_error text;

alter table public.lp_credit_notes
  add column if not exists fin_ar_credit_note_id integer,
  add column if not exists fin_journal_id integer,
  add column if not exists fin_posted_at timestamptz,
  add column if not exists fin_posted_by varchar(45),
  add column if not exists fin_posting_error text;

create index if not exists idx_lp_invoices_fin_ar_invoice
  on public.lp_invoices (fin_ar_invoice_id);

create index if not exists idx_lp_credit_notes_fin_ar_cn
  on public.lp_credit_notes (fin_ar_credit_note_id);

create or replace function public.fin_config_text(p_key text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_value text;
begin
  select nullif(trim(config_value), '')
    into v_value
    from public.fin_posting_config
   where config_key = p_key;

  return v_value;
end;
$$;

create or replace function public.fin_next_ref(p_prefix text, p_doc_date date)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_period_key text := to_char(p_doc_date, 'YYYYMM');
  v_next integer;
begin
  insert into public.fin_doc_sequences (seq_key, period_key, last_no)
  values (p_prefix, v_period_key, 1)
  on conflict (seq_key, period_key)
  do update
     set last_no = public.fin_doc_sequences.last_no + 1,
         updated_at = now()
  returning last_no into v_next;

  return p_prefix || '-' || v_period_key || '-' || lpad(v_next::text, 5, '0');
end;
$$;

create or replace function public.fin_period_for_date(p_doc_date date, p_entity_id integer default 1)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_period_id integer;
begin
  select period_id
    into v_period_id
    from public.fin_periods
   where entity_id = p_entity_id
     and p_doc_date between period_start and period_end
     and coalesce(is_closed, false) = false
   order by period_start
   limit 1;

  if v_period_id is null then
    raise exception 'No open finance period found for date % and entity %', p_doc_date, p_entity_id
      using errcode = 'P0001';
  end if;

  return v_period_id;
end;
$$;

create or replace function public.fin_assert_account(p_account_code text, p_context text)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_account_code is null or trim(p_account_code) = '' then
    raise exception 'Missing GL account for %', p_context using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from public.fin_gl_accounts
     where account_code = p_account_code
       and coalesce(active, true) = true
  ) then
    raise exception 'GL account % for % does not exist or is inactive', p_account_code, p_context
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.fin_insert_posted_journal(
  p_ref_prefix text,
  p_journal_type text,
  p_description text,
  p_period_id integer,
  p_journal_date date,
  p_source_document text,
  p_source_module text,
  p_created_by text,
  p_entity_id integer default 1
)
returns table (journal_id integer, journal_ref text)
language plpgsql
volatile
set search_path = public
as $$
declare
  v_journal_ref text;
begin
  v_journal_ref := public.fin_next_ref(p_ref_prefix, p_journal_date);

  insert into public.fin_gl_journals (
    entity_id,
    journal_ref,
    journal_type,
    description,
    period_id,
    journal_date,
    source_document,
    source_module,
    posted,
    posted_at,
    posted_by,
    created_by
  )
  values (
    p_entity_id,
    v_journal_ref,
    p_journal_type,
    p_description,
    p_period_id,
    p_journal_date,
    p_source_document,
    p_source_module,
    true,
    now(),
    p_created_by,
    p_created_by
  )
  returning fin_gl_journals.journal_id, fin_gl_journals.journal_ref
    into journal_id, journal_ref;

  return next;
end;
$$;

create or replace function public.fin_log_audit(
  p_table_name text,
  p_record_id integer,
  p_action text,
  p_changed_by text,
  p_new_values jsonb default null
)
returns void
language plpgsql
volatile
set search_path = public
as $$
begin
  insert into public.fin_gl_audit_log (
    table_name,
    record_id,
    action,
    changed_by,
    new_values
  )
  values (
    p_table_name,
    p_record_id,
    p_action,
    p_changed_by,
    p_new_values::text
  );
exception
  when undefined_table or undefined_column then
    -- Audit logging should not block posting in older databases.
    null;
end;
$$;

create or replace function public.fin_post_lp_invoice(
  p_lp_invoice_id integer,
  p_posted_by text,
  p_revenue_account text default null,
  p_vat_code text default null,
  p_entity_id integer default 1
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_inv public.lp_invoices%rowtype;
  v_customer record;
  v_period_id integer;
  v_due_date date;
  v_revenue_account text;
  v_debtors_account text;
  v_vat_account text;
  v_vat_code text;
  v_vat_rate numeric := 0;
  v_journal_id integer;
  v_journal_ref text;
  v_debtors_line_id integer;
  v_revenue_line_id integer;
  v_vat_line_id integer;
  v_ar_invoice_id integer;
  v_ar_invoice_ref text;
  v_total_debit numeric;
  v_total_credit numeric;
begin
  select *
    into v_inv
    from public.lp_invoices
   where id = p_lp_invoice_id
   for update;

  if not found then
    raise exception 'LP invoice % not found', p_lp_invoice_id using errcode = 'P0001';
  end if;

  if v_inv.inv_status = 'CREDITED' then
    raise exception 'LP invoice % is credited and cannot be posted', v_inv.inv_number using errcode = 'P0001';
  end if;

  if v_inv.fin_ar_invoice_id is not null or v_inv.fin_journal_id is not null then
    return jsonb_build_object(
      'already_posted', true,
      'lp_invoice_id', v_inv.id,
      'fin_ar_invoice_id', v_inv.fin_ar_invoice_id,
      'journal_id', v_inv.fin_journal_id
    );
  end if;

  select customer_code,
         customer_name,
         payment_terms_days,
         gl_control_account,
         default_vat_type
    into v_customer
    from public.fin_ar_customers
   where customer_code = v_inv.inv_customer
      or lp_client_code = v_inv.inv_customer
   order by case when customer_code = v_inv.inv_customer then 0 else 1 end
   limit 1;

  if v_customer.customer_code is null then
    raise exception 'No finance AR customer mapped for LP customer %', v_inv.inv_customer
      using errcode = 'P0001';
  end if;

  v_period_id := public.fin_period_for_date(v_inv.inv_date, p_entity_id);
  v_due_date := v_inv.inv_date + coalesce(v_customer.payment_terms_days, 30)::integer;

  v_revenue_account := coalesce(nullif(trim(p_revenue_account), ''), public.fin_config_text('transport_revenue_account'));
  v_debtors_account := coalesce(nullif(trim(v_customer.gl_control_account), ''), public.fin_config_text('debtors_control_account'));
  v_vat_account := public.fin_config_text('vat_control_account');
  v_vat_code := coalesce(nullif(trim(p_vat_code), ''), nullif(trim(v_customer.default_vat_type), ''), public.fin_config_text('default_output_vat_code'));

  perform public.fin_assert_account(v_revenue_account, 'transport revenue');
  perform public.fin_assert_account(v_debtors_account, 'debtors control');
  if coalesce(v_inv.inv_vat, 0) > 0 then
    perform public.fin_assert_account(v_vat_account, 'VAT control');
  end if;

  if coalesce(v_inv.inv_amount_incl, 0) <> round((coalesce(v_inv.inv_amount_excl, 0) + coalesce(v_inv.inv_vat, 0))::numeric, 2) then
    raise exception 'LP invoice % totals do not agree: excl + VAT <> incl', v_inv.inv_number
      using errcode = 'P0001';
  end if;

  select journal_id, journal_ref
    into v_journal_id, v_journal_ref
    from public.fin_insert_posted_journal(
      'AR',
      'AR_INV',
      'Customer invoice ' || v_inv.inv_number,
      v_period_id,
      v_inv.inv_date,
      v_inv.inv_number,
      'AR',
      p_posted_by,
      p_entity_id
    );

  insert into public.fin_gl_journal_lines (
    journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
  )
  values
    (v_journal_id, 1, v_debtors_account, 'Debtors control - ' || v_inv.inv_number, v_inv.inv_amount_incl, 0, null, 0, v_customer.customer_code)
  returning line_id into v_debtors_line_id;

  insert into public.fin_gl_journal_lines (
    journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
  )
  values
    (v_journal_id, 2, v_revenue_account, v_inv.inv_description, 0, v_inv.inv_amount_excl, v_vat_code, v_inv.inv_vat, v_inv.inv_load_no)
  returning line_id into v_revenue_line_id;

  if coalesce(v_inv.inv_vat, 0) > 0 then
    insert into public.fin_gl_journal_lines (
      journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
    )
    values
      (v_journal_id, 3, v_vat_account, 'Output VAT - ' || v_inv.inv_number, 0, v_inv.inv_vat, v_vat_code, v_inv.inv_vat, v_inv.inv_number)
    returning line_id into v_vat_line_id;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_total_debit, v_total_credit
    from public.fin_gl_journal_lines
   where journal_id = v_journal_id;

  if abs(v_total_debit - v_total_credit) >= 0.01 then
    raise exception 'AR invoice journal % is not balanced: debit %, credit %', v_journal_ref, v_total_debit, v_total_credit
      using errcode = 'P0001';
  end if;

  v_ar_invoice_ref := public.fin_next_ref('ARI', v_inv.inv_date);

  insert into public.fin_ar_invoices (
    entity_id,
    invoice_ref,
    customer_code,
    customer_invoice_no,
    invoice_date,
    due_date,
    period_id,
    status,
    lp_load_number,
    subtotal_excl_vat,
    vat_amount,
    total_incl_vat,
    amount_received,
    balance_due,
    journal_id,
    document_ref,
    notes
  )
  values (
    p_entity_id,
    v_ar_invoice_ref,
    v_customer.customer_code,
    v_inv.inv_number,
    v_inv.inv_date,
    v_due_date,
    v_period_id,
    'POSTED',
    v_inv.inv_load_no,
    v_inv.inv_amount_excl,
    v_inv.inv_vat,
    v_inv.inv_amount_incl,
    0,
    v_inv.inv_amount_incl,
    v_journal_id,
    v_inv.inv_order_no,
    'Posted from LP invoice ' || v_inv.inv_number
  )
  returning invoice_id into v_ar_invoice_id;

  insert into public.fin_ar_invoice_lines (
    invoice_id,
    line_number,
    description,
    gl_account_code,
    lp_load_number,
    quantity,
    unit_rate,
    subtotal_excl_vat,
    vat_type,
    vat_amount,
    line_total_incl
  )
  values (
    v_ar_invoice_id,
    1,
    v_inv.inv_description,
    v_revenue_account,
    v_inv.inv_load_no,
    1,
    v_inv.inv_amount_excl,
    v_inv.inv_amount_excl,
    v_vat_code,
    v_inv.inv_vat,
    v_inv.inv_amount_incl
  );

  if coalesce(v_inv.inv_vat, 0) > 0 then
    select coalesce(rate_pct, 0)
      into v_vat_rate
      from public.fin_vat_types
     where vat_code = v_vat_code;

    insert into public.fin_vat_transactions (
      entity_id,
      vat_code,
      vat_direction,
      vat_period,
      transaction_date,
      tax_invoice_no,
      counterparty_name,
      exclusive_amount,
      vat_amount,
      inclusive_amount,
      gl_account_code,
      source_module,
      journal_id,
      line_id,
      is_capital_goods
    )
    values (
      p_entity_id,
      v_vat_code,
      'OUTPUT',
      to_char(v_inv.inv_date, 'YYYYMM'),
      v_inv.inv_date,
      v_inv.inv_number,
      v_customer.customer_name,
      v_inv.inv_amount_excl,
      v_inv.inv_vat,
      v_inv.inv_amount_incl,
      v_vat_account,
      'AR',
      v_journal_id,
      v_vat_line_id,
      false
    );
  end if;

  update public.lp_invoices
     set inv_status = 'FINAL',
         inv_approved_by = coalesce(inv_approved_by, p_posted_by),
         inv_approved_at = coalesce(inv_approved_at, now()),
         fin_ar_invoice_id = v_ar_invoice_id,
         fin_journal_id = v_journal_id,
         fin_posted_at = now(),
         fin_posted_by = p_posted_by,
         fin_posting_error = null,
         updated_at = now()
   where id = v_inv.id;

  perform public.fin_log_audit(
    'fin_ar_invoices',
    v_ar_invoice_id,
    'POST_AR_INVOICE',
    p_posted_by,
    jsonb_build_object('lp_invoice_id', v_inv.id, 'journal_id', v_journal_id, 'journal_ref', v_journal_ref)
  );

  return jsonb_build_object(
    'success', true,
    'lp_invoice_id', v_inv.id,
    'lp_invoice_number', v_inv.inv_number,
    'fin_ar_invoice_id', v_ar_invoice_id,
    'fin_ar_invoice_ref', v_ar_invoice_ref,
    'journal_id', v_journal_id,
    'journal_ref', v_journal_ref,
    'period_id', v_period_id,
    'customer_code', v_customer.customer_code
  );
end;
$$;

create or replace function public.fin_post_lp_credit_note(
  p_lp_credit_note_id integer,
  p_posted_by text,
  p_revenue_account text default null,
  p_vat_code text default null,
  p_entity_id integer default 1
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_cn public.lp_credit_notes%rowtype;
  v_lp_invoice public.lp_invoices%rowtype;
  v_customer record;
  v_period_id integer;
  v_revenue_account text;
  v_debtors_account text;
  v_vat_account text;
  v_vat_code text;
  v_journal_id integer;
  v_journal_ref text;
  v_vat_line_id integer;
  v_fin_cn_id integer;
  v_fin_cn_ref text;
  v_original_fin_invoice_id integer;
  v_total_debit numeric;
  v_total_credit numeric;
begin
  select *
    into v_cn
    from public.lp_credit_notes
   where id = p_lp_credit_note_id
   for update;

  if not found then
    raise exception 'LP credit note % not found', p_lp_credit_note_id using errcode = 'P0001';
  end if;

  if v_cn.fin_ar_credit_note_id is not null or v_cn.fin_journal_id is not null then
    return jsonb_build_object(
      'already_posted', true,
      'lp_credit_note_id', v_cn.id,
      'fin_ar_credit_note_id', v_cn.fin_ar_credit_note_id,
      'journal_id', v_cn.fin_journal_id
    );
  end if;

  select *
    into v_lp_invoice
    from public.lp_invoices
   where id = v_cn.cn_invoice_id
   for update;

  if not found then
    raise exception 'Original LP invoice % not found for credit note %', v_cn.cn_invoice_id, v_cn.cn_number
      using errcode = 'P0001';
  end if;

  if v_lp_invoice.fin_ar_invoice_id is null then
    raise exception 'Original LP invoice % has not been finance-posted', v_lp_invoice.inv_number
      using errcode = 'P0001';
  end if;

  v_original_fin_invoice_id := v_lp_invoice.fin_ar_invoice_id;

  select customer_code,
         customer_name,
         gl_control_account,
         default_vat_type
    into v_customer
    from public.fin_ar_customers
   where customer_code = v_cn.cn_customer
      or lp_client_code = v_cn.cn_customer
   order by case when customer_code = v_cn.cn_customer then 0 else 1 end
   limit 1;

  if v_customer.customer_code is null then
    raise exception 'No finance AR customer mapped for LP customer %', v_cn.cn_customer
      using errcode = 'P0001';
  end if;

  v_period_id := public.fin_period_for_date(v_cn.cn_date, p_entity_id);
  v_revenue_account := coalesce(nullif(trim(p_revenue_account), ''), public.fin_config_text('transport_revenue_account'));
  v_debtors_account := coalesce(nullif(trim(v_customer.gl_control_account), ''), public.fin_config_text('debtors_control_account'));
  v_vat_account := public.fin_config_text('vat_control_account');
  v_vat_code := coalesce(nullif(trim(p_vat_code), ''), nullif(trim(v_customer.default_vat_type), ''), public.fin_config_text('default_output_vat_code'));

  perform public.fin_assert_account(v_revenue_account, 'transport revenue credit reversal');
  perform public.fin_assert_account(v_debtors_account, 'debtors control credit reversal');
  if coalesce(v_cn.cn_vat, 0) > 0 then
    perform public.fin_assert_account(v_vat_account, 'VAT control credit reversal');
  end if;

  select journal_id, journal_ref
    into v_journal_id, v_journal_ref
    from public.fin_insert_posted_journal(
      'CN',
      'AR_CN',
      'Customer credit note ' || v_cn.cn_number,
      v_period_id,
      v_cn.cn_date,
      v_cn.cn_number,
      'AR',
      p_posted_by,
      p_entity_id
    );

  insert into public.fin_gl_journal_lines (
    journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
  )
  values
    (v_journal_id, 1, v_revenue_account, v_cn.cn_description, v_cn.cn_amount_excl, 0, v_vat_code, v_cn.cn_vat, v_cn.cn_load_no),
    (v_journal_id, 2, v_debtors_account, 'Debtors control reversal - ' || v_cn.cn_number, 0, v_cn.cn_amount_incl, null, 0, v_customer.customer_code);

  if coalesce(v_cn.cn_vat, 0) > 0 then
    insert into public.fin_gl_journal_lines (
      journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
    )
    values (
      v_journal_id,
      3,
      v_vat_account,
      'Output VAT reversal - ' || v_cn.cn_number,
      v_cn.cn_vat,
      0,
      v_vat_code,
      v_cn.cn_vat,
      v_cn.cn_number
    )
    returning line_id into v_vat_line_id;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_total_debit, v_total_credit
    from public.fin_gl_journal_lines
   where journal_id = v_journal_id;

  if abs(v_total_debit - v_total_credit) >= 0.01 then
    raise exception 'Credit note journal % is not balanced: debit %, credit %', v_journal_ref, v_total_debit, v_total_credit
      using errcode = 'P0001';
  end if;

  v_fin_cn_ref := public.fin_next_ref('ARC', v_cn.cn_date);

  insert into public.fin_ar_credit_notes (
    entity_id,
    cn_ref,
    customer_code,
    original_invoice_id,
    cn_date,
    period_id,
    reason,
    subtotal_excl_vat,
    vat_amount,
    total_incl_vat,
    status,
    journal_id
  )
  values (
    p_entity_id,
    v_fin_cn_ref,
    v_customer.customer_code,
    v_original_fin_invoice_id,
    v_cn.cn_date,
    v_period_id,
    v_cn.cn_reason,
    v_cn.cn_amount_excl,
    v_cn.cn_vat,
    v_cn.cn_amount_incl,
    'POSTED',
    v_journal_id
  )
  returning cn_id into v_fin_cn_id;

  update public.fin_ar_invoices
     set balance_due = greatest(0, coalesce(balance_due, 0) - v_cn.cn_amount_incl),
         status = case when greatest(0, coalesce(balance_due, 0) - v_cn.cn_amount_incl) < 0.01 then 'PAID' else 'PARTIAL' end
   where invoice_id = v_original_fin_invoice_id;

  if coalesce(v_cn.cn_vat, 0) > 0 then
    insert into public.fin_vat_transactions (
      entity_id,
      vat_code,
      vat_direction,
      vat_period,
      transaction_date,
      tax_invoice_no,
      counterparty_name,
      exclusive_amount,
      vat_amount,
      inclusive_amount,
      gl_account_code,
      source_module,
      journal_id,
      line_id,
      is_capital_goods
    )
    values (
      p_entity_id,
      v_vat_code,
      'OUTPUT',
      to_char(v_cn.cn_date, 'YYYYMM'),
      v_cn.cn_date,
      v_cn.cn_number,
      v_customer.customer_name,
      -v_cn.cn_amount_excl,
      -v_cn.cn_vat,
      -v_cn.cn_amount_incl,
      v_vat_account,
      'AR_CN',
      v_journal_id,
      v_vat_line_id,
      false
    );
  end if;

  update public.lp_credit_notes
     set cn_approved_by = coalesce(cn_approved_by, p_posted_by),
         cn_approved_at = coalesce(cn_approved_at, now()),
         fin_ar_credit_note_id = v_fin_cn_id,
         fin_journal_id = v_journal_id,
         fin_posted_at = now(),
         fin_posted_by = p_posted_by,
         fin_posting_error = null
   where id = v_cn.id;

  update public.lp_invoices
     set inv_status = 'CREDITED',
         updated_at = now()
   where id = v_lp_invoice.id;

  perform public.fin_log_audit(
    'fin_ar_credit_notes',
    v_fin_cn_id,
    'POST_AR_CREDIT_NOTE',
    p_posted_by,
    jsonb_build_object('lp_credit_note_id', v_cn.id, 'journal_id', v_journal_id, 'journal_ref', v_journal_ref)
  );

  return jsonb_build_object(
    'success', true,
    'lp_credit_note_id', v_cn.id,
    'lp_credit_note_number', v_cn.cn_number,
    'fin_ar_credit_note_id', v_fin_cn_id,
    'fin_ar_credit_note_ref', v_fin_cn_ref,
    'journal_id', v_journal_id,
    'journal_ref', v_journal_ref,
    'period_id', v_period_id,
    'customer_code', v_customer.customer_code
  );
end;
$$;

create or replace function public.fin_post_ap_invoice(
  p_ap_invoice_id integer,
  p_posted_by text,
  p_expense_account text default null,
  p_vat_code text default null,
  p_entity_id integer default 1
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_inv public.fin_ap_invoices%rowtype;
  v_supplier record;
  v_expense_account text;
  v_creditors_account text;
  v_vat_account text;
  v_vat_code text;
  v_journal_id integer;
  v_journal_ref text;
  v_vat_line_id integer;
  v_period_check integer;
  v_total_debit numeric;
  v_total_credit numeric;
begin
  select *
    into v_inv
    from public.fin_ap_invoices
   where invoice_id = p_ap_invoice_id
   for update;

  if not found then
    raise exception 'AP invoice % not found', p_ap_invoice_id using errcode = 'P0001';
  end if;

  if v_inv.status <> 'UNPOSTED' then
    return jsonb_build_object(
      'already_posted', v_inv.status = 'POSTED',
      'ap_invoice_id', v_inv.invoice_id,
      'status', v_inv.status,
      'journal_id', v_inv.journal_id
    );
  end if;

  select supplier_code,
         supplier_name,
         gl_control_account,
         default_vat_type
    into v_supplier
    from public.fin_suppliers
   where supplier_code = v_inv.supplier_code;

  if v_supplier.supplier_code is null then
    raise exception 'Supplier % not found for AP invoice %', v_inv.supplier_code, v_inv.invoice_ref
      using errcode = 'P0001';
  end if;

  v_period_check := public.fin_period_for_date(v_inv.invoice_date, coalesce(v_inv.entity_id, p_entity_id));
  if v_period_check <> v_inv.period_id then
    raise exception 'AP invoice period % does not match open period % for date %', v_inv.period_id, v_period_check, v_inv.invoice_date
      using errcode = 'P0001';
  end if;

  v_expense_account := nullif(trim(p_expense_account), '');
  if v_expense_account is null then
    raise exception 'p_expense_account is required for AP posting until AP invoice line accounts are implemented'
      using errcode = 'P0001';
  end if;

  v_creditors_account := coalesce(nullif(trim(v_supplier.gl_control_account), ''), public.fin_config_text('creditors_control_account'));
  v_vat_account := public.fin_config_text('vat_control_account');
  v_vat_code := coalesce(nullif(trim(p_vat_code), ''), nullif(trim(v_supplier.default_vat_type), ''), public.fin_config_text('default_input_vat_code'));

  perform public.fin_assert_account(v_expense_account, 'AP expense/asset');
  perform public.fin_assert_account(v_creditors_account, 'creditors control');
  if coalesce(v_inv.vat_amount, 0) > 0 then
    perform public.fin_assert_account(v_vat_account, 'VAT control');
  end if;

  if coalesce(v_inv.total_incl_vat, 0) <> round((coalesce(v_inv.subtotal_excl_vat, 0) + coalesce(v_inv.vat_amount, 0))::numeric, 2) then
    raise exception 'AP invoice % totals do not agree: excl + VAT <> incl', v_inv.invoice_ref
      using errcode = 'P0001';
  end if;

  select journal_id, journal_ref
    into v_journal_id, v_journal_ref
    from public.fin_insert_posted_journal(
      'AP',
      'AP_INV',
      'Supplier invoice ' || coalesce(v_inv.supplier_invoice_no, v_inv.invoice_ref),
      v_inv.period_id,
      v_inv.invoice_date,
      coalesce(v_inv.supplier_invoice_no, v_inv.invoice_ref),
      'AP',
      p_posted_by,
      coalesce(v_inv.entity_id, p_entity_id)
    );

  insert into public.fin_gl_journal_lines (
    journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
  )
  values
    (v_journal_id, 1, v_expense_account, 'Supplier invoice expense - ' || v_inv.invoice_ref, v_inv.subtotal_excl_vat, 0, v_vat_code, v_inv.vat_amount, v_inv.supplier_code),
    (v_journal_id, 2, v_creditors_account, 'Creditors control - ' || v_inv.invoice_ref, 0, v_inv.total_incl_vat, null, 0, v_inv.supplier_code);

  if coalesce(v_inv.vat_amount, 0) > 0 then
    insert into public.fin_gl_journal_lines (
      journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
    )
    values (
      v_journal_id,
      3,
      v_vat_account,
      'Input VAT - ' || v_inv.invoice_ref,
      v_inv.vat_amount,
      0,
      v_vat_code,
      v_inv.vat_amount,
      coalesce(v_inv.supplier_invoice_no, v_inv.invoice_ref)
    )
    returning line_id into v_vat_line_id;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_total_debit, v_total_credit
    from public.fin_gl_journal_lines
   where journal_id = v_journal_id;

  if abs(v_total_debit - v_total_credit) >= 0.01 then
    raise exception 'AP invoice journal % is not balanced: debit %, credit %', v_journal_ref, v_total_debit, v_total_credit
      using errcode = 'P0001';
  end if;

  update public.fin_ap_invoices
     set status = 'POSTED',
         journal_id = v_journal_id,
         balance_due = total_incl_vat - coalesce(amount_paid, 0) - coalesce(amount_written_off, 0)
   where invoice_id = v_inv.invoice_id;

  if coalesce(v_inv.vat_amount, 0) > 0 and not exists (
    select 1
      from public.fin_vat_transactions
     where source_module = 'AP'
       and tax_invoice_no = coalesce(v_inv.supplier_invoice_no, v_inv.invoice_ref)
       and vat_amount = v_inv.vat_amount
  ) then
    insert into public.fin_vat_transactions (
      entity_id,
      vat_code,
      vat_direction,
      vat_period,
      transaction_date,
      tax_invoice_no,
      counterparty_name,
      exclusive_amount,
      vat_amount,
      inclusive_amount,
      gl_account_code,
      source_module,
      journal_id,
      line_id,
      is_capital_goods
    )
    values (
      coalesce(v_inv.entity_id, p_entity_id),
      v_vat_code,
      'INPUT',
      to_char(v_inv.invoice_date, 'YYYYMM'),
      v_inv.invoice_date,
      coalesce(v_inv.supplier_invoice_no, v_inv.invoice_ref),
      v_supplier.supplier_name,
      v_inv.subtotal_excl_vat,
      v_inv.vat_amount,
      v_inv.total_incl_vat,
      v_vat_account,
      'AP',
      v_journal_id,
      v_vat_line_id,
      false
    );
  end if;

  perform public.fin_log_audit(
    'fin_ap_invoices',
    v_inv.invoice_id,
    'POST_AP_INVOICE',
    p_posted_by,
    jsonb_build_object('journal_id', v_journal_id, 'journal_ref', v_journal_ref)
  );

  return jsonb_build_object(
    'success', true,
    'ap_invoice_id', v_inv.invoice_id,
    'ap_invoice_ref', v_inv.invoice_ref,
    'journal_id', v_journal_id,
    'journal_ref', v_journal_ref
  );
end;
$$;

create or replace function public.fin_allocate_ar_receipt(
  p_receipt_id integer,
  p_invoice_id integer,
  p_amount numeric,
  p_created_by text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_receipt public.fin_ar_receipts%rowtype;
  v_invoice public.fin_ar_invoices%rowtype;
  v_alloc_id integer;
  v_amount numeric := round(p_amount, 2);
  v_alloc_ref text;
  v_new_receipt_allocated numeric;
  v_new_invoice_received numeric;
  v_new_balance numeric;
begin
  if v_amount <= 0 then
    raise exception 'Allocation amount must be positive' using errcode = 'P0001';
  end if;

  select * into v_receipt from public.fin_ar_receipts where receipt_id = p_receipt_id for update;
  if not found then raise exception 'AR receipt % not found', p_receipt_id using errcode = 'P0001'; end if;

  select * into v_invoice from public.fin_ar_invoices where invoice_id = p_invoice_id for update;
  if not found then raise exception 'AR invoice % not found', p_invoice_id using errcode = 'P0001'; end if;

  if v_receipt.customer_code <> v_invoice.customer_code then
    raise exception 'Receipt customer % does not match invoice customer %', v_receipt.customer_code, v_invoice.customer_code
      using errcode = 'P0001';
  end if;

  if v_amount > coalesce(v_invoice.balance_due, 0) then
    raise exception 'Allocation % exceeds invoice balance %', v_amount, v_invoice.balance_due
      using errcode = 'P0001';
  end if;

  if v_amount > coalesce(v_receipt.amount, 0) - coalesce(v_receipt.amount_allocated, 0) then
    raise exception 'Allocation % exceeds receipt unallocated amount', v_amount using errcode = 'P0001';
  end if;

  v_alloc_ref := public.fin_next_ref('ARA', current_date);

  insert into public.fin_ar_receipt_allocations (
    receipt_id,
    invoice_id,
    allocated_amount,
    allocation_date,
    allocation_ref,
    note,
    created_by
  )
  values (
    p_receipt_id,
    p_invoice_id,
    v_amount,
    current_date,
    v_alloc_ref,
    p_note,
    p_created_by
  )
  returning alloc_id into v_alloc_id;

  v_new_receipt_allocated := coalesce(v_receipt.amount_allocated, 0) + v_amount;
  v_new_invoice_received := coalesce(v_invoice.amount_received, 0) + v_amount;
  v_new_balance := greatest(0, coalesce(v_invoice.balance_due, 0) - v_amount);

  update public.fin_ar_receipts
     set amount_allocated = v_new_receipt_allocated,
         amount_unallocated = greatest(0, amount - v_new_receipt_allocated),
         fully_allocated = (greatest(0, amount - v_new_receipt_allocated) < 0.01)
   where receipt_id = p_receipt_id;

  update public.fin_ar_invoices
     set amount_received = v_new_invoice_received,
         balance_due = v_new_balance,
         status = case when v_new_balance < 0.01 then 'PAID' else 'PARTIAL' end
   where invoice_id = p_invoice_id;

  return jsonb_build_object(
    'success', true,
    'allocation_id', v_alloc_id,
    'allocation_ref', v_alloc_ref,
    'receipt_id', p_receipt_id,
    'invoice_id', p_invoice_id,
    'allocated_amount', v_amount
  );
end;
$$;

create or replace function public.fin_allocate_ap_payment(
  p_payment_id integer,
  p_invoice_id integer,
  p_amount numeric,
  p_created_by text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_payment public.fin_ap_payments%rowtype;
  v_invoice public.fin_ap_invoices%rowtype;
  v_alloc_id integer;
  v_amount numeric := round(p_amount, 2);
  v_alloc_ref text;
  v_new_payment_allocated numeric;
  v_new_invoice_paid numeric;
  v_new_balance numeric;
begin
  if v_amount <= 0 then
    raise exception 'Allocation amount must be positive' using errcode = 'P0001';
  end if;

  select * into v_payment from public.fin_ap_payments where payment_id = p_payment_id for update;
  if not found then raise exception 'AP payment % not found', p_payment_id using errcode = 'P0001'; end if;

  select * into v_invoice from public.fin_ap_invoices where invoice_id = p_invoice_id for update;
  if not found then raise exception 'AP invoice % not found', p_invoice_id using errcode = 'P0001'; end if;

  if v_payment.supplier_code <> v_invoice.supplier_code then
    raise exception 'Payment supplier % does not match invoice supplier %', v_payment.supplier_code, v_invoice.supplier_code
      using errcode = 'P0001';
  end if;

  if v_amount > coalesce(v_invoice.balance_due, 0) then
    raise exception 'Allocation % exceeds invoice balance %', v_amount, v_invoice.balance_due
      using errcode = 'P0001';
  end if;

  if v_amount > coalesce(v_payment.amount, 0) - coalesce(v_payment.amount_allocated, 0) then
    raise exception 'Allocation % exceeds payment unallocated amount', v_amount using errcode = 'P0001';
  end if;

  v_alloc_ref := public.fin_next_ref('APA', current_date);

  insert into public.fin_ap_payment_allocations (
    payment_id,
    invoice_id,
    allocated_amount,
    allocation_date,
    allocation_ref,
    note,
    created_by
  )
  values (
    p_payment_id,
    p_invoice_id,
    v_amount,
    current_date,
    v_alloc_ref,
    p_note,
    p_created_by
  )
  returning alloc_id into v_alloc_id;

  v_new_payment_allocated := coalesce(v_payment.amount_allocated, 0) + v_amount;
  v_new_invoice_paid := coalesce(v_invoice.amount_paid, 0) + v_amount;
  v_new_balance := greatest(0, coalesce(v_invoice.balance_due, 0) - v_amount);

  update public.fin_ap_payments
     set amount_allocated = v_new_payment_allocated,
         amount_unallocated = greatest(0, amount - v_new_payment_allocated),
         fully_allocated = (greatest(0, amount - v_new_payment_allocated) < 0.01)
   where payment_id = p_payment_id;

  update public.fin_ap_invoices
     set amount_paid = v_new_invoice_paid,
         balance_due = v_new_balance,
         status = case when v_new_balance < 0.01 then 'PAID' else 'PARTIAL' end
   where invoice_id = p_invoice_id;

  return jsonb_build_object(
    'success', true,
    'allocation_id', v_alloc_id,
    'allocation_ref', v_alloc_ref,
    'payment_id', p_payment_id,
    'invoice_id', p_invoice_id,
    'allocated_amount', v_amount
  );
end;
$$;

create or replace function public.fin_post_cashbook_staging(
  p_staging_id integer,
  p_posted_by text,
  p_entity_id integer default null
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_entry public.fin_cb_staging%rowtype;
  v_entity_id integer;
  v_period_id integer;
  v_bank_account text;
  v_contra_account text;
  v_vat_account text;
  v_vat_type record;
  v_is_receipt boolean;
  v_abs_amount numeric;
  v_vat_amount numeric := 0;
  v_excl_amount numeric;
  v_journal_id integer;
  v_journal_ref text;
  v_vat_line_id integer;
  v_total_debit numeric;
  v_total_credit numeric;
begin
  select *
    into v_entry
    from public.fin_cb_staging
   where staging_id = p_staging_id
   for update;

  if not found then
    raise exception 'Cashbook staging entry % not found', p_staging_id using errcode = 'P0001';
  end if;

  if v_entry.status = 'POSTED' or v_entry.journal_id is not null then
    return jsonb_build_object(
      'already_posted', true,
      'staging_id', v_entry.staging_id,
      'journal_id', v_entry.journal_id,
      'journal_ref', v_entry.journal_ref
    );
  end if;

  if nullif(trim(v_entry.gl_account_code), '') is null then
    raise exception 'GL account must be assigned before posting staging entry %', p_staging_id
      using errcode = 'P0001';
  end if;

  v_entity_id := coalesce(p_entity_id, v_entry.entity_id, 1);
  v_period_id := public.fin_period_for_date(v_entry.transaction_date, v_entity_id);
  v_bank_account := coalesce(nullif(trim(v_entry.bank_account), ''), public.fin_config_text('default_bank_account'));
  v_contra_account := v_entry.gl_account_code;
  v_vat_account := public.fin_config_text('vat_control_account');

  perform public.fin_assert_account(v_bank_account, 'cashbook bank account');
  perform public.fin_assert_account(v_contra_account, 'cashbook contra account');

  v_is_receipt := coalesce(v_entry.direction = 'RECEIPT', false) or v_entry.amount > 0;
  v_abs_amount := abs(v_entry.amount);

  if nullif(trim(coalesce(v_entry.vat_type, '')), '') is not null and v_entry.vat_type <> 'NONE' then
    select vat_code, vat_direction, rate_pct
      into v_vat_type
      from public.fin_vat_types
     where vat_code = v_entry.vat_type;

    if v_vat_type.vat_code is null then
      raise exception 'VAT type % does not exist', v_entry.vat_type using errcode = 'P0001';
    end if;

    perform public.fin_assert_account(v_vat_account, 'cashbook VAT control');
    v_vat_amount := round((v_abs_amount - (v_abs_amount / (1 + coalesce(v_vat_type.rate_pct, 0) / 100)))::numeric, 2);
  end if;

  v_excl_amount := round((v_abs_amount - v_vat_amount)::numeric, 2);

  select journal_id, journal_ref
    into v_journal_id, v_journal_ref
    from public.fin_insert_posted_journal(
      'CB',
      case when v_is_receipt then 'CB_REC' else 'CB_PAY' end,
      coalesce(nullif(trim(v_entry.journal_description), ''), v_entry.description),
      v_period_id,
      v_entry.transaction_date,
      v_entry.import_batch,
      'CASHBOOK',
      p_posted_by,
      v_entity_id
    );

  if v_is_receipt then
    insert into public.fin_gl_journal_lines (
      journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
    )
    values
      (v_journal_id, 1, v_bank_account, v_entry.description, v_abs_amount, 0, null, 0, v_entry.reference),
      (v_journal_id, 2, v_contra_account, coalesce(v_entry.journal_description, v_entry.description), 0, v_excl_amount, v_entry.vat_type, v_vat_amount, v_entry.reference);

    if v_vat_amount > 0 then
      insert into public.fin_gl_journal_lines (
        journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
      )
      values
        (v_journal_id, 3, v_vat_account, 'VAT on ' || v_entry.description, 0, v_vat_amount, v_entry.vat_type, v_vat_amount, v_entry.reference)
      returning line_id into v_vat_line_id;
    end if;
  else
    insert into public.fin_gl_journal_lines (
      journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
    )
    values
      (v_journal_id, 1, v_contra_account, coalesce(v_entry.journal_description, v_entry.description), v_excl_amount, 0, v_entry.vat_type, v_vat_amount, v_entry.reference),
      (v_journal_id, 2, v_bank_account, v_entry.description, 0, v_abs_amount, null, 0, v_entry.reference);

    if v_vat_amount > 0 then
      insert into public.fin_gl_journal_lines (
        journal_id, line_number, account_code, description, debit, credit, vat_type, vat_amount, reference
      )
      values
        (v_journal_id, 3, v_vat_account, 'VAT on ' || v_entry.description, v_vat_amount, 0, v_entry.vat_type, v_vat_amount, v_entry.reference)
      returning line_id into v_vat_line_id;
    end if;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_total_debit, v_total_credit
    from public.fin_gl_journal_lines
   where journal_id = v_journal_id;

  if abs(v_total_debit - v_total_credit) >= 0.01 then
    raise exception 'Cashbook journal % is not balanced: debit %, credit %', v_journal_ref, v_total_debit, v_total_credit
      using errcode = 'P0001';
  end if;

  if v_vat_amount > 0 then
    insert into public.fin_vat_transactions (
      entity_id,
      vat_code,
      vat_direction,
      vat_period,
      transaction_date,
      tax_invoice_no,
      counterparty_name,
      exclusive_amount,
      vat_amount,
      inclusive_amount,
      gl_account_code,
      source_module,
      journal_id,
      line_id,
      is_capital_goods
    )
    values (
      v_entity_id,
      v_entry.vat_type,
      v_vat_type.vat_direction,
      to_char(v_entry.transaction_date, 'YYYYMM'),
      v_entry.transaction_date,
      coalesce(v_entry.reference, v_journal_ref),
      null,
      v_excl_amount,
      v_vat_amount,
      v_abs_amount,
      v_vat_account,
      'CASHBOOK',
      v_journal_id,
      v_vat_line_id,
      false
    );
  end if;

  update public.fin_cb_staging
     set status = 'POSTED',
         journal_id = v_journal_id,
         journal_ref = v_journal_ref,
         posted_by = p_posted_by,
         posted_at = now()
   where staging_id = p_staging_id;

  perform public.fin_log_audit(
    'fin_cb_staging',
    p_staging_id,
    'POST_CASHBOOK_STAGING',
    p_posted_by,
    jsonb_build_object('journal_id', v_journal_id, 'journal_ref', v_journal_ref)
  );

  return jsonb_build_object(
    'success', true,
    'staging_id', p_staging_id,
    'journal_id', v_journal_id,
    'journal_ref', v_journal_ref,
    'period_id', v_period_id
  );
end;
$$;

revoke all on function public.fin_config_text(text) from public, anon, authenticated;
revoke all on function public.fin_next_ref(text, date) from public, anon, authenticated;
revoke all on function public.fin_period_for_date(date, integer) from public, anon, authenticated;
revoke all on function public.fin_assert_account(text, text) from public, anon, authenticated;
revoke all on function public.fin_insert_posted_journal(text, text, text, integer, date, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fin_log_audit(text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fin_post_lp_invoice(integer, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fin_post_lp_credit_note(integer, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fin_post_ap_invoice(integer, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.fin_allocate_ar_receipt(integer, integer, numeric, text, text) from public, anon, authenticated;
revoke all on function public.fin_allocate_ap_payment(integer, integer, numeric, text, text) from public, anon, authenticated;
revoke all on function public.fin_post_cashbook_staging(integer, text, integer) from public, anon, authenticated;

grant execute on function public.fin_post_lp_invoice(integer, text, text, text, integer) to service_role;
grant execute on function public.fin_post_lp_credit_note(integer, text, text, text, integer) to service_role;
grant execute on function public.fin_post_ap_invoice(integer, text, text, text, integer) to service_role;
grant execute on function public.fin_allocate_ar_receipt(integer, integer, numeric, text, text) to service_role;
grant execute on function public.fin_allocate_ap_payment(integer, integer, numeric, text, text) to service_role;
grant execute on function public.fin_post_cashbook_staging(integer, text, integer) to service_role;

commit;


-- =============================================================================
-- Post-run confirmation (read-only — run this immediately after the block above)
-- Expected results:
--   fin_posting_config  → 7 rows, transport_revenue_account = '1000'
--   posting functions   → 6 rows
--   lp_invoices columns → 4 rows (fin_ar_invoice_id, fin_journal_id,
--                                  fin_posted_at, fin_posted_by)
-- =============================================================================
select config_key, config_value
  from public.fin_posting_config
 order by config_key;

select routine_name
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name in (
     'fin_post_lp_invoice','fin_post_lp_credit_note','fin_post_ap_invoice',
     'fin_post_cashbook_staging','fin_allocate_ar_receipt','fin_allocate_ap_payment'
   )
 order by routine_name;

select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'lp_invoices'
   and column_name  like 'fin_%'
 order by column_name;
