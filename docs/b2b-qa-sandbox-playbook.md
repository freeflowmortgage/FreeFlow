# 🚨 FreeFlow B2B Income Engine: End-to-End QA Sandbox Playbook
*The Definitive Pre-Launch Technical Verification, Cryptographic Disk Isolation, and Monorepo Directory Mapping Guide*

---

## 1. Executive Summary & Zero-Data-Retention (ZDR) Mandate

This document serves as the official pre-flight audit and quality assurance playbook for the **FreeFlow B2B Unified Income Engine & Document Ingestion microservice** [cite: 31, 33]. 

To pass rigid institutional bank CISO reviews, regional credit union audits, and independent mortgage banker (IMB) compliance checks, this point-solution enforces a strict **Zero-Data-Retention (ZDR)** transit topology [cite: 33, 72]:
*   Incoming PDF file streams are processed **exclusively in-memory (RAM)** within volatile, containerized execution frames [cite: 1, 31, 33].
*   At no point do the document pre-processing services write unencrypted consumer Non-Public Personal Information (NPI) to persistent physical disks [cite: 33, 41].
*   All calculated coordinates and qualifying financial values are returned directly to the browser or synchronized securely to the lender's Encompass eFolder before the container's local environment is hard-purged [cite: 30, 31, 148].

---

## 2. Directory Mapping & Monorepo Configuration Index

To guarantee your workspace is clean of any retail point-of-sale (POS) consumer-facing code, verify that your local workspace maps strictly to this B2B Turborepo schema [cite: 31, 38]:

```
freeflow-income-suite/ (Monorepo Root)
├── .github/
│   └── workflows/
│       └── ecs-deploy.yml               # GitHub Actions CI/CD to push Python container to ECR
├── apps/
│   └── underwriter-portal/              # B2B Professional Web Dashboard (Next.js) [cite: 38]
│       ├── src/
│       │   ├── components/
│       │   │   ├── UnderwriterSplitViewDemo.tsx     # UnderwriterSplitViewDemo-v7.tsx [cite: 159]
│       │   │   └── AuditTrailTable.tsx              # AuditTrailTable.tsx [cite: 71]
│       │   └── pages/
│       │       └── api/
│       │           ├── billing/
│       │           │   └── webhook.ts               # stripe-billing-router-v4.ts [cite: 152]
│       │           └── underwrite/
│       │               ├── process.ts               # underwrite-process-route-v2.ts [cite: 66]
│       │               ├── encompass-sync.ts        # encompass-sync.ts [cite: 18]
│       │               ├── pull-docs.ts             # encompass-pull-efolder-docs.ts [cite: 77]
│       │               └── summary-pdf.ts           # summary-pdf-route.ts [cite: 8]
│       ├── package.json                 # web-package.json [cite: 38]
│       └── next.config.js               # next.config.js [cite: 245]
├── packages/
│   ├── database/                        # Database modeling and migration scripts
│   │   ├── prisma/
│   │   │   └── schema.prisma            # supabase-schema-v2.prisma [cite: 131]
│   │   └── package.json
│   └── mortgage-engine/                 # Shared deterministic GSE rules and unit tests [cite: 38]
│       ├── src/
│       │   ├── calculateForm1084Income.ts # calculateForm1084Income-v9.ts [cite: 11]
│       │   └── payload-guard.ts         # payload-guard.ts [cite: 103]
│       ├── tests/
│       │   ├── subject-property-fnma.test.ts # subject-property-fnma.test.ts [cite: 21]
│       │   └── fha-declining-multifamily.test.ts # fha-declining-multifamily.test.ts [cite: 118]
│       └── package.json
├── services/
│   └── doc-parser/                      # Stateless Python ECS Fargate microservice [cite: 31, 33]
│       ├── src/
│       │   ├── server.py                # server.py (Stateless FastAPI Server) [cite: 137]
│       │   ├── ai_pdf_converter.py      # ai_pdf_converter-v2.py [cite: 112]
│       │   └── pdf_splitter.py          # pre_split_tax_returns-v5.py [cite: 8]
│       ├── Dockerfile                   # Dockerfile-v2 [cite: 106]
│       └── ecs-task-definition-v4.json  # ecs-task-definition-v4.json (Fargate spec) [cite: 68]
├── .env.slicer                          # env.slicer-v2 [cite: 37]
├── .env.development                     # .env.development [cite: 133]
├── docker-compose.yml                   # docker-compose.yml [cite: 127]
├── pnpm-workspace.yaml                  # pnpm-workspace.yaml [cite: 113]
├── turbo.json                           # turbo.json [cite: 105]
└── copy-assets-v7.sh                    # copy-assets-v7.sh [cite: 64]
```

### **Distributing Files Programmatically**
Ensure all downloaded source files reside in a flat directory and execute our latest migration utility to automatically route files to their respective monorepo workspaces:
```bash
chmod +x copy-assets-v7.sh
./copy-assets-v7.sh
```

---

## 3. Phase-by-Phase Local QA Sandbox Playbook

Run these phases inside your local environment to verify system functionality before the production release [cite: 31].

