# B2B Unified Income Engine Monorepo Specification & Directory Mapping
*The Architectural Standard for Isolated AI Income Underwriting, Zero-Retention Coordinate Overlays, and Decoupled SaaS Infrastructure*

---

## 1. Core Architectural Boundary (Pure B2B Isolation)

To eliminate enterprise security liabilities, prevent customer onboarding delays, and maximize system maintainability, we enforce a strict separation of concerns [cite: 31, 33]. 

The **FreeFlow B2B Income Calculations & Document Intake Suite** operates as a standalone, enterprise-grade underwriting utility. All retail-oriented components—specifically the retail Mortgage Broker Point of Sale (POS), consumer loan application wizards, and consumer-facing frontends—are **100% purged** from this repository layout [cite: 31]. 

The suite is organized as a high-performance **Turborepo monorepo** consisting of four decoupled architectural layers [cite: 31, 38]:
1.  **`/services/doc-parser` (Stateless Python Microservice):** Core in-memory PDF page-slicer and CV/OCR sandwich compiler [cite: 31, 33].
2.  **`/packages/mortgage-engine` (Shared TypeScript Math):** Deterministic GSE-compliant calculation rules (Fannie Mae 1084 / Freddie Mac 91) [cite: 11].
3.  **`/packages/database` (Data Persistence & Audit):** Prisma schema defining multi-tenant entities, cryptographic document hashes, and compliance audit histories [cite: 131].
4.  **`/apps/underwriter-portal` (B2B Web Dashboard):** Next.js web portal containing our flipped underwriter workspace, transactional Stripe billing gates, and Encompass sync routes [cite: 152, 159].

---

## 2. Definitive Monorepo File Structure Map

This diagram outlines the complete directory layout, showcasing how each file maps together to run the system with absolute security and zero POS bloat [cite: 31, 33, 38]:

```
freeflow-income-suite/ (Monorepo Root)
├── .github/
│   └── workflows/
│       └── ecs-deploy.yml               # GitHub Actions CI/CD to push Python container to ECR
├── apps/
│   └── underwriter-portal/              # B2B Professional Web Dashboard (Next.js) [cite: 38]
│       ├── src/
│       │   ├── components/
│       │   │   ├── UnderwriterSplitViewDemo-v7.tsx  # Flipped split-screen review canvas [cite: 159]
│       │   │   └── AuditTrailTable.tsx              # Renders OCR-to-manual override trace ledger [cite: 71]
│       │   └── pages/
│       │       └── api/
│       │           ├── billing/
│       │           │   └── webhook.ts   # stripe-billing-router-v4.ts: volumetric transaction gate [cite: 152]
│       │           └── underwrite/
│       │               ├── process.ts   # underwrite-process-route-v2.ts: handles upload streaming [cite: 66]
│       │               ├── encompass-sync.ts # Transmits verified MISMO payloads to Encompass [cite: 18]
│       │               └── pull-docs.ts # encompass-pull-efolder-docs.ts: pulls from eFolder queue [cite: 77]
│       ├── package.json
│       └── next.config.js
├── packages/
│   ├── database/                        # Database modeling and migration scripts
│   │   ├── prisma/
│   │   │   └── schema.prisma            # supabase-schema-v2.prisma: multi-tenant schema [cite: 131]
│   │   └── package.json
│   └── mortgage-engine/                 # Shared deterministic GSE rules and unit tests [cite: 38]
│       ├── src/
│       │   ├── calculateForm1084Income.ts # calculateForm1084Income-v9.ts: math formulas core [cite: 11]
│       │   └── payload-guard.ts         # Enforces strict type verification over raw inputs [cite: 103]
│       ├── tests/
│       │   ├── subject-property-fnma.test.ts # Offsets, vacancy factors, and multi-unit check [cite: 21]
│       │   └── fha-declining-multifamily.test.ts # FHA declining rental properties audit [cite: 118]
│       └── package.json
├── services/
│   └── doc-parser/                      # Stateless Python ECS Fargate microservice [cite: 31, 33]
│       ├── src/
│       │   ├── server.py                # Stateless FastAPI server containing in-memory upload routes [cite: 137]
│       │   ├── ai_pdf_converter.py      # ai_pdf_converter-v2.py: deskew, CLAHE, OCR-sandwich [cite: 112]
│       │   └── pdf_splitter.py          # pre_split_tax_returns-v5.py: regex-driven form splitter [cite: 8]
│       ├── Dockerfile-v2                # Multi-stage, non-privileged Fargate packaging [cite: 106]
│       ├── ecs-task-definition-v4.json  # POS-free task definitions (8.0 GB Fargate RAM configuration) [cite: 68]
│       └── test-tmpfs-isolation.sh      # Shell audit script verifying Zero-Retention disk bypass [cite: 144]
├── .env.slicer                          # env.slicer-v2: POS-free container runtime variables [cite: 37]
├── .env.development                     # Master local database, Redis, S3, and Stripe keys [cite: 133]
├── docker-compose.yml                   # Bootstraps local Postgres, Redis, and MinIO for local dev [cite: 127]
├── pnpm-workspace.yaml                  # Turborepo pnpm packages wiring configuration [cite: 113]
├── turbo.json                           # Configures caching pipeline for zero-cost rebuild builds [cite: 105]
└── copy-assets-v6.sh                    # Automated shell utility script to drop monorepo files [cite: 64]
```

