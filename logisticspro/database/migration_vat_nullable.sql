-- migration_vat_nullable.sql
-- Make journal_id and line_id nullable in fin_vat_transactions
-- These columns are NOT NULL by default but AP invoices and future
-- non-journal VAT entries (e.g. imported VAT) don't always have a GL journal.
-- Run this in the Supabase SQL Editor before deploying the latest finance.js.

ALTER TABLE fin_vat_transactions
  ALTER COLUMN journal_id DROP NOT NULL,
  ALTER COLUMN line_id    DROP NOT NULL;

-- Verify
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'fin_vat_transactions'
  AND column_name IN ('journal_id', 'line_id');