### **Phase 1: Volatile Infrastructure & Disk Isolation Audit**
**Objective:** Confirm that the document pre-processor operates in-memory with zero physical disk persistence [cite: 33, 41].

1.  **Boot Up the Infrastructure:**
    Spin up your local relational database, memory cache, and S3-compatible mock storage using Docker Compose [cite: 127]:
    ```bash
    docker-compose up -d
    ```
2.  **Execute the Build and Runtime Syntax Audit:**
    Run our specialized test verifier to compile the services locally, check for python syntax and module integrity, and simulate an in-memory document parse [cite: 31, 143]:
    ```bash
    chmod +x verify-b2b-slicer-build.sh
    ./verify-b2b-slicer-build.sh
    ```
3.  **Audit the Memory Boundaries:**
    Confirm that during processing, the console prints [cite: 31, 112]:
    *   `[ZDR System] PDF document binary buffered in tmpfs / RAM memory`
    *   `[ZDR System] PDF processing complete. Local temporary tmpfs space unlinked and cleared`
    
    Verify that executing `docker exec freeflow-doc-parser ls -la /tmp` returns no cached document directories or traces of file buffers, proving complete, local physical erasure [cite: 31, 33].

---

### **Phase 2: Computer Vision, Deskew, and OCR-Sandwich Verification**
**Objective:** Verify that poor quality scanned files and slanted mobile uploads are automatically deskewed and returned as selectable and searchable PDF documents [cite: 30].

1.  **Stage a Slanted Test File:**
    Generate or download a standard flat-raster tax PDF (containing no vector text layer) [cite: 14, 21]. Rotate it by `5°` to `10°` to simulate a skewed scan, and save it as `skewed_scan.pdf`.
2.  **Submit the Request directly to the API:**
    ```bash
    curl -X POST -F "file=@skewed_scan.pdf" http://localhost:8080/api/underwrite/process > parser_response.json
    ```
3.  **Validate the API Payload Response:**
    Verify the JSON response block contains the following structural components [cite: 30, 31, 148]:
    *   `"was_sandwich_applied": true` (asserts the CV image pipeline ran binarization and deskewing).
    *   `"has_business_returns": true` (asserts target Schedules C or E were recognized).
    *   `"sliced_pdf_payload_b64"`: A non-empty Base64-encoded string representing the sliced searchable PDF.
4.  **Confirm Selection Legibility:**
    Open the resulting searchable PDF output inside your browser or viewer. Double-click the text to verify you can select individual characters, and ensure that the selectable text overlay matches the visual document with pixel-perfect coordinate precision [cite: 30].

---

### **Phase 3: Segmented Billing Gate & Webhook Testing**
**Objective:** Confirm that the Stripe Webhook billing gates enforce our volumetric tier pricing, upgrade differentials, and apply resubmission exemptions correctly [cite: 40].

1.  **Forward Stripe Webhook Events Locally:**
    Establish a secure webhook listener pointing to your local Next.js API server:
    ```bash
    stripe listen --forward-to localhost:3000/api/billing/webhook
    ```
2.  **Verify Tier 2 Billing Trigger (\$25.00 Standard Charge):**
    Trigger a simulated payment success webhook event using our sole proprietorship JSON payload profile [cite: 40]:
    ```bash
    stripe trigger payment_intent.succeeded --payload @payment-intent-succeeded-v4.json
    ```
    Assert in your PostgreSQL database that the loan record has updated `isAppFeeBilled` to `true`, and `billedTier` is registered as `SOLE_PROPRIETOR_SINGLE_ENTITY`.
3.  **Verify Tier 3 Upgrade Delta (\$17.00 Upgrade Charge):**
    Simulate an upgrade webhook event where the same `loanId` is processed with a target tier of `MULTI_ENTITY_PORTFOLIO_OR_USDA` (the \$45.00 tier).
    *   **Audit Check:** Verify that the billing gateway processes a charge of exactly **\$17.00** (the differential delta) [cite: 122], preventing a duplicate \$45.00 transaction.
4.  **Verify Resubmission Exemption (\$0.00 Reprocessing):**
    Submit the exact same tax package to the ingestion endpoint.
    *   **Audit Check:** Verify that the system bypasses Stripe billing entirely [cite: 122], executing the request with a transaction record of `RESUBMISSION_EXEMPTION_ACTIVE` and a `chargeApplied` value of exactly `0` cents.

---

### **Phase 4: Math Core & Underwriting Rule Validations**
**Objective:** Confirm that all deterministic GSE mathematical algorithms are 100% compliant with Fannie Mae, Freddie Mac, HUD, and VA regulations [cite: 11, 107].

1.  **Execute the Test Suite:**
    Navigate to your TypeScript package workspace and trigger the Jest unit tests:
    ```bash
    pnpm --filter @mortgage-pos/mortgage-engine test
    ```
2.  **Assert Rental Real Estate Property Constraints (HUD 4000.1):**
    Verify that our declining rental tests pass with the following controls:
    *   **Decline <= 5.0%:** HUD permits standard average of both years.
    *   **Decline > 5.0% and <= 20.0%:** Restricts qualifying income to the lower, most recent 12-month period.
    *   **Decline > 20.0%:** Completely disqualifies property income, returning `$0.00` monthly.
