# 📝 Saturday Launch: Day 1 Enterprise Pre-Deployment Checklist
### **Project:** FreeFlow Mortgage Solutions — Unified AI Income Orchestrator (v7)
**Target Date:** 2026-08-29 (Saturday Release)  
**Security Level:** Bank-Grade / CISO-Approved ZDR Architecture  

This checklist serves as the final gateways and validations required by the engineering, DevOps, and compliance teams before pushing the **FreeFlow Income Engine v7** and **Broker Portal v4** live into commercial banking production.

---

## 🛡️ PHASE 1: Local Workspace Security & Regression Shield

Before code is staged or merged into the production branch, local environments must be audited for structural safety and math-engine regressions.

- [ ] **Verify Local Git Pre-Commit Hook Executability**
  - Ensure the local `.git/hooks/pre-commit` or `.husky/pre-commit` is compiled, saved, and executable.
  - *Verification Command:* Run `chmod +x .git/hooks/pre-commit` or verify husky init completes.
  - *Result:* Accidental code changes that damage the income math core will block Git commit actions instantly.
- [ ] **Run Core Math Engine v7 Unit Tests**
  - *Command:* `yarn workspace @freeflow/rules-engine test`
  - *Assert:* 100% green test assertions on:
    - [ ] **FHA Multi-Family Subject Property Decline Rules** (`fha-declining-multifamily.test.ts`): Capping duplexes, restricting triplexes to Year 1/12, and locking out quadplexes (>20% decline) to $0.00/mo.
    - [ ] **C-Corp Dividend Stacking for Minority Owners** (`form1120-dividends-under-25.test.ts`): Verifying W-2 wages and direct corporate dividends stack cleanly for <25% stakeholders, and testing the Schedule L Quick Ratio gating for ≥25% owners.
    - [ ] **Day 1 Certainty (D1C) Reference ID Mappings** (`mismo-d1c-mapping.test.ts`): Validating correct vendor mapping for Plaid, Truework, Argyle, and Equifax.
- [ ] **Lock Dependencies in Turborepo Monorepo**
  - Verify package lockfiles are clean (`pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`).
  - Run `yarn build` locally to confirm Next.js build-time TS type checks pass with zero warnings.

---

## 🗄️ PHASE 2: Database & Multi-Tenancy Layer (Supabase/Prisma)

Data isolation and immutable security ledgers are enforced directly at the SQL database engine. 

- [ ] **Execute Relational Schema Migration**
  - Run the database schema migration scripts on your live production instance pool.
  - *Command:* `npx prisma db push` or verify migrations are applied to production Supabase.
  - *Result:* Target tables `LoanApplication`, `TenantBillingLedger`, and `IncomeAuditLog` are synchronized.
- [ ] **Apply PostgreSQL Row-Level Security (RLS) Rules**
  - Execute `supabase-rls-policies.sql` in your production SQL Editor.
  - *Verify Policy 1:* Access is restricted. A user under Tenant A (`tenant_id_1`) must receive a 403 Forbidden if attempting to query files under Tenant B.
  - *Verify Policy 2 (Sales Role Lockout):* Read-Only roles (`SALES_LO`) are strictly blocked from writing to, altering, or overriding any validated income cash-flows to prevent TRID violations.
  - *Verify Policy 3 (Billing Ledger Safeguard):* Write access on transaction meter records is isolated exclusively to system-authenticated server-side Stripe webhooks.

---

## 🖥️ PHASE 3: Parser & Microservices Layer (AWS Fargate & `/tmpfs`)

Our document parsing container runs Python-slicing pipelines. Perfect Zero-Data-Retention (ZDR) relies on OS-level virtual memory mapping.

- [ ] **Validate ECS Task Definition (`ecs-task-definition.json`)**
  - Open your AWS Task Definition and confirm `linuxParameters` registers the custom virtual volume:
    - `containerPath` is set strictly to `/tmp`.
    - `mountOptions` includes: `"rw"`, `"noexec"`, `"nosuid"`, and `"nodev"`.
    - `size` is set to `512` (Allocates 512 MB of volatile virtual RAM).
  - *Result:* No document uploads or unredacted PDF binaries will ever touch physical block storage (EBS/EFS).
