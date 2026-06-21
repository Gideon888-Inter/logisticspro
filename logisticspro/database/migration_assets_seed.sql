-- ═══════════════════════════════════════════════════════════════
-- LP2.0 Migration: Asset Classes + Assets → Supabase (fin_ tables)
-- Run in Supabase SQL Editor
-- Safe to re-run — uses INSERT ... ON CONFLICT DO NOTHING
-- ═══════════════════════════════════════════════════════════════

-- ─── Reset sequences first ───────────────────────────────────
SELECT setval(pg_get_serial_sequence('fin_asset_classes','class_id'), COALESCE((SELECT MAX(class_id) FROM fin_asset_classes),0));
SELECT setval(pg_get_serial_sequence('fin_assets','asset_id'), COALESCE((SELECT MAX(asset_id) FROM fin_assets),0));

-- ─────────────────────────────────────────────────────────────
-- ASSET CLASSES (11 classes)
-- ─────────────────────────────────────────────────────────────

INSERT INTO fin_asset_classes (class_id, class_code, class_name, gl_cost_account, gl_accum_account, gl_depre_account, sars_wt_rate_pct, ifrs_useful_life_yr, ifrs_method, sars_section, active)
VALUES
  (1, 'FH', 'Fleet Horses', '6600 010', '6600 020', '3450 010', 20.0, 5, 'SL', 'Section 11(e)', True),
  (2, 'FT', 'Fleet Trailers', '6600 010', '6600 020', '3450 010', 20.0, 5, 'SL', 'Section 11(e)', True),
  (3, 'VH', 'Motor Vehicles', '6200 010', '6200 020', '3450 020', 20.0, 5, 'SL', 'Section 11(e)', True),
  (4, 'EP', 'Plant & Equipment', '6700 010', '6700 020', '3450 020', 20.0, 5, 'SL', 'Section 11(e)', True),
  (5, 'GE', 'Generator Units', '6850 010', '6850 020', '3450 020', 20.0, 5, 'SL', 'Section 11(e)', True),
  (6, 'FF', 'Furniture & Fittings', '6350 010', '6350 020', '3450 020', 16.67, 6, 'SL', 'Section 11(e)', True),
  (7, 'LH', 'Leasehold Improvements', '6750 010', '6750 020', '3450 020', 20.0, 5, 'SL', 'Section 11(e)', True),
  (8, 'PC', 'Computer Equipment', '6250 010', '6250 020', '3450 020', 33.33, 3, 'SL', 'Section 11(e)', True),
  (9, 'OF', 'Office Equipment', '6300 010', '6300 020', '3450 020', 20.0, 5, 'SL', 'Section 11(e)', True),
  (10, 'SO', 'Solar Equipment', '6800 010', '6800 020', '3450 020', 100.0, 1, 'SL', 'Section 12B', True),
  (11, 'TR', 'Tracking Equipment', '6250 010', '6250 020', '3450 020', 33.33, 3, 'SL', 'Section 11(e)', True)
