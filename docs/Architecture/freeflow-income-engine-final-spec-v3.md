# FreeFlow Unified AI Income Engine - Production-Grade Master Specification (v3-Final)

This specification consolidates the complete, finalized technical and business architecture for the **Standalone AI Income & In-Memory Slicing Engine**. It is designed to be dropped directly into your Cursor workspace as a master prompt and reference file for full-scale code generation.

---

## 1. System Philosophy: The Standalone Point-Solution Wedge

To maximize market adoption in low-volume cycles, this engine operates strictly as a **back-office operational utility** rather than a consumer-facing POS platform. It plugs directly into existing lender infrastructure via an **Encompass-hosted custom tool**, targeting the highest-overhead task in mortgage processing: manual self-employed, government, and complex income calculations [cite: 32, 104].

```
       [ Underwriter Workspace ]
                  │
                  ▼  (Embedded Web Control Iframe) [cite: 101, 102]
┌───────────────────────────────────────────┐
│     FreeFlow Standalone Income UI         │
├───────────────────────────────────────────┤
│ • Click "Sync eFolder Docs" [cite: 102]   │
│ • Review Side-by-Side Highlighted Math    │
│ • Click "Approve and Sync"                │
└─────────────────────┬─────────────────────┘
                      │  (Stateless RAM Handshake) [cite: 33]
                      ▼
┌───────────────────────────────────────────┐
│       Secure Multi-Tenant API             │
│ • Encompass REST API Token Exchange       │
│ • Cryptographic SHA-256 Dedup Scanner     │
│ • Local Python Pre-Slicing Container      │
│ • Volatile RAM Document Purge [cite: 33]  │
└───────────────────────────────────────────┘
```

---

## 2. Dynamic 3-Tier Transactional Pricing Architecture