---

## 3. The Enterprise Slicing & Parsing Core (v5 Upgraded)

### **A. Algorithmic "See Statement" Regex Scanning (pdf_splitter.py)**
The core page-splitting utility (`pdf_splitter.py`) operates as a **four-pass deterministic indexer [cite: 30, 38].** 

To maximize accuracy and eliminate catastrophic parsing failures on low-quality tax returns, we replaced generic text-scans with a highly optimized, non-backtracking regular expression pattern [cite: 30]. This pattern is specifically designed to recognize both active and passive variants of underwriter attachments without causing memory exhaustion [cite: 30]:

```python
# Upgraded, non-capturing B2B v5 Slicing Regex [cite: 30]
see_statement_patterns = re.compile(
    r"\b(?:see|refer\s+to|as\s+per)\s+(?:stmt|stat?e?ment|attached|schedule|sch|continuation)(?:\s+\w+)?(?:\s+(?:attached|sheet|\d+))?\b|"
    r"\b(?:stmt|stat?e?ment|schedule|sch)(?:\s+\w+)?\s+attached\b",
    re.IGNORECASE
)
```

#### **How the Parser Evaluates This Pattern:**
1.  **Pass 1 (Core Discovery):** The engine scans the entire document page-by-page. When it detects standard IRS forms (like Schedule C or E) [cite: 38], it extracts the page text and runs `see_statement_patterns` [cite: 30].
2.  **Pass 2 (Lazy Statement Scanning):** If (and only if) the regex matches a trigger (like *"Schedule E Part II - See Sched E Attached"* or *"refer to statement 1"*) [cite: 30], the script sets `has_see_statement_trigger = True` [cite: 30].
3.  **Pass 3 (Targeted Zone Traversal):** To avoid scanning hundreds of pages of unrelated loan manuals or bank brochures, the statement scanner restricts its execution **strictly to the last 20% or last 15 pages of the document** (where tax statements are legally appended by software like TurboTax) [cite: 30].
4.  **Pass 4 (Execution Slicing):** The matching schedules and supporting statement pages are programmatically compiled using `pypdf` [cite: 30, 106]. Any page that did not contain a core form or a matched statement is **permanently discarded**, achieving up to a **90% file volume reduction [cite: 30]** before calculations begin.

---

## 4. Normalized Spatial Coordinate Mapping (HTML5 Canvas View)

To render highlight boxes over scanned documents responsively without corrupting the original file [cite: 30], the engine utilizes **relative percentage coordinates** rather than absolute pixel positions [cite: 140]:

```
      (0,0) ┌───────────────────────────────────────┐
            │                                       │
            │     [x: 0.15, y: 0.22, w: 0.30, h: 0.05]
            │     ┌──────────────────┐              │
            │     │ Net profit/loss  │              │
            │     └──────────────────┘              │
            │                                       │
            │                                       │
            │                                       │
            └───────────────────────────────────────┘ (1.0, 1.0)
```

#### **The Mathematical Translation Formula [cite: 72]:**
When Tesseract OCR extracts bounding boxes, it returns raw pixels based on Poppler’s rendered image resolution (typically 300 DPI) [cite: 106, 112]:
\\[X_{\text{raw}}, Y_{\text{raw}}, W_{\text{raw}}, H_{\text{raw}}\ \in\ \text{Pixels}\\]
Our Python engine (`ai_pdf_converter.py`) immediately translates these into **normalized relative percentages** based on the total dimensions of the rendered page image [cite: 140]:
\\[X_{\text{rel}} = \frac{X_{\text{raw}}}{\text{Image Width}}\\]
\\[Y_{\text{rel}} = \frac{Y_{\text{raw}}}{\text{Image Height}}\\]
\\[W_{\text{rel}} = \frac{W_{\text{raw}}}{\text{Image Width}}\\]
\\[H_{\text{rel}} = \frac{H_{\text{raw}}}{\text{Image Height}}\\]