- [ ] **Run Live RAM Mount Compliance Validator**
  - Execute the live validator script inside your test container.
  - *Command:* `./services/doc-parser/test-tmpfs-isolation.sh`
  - *Assert Output:* `✅ VALIDATION SUCCESS: /tmp is mounted as a genuine tmpfs virtual RAM device!`
- [ ] **Confirm Zero Disk Residue Purge**
  - Execute the mock processing script (`mock-network-timeout.sh`).
  - *Assert Output:* `No residual files found. The virtual tmpfs RAM volume successfully cleared.` (Proof that `os.remove()` and garbage collection triggers unlinked the memory space upon task completion).

---

## 🌐 PHASE 4: DNS, Reverse Proxy, & SSL Routing

The gateway separates public marketing zones from secure underwriter APIs.

- [ ] **Audit Multi-Domain DNS Record Mapping**
  - Verify your DNS zone registrar (e.g., AWS Route 53 or Cloudflare) has propagated:
    - [ ] `freeflowmortgage.com` (A Record) -> Points root consumer POS site.
    - [ ] `*.freeflowmortgage.com` (Wildcard CNAME) -> Enables dynamic, custom subdomains for brokers on save.
    - [ ] `app.freeflowmortgage.com` (A/CNAME) -> Points directly to the standalone B2B Underwriter Console.
- [ ] **Configure Server Reverse Proxy (`nginx-secure-routing.conf`)**
  - Confirm the Nginx configuration is updated to route traffic strictly for `app.freeflowmortgage.com`.
  - Verify standard rate-limiting zones:
    - High-compute endpoint `/api/underwrite/process` is capped at **10 requests per minute** per IP to shield against botnets and script-DDoS attacks.
- [ ] **Verify Clickjacking Frame Protection (CSP Headers)**
  - Open `next.config.js` or Next.js middleware and verify `frame-ancestors` is active.
  - *Required Whitelist:* `'self'` plus only the exact Encompass origins approved for the lender deployment.
  - *Result:* Encompass SmartClient or web controls can safely embed your split-screen view while blocking public iframe spoofing.
- [ ] **Run Let's Encrypt Certbot Certificate Generator**
  - *Command:* `certbot --nginx -d freeflowmortgage.com -d app.freeflowmortgage.com`

---

## 🤝 PHASE 5: Encompass Integration & Day 1 Certainty (D1C) Auth

To clear files automatically without audit risk, the hosted tool and custom
connector must use authoritative tenant bindings.

- [ ] **Configure the Encompass hosted tool and custom connector**
  - Approve the exact hosted origin and bind the connector deployment to one lender.
  - Keep LOS credentials outside FreeFlow core services and databases.
- [ ] **Verify Dynamic Audit Links & transactional Email Senders**
  - Open `encompass-fallback-queue.ts` and confirm custom fields map to the correct production routes:
    - `CX.FREEFLOW.AUDIT.URL` -> `https://app.freeflowmortgage.com/audit/{loanId}`
    - Sender Email -> Configured to your active solutions brand (`noreply@freeflowmortgagesolutions.com`).
- [ ] **Verify D1C XML Exporter Structure**
  - Confirm the XML exporter uses the designated third-party vendor codes for Fannie Mae:
    - Plaid -> `Plaid_Income`
    - Truework -> `Truework_Income`
    - Argyle -> `Argyle_Employment`
    - The Work Number -> `The_Work_Number`

---

## 🚦 PHASE 6: Production Launch & Monitoring (The Saturday Smoke Tests)

Perform these diagnostic checks once the pipelines complete.

- [ ] **Test API /health Endpoints**
  - Query: `curl -I https://api-parser.freeflowmortgage.com/health` (Expect `200 OK` with JSON `{"status": "healthy"}`).
- [ ] **Run End-to-End Live Transaction Sandbox Test**
  - Upload a dummy self-employed 1040 package to `app.freeflowmortgage.com`.
  - Verify that:
    1. The PDF pre-slicing completes.
    2. Coordinate bounding boxes highlight correctly on the UI split-view dashboard.
    3. The `IncomeAuditLog` atomic transaction writes successfully to Supabase.
    4. The container `/tmp` folder is empty after finalization (ZDR check).
- [ ] **Confirm Stripe Metering Firewalls**
  - Verify that executing a loan calculation records a billing event on the database ledger, and that the server-side API rejects transactions once a single loan ID exceeds its **Fair-Use Recalculation Cap (Max 15 requests)**.
