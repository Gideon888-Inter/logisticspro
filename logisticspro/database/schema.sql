-- LogisticsPro Database Schema
-- Run this in Supabase SQL Editor at supabase.com
-- Based on the original SQL Server backup (LogisticsPro-2019)

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- BUSINESS UNITS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_business_units (
  bu_code        VARCHAR(10)  PRIMARY KEY,
  bu_name        VARCHAR(100) NOT NULL,
  bu_active      CHAR(1)      NOT NULL DEFAULT 'Y'
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_customers (
  c_code         VARCHAR(10)  PRIMARY KEY,
  c_name         VARCHAR(100) NOT NULL,
  c_active       CHAR(1)      NOT NULL DEFAULT 'Y',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lp_customer_contact (
  cc_no          SERIAL       PRIMARY KEY,
  cc_customer    VARCHAR(10)  NOT NULL REFERENCES lp_customers(c_code),
  cc_name        VARCHAR(100),
  cc_email       VARCHAR(150),
  cc_cell        VARCHAR(20),
  cc_pod         CHAR(1)      DEFAULT 'N'
);

-- ============================================================
-- VEHICLES
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_vehicles (
  vh_code           VARCHAR(10)  PRIMARY KEY,
  vh_type           VARCHAR(20)  NOT NULL CHECK (vh_type IN ('Horse','Trailer','Rigid')),
  vh_bus_unit       VARCHAR(10)  REFERENCES lp_business_units(bu_code),
  vh_active         CHAR(1)      NOT NULL DEFAULT 'Y',
  vh_odometer       INT          DEFAULT 0,
  vh_next_service   INT          DEFAULT 0,
  vh_next_wheel     INT          DEFAULT 0,
  vh_status         VARCHAR(30)  DEFAULT 'AVAILABLE',
  vh_status_load    VARCHAR(20),
  vh_last_location  VARCHAR(100),
  vh_last_location_date DATE,
  vh_cell           VARCHAR(20),
  vh_disposal_date  DATE
);

-- ============================================================
-- DRIVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_drivers (
  d_id           VARCHAR(20)  PRIMARY KEY,
  d_nickname     VARCHAR(90)  NOT NULL,
  d_cell         VARCHAR(20),
  d_active       CHAR(1)      NOT NULL DEFAULT 'Y',
  d_bus_unit     VARCHAR(10)  REFERENCES lp_business_units(bu_code),
  d_receipt      CHAR(1)      DEFAULT 'N'
);

-- ============================================================
-- ROUTES
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_route (
  rc_no          SERIAL       PRIMARY KEY,
  rc_code        VARCHAR(10)  UNIQUE,
  rc_from        VARCHAR(100),
  rc_to          VARCHAR(100),
  rc_distance    INT          DEFAULT 0,
  rc_rate        NUMERIC(10,2) DEFAULT 0
);

-- ============================================================
-- LOADS / MOVEMENT (main table)
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_movement (
  m_load_no        VARCHAR(20)  PRIMARY KEY,
  m_load_suffix    INT          DEFAULT 0,
  m_date           DATE         NOT NULL DEFAULT CURRENT_DATE,
  m_truck          VARCHAR(10)  REFERENCES lp_vehicles(vh_code),
  m_driver_id      VARCHAR(90),
  m_customer       VARCHAR(10)  REFERENCES lp_customers(c_code),
  m_from           VARCHAR(100),
  m_to             VARCHAR(100),
  m_route_code     VARCHAR(10),
  m_starting_km    INT          DEFAULT 0,
  m_complete_km    INT          DEFAULT 0,
  m_total_km       INT          DEFAULT 0,
  m_rate           NUMERIC(10,2) DEFAULT 0,
  m_extras         NUMERIC(10,2) DEFAULT 0,
  m_load_total     NUMERIC(10,2) DEFAULT 0,
  m_order_no       VARCHAR(45),
  m_invoice        VARCHAR(45),
  m_jobcard        VARCHAR(15),
  m_status         VARCHAR(30)  NOT NULL DEFAULT 'PRELOAD'
                                CHECK (m_status IN (
                                  'PRELOAD','EN_ROUTE','OFFLOADED',
                                  'WAIT_ORDER_NO','WAIT_APPROVAL','WAIT_POD_SCAN',
                                  'WAIT_INVOICE_NO','LOAD_INVOICED','WAIT_PROCESSING',
                                  'REJECTED','DELETED'
                                )),
  m_comment        VARCHAR(500),
  m_external       VARCHAR(5),
  m_external_client VARCHAR(3),
  m_operator       VARCHAR(45),
  m_bus_unit       VARCHAR(10)  REFERENCES lp_business_units(bu_code),
  m_a_offloaded_time TIMESTAMPTZ,
  m_s_offload_time   TIMESTAMPTZ,
  m_app_time         TIMESTAMPTZ  DEFAULT NOW(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PRELOADS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_preload (
  id             SERIAL       PRIMARY KEY,
  pl_truck       VARCHAR(10)  REFERENCES lp_vehicles(vh_code),
  pl_driver      VARCHAR(90),
  pl_customer    VARCHAR(10)  REFERENCES lp_customers(c_code),
  pl_from        VARCHAR(100),
  pl_to          VARCHAR(100),
  pl_date        DATE,
  pl_rate        NUMERIC(10,2),
  pl_status      VARCHAR(20)  DEFAULT 'PENDING',
  pl_operator    VARCHAR(45),
  pl_bus_unit    VARCHAR(10)  REFERENCES lp_business_units(bu_code),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUB-CONTRACTORS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_sub_cont (
  s_code         VARCHAR(10)  PRIMARY KEY,
  s_name         VARCHAR(100),
  s_cell         VARCHAR(20),
  s_active       CHAR(1)      DEFAULT 'Y'
);

-- ============================================================
-- COSTS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_costs (
  c_cost_no      SERIAL       PRIMARY KEY,
  c_load         VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  c_description  VARCHAR(200),
  c_amount       NUMERIC(10,2) DEFAULT 0,
  c_code         VARCHAR(10),
  c_operator     VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EXTRAS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_extras (
  x_id           SERIAL       PRIMARY KEY,
  x_load         VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  x_description  VARCHAR(200),
  x_amount       NUMERIC(10,2) DEFAULT 0,
  x_operator     VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COMMENTS (load audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_comments (
  id             SERIAL       PRIMARY KEY,
  c_load         VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  c_comment      VARCHAR(500),
  c_time         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  c_logged_by    VARCHAR(45)
);

-- ============================================================
-- EVENTS (incidents / fuel)
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_events (
  id              SERIAL       PRIMARY KEY,
  e_load_no       VARCHAR(20)  REFERENCES lp_movement(m_load_no),
  e_driver_name   VARCHAR(90),
  e_type          VARCHAR(50),
  e_vehicle       VARCHAR(10),
  e_date          DATE,
  e_time          TIMESTAMPTZ,
  e_description   VARCHAR(500),
  e_user          VARCHAR(45),
  e_operator      VARCHAR(45),
  e_station       VARCHAR(100),
  e_order_no      VARCHAR(45),
  e_litres        NUMERIC(8,2),
  e_severity      VARCHAR(45),
  e_status        VARCHAR(20)  DEFAULT 'OPEN'
);

-- ============================================================
-- MAINTENANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_maintenance (
  ma_incident_no  SERIAL       PRIMARY KEY,
  ma_vehicle      VARCHAR(10)  REFERENCES lp_vehicles(vh_code),
  ma_date         DATE         DEFAULT CURRENT_DATE,
  ma_service_type VARCHAR(100),
  ma_supplier     VARCHAR(100),
  ma_km           INT          DEFAULT 0,
  ma_labour       NUMERIC(10,2) DEFAULT 0,
  ma_markup       NUMERIC(10,2) DEFAULT 0,
  ma_next_service INT          DEFAULT 0,
  ma_status       VARCHAR(20)  DEFAULT 'OPEN',
  ma_operator     VARCHAR(45),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- JOB CARD HEADERS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_jobcard_header (
  id             SERIAL       PRIMARY KEY,
  jh_vehicle     VARCHAR(10)  REFERENCES lp_vehicles(vh_code),
  jh_date        DATE         DEFAULT CURRENT_DATE,
  jh_description VARCHAR(200),
  jh_status      VARCHAR(20)  DEFAULT 'OPEN',
  jh_operator    VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- JOB CARDS (parts rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_jobcards (
  id             SERIAL       PRIMARY KEY,
  j_headerno     INT          REFERENCES lp_jobcard_header(id),
  j_partno       VARCHAR(50),
  j_description  VARCHAR(200),
  j_description_long VARCHAR(500),
  j_quantity     INT          DEFAULT 1,
  j_price        NUMERIC(10,2) DEFAULT 0,
  j_markup       NUMERIC(5,2) DEFAULT 0,
  j_line_total   NUMERIC(10,2) DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INVENTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_inventory (
  l_id           SERIAL       PRIMARY KEY,
  p_partno       VARCHAR(50)  UNIQUE,
  p_description  VARCHAR(200),
  p_qty          INT          DEFAULT 0,
  p_min          INT          DEFAULT 0,
  p_max          INT          DEFAULT 0,
  p_suppliera    VARCHAR(50),
  p_supplierb    VARCHAR(50),
  p_leadtime     INT          DEFAULT 0,
  p_invoice      VARCHAR(20),
  p_row          VARCHAR(10),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- LEAVE
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_leave (
  id             SERIAL       PRIMARY KEY,
  l_driver       VARCHAR(20)  REFERENCES lp_drivers(d_id),
  l_from         DATE,
  l_to           DATE,
  l_reason       VARCHAR(200),
  l_approved     CHAR(1)      DEFAULT 'N',
  l_operator     VARCHAR(45),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_users (
  u_id           SERIAL       PRIMARY KEY,
  u_username     VARCHAR(45)  UNIQUE NOT NULL,
  u_password     VARCHAR(200) NOT NULL,
  u_name         VARCHAR(100),
  u_email        VARCHAR(150),
  u_role         VARCHAR(20)  DEFAULT 'OPERATOR'
                              CHECK (u_role IN ('ADMIN','MANAGER','OPERATOR','READONLY')),
  u_bus_unit     VARCHAR(10)  REFERENCES lp_business_units(bu_code),
  u_active       CHAR(1)      DEFAULT 'Y',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REPORTS / EMAIL QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_reports (
  lp_report_no     SERIAL      PRIMARY KEY,
  lp_report_type   VARCHAR(10),
  lp_report_email  VARCHAR(150),
  lp_generated     CHAR(1)     DEFAULT 'N',
  lp_report_heading VARCHAR(200),
  lp_input         VARCHAR(200),
  lp_last_run      DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REPORT SCHEDULE
-- ============================================================
CREATE TABLE IF NOT EXISTS lp_report_schedule (
  rp_id          SERIAL       PRIMARY KEY,
  rp_type        VARCHAR(10),
  rp_email       VARCHAR(150),
  rp_frequency   VARCHAR(20),
  rp_last_run    DATE,
  rp_active      CHAR(1)      DEFAULT 'Y'
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_movement_status    ON lp_movement(m_status);
CREATE INDEX IF NOT EXISTS idx_movement_date      ON lp_movement(m_date);
CREATE INDEX IF NOT EXISTS idx_movement_truck     ON lp_movement(m_truck);
CREATE INDEX IF NOT EXISTS idx_movement_customer  ON lp_movement(m_customer);
CREATE INDEX IF NOT EXISTS idx_movement_bus_unit  ON lp_movement(m_bus_unit);
CREATE INDEX IF NOT EXISTS idx_comments_load      ON lp_comments(c_load);
CREATE INDEX IF NOT EXISTS idx_events_load        ON lp_events(e_load_no);
CREATE INDEX IF NOT EXISTS idx_costs_load         ON lp_costs(c_load);

-- ============================================================
-- ROW LEVEL SECURITY (Supabase best practice)
-- ============================================================
ALTER TABLE lp_movement         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_vehicles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_drivers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lp_users            ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (refine per role as needed)
CREATE POLICY "Allow authenticated" ON lp_movement         FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated" ON lp_vehicles         FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated" ON lp_drivers          FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated" ON lp_customers        FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated" ON lp_users            FOR ALL TO authenticated USING (true);

-- ============================================================
-- SEED DATA — Business Units
-- ============================================================
INSERT INTO lp_business_units (bu_code, bu_name) VALUES
  ('IDC',     'IDC Division'),
  ('IDM',     'IDM Division'),
  ('MOGWASE', 'Mogwase Division')
ON CONFLICT DO NOTHING;
