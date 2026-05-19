# LogisticsPro — Full Deployment Guide
## Free platforms: Supabase (database) + Railway (backend) + Vercel (frontend)

---

## Overview

```
Browser → Vercel (React frontend)
             ↓ REST API calls
          Railway (Node.js backend)
             ↓ Supabase JS client
          Supabase (PostgreSQL database)
```

All three platforms have generous free tiers — no credit card needed for Supabase and Vercel.

---

## Step 1 — Supabase (Database)

1. Go to https://supabase.com and sign up (free)
2. Click **New Project** — choose a name, set a strong DB password, pick a region close to South Africa (e.g. `eu-west-2 London` is closest)
3. Wait ~2 minutes for the project to spin up
4. Go to **SQL Editor** in the left sidebar
5. Open the file `database/schema.sql` from this project and paste the entire contents into the editor
6. Click **Run** — this creates all tables, indexes, and seed data
7. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **service_role key** (the secret one, not the anon key)

---

## Step 2 — Create your first admin user

In Supabase SQL Editor, run this to create your first login:

```sql
-- Replace the values below with your own
INSERT INTO lp_users (u_username, u_password, u_name, u_email, u_role, u_bus_unit)
VALUES (
  'admin',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password: "password"
  'System Admin',
  'admin@yourcompany.co.za',
  'ADMIN',
  'IDC'
);
```

> ⚠️ Change the password immediately after first login via the API:
> `POST /api/auth/register` with a proper bcrypt hash.
> You can generate a bcrypt hash at https://bcrypt-generator.com (use 10 rounds)

---

## Step 3 — Deploy Backend to Railway

1. Go to https://railway.app and sign up with GitHub (free)
2. Click **New Project → Deploy from GitHub repo**
3. Connect your GitHub account and push this project to a GitHub repo first:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   gh repo create logisticspro --public --push --source=.
   ```
4. In Railway: select your repo, then set the **Root Directory** to `backend`
5. Railway auto-detects Node.js and runs `npm start`
6. Go to **Variables** tab and add:
   ```
   SUPABASE_URL         = https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = your-service-role-key
   JWT_SECRET           = any-long-random-string-minimum-32-chars
   FRONTEND_URL         = https://your-app.vercel.app   ← fill in after Step 4
   ```
7. Click **Deploy** — Railway gives you a URL like `https://logisticspro-production.up.railway.app`
8. Test it: visit `https://your-railway-url/health` — should return `{"status":"ok"}`

---

## Step 4 — Deploy Frontend to Vercel

1. Go to https://vercel.com and sign up with GitHub (free)
2. Click **New Project → Import Git Repository**
3. Select your repo, set **Root Directory** to `frontend`
4. Under **Environment Variables** add:
   ```
   VITE_API_URL = https://your-railway-url.up.railway.app
   ```
5. Click **Deploy** — Vercel gives you a URL like `https://logisticspro.vercel.app`
6. Go back to Railway and update `FRONTEND_URL` to this Vercel URL, then redeploy

---

## Step 5 — Test your app

1. Open your Vercel URL in the browser
2. Log in with `admin` / `password`
3. Change your password immediately

---

## Local Development

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your Supabase credentials
npm run dev
# API runs at http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
# Edit .env: VITE_API_URL=http://localhost:3001
npm run dev
# App runs at http://localhost:5173
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login → returns JWT token |
| POST | /api/auth/register | Create user (first setup) |
| GET | /api/loads | List loads (filterable) |
| POST | /api/loads | Create new load |
| PATCH | /api/loads/:id | Update load / status |
| DELETE | /api/loads/:id | Soft-delete load |
| GET | /api/loads/stats/summary | Dashboard stats |
| GET | /api/loads/:id/comments | Load comments |
| POST | /api/loads/:id/comments | Add comment |
| GET | /api/vehicles | List vehicles |
| POST | /api/vehicles | Add vehicle |
| PATCH | /api/vehicles/:code | Update vehicle |
| GET | /api/drivers | List drivers |
| GET | /api/customers | List customers with contacts |
| GET | /api/maintenance | List maintenance records |
| POST | /api/maintenance | Create maintenance record |
| GET | /api/inventory | List inventory parts |
| GET | /api/routes | List freight routes |

All endpoints (except `/api/auth/login`) require `Authorization: Bearer <token>` header.

---

## Project Structure

```
logisticspro/
├── database/
│   └── schema.sql          ← Run this in Supabase
├── backend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js         ← Express server
│       ├── supabase.js      ← Supabase client
│       ├── middleware/
│       │   └── auth.js      ← JWT middleware
│       └── routes/
│           ├── auth.js      ← Login / register
│           ├── loads.js     ← Loads + comments + stats
│           ├── vehicles.js  ← Fleet management
│           └── entities.js  ← Drivers, customers, maintenance, inventory, routes
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx          ← Layout + routing
        ├── index.css        ← Global dark theme
        ├── lib/
        │   ├── api.js       ← All API calls
        │   └── AuthContext.jsx
        └── pages/
            ├── Login.jsx
            ├── Loads.jsx    ← Main loads page
            └── Entities.jsx ← Vehicles, Drivers, Customers, Maintenance, Inventory, Routes
```

---

## Free Tier Limits

| Platform | Free limit | Notes |
|----------|-----------|-------|
| Supabase | 500 MB DB, 2 GB bandwidth | Pauses after 7 days inactivity on free tier |
| Railway  | $5 credit/month (~500 hrs) | Enough for a small team |
| Vercel   | 100 GB bandwidth, unlimited deploys | Very generous |

To prevent Supabase pausing: upgrade to Pro ($25/month) or set up a cron job to ping the DB weekly.

---

## Migrating your existing data

Since the original database is a SQL Server `.bak` file, you have two options:

**Option A — Manual export (recommended for small datasets)**
1. Restore the `.bak` to a local SQL Server instance (SQL Server Express is free)
2. Use SSMS to export tables to CSV
3. Import CSVs via Supabase dashboard: **Table Editor → Import CSV**

**Option B — Use a migration tool**
- Install `mssql-to-postgres` or use `pgloader`
- This requires a running SQL Server instance with the backup restored

---

## Support

For questions about extending this app, ask Claude to help you add:
- PDF/invoice generation
- Email notifications via SendGrid (free tier)
- Role-based access per business unit
- Mobile-responsive layout
- Export to Excel