ON CONFLICT (class_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- ASSETS (60 assets)
-- Columns mapped: asset_id, asset_code, description, class_code,
--   purchase_date, depre_start_date, purchase_price, vat_paid,
--   location, serial_number, reg_number,
--   tax_depre_prior, tax_depre_curr_yr, tax_depre_period, tax_value,
--   book_depre_total, book_depre_prior, book_depre_curr_yr, book_depre_period, book_nbv,
--   disposal_date, disposal_proceeds, is_active, fully_depreciated, created_at
-- ─────────────────────────────────────────────────────────────

INSERT INTO fin_assets (asset_id, asset_code, description, class_code, purchase_date, depre_start_date, purchase_price, location, reg_number, tax_depre_prior, tax_depre_curr_yr, tax_depre_period, tax_value, book_depre_total, book_depre_prior, book_depre_curr_yr, book_depre_period, book_nbv, disposal_date, disposal_proceeds, is_active, fully_depreciated)
VALUES
  (1, 'MH180', 'Volvo FH440', 'FH', '2023-12-06', '2023-12-01', 1984304.35, 'JHB', NULL, 620095.11, 562219.57, 33071.74, 801989.67, 523635.87, 413396.74, 176382.61, 33071.74, 1394525.0, NULL, NULL, True, False),
  (2, 'MH181', 'Volvo FH440', 'FH', '2023-12-06', '2023-12-01', 1984304.35, 'JHB', NULL, 620095.11, 562219.57, 33071.74, 801989.67, 523635.87, 413396.74, 176382.61, 33071.74, 1394525.0, NULL, NULL, True, False),
  (3, 'MH182', 'Volvo FH440', 'FH', '2023-12-14', '2024-01-01', 1944304.35, 'JHB', NULL, 607595.11, 550886.23, 32405.07, 785823.01, 513080.31, 405063.41, 172827.05, 32405.07, 1366413.9, NULL, NULL, True, False),
  (4, 'MH183', 'Volvo FH440', 'FH', '2024-02-05', '2024-02-01', 2014304.35, 'JHB', NULL, 545540.76, 570719.57, 33571.74, 898044.02, 475599.64, 363693.84, 179049.28, 33571.74, 1471561.23, NULL, NULL, True, False),
  (5, 'MH184', 'Volvo FH440', 'FH', '2024-02-05', '2024-02-01', 2014304.35, 'CT', NULL, 545540.76, 570719.57, 33571.74, 898044.02, 475599.64, 363693.84, 179049.28, 33571.74, 1471561.23, NULL, NULL, True, False),
  (6, 'MH185', 'Volvo FH440', 'FH', '2024-06-10', '2024-06-01', 2134304.35, 'CT', NULL, 400182.07, 604719.57, 35571.74, 1129402.72, 385360.51, 266788.04, 189715.94, 35571.74, 1677800.36, NULL, NULL, True, False),
  (7, 'MH186', 'Volvo FH440', 'FH', '2024-06-10', '2024-06-01', 2064304.35, 'CT', NULL, 387057.07, 584886.23, 34405.07, 1092361.06, 372721.62, 258038.04, 183493.72, 34405.07, 1622772.59, NULL, NULL, True, False),
  (8, 'MH187', 'Volvo FH440', 'FH', '2024-08-31', '2024-09-01', 2064304.35, 'JHB', NULL, 258038.04, 584886.23, 34405.07, 1221380.08, 286708.94, 172025.36, 183493.72, 34405.07, 1708785.27, NULL, NULL, True, False),
  (9, 'MH188', 'Volvo FH440', 'FH', '2024-08-31', '2024-09-01', 2064304.35, 'JHB', NULL, 258038.04, 584886.23, 34405.07, 1221380.08, 286708.94, 172025.36, 183493.72, 34405.07, 1708785.27, NULL, NULL, True, False),
  (10, 'MH189', 'Volvo FH440', 'FH', '2024-08-31', '2024-09-01', 2064304.35, 'CT', NULL, 258038.04, 584886.23, 34405.07, 1221380.08, 286708.94, 172025.36, 183493.72, 34405.07, 1708785.27, NULL, NULL, True, False),
  (11, 'MH190', 'Volvo FH440', 'FH', '2024-10-03', '2024-10-01', 1511804.35, 'JHB', NULL, 157479.62, 428344.57, 25196.74, 925980.16, 188975.54, 104986.41, 134382.61, 25196.74, 1272435.33, NULL, NULL, True, False),
  (12, 'MH191', 'Volvo FH440', 'FH', '2024-10-03', '2024-10-01', 1661804.35, 'JHB', NULL, 173104.62, 470844.57, 27696.74, 1017855.16, 207725.54, 115403.08, 147715.94, 27696.74, 1398685.33, NULL, NULL, True, False),
  (13, 'MH192', 'Volvo FH440', 'FH', '2024-11-13', '2024-12-01', 1661804.35, 'CT', NULL, 138483.7, 470844.57, 27696.74, 1052476.09, 184644.93, 92322.46, 147715.94, 27696.74, 1421765.94, NULL, NULL, True, False),
  (14, 'MH193', 'Volvo FH440', 'FH', '2024-11-13', '2024-12-01', 1661804.35, 'CT', NULL, 138483.7, 470844.57, 27696.74, 1052476.09, 184644.93, 92322.46, 147715.94, 27696.74, 1421765.94, NULL, NULL, True, False),
  (15, 'MH195', 'Volvo FH440', 'FH', '2025-06-30', '2025-07-01', 2160000.0, 'JHB', NULL, 0.0, 441000.0, 36000.0, 1719000.0, 30000.0, 0.0, 66000.0, 36000.0, 2094000.0, NULL, NULL, True, False),
  (16, 'MH196', 'Volvo FH440', 'FH', '2025-09-01', '2025-09-01', 2164304.35, 'JHB', NULL, 0.0, 306609.78, 36071.74, 1857694.57, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (17, 'MH197', 'Volvo FH440', 'FH', '2025-09-01', '2025-09-01', 2164304.35, 'CT', NULL, 0.0, 306609.78, 36071.74, 1857694.57, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (18, 'MH198', 'Volvo FH440', 'FH', '2025-09-01', '2025-09-01', 2164304.35, 'CT', NULL, 0.0, 306609.78, 36071.74, 1857694.57, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (19, 'MH199', 'Volvo FH440', 'FH', '2025-09-01', '2025-09-01', 2164304.35, 'JHB', NULL, 0.0, 306609.78, 36071.74, 1857694.57, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (20, 'MH200', 'Volvo FH440', 'FH', '2025-12-01', '2025-12-01', 2164304.35, 'JHB', NULL, 0.0, 171340.76, 36071.74, 1992963.59, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (21, 'MH201', 'Volvo FH440', 'FH', '2025-12-01', '2025-12-01', 2164304.35, 'CT', NULL, 0.0, 171340.76, 36071.74, 1992963.59, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (22, 'MH202', 'Volvo FH440', 'FH', '2025-12-01', '2025-12-01', 2164304.35, 'CT', NULL, 0.0, 171340.76, 36071.74, 1992963.59, 0.0, 0.0, 36071.74, 36071.74, 2128232.61, NULL, NULL, True, False),
  (23, 'RH10', 'Volvo FH440', 'FH', '2025-07-22', '2025-08-01', 2160000.0, 'JHB', NULL, 0.0, 396000.0, 36000.0, 1764000.0, 360000.0, 0.0, 396000.0, 36000.0, 1764000.0, NULL, NULL, True, False),
  (24, 'RH11', 'Volvo FH440', 'FH', '2025-07-22', '2025-08-01', 2160000.0, 'JHB', NULL, 0.0, 396000.0, 36000.0, 1764000.0, 360000.0, 0.0, 396000.0, 36000.0, 1764000.0, NULL, NULL, True, False),
  (25, 'BT01/BT02', 'Box Link Conversion', 'FT', '2023-10-03', '2023-10-01', 368800.0, 'JHB', NULL, 130616.67, 104493.34, 6146.67, 133689.99, 107566.67, 87077.78, 32782.23, 6146.67, 248939.99, NULL, NULL, True, False),
  (26, 'BT015/016', 'Box Link Conversion', 'FT', '2024-10-24', '2024-11-01', 362000.0, 'JHB', NULL, 37708.33, 102566.66, 6033.33, 221725.01, 45250.0, 25138.89, 32177.77, 6033.33, 304683.34, NULL, NULL, True, False),
  (27, 'BT02/BT03', 'Box Link Conversion', 'FT', '2024-01-29', '2024-02-01', 362000.0, 'CT', NULL, 105583.33, 102566.66, 6033.33, 153850.01, 90500.0, 70388.89, 32177.77, 6033.33, 259433.34, NULL, NULL, True, False),
  (28, 'BT04/BT05', 'Box Link Conversion', 'FT', '2024-04-04', '2024-04-01', 383720.0, 'CT', NULL, 87935.83, 108720.66, 6395.33, 187063.51, 79941.67, 58623.89, 34108.44, 6395.33, 290987.67, NULL, NULL, True, False),
  (29, 'BT06/BT07', 'Box Link Conversion', 'FT', '2024-05-30', '2024-06-01', 362000.0, 'JHB', NULL, 75416.67, 102566.66, 6033.33, 184016.67, 70388.89, 50277.78, 32177.77, 6033.33, 279544.45, NULL, NULL, True, False),
  (30, 'BT08/BT09', 'Box Link Conversion', 'FT', '2024-06-30', '2024-07-01', 362000.0, 'JHB', NULL, 67875.0, 102566.66, 6033.33, 191558.34, 65361.11, 45250.0, 32177.77, 6033.33, 284572.23, NULL, NULL, True, False),
  (31, 'BT10/BT11', 'Box Link Conversion', 'FT', '2024-09-16', '2024-10-01', 362000.0, 'CT', NULL, 45250.0, 102566.66, 6033.33, 214183.34, 50277.78, 30166.67, 32177.77, 6033.33, 299655.56, NULL, NULL, True, False),
  (32, 'BT13/14', 'Box Link Conversion', 'FT', '2024-09-16', '2024-10-01', 362000.0, 'CT', NULL, 45250.0, 102566.66, 6033.33, 214183.34, 50277.78, 30166.67, 32177.77, 6033.33, 299655.56, NULL, NULL, True, False),
  (33, 'BT25/26', 'Box Link Conversion', 'FT', '2024-11-25', '2024-12-01', 362000.0, 'JHB', NULL, 30166.67, 102566.66, 6033.33, 229266.67, 40222.22, 20111.11, 32177.77, 6033.33, 309711.12, NULL, NULL, True, False),
  (34, 'BT29', 'Cobalt Pantech Conversion ST14', 'FT', '2025-03-12', '2025-04-01', 401999.98, 'JHB', NULL, 0.0, 113899.99, 6700.0, 288099.98, 22333.33, 0.0, 35733.33, 6700.0, 366266.65, NULL, NULL, True, False),
  (35, 'BT31/32', 'Cobalt Pantech Conversion ST09', 'FT', '2025-05-06', '2025-05-01', 379999.98, 'CT', NULL, 0.0, 85499.99, 6333.33, 294499.99, 10555.56, 0.0, 16888.89, 6333.33, 363111.1, NULL, NULL, True, False),
  (36, 'BT33/34', 'Cobalt Pantech Conversion ST06', 'FT', '2025-05-27', '2025-06-01', 379999.98, 'CT', NULL, 0.0, 85499.99, 6333.33, 294499.99, 10555.56, 0.0, 16888.89, 6333.33, 363111.1, NULL, NULL, True, False),
  (37, 'BT35/36', 'Cobalt Pantech Conversion', 'FT', '2025-07-07', '2025-07-01', 379999.98, 'JHB', NULL, 0.0, 69666.66, 6333.33, 310333.32, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (38, 'BT37/38', 'Cobalt Pantech Conversion', 'FT', '2025-08-01', '2025-08-01', 379999.98, 'JHB', NULL, 0.0, 61749.99, 6333.33, 318249.99, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (39, 'BT39/40', 'Cobalt Pantech Conversion', 'FT', '2025-08-11', '2025-09-01', 379999.98, 'CT', NULL, 0.0, 61749.99, 6333.33, 318249.99, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (40, 'BT41/42', 'Cobalt Pantech Conversion', 'FT', '2025-09-02', '2025-09-01', 379999.98, 'CT', NULL, 0.0, 53833.33, 6333.33, 326166.65, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (41, 'BT43/44', 'Cobalt Pantech Conversion', 'FT', '2025-09-22', '2025-10-01', 379999.98, 'JHB', NULL, 0.0, 53833.33, 6333.33, 326166.65, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (42, 'BT45/46', 'Box Link Conversion ST27', 'FT', '2025-10-24', '2025-11-01', 379999.98, 'JHB', NULL, 0.0, 45916.66, 6333.33, 334083.32, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (43, 'BT47/48', 'Box Link Conversion ST95', 'FT', '2026-02-01', '2026-02-01', 379999.98, 'CT', NULL, 0.0, 14250.0, 6333.33, 365749.98, 0.0, 0.0, 6333.33, 6333.33, 373666.65, NULL, NULL, True, False),
  (44, 'ST153/154', 'Afrit S/Link Tautliner', 'FT', '2025-09-16', '2025-10-01', 350000.0, 'CT', NULL, 0.0, 49583.33, 5833.33, 300416.67, 43750.0, 0.0, 49583.33, 5833.33, 300416.67, NULL, NULL, True, False),
  (45, 'ST154/155', 'SA Truck Body Superlink', 'FT', '2023-03-06', '2023-03-01', 1042204.35, 'JHB', NULL, 521102.17, 295291.23, 17370.07, 225810.95, 405301.69, 347401.45, 92640.38, 17370.07, 602162.52, NULL, NULL, True, False),
  (46, 'VH17', 'Isuzu D-Max 250 Fleetside', 'VH', '2021-12-02', '2021-12-01', 295652.17, 'JHB', NULL, 192173.91, 68985.51, 4927.54, 34492.75, 251304.34, 192173.91, 68985.51, 4927.54, 34492.75, NULL, NULL, True, False),
  (47, 'VH19', 'VW Toureg', 'VH', '2023-03-09', '2023-03-01', 1542600.0, 'CT', NULL, 617040.0, 359940.0, 25710.0, 565620.0, 925560.0, 617040.0, 359940.0, 25710.0, 565620.0, NULL, NULL, True, False),
  (48, 'VH20', 'Ford Raptor 2023', 'VH', '2023-03-01', '2023-03-01', 1151146.75, 'JHB', NULL, 460458.7, 268600.91, 19185.78, 422087.14, 690688.05, 460458.7, 268600.91, 19185.78, 422087.14, NULL, NULL, True, False),
  (49, 'VH21', 'Ford Wildtrak 2023', 'VH', '2023-03-13', '2023-04-01', 1104850.0, 'JHB', NULL, 441940.0, 257798.34, 18414.17, 405111.66, 662910.0, 441940.0, 257798.34, 18414.17, 405111.66, NULL, NULL, True, False),
  (50, 'VH22', 'Ford Ranger XL', 'VH', '2023-03-29', '2023-04-01', 661112.5, 'CT', NULL, 264445.0, 154259.58, 11018.54, 242407.92, 396667.5, 264445.0, 154259.58, 11018.54, 242407.92, NULL, NULL, True, False),
  (51, 'GE01', 'CT Generator Unit - Standby', 'GE', '2020-01-29', '2020-02-01', 184437.5, 'CT', NULL, 63528.47, 18443.75, 3073.96, 102465.27, 75824.31, 63528.47, 18443.75, 3073.96, 102465.27, NULL, NULL, True, False),
  (52, 'GE02', 'Additional CT Yard Generator', 'GE', '2022-10-06', '2022-10-01', 16517.39, 'CT', NULL, 2661.14, 1651.74, 275.29, 12204.52, 0.0, 0.0, 550.58, 275.29, 15966.81, NULL, NULL, True, False),
  (53, 'GE03', 'Additional Jhb Yard Generator', 'GE', '2024-04-22', '2024-05-01', 80000.0, 'JHB', NULL, 4888.89, 7999.99, 1333.33, 67111.12, 0.0, 0.0, 2666.66, 1333.33, 77333.34, NULL, NULL, True, False),
  (54, 'SO02', 'Solar Solutions - CT', 'SO', '2020-12-24', '2021-01-01', 283632.5, 'CT', NULL, 283632.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, NULL, NULL, True, True),
  (55, 'SO12', 'Solar Additions Feb-24', 'SO', '2024-02-29', '2024-03-01', 37920.0, 'CT', NULL, 37920.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, NULL, NULL, True, True),
  (56, 'SO13', 'Solar Additions Apr-24', 'SO', '2024-04-15', '2024-05-01', 58902.0, 'JHB', NULL, 58902.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, NULL, NULL, True, True),
  (57, 'PC35', 'Ryan New Laptop', 'PC', '2024-09-25', '2024-10-01', 17476.52, 'JHB', NULL, 2912.75, 6796.33, 485.41, 7767.44, 0.0, 0.0, 970.92, 485.46, 16505.6, NULL, NULL, True, False),
  (58, 'PC36', 'Lenovo IdeaPad Slim', 'PC', '2025-02-07', '2025-02-01', 9500.0, 'CT', NULL, 263.89, 3694.39, 263.86, 5541.72, 0.0, 0.0, 527.78, 263.89, 8972.22, NULL, NULL, True, False),
  (59, 'PC37', 'Laptop Lenovo', 'PC', '2025-02-18', '2025-03-01', 8179.0, 'JHB', NULL, 227.19, 3180.67, 227.17, 4771.13, 0.0, 0.0, 454.38, 227.19, 7724.62, NULL, NULL, True, False),
  (60, 'PC38', 'Laptop Vanessa', 'PC', '2024-09-25', '2024-10-01', 18260.0, 'CT', NULL, 3043.33, 7101.01, 507.17, 8115.66, 0.0, 0.0, 1014.44, 507.22, 17245.56, NULL, NULL, True, False)
ON CONFLICT (asset_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Fix sequences after bulk insert
-- ─────────────────────────────────────────────────────────────
SELECT setval(pg_get_serial_sequence('fin_asset_classes','class_id'), (SELECT MAX(class_id) FROM fin_asset_classes));
SELECT setval(pg_get_serial_sequence('fin_assets','asset_id'), (SELECT MAX(asset_id) FROM fin_assets));

-- ─────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────
SELECT class_code, class_name, COUNT(a.asset_id) AS asset_count
FROM fin_asset_classes c
LEFT JOIN fin_assets a USING (class_code)
GROUP BY c.class_id, c.class_code, c.class_name
ORDER BY c.class_id;