Billing is transacted strictly per active loan file, aligning software costs directly to lender pipeline revenue and eliminating fixed user seat licenses [cite: 111, 112].

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   3-TIER FEE COMPLEXITY ROUTER                         │
├────────────────────────────────────────────────────────────────────────┤
│  Tier 1: Standard Verification ─────────────────────────────► $8.00    │
│  (W-2 Wage Earner, SSI Award Letters, Pensions, Capital Gains)         │
│                                                                        │
│  Tier 2: Single-Proprietor Return ─────────────────────────► $25.00   │
│  (1-Year Tax Return files: 1040, Schedule C, Schedule E, IRAs)         │
│                                                                        │
│  Tier 3: Multi-Entity Portfolio ───────────────────────────► $45.00   │
│  (2-Year Returns or Business Entity Returns: K-1s, 1065, 1120/1120S)   │
│                                                                        │
│  * Active-Loan Exemption Gate: Recalculations and Resubmissions = $0.00│
└────────────────────────────────────────────────────────────────────────┘
```

### Programmatic Tier Classification Rules [cite: 38]:
1. **Dynamic Ingestion Analysis:** When documents stream from the eFolder, the engine evaluates file classifications [cite: 58].
2. **If `TAX_RETURN_1040` (with Schedule C/E) or `FORM_1065` / `FORM_1120S`** is detected in the pipeline, the loan file is programmatically upgraded to **Tier 2 (\$25.00)** or **Tier 3 (\$45.00)** based on tax-year count and entity presence [cite: 38, 66, 111].
3. **If only `SSI_AWARD_LETTER`, `W2_WAGE_STATEMENT`, or `PENSION_STATEMENT`** is detected, the loan remains locked at **Tier 1 (\$8.00)** [cite: 38, 58, 66].
4. **Active-Loan Exemption Gate:** The database queries the transaction ledger for the active `loanId`. If a prior successful payment intent is registered, the system **applies a \$0.00 billing override for all recalculations, document updates, and manual coordinate overrides [cite: 19].**

---

## 3. Cryptographic Stateless Resubmission Logic

To preserve airtight user data privacy and eliminate bank liability, the system operates on a **Zero-Data-Retention (ZDR)** pipeline [cite: 33]. It enforces \$0.00 billing on resubmissions without retaining borrower documents, unredacted text, or PII [cite: 18, 33, 40].

### Database Ledger Schema (`schema.prisma`):
```prisma
model TenantBillingLedger {
  id                String                @id @default(uuid()) @db.Uuid
  tenantId          String                @db.Uuid
  loanId            String                @db.Uuid
  documentHashList  String[]              // Array of SHA-256 cryptographic file hashes
  activeTier        BillingTier           @default(STANDARD)
  amountCents       Int                   // Stored in cents (e.g. 4500 for $45.00)
  stripeChargeId    String?               @db.VarChar(255)
  isBilled          Boolean               @default(false)
  createdAt         DateTime              @default(now()) @db.Timestamptz

  @@index([tenantId])
  @@index([loanId])
  @@index([createdAt])
  @@map("tenant_billing_ledgers")
}
```

### The In-Memory Cryptographic Handshake [cite: 33]:
1. **Document Stream:** Raw PDF bytes are buffered directly from the Encompass `/attachments` endpoint into volatile server RAM [cite: 33, 102].
2. **Cryptographic Signature:** The system generates a one-way **SHA-256 Hash** of the raw byte buffer [cite: 33]:
   $$\text{Hash} = \text{SHA-256}(\text{PDF\_Binary\_Buffer})$$
3. **Ledger Check:** The system queries the `TenantBillingLedger` for matches under that `loanId` [cite: 19, 102]:
   * **Exact Hash Match:** If the hash matches an entry in `documentHashList`, the file is calculated and updated at **\$0.00 cost** [cite: 19].
   * **Active Loan Match (New File Version):** If the hash is new but a ledger entry exists under that `loanId` for the same or higher complexity tier, the system **updates the hash array and returns \$0.00 [cite: 19].**
   * **Tier Upgrade Match:** If a Tier 1 file is updated to Tier 3, the engine calculates the difference [cite: 19]:
     $$\text{Upgrade Charge} = \text{Tier 3 (\$45.00)} - \text{Tier 1 (\$8.00)} = \mathbf{\$37.00}$$
4. **Purge Action:** Once coordinate math is completed and fields are written back to Encompass, **the binary array is completely purged from RAM [cite: 33].** No documents ever touch physical hard disks [cite: 33].

---

## 4. Underwriter Verification, Warning Clearance, & Encompass Sync

The UI is designed to prevent "blind calculations." Lenders are insulated from liability by enforcing a manual verification gate before writing data to Encompass [cite: 20, 62]:

1. **Highlight and Flag Display:** The system highlights parsed values (such as wages, withholdings, interest, and child support) on the split-screen panel, flagging any warning markers or discrepancies (e.g. withholding mismatches or missing tax returns) [cite: 25, 85].
2. **Underwriter Review & Override:** The underwriter reviews the coordinate highlights. They can manually adjust fields or override warnings if supplementary documentation verifies the compliance structure [cite: 25].
3. **Approve and Sync Trigger:** Clicking the **"Approve 1084 Cash-Flow"** or **"Approve & Sync"** button executed several automated actions [cite: 25, 102]:
   * Commits the finalized qualifying income figures to the core PostgreSQL datastore [cite: 42].
   * Executes an outbound REST payload to write the validated numbers back to the corresponding Encompass fields (e.g., Field `19` for primary monthly income) [cite: 28, 102].
   * Automatically updates the Encompass eFolder document status, **clearing the outstanding document checklist warning cards** [cite: 102, 104, 105].

---

## 5. Advanced Lending Math & Rules Engines

### A. Automatic Conventional SSI Gross-Up Formula
Under Fannie Mae/Freddie Mac guidelines, underwriters can automatically gross up tax-exempt Social Security Income by **125% (1.25 multiplier)** without requiring tax returns [cite: 8, 60, 104]. The engine calculates and prints this exact audit log step-by-step [cite: 38, 85]:

Let $G$ represent the raw **Gross Monthly SSI Award Amount** [cite: 30]:
1. **Calculate Tax-Exempt Portion (Conventional 15% Assumption):**
   $$\text{Exempt Portion} = G \times 0.15$$
2. **Gross Up the Exempt Portion by 1.25:**
   $$\text{Grossed-Up Exempt} = (G \times 0.15) \times 1.25$$
3. **Calculate Taxable Baseline (85%):**
   $$\text{Taxable Portion} = G \times (1 - 0.15)$$
4. **Combine for Final Qualifying Income:**
   $$\text{Qualifying Monthly Income} = \text{Taxable Portion} + \text{Grossed-Up Exempt}$$

#### Practical Example (\$2,000.00 Gross Award):
1. **Tax-Exempt Portion (15%):** $\$2,000.00 \times 0.15 = \$300.00$
2. **Grossed-Up Exempt:** $\$300.00 \times 1.25 = \$375.00$
3. **Taxable Portion (85%):** $\$2,000.00 - \$300.00 = \$1,700.00$
4. **Final Qualifying Income:** $\$1,700.00 + \$375.00 = \mathbf{\$2,075.00 \text{ / month}}$

*Compliance Gate:* If the loan file is changed to **FHA**, the rules engine executes a hard block, requiring the underwriter to upload Form 1040 tax returns before applying any gross-up multiplier [cite: 104].

---

### B. Standalone USDA Dual-Track Calculation Engine
USDA Rural Development (HB-1-3555 Chapter 9) loans require executing two distinct income calculations with opposite, conflicting rules for self-employment [cite: 2, 32].

#### 1. USDA Repayment Income (DTI Track) [cite: 2]
* **Goal:** Maximum qualifying capacity for note-borrowers only.
* **Add-Back Rules:** Allows non-cash expenses to be added back to business profit [cite: 120]:
  $$\text{Repayment Cash Flow} = \text{Net Profit} + \text{Depreciation} + \text{Business Use of Home} - \text{Meals Exclusion}$$

#### 2. Annual Household Income (Eligibility Track) [cite: 2]
* **Goal:** Combined projected prospective income for the upcoming 12 months for *all adult household members (18+)* to verify they remain below county limits.
* **Zero Add-Back Rule:** To prevent borrowers from artificially deflating household eligibility, **depreciation (Line 12) and business-use-of-home (Line 30) deductions are strictly disallowed as add-backs [cite: 2].**
  $$\text{Household Eligibility Cash Flow} = \text{Net Business Profit/Loss (Raw)}$$

#### 3. Household Member Age & Student Caps (Procedure Notice PN 657) [cite: 2]:
* **Minors (Under 18):** **0% of earned income** is counted. 100% of unearned income is counted.
* **Full-Time Students (18+ & Non-Borrower/Spouse):** Earned income is capped at exactly **\$500.00 per year**. Unearned income is included with no cap.
* **Borrowers, Co-Borrowers, or Spouses:** **100% of all earned and unearned income** is fully included in eligibility calculations with no caps.

---

### C. Transactional Asset Sourcing Engine
To protect lenders from undisclosed household income during USDA audits, the system scans bank transaction histories (Plaid or parsed PDF statements) using a two-layered rule [cite: 2, 104]:

1. **Recurring Deposits (Zero Tolerance):** Every recurring deposit not identified as standard employer payroll is flagged, regardless of amount [cite: 33].
2. **Non-Recurring Deposits (Configurable Threshold):** Automatically flags individual unexplained deposits over **\$1,000.00** (USDA standard) or a customizable threshold (down to **\$100.00** to satisfy conservative warehouse lender overlays) [cite: 20].
3. **P2P Tracker:** Flags Venmo, Zelle, and CashApp incoming flows as potential unrecorded cash wages.

---

### D. Multi-Borrower Name-to-Document Matcher
To prevent co-mingling husband-and-wife tax returns or paystubs [cite: 18, 25]:
1. **Pre-Fetch:** Queries Encompass to lock down active borrower names and SSNs [cite: 28, 102].
2. **OCR Extract:** Parses name strings from form headers (e.g. "Jonathan S. Doe") [cite: 30, 83].
3. **Levenshtein Distance Analysis:** Computes a name-similarity score [cite: 86]:
   $$\text{Similarity} = \left( 1 - \frac{\text{LevenshteinDistance}(\text{ParsedName}, \text{ExpectedName})}{\max(\text{Length}(\text{ParsedName}), \text{Length}(\text{ExpectedName}))} \right) \times 100\%$$
4. **The Gate:** If the confidence score falls below **95%**, the automated write-back is **blocked** [cite: 25, 86]. An alert forces the underwriter to select the correct borrower from a dropdown manually before the system writes back to Encompass [cite: 25, 86, 102].

---

### E. W-2 Withholding Fraud Auditing (FICA Calculation Verification)
To prevent photoshopped W-2s from being approved, the engine audits Social Security and Medicare withholdings against the stated wages [cite: 104]:

1. **Social Security Audit (Expected 6.2%):**
   $$\text{Expected SS Tax} = \text{Minimum}(\text{Box 3 SS Wages}, \$168,600) \times 0.062$$
   If Box 4 withholding deviates from this expected amount by more than **\$1.50** (payroll rounding tolerance), the system flags a **High-Severity `WITHHOLDING_FRAUD_RISK` alert** and freezes automated approval workflows [cite: 62].
2. **Medicare Audit (Expected 1.45% + High-Earner Surtax):**
   $$\text{Base Medicare Tax} = \text{Box 5 Medicare Wages} \times 0.0145$$
   $$\text{Additional Medicare Tax (Wages} > \$200,000) = (\text{Box 5} - \$200,000) \times 0.009$$
   If Box 6 withholding deviates from the combined sum by more than **\$1.50**, the system flags a **High-Severity `WITHHOLDING_FRAUD_RISK` alert [cite: 62].**

---

### F. W-2 Box 12, Code II (Medicaid Waiver Payments) & Paystub Gross-Up
Medicaid Waiver / Difficulty of Care payments are fully excludable from federal income tax under **IRS Notice 2014-7**. If these payments are present, we apply specialized parsing and qualification rules [cite: 32, 104]:

1. **Identification:** The OCR parser extracts **W-2 Box 12, Code II** (amount and code check) [cite: 30, 32].
2. **History Check (1-Year Returns warning):** If Medicaid Waiver income is present and the active file is configured for only **1 Year of tax history/returns**, the system triggers a required document warning [cite: 38]:
   * **Required Doc warning:** *"Medicaid Waiver Income detected with 1-Year Tax Return history. Please upload the state-approved Medicaid Waiver / IHSS Caregiver Agreement, and/or historical bank statement payment ledger (12-24 months required) to verify continuance [cite: 104]."*
3. **Paystub Averaging:** If the underwriter uploads active paystubs for Medicaid Waiver income, the system parses the gross pay and pay frequency to calculate the monthly average [cite: 30, 38]:
   * Weekly stub: $\text{Gross} \times 52 / 12$
   * Bi-weekly stub: $\text{Gross} \times 26 / 12$
   * Semi-monthly stub: $\text{Gross} \times 24 / 12$
4. **The 1.25 Gross-Up Rule:** Because Medicaid Waiver payments are fully tax-exempt, the system automatically grosses up both the W-2 Box 12 Code II amount and the parsed paystub average by **125% (1.25 multiplier)** to maximize qualifying power [cite: 8, 60, 104].

---

### G. Child Support 125% Gross-Up Math
Because child support income is legally tax-free, conventional Fannie Mae and Freddie Mac rules permit grossing up child support by 125% [cite: 8, 60]. 

1. **Document Verification Check:** The system looks up whether the underwriter has checked the `"has3YearContinuanceProof"` box (verifying court divorce decrees and custody orders confirm payments will continue for at least 3 years) [cite: 62].
2. **The Calculation:**
   * **If continuance is verified:**
     $$\text{Qualifying Income} = \text{Monthly Child Support} \times 1.25$$
   * **If continuance is unverified:** The system includes only the raw, non-grossed up monthly amount and triggers a medium-severity warning card: *"Missing 3-Year Continuation proof for child support gross-up [cite: 62]."*

---

## 6. Secure Shared Access & Read-Only Role Enforcement

To prevent Loan Officers, originators, or branch sales managers from tampering with calculated underwriting values to artificially force a DTI to qualify, the system integrates a **Tokenized Shared Link Access Control Engine** [cite: 12, 62, 104]:

*   **Role-Based Constraints (RBAC):** Underwriters, Processors, and Admins are granted full write and Encompass-export capabilities (`canMutate: true`) [cite: 62].
*   **Sales/Loan Officer (LO) Constraints:** When a link is shared with a Sales or LO role, or if the link configuration specifies a read-only tag (`isReadOnly: true`), the API middleware **blocks all POST, PUT, and DELETE commands with a `403 Forbidden` response [cite: 62].**
*   **UI Read-Only Rendering:** On read-only views, **every input field, checkboxes, re-upload utility, and "Approve and Sync" buttons are programmatically disabled,** allowing Sales to view the verified math but preventing any tampering with the loan file [cite: 25, 62].

---

## 7. Defensive Document Slicing Pipeline (OCR Fee Shield)

To preserve your 96%+ gross margins, the engine uses an offline, CPU-based Python pre-parser to split and discard document noise before sending pages to paid cloud OCR services [cite: 30, 111].

```python
# From services/doc-parser/pre_split_tax_returns-v4.py
import pypdf
import os

