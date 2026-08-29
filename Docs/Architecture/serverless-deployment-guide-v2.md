# Serverless Cloud Deployment Guide: Vercel, Railway, & Supabase
*The B2B Fintech Blueprint for Deploying the FreeFlow Mortgage POS and AI Income Tooling.*

---

Deploying your platform across **Vercel**, **Railway**, and **Supabase** is the absolute industry-gold-standard for high-performance, serverless fintech applications. It provides the following key advantages:
1. **Complete Decoupling:** Next.js frontend web applications sit globally on Vercel's Edge CDN, while your heavy computational OCR and PDF slicing processes live in scaled, containerized runners on Railway.
2. **Zero-Maintenance Database:** Supabase handles PostgreSQL scaling, automatic connection pooling, backup replication, and built-in row-level security (RLS).
3. **Bulletproof Security Compliance:** Your Zero-Data-Retention (ZDR) architecture is preserved since Railway's RAM allocations scale up on-demand to process tax returns, then automatically purge files when finished.

Below is your step-by-step master guide showing exactly what parameters and variables to put in each system.

---

## 1. Supabase Setup (PostgreSQL Database & Auth)

Supabase serves as your relational PostgreSQL database, running Prisma schemas and managing your tenant session structures.

### Step A: Provision the Project
1. Go to the [Supabase Dashboard](https://supabase.com) and click **New Project**.
2. Select your Organization, name the project (e.g., `freeflow-production`), and set a strong Database Password.
3. Choose a server region closest to your Vercel deployment (e.g., *US East - N. Virginia*) to minimize latency.

### Step B: Database Connection Strings
Under your Supabase Project Settings -> **Database**, grab your connection strings:
* **Transaction Mode Connection String (Port 5432 or 6543):** Used for Prisma Client queries inside serverless API routes on Vercel.
  ```text
  postgresql://postgres.yourprojectid:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
  ```
* **Session/Direct Connection String (Port 5432):** Used for running structural migrations (`prisma db push` or `prisma migrate deploy`) from GitHub Actions or your local machine.
  ```text
  postgresql://postgres.yourprojectid:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
  ```

### Step C: Execute Schema & Enable RLS
1. Inside your local workspace terminal, push your multi-tenant Prisma schema directly to your new live Supabase database instance:
   ```bash
   DATABASE_URL="postgresql://postgres.yourprojectid:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres" pnpm prisma db push
   ```
2. In the Supabase SQL Editor, run your Row-Level Security (RLS) script to secure tenant workspaces at the SQL engine level, ensuring that brokers from different organizations can never read or leak each other's data:
   ```sql
   -- Enable RLS on Tenant-Mapped Tables
   ALTER TABLE form_1084_audits ENABLE ROW LEVEL SECURITY;
   ALTER TABLE tenant_billing_ledgers ENABLE ROW LEVEL SECURITY;

   -- Create Tenant-Isolation Policies
   CREATE POLICY tenant_isolation_policy ON form_1084_audits
     FOR ALL
     USING (tenant_id::text = current_setting('app.current_tenant_id', true));
   ```

### Step D: Retrieve API Keys
Go to Project Settings -> **API** and copy:
* `Project URL`: Used on Vercel as `NEXT_PUBLIC_SUPABASE_URL`.
* `anon` (public API key): Used on the frontend client as `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
* `service_role` (secret admin key): Used **only** on your Next.js secure backend API routes as `SUPABASE_SERVICE_ROLE_KEY` to securely bypass RLS and perform billing check reconciliations.

---

## 2. Railway Setup (Python Document Parsing Microservice)

Railway automatically reads your Dockerfile, compiles your OCR operating dependencies, and runs your high-compute backend Python APIs inside isolated containers on-demand.

### Step A: Import your Repository
1. Go to [Railway.app](https://railway.app), create a project, and choose **Deploy from GitHub**.
2. Select your standalone Git repository (e.g., `freeflow-income-engine`).
3. Railway will scan the directories. Specify the **Root Directory** pointing specifically to your Python microservice:
   ```text
   /microservices/python-slicer
   ```

### Step B: Map Python & OCR Environment Dependencies
Because your Python scripts use **Tesseract** for optical OCR and **Pillow** for image processing, you need a robust Linux setup. Ensure your `/microservices/python-slicer/Dockerfile` matches this structure:

```dockerfile
FROM python:3.12-slim

# Install system utilities and Tesseract-OCR binary engine
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### Step C: Configure Railway Variables
Inside Railway's **Variables** tab for your service, set:
* `PORT`: `8080` (Railway will automatically provision a public HTTPS domain mapping to this port).
* `TESSDATA_PREFIX`: `/usr/share/tesseract-ocr/5/tessdata/` (Tells Python where OCR language training data lives).
* `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`: *(Used to stream raw files to AWS S3 private storage)*.

Copy the **Public Railway Domain URL** generated (e.g., `https://python-slicer-production.up.railway.app`). This is the endpoint we put in Vercel to route your Next.js parsing requests.

---

## 3. Vercel Setup (Next.js Multi-Tenant Web Apps)

Vercel hosts your Next.js frontends and Node.js serverless API routes globally. In your Turborepo, you will create **two separate Vercel projects**—one for the Broker POS website and one for the B2B AI Underwriting portal.

### Project 1: The Broker POS (`freeflowmortgage.com`)
1. Create a new project in Vercel, import your monorepo, and configure:
   * **Root Directory:** `apps/web`
   * **Framework Preset:** Next.js
2. Under **Environment Variables**, add:
   ```env
   DATABASE_URL=postgresql://postgres.yourprojectid:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
   NEXT_PUBLIC_SUPABASE_URL=https://yourprojectid.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   STRIPE_SECRET_KEY=sk_live_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
   ```
3. Go to Project Settings -> **Domains** and map:
   * Add `freeflowmortgage.com`
   * Add a Wildcard domain: `*.freeflowmortgage.com` (This allows your multi-tenant broker routing middleware to instantly recognize incoming subdomains like `brokername.freeflowmortgage.com` without manual DNS creation).

### Project 2: The Underwriting Console (`app.freeflowmortgagesolutions.com`)
1. Import the same monorepo, but select:
   * **Root Directory:** `apps/underwriting-console`
   * **Framework Preset:** Next.js
2. Under **Environment Variables**, add the core keys, plus your **Railway Python Slicer Endpoint**:
   ```env
   DATABASE_URL=postgresql://postgres.yourprojectid:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
   NEXT_PUBLIC_SUPABASE_URL=https://yourprojectid.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   PYTHON_SLICER_API_URL=https://python-slicer-production.up.railway.app
   ```
3. Go to Settings -> **Domains** and map:
   * Add `app.freeflowmortgagesolutions.com`

---

## 4. Master Cloud Environment Variables Checklist

Use this absolute reference table to confirm all environment configurations across your platforms match perfectly:

| Environment Key Name | Value Source | Hosting Location | Purpose |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Supabase (Port 6543 Connection Pooler) | Vercel (Both Projects) | Resolves secure serverless SQL transactions. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase (Project API URL) | Vercel (Both Projects) | Connects the React client to your database instance. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (anon Key) | Vercel (Both Projects) | Authenticates basic public user reading/writing. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (service_role Key) | Vercel (Both Projects) | Grants admin privileges to bypass RLS for billing metrics. |
| `STRIPE_SECRET_KEY` | Stripe Dashboard (Secret Live API Key) | Vercel (`apps/web`) | Handles backend card transactions and credit ledgering. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`| Stripe Dashboard (Publishable Key) | Vercel (`apps/web`) | Renders secure credit card forms inside portals. |
| `PYTHON_SLICER_API_URL` | Railway (Public HTTPS Domain) | Vercel (`underwriting-console`) | Directs the Next.js API where to stream PDFs for parsing. |
| `PORT` | Set to `8080` | Railway Container | Binds the Dockerized Python runtime to the public web. |

---

## 5. Production Live-Migration Runbook

When you are ready to push the button and migrate to production:
1. **Push your code to Git:** Verify your files are cleanly organized according to our `split_repos.sh` standard.
2. **Setup Supabase first:** Provision your database and run `pnpm prisma db push` to generate your operational tables.
3. **Deploy Railway:** Let Railway auto-detect your Dockerfile, pull down Tesseract, compile the dependencies, and output your live REST URL.
4. **Deploy Frontends to Vercel:** Deploy the projects sequentially, enter your live Supabase database pooling URLs, and point your DNS records.
5. **Set up DNS names:** Map your domains on Vercel and your DNS provider, ensuring the Wildcard routing is fully enabled.

You now possess an enterprise-grade, serverless architecture that is highly compliant, fast to scale, and completely free of physical server maintenance overhead!