3.  **Assert Fannie Mae Subject Property Offsets:**
    Verify that the Jest output confirms [cite: 35]:
    *   Subject property vacancy factors default strictly to **`75%`** of gross rent.
    *   Positive rental cash flows offset global qualifying income, whereas net rental losses are subtracted from the borrower's debt-to-income (DTI) ratio.
    *   2–4 unit primary residence rental incomes are restricted strictly to offsetting the actual PITIA of the property, with excess cash flows locked out.

---

### **Phase 5: Ellie Mae Encompass REST Integration & Fallback Queues**
**Objective:** Ensure that verified data maps correctly to Encompass fields and processes gracefully during network failures [cite: 18, 31].

1.  **Trigger Encompass Sync:**
    Simulate an underwriter signing off on a parsed dataset inside the dashboard console:
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{"loanId": "e1f82f80-df4f-4d56-a97e-12829a34b2cf"}' http://localhost:3000/api/underwrite/encompass-sync
    ```
2.  **Assert Outbound Serializations:**
    Verify in your Next.js console logs that the payload compiles cleanly into a standard MISMO 3.4 XML data structure and calls the correct Ellie Mae REST API folder path [cite: 18].
3.  **Test Network Timeout & Async Recovery:**
    Run our automated retry and queue test suite to simulate network congestion:
    ```bash
    pnpm test timeout-exception-resiliency.test.ts
    ```
    Confirm that if the Encompass endpoint experiences a timeout, the payload is safely redirected to the Redis-backed fallback queue, marked as `PENDING_RETRY`, and does not crash your Next.js main web thread [cite: 31].

---

## 4. Auditor-Ready Security Proofs: Proving Zero Physical Disk Access

When bank security officers or independent SOC 2 Type II auditors demand proof that your platform is completely locked down and has **zero access to the raw storage disks**, provide the following three system proofs:

### **Proof A: Complete IAM Decoupling (No Key Authority)**
Our ECS Task Execution Role (`freeflowEcsTaskRole`) possesses absolutely **zero IAM permissions** for the AWS Key Management Service (KMS) or S3 Decryption APIs:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StatelessTaskExecution",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```
*   **The Cryptographic Boundary:** Because our application code lacks KMS credentials or API access, it is cryptographically barred from querying or retrieving any storage decryption keys [cite: 31, 33].

### **Proof B: AWS Fargate Hypervisor-Level Gating**
Our container builds target the AWS Fargate serverless platform natively [cite: 31, 33].
*   Fargate runs all tasks inside isolated **Firecracker MicroVMs** [cite: 138].
*   Ephemeral block-level storage (under `/tmp`) is encrypted on-the-fly at the hypervisor virtualization layer using the default AWS-managed key **`aws/fargate`** [cite: 138, 160].
*   Because the encryption keys reside entirely inside AWS's infrastructure account, **our AWS customer account has zero ability to view, export, or retrieve the encryption keys [cite: 138].**

### **Proof C: Volatile Container Crypto-Shredding**
Upon completion of a document parsing transaction, or during a container scale-down event:
*   AWS Fargate physically terminates the Firecracker MicroVM hosting our container [cite: 138, 166].
*   The unique, volatile AES-256 container encryption key generated by AWS KMS is **permanently deleted and discarded** from AWS's system memory [cite: 166].
*   Without this key, any physical blocks written to the underlying storage rack during the container's lifecycle instantly turn into **cryptographic noise [cite: 138, 166]**, executing complete cryptographic erasure [cite: 166].

---

## 5. Live Interactive Sandbox Workflows (The B2B PLG Demo)

When demonstrating the platform to enterprise buyers, show how the system actively recalculates and learns from human inputs [cite: 72, 111]:

### **1. Real-Time Underwriter Overrides**
1.  Navigate to the B2B dashboard and click **"Simulate Fraudulent W-2"** [cite: 8].
2.  Observe that Box 4 (Social Security Withholding) glows red, triggering a **Critical Fraud Risk: Withholding Mismatch** alert at the bottom of the workbench [cite: 8].
3.  Click **Box 4** and type **`9300`** into the "Type Manual Override" input field [cite: 89, 94].
4.  Watch the visual card instantly transition to **`$9,300.00 (Override)`**, and observe that the critical fraud warning box immediately disappears [cite: 89, 94].

### **2. OCR System Training Feedback Loop**
1.  If a field's bounding box coordinates were skewed or inaccurate, click the **"Flag for AI Learning"** button in the override panel [cite: 72].
2.  Watch the card spawn an active amber radar beacon, logging the event [cite: 71, 72]:
    > `[Audit Logged] Coordinates flagged. Feedback is queued to correct the local OpenCV container binarization parameters for future uploads [cite: 30, 71, 112].`
3.  The coordinates are instantly synced back to the relational `ocrDiffHistories` PostgreSQL tables, proving complete programmatic traceability to compliance officers [cite: 63, 64].
