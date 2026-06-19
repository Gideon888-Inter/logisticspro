require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const loadsRoutes = require('./routes/loads');
const vehiclesRoutes = require('./routes/vehicles');
const { driversRouter, customersRouter, maintenanceRouter, inventoryRouter, routesRouter } = require('./routes/entities');
const clientRatesRouter = require('./routes/clientRates');
const usersRouter = require('./routes/users');
const costsRouter = require('./routes/costs');
const kmRouter = require('./routes/km');
const serviceRouter  = require('./routes/service');
const podsRouter     = require('./routes/pods');
const invoicesRouter = require('./routes/invoices');

const app = express();
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
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
app.use('/api/inventory',   inventoryRouter);
app.use('/api/routes',      routesRouter);
app.use('/api/rates',       clientRatesRouter);
app.use('/api/users',       usersRouter);
app.use('/api/costs',       costsRouter);
app.use('/api/km',          kmRouter);
app.use('/api/service',      serviceRouter);
app.use('/api/pods',         podsRouter);
app.use('/api/invoices',    invoicesRouter);

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
app.listen(PORT, () => console.log(`LogisticsPro API running on port ${PORT}`));