def slice_and_shield_tax_package(input_pdf_path, scratch_dir):
    """
    Scans the local PDF text layer on the CPU for free.
    Slices and retains ONLY target Schedule C/E pages.
    Discards state forms, instructions, and worksheets to keep paid OCR bills near zero.
    """
    reader = pypdf.PdfReader(input_pdf_path)
    writer = pypdf.PdfWriter()
    target_pages = []

    for idx, page in enumerate(reader.pages):
        text = page.extract_text().upper()
        
        # Identify key target pages using exact anchor string matches
        if "SCHEDULE C (FORM 1040)" in text or "SCHEDULE E (FORM 1040)" in text:
            target_pages.append(idx)
            writer.add_page(page)

    if not target_pages:
        return None # No self-employment schedules found, skip premium billing

    sliced_filename = os.path.join(scratch_dir, "sliced_schedules.pdf")
    with open(sliced_filename, "wb") as fh:
        writer.write(fh)
        
    return sliced_filename # Send ONLY this 2-page document to your paid Cloud OCR API
```

---

## 8. High-Performance Infrastructure & Dedicated Hosting Spec

Because this engine processes multi-entity, 150-page tax packages, splits PDFs, and runs OCR parsing **strictly inside volatile server RAM**, standard serverless cloud functions (like AWS Lambda) will crash due to execution timeouts and Out-Of-Memory (OOM) errors during peak concurrent loads [cite: 31, 33].

### Production Hosting Recommendation:
* **Infrastructure:** **AWS ECS (Elastic Container Service) on AWS Fargate** or **Google Cloud Run** with dedicated virtual resources.
* **Container Specifications:**
  * **vCPU:** Minimum **2.0 vCPU** per container task (enables rapid multi-threaded PDF stream buffering) [cite: 31].
  * **Memory:** Minimum **4.0 GB RAM** per container task (guarantees multiple 100MB+ PDF documents can be loaded, decrypted, and parsed concurrently inside volatile memory without activating swap drives) [cite: 31, 33].
* **Autoscaling Policy:** 
  * Trigger container replication when average task memory utilization exceeds **70%** or CPU utilization hits **60%** for more than 2 minutes. This ensures immediate capacity during high-volume end-of-month pipeline spikes [cite: 31].