#### **Why This is Vital for the Frontend Canvas (`UnderwriterSplitViewDemo-v7.tsx`) [cite: 140]:**
When our B2B interface renders the PDF on the left panel [cite: 159], we overlay a transparent **HTML5 `<canvas>` element** directly on top of the browser viewport [cite: 140]. 
1.  The browser's layout is responsive; an underwriter on a 4K monitor might render the PDF page at `1200` pixels wide, while an underwriter on a laptop renders it at `650` pixels wide [cite: 140].
2.  Because our coordinates are returned as relative decimals `(0.15, 0.22)`, the React viewport calculates the pixel offsets dynamically in real-time based on its active viewport bounding client rect [cite: 140]:
    \\[X_{\text{render}} = X_{\text{rel}} \times \text{Current Canvas Width}\\]
    \\[Y_{\text{render}} = Y_{\text{rel}} \times \text{Current Canvas Height}\\]
3.  **The Result:** The highlighted boxes line up with 100% surgical accuracy regardless of zoom level, resolution, window sizing, or device orientation, providing a flawless, pixel-aligned auditing experience without modifying the underlying PDF source bytes [cite: 30, 140].

---

## 5. Security Proof: Decoupled PDF2Image & Poppler Architecture

Institutional security teams often flag **`pdf2image` and Poppler** because, in generic setups, they spawn subprocesses that write temporary, unencrypted `.png` image files to the default Linux filesystem `/tmp` directory, risking data leaks of consumer NPI [cite: 33, 41].

Inside the **FreeFlow doc-parser**, we implement **two airtight guardrails** to prove complete, zero-retention security to bank auditors [cite: 33, 72]:

### **Guardrail A: Pure In-Memory Byte Buffering [cite: 1]**
We configure `pdf2image` and `OpenCV` to operate entirely within Python's volatile virtual RAM heap.
*   We ingest the uploaded file directly as a raw byte array from the FastAPI request stream [cite: 149].
*   We pass the raw byte array directly to Python’s internal buffer memory:
    ```python
    # Streams raw PDF bytes into a volatile in-memory heap [cite: 1]
    pdf_bytes_stream = io.BytesIO(upload_file)
    images = pdf2image.convert_from_bytes(pdf_bytes_stream.read())
    ```
*   `convert_from_bytes` reads the binary block directly and returns standard **PIL Image objects mapped inside RAM [cite: 1].**
*   OpenCV converts these PIL images directly to **NumPy matrix arrays** [cite: 30].
*   At no point in our Python script do we invoke disk-write commands (like `cv2.imwrite` or `image.save(path)`) [cite: 1, 30]. The documents never touch a physical folder inside the container during processing [cite: 1].

### **Guardrail B: Fargate Ephemeral Block Encryption & Crypto-Shredding [cite: 3, 166]**
If the underlying operating system kernel (Linux virtual memory manager) undergoes RAM congestion due to a massive 150-page document portfolio, it may decide to temporarily dump page caches to `/tmp` [cite: 31, 33]. 

We neutralize this threat at the **AWS hypervisor level [cite: 138, 160]:**
1.  **AES-256 Storage Gating:** AWS Fargate natively encrypts all ephemeral storage blocks at rest using the default managed key **`aws/fargate`** [cite: 3, 160]. 
2.  **AWS Key Isolation:** Our AWS customer account has **zero IAM permissions** to access or export this key [cite: 31, 138, 160]. Decryption is restricted entirely to the Fargate managed hypervisor.
3.  **Cryptographic Erasure (Crypto-Shredding):** The millisecond the container completes the request and scales down or terminates, AWS permanently discards the unique task decryption key and destroys the virtual task instance [cite: 31, 166]. Without the key, any physical bits cached to `/tmp` during execution are instantly turned into **unrecoverable cryptographic noise [cite: 138, 166].**

This dual-layer approach guarantees that **even under a forensic physical drive scan, zero borrower information is ever retrievable**, establishing an airtight compliance story for Saturday’s production deployment [cite: 31, 33]!
