# FreeFlow AI Income Underwriting Engine
## Transition & Onboarding Playbook (Perpetual Enterprise License Handover)

This playbook outlines the secure, standardized 3-step transition plan for handing over the **FreeFlow AI Income Underwriting Engine** codebase, Docker containers, database schemas, and integration modules to the Licensee's internal IT and DevOps departments.

---

### **Executive Overview & Security Position**
Under the **Perpetual Enterprise License**, FreeFlow's engineering team will transition our standalone, in-memory PDF slicing and Form 1084 math engine directly into the Licensee's private cloud infrastructure.

*   **Deployment Model:** Private VPC (AWS ECS / Azure Kubernetes Service) with zero telemetry or external calling to FreeFlow servers.
*   **Data Custody Boundary:** Strict **Zero-Data-Retention (ZDR)** execution model. All files are processed ephemerally in RAM buffers and purged immediately upon database commit, completely eliminating external data-at-rest liabilities.
*   **Integration Target:** Direct synchronization with your native **ICE Encompass** instance via Encompass Developer Connect OAuth 2.0 REST APIs, accompanied by manual offline **MISMO v3.4 XML** export capabilities.

---

### **Phase 1: Codebase Walkthrough & Secure Repository Handover**

In this phase, we establish access boundaries and guide your lead engineers through the architectural modules of the Turborepo monorepo.

#### **1.1 Secure Git Transfer**
*   FreeFlow engineers will provision a secure, private GitHub repository transition fork or coordinate a direct physical push to your enterprise self-hosted repository (e.g., GitLab Self-Hosted or Bitbucket Server).
*   **Verification Gate:** SSH credential validation and Multi-Factor Authentication (MFA) enforcement for your assigned lead developers.

#### **1.2 Codebase Modules Architecture Walkthrough**
We will conduct a 2-hour technical walkthrough covering your four primary application directories:
1.  **`apps/landing/` (Static Storefront):** Next.js static marketing and pricing module optimized for deployment to Vercel or Cloudflare CDN.
2.  **`apps/web/` (Interactive Underwriter Console):** Next.js & Tailwind CSS split-screen underwriting workspace (`UnderwriterSplitViewDemo-v2.tsx` and `AuditTrailTable.tsx`).
3.  **`packages/math-engine/` (Form 1084 Core):** Deterministic TypeScript math ledger implementing GSE-compliant Schedule C/E/F, Form 8825, and corporate tax return cash flow math.
4.  **`packages/pdf-slicer/` (Python OCR & In-Memory Extraction):** Slices unredacted tax packages in-memory, maps form spatial coordinates, and parses native vector text layouts.

---

### **Phase 2: Private VPC Provisioning & Environment Configuration**

In this phase, your DevOps team will deploy our pre-configured Docker containers inside your private virtual network, hydrating the database and encryption layers.

#### **2.1 Containerized Backend Deployment (AWS ECS / Fargate)**
We provide standard `Dockerfile` and `docker-compose.yml` configurations for the Python parsing compute microservice.
*   **Infrastructure Setup:** Deploy the container inside your private subnet behind an Application Load Balancer (ALB).
*   **RAM-Only Parsing Buffer:** The Python runtime is configured to run entirely in RAM (`/dev/shm` shared memory mount) to enforce the Zero-Data-Retention (ZDR) architecture. 

#### **2.2 PostgreSQL Schema Hydration & Row-Level Security (RLS)**
We initialize and configure your Supabase/PostgreSQL database instances:
*   **Prisma Migration:** Run `npx prisma migrate deploy` to hydrate tables: `form_1084_audits`, `tenant_configurations`, and `tenant_billing_ledgers`.
*   **RLS Policies:** Enforce database kernel-level isolation rules:
    ```sql
    ALTER TABLE form_1084_audits ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation_policy ON form_1084_audits 
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id'));
    ```

#### **2.3 Private AWS S3 Bucket Encrypted Storage Configuration**
Configure an S3 bucket with **AWS Key Management Service (KMS) AES-256 server-side encryption** to serve as a temporary transit buffer. Our cleanup cron triggers an immediate, unrecoverable purge of all uploaded PDF binaries the instant coordinates are processed and logged.

---

### **Phase 3: Integration Handshake, Testing, & Compliance Sign-Off**

The final phase connects the newly private instance of FreeFlow to your native core systems and executes strict automated adversarial tests for operational sign-off.

#### **3.1 ICE Encompass Web Control & Iframe Handshake**
Configure your local Encompass custom Web Input Forms to frame the secure React split-screen UI:
*   **Next.js CSP Restriction:** Adjust `next.config.js` response headers to lock down frame authorization:
    ```javascript
    Content-Security-Policy: frame-ancestors 'self' https://*.encompass.epic.com;
    ```
*   **REST API Mapping:** Map the Python generator (`mismo_xml_exporter.py`) with your corporate Encompass Instance ID and Client ID credentials inside your secure database configuration to enable automatic XML payload pushing.

#### **3.2 Automated QA Adversarial Testing Suite**
We run our regression unit-testing framework (`stress_test_runner.py` and `adversarial_test_runner.py`) on your production-mirrored staging environment to verify accuracy.
*   **Testing Targets:** 100-page scanned returns, multi-entity Schedule E packages, missing corporate corporate returns, and intentionally degraded document strings.
*   **Pass Criteria:** 100% mathematical accuracy on all Form 1084 monthly qualifying income totals, zero text-slicing false positives, and zero server crashes.

#### **3.3 Enterprise Security & Legal Sign-Off**
*   Execute a final verification checklist with your Chief Information Security Officer (CISO) and Compliance Director.
*   Deliver the finalized **Non-Exclusive, Perpetual Software License Agreement** and active **Annual Maintenance & Guideline Update Service Level Agreement (SLA)**.

---
*Document prepared by Gemini Notebook on behalf of FreeFlow Mortgage Solutions.*
