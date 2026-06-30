require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const loadsRoutes = require('./routes/loads');
const vehiclesRoutes = require('./routes/vehicles');
const { driversRouter, customersRouter, maintenanceRouter } = require('./routes/entities');
const clientRatesRouter = require('./routes/clientRates');
const usersRouter = require('./routes/users');
const costsRouter = require('./routes/costs');
const kmRouter = require('./routes/km');
const serviceRouter  = require('./routes/service');
const podsRouter     = require('./routes/pods');
const invoicesRouter = require('./routes/invoices');
const stockRouter    = require('./routes/inventory');    // LP2.0 Inventory & PO module
const rolesRouter    = require('./routes/roles_admin');  // LP2.0 Role Manager
const financeRouter  = require('./routes/finance');       // LP2.0 Financial Module
const trackingRouter = require('./routes/tracking');      // LP2.0 Pulsit GPS tracking integration
const addressesRouter = require('./routes/addresses');     // LP2.0 Named addresses / home bases
const stopsRouter     = require('./routes/stops');         // LP2.0 Load card extra stops

const app = express();
app.set('trust proxy', 1);

// ── Allowed origins ───────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://logisticspro.pages.dev',           // Production
  process.env.FRONTEND_URL,                    // Override via env if needed
  'http://localhost:5173',                     // Local dev (Vite default)
  'http://localhost:4173',                     // Local dev (Vite preview)
].filter(Boolean);

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json({ limit: '20mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/loads',       loadsRoutes);
app.use('/api/vehicles',    vehiclesRoutes);
app.use('/api/drivers',     driversRouter);
app.use('/api/customers',   customersRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/stock',       stockRouter);       // LP2.0 Inventory & Purchase Orders module
app.use('/api/roles',       rolesRouter);       // LP2.0 Role Manager (Admin only)
app.use('/api/fin',         financeRouter);    // LP2.0 Financial Module
app.use('/api/tracking',    trackingRouter);    // LP2.0 Pulsit GPS tracking integration
app.use('/api/rates',       clientRatesRouter);
app.use('/api/users',       usersRouter);
app.use('/api/costs',       costsRouter);
app.use('/api/km',          kmRouter);
app.use('/api/service',     serviceRouter);
app.use('/api/pods',        podsRouter);
app.use('/api/invoices',    invoicesRouter);
app.use('/api/addresses',   addressesRouter);
app.use('/api/stops',       stopsRouter);

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── 404 ───────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`LogisticsPro API running on port ${PORT}`));

// ── Render free-tier keepalive ────────────────────────────────
// Render spins down free instances after 15 min of inactivity.
// Self-ping every 10 min keeps the server awake during business hours.
// Only runs when actually deployed on Render (RENDER_EXTERNAL_URL is set
// by Render itself) — pointless and noisy in local development.
if (process.env.RENDER_EXTERNAL_URL) {
  const SELF_URL = process.env.RENDER_EXTERNAL_URL;
  setInterval(() => {
    const https = SELF_URL.startsWith('https') ? require('https') : require('http');
    https.get(`${SELF_URL}/health`, (res) => {
      console.log(`[keepalive] /health → ${res.statusCode}`);
    }).on('error', (e) => {
      console.warn('[keepalive] ping failed:', e.message);
    });
  }, 10 * 60 * 1000); // every 10 minutes
}


