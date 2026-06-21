# LP2.0 Financial Engine

Standalone Python/SQLite financial management system for Interland Distribution Cape (Pty) Ltd.
Built as a replacement for Sage Evolution. Runs independently of the Node.js/React LP2.0 stack.

## Structure

```
financial/
├── engines/
│   ├── depreciation_engine.py     # IFRS (IAS 16) + SARS dual depreciation
│   ├── journal_engine.py          # GL journal posting + VAT stamping
│   ├── statement_engine.py        # Customer statement PDF generation
│   ├── period_end_engine.py       # Period locking, VAT periods, year-end close
│   └── cashbook_engine.py         # Cashbook import, bank recon, AR/AP allocation
└── migrations/
    ├── lp2_schema_final.sql       # Full DB schema — 18 tables, 4 views (run first)
    ├── lp2_seed_data.sql          # CoA (168 accounts), suppliers (293), assets (60)
    ├── lp2_period_end_migration.sql # VAT period tables, bank recon, cashbook
    └── lp2_v2_migration.sql       # Multi-entity support, enhanced AR/AP allocation
```

## Setup

```bash
pip install python-dateutil reportlab

# Create and seed the database
sqlite3 lp2.db < migrations/lp2_schema_final.sql
sqlite3 lp2.db < migrations/lp2_seed_data.sql
sqlite3 lp2.db < migrations/lp2_period_end_migration.sql
sqlite3 lp2.db < migrations/lp2_v2_migration.sql
```

## Validation Benchmarks (FY2026 Feb run)

| Check | Expected |
|-------|----------|
| GL accounts | 168 |
| Suppliers | 293 |
| Active assets | 60 |
| Feb 2026 book depreciation | R 1,034,774.24 |
| Feb 2026 tax depreciation | R 1,034,774.09 |
| AR customers | 290 |

## Key Policies

- **Financial year:** March–February (FY2026 = Mar 2025 – Feb 2026)
- **VAT:** Single control account 9500 — input and output both post here
- **Depreciation start:** Purchased ≤10th → starts 1st same month; >10th → 1st next month
- **No hard rollovers:** Year-end posts summary YE journal, all originals intact
- **VAT direction:** Fixed by `source_module` at posting time — never inferred from debit/credit
- **Journals:** Immutable once posted — reverse to correct, never edit

See `README_LP2_FINANCIAL.md` in the original build packages for full business rules.
