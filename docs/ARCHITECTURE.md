# FreeFlow B2B Income Suite Architecture

*Document version: 4.1 — aligned to `b2b-income-monorepo-structure-v4.md` and the in-memory parser now running locally.*

This is the live architecture note. Older playbooks (`ARCHITECTURE.md` v2, monorepo structure v2) described a retail POS + sandwich-PDF stack. Those are archived. The product is a **B2B income-underwriting utility only**.

---

## 1. Boundary

The suite is a standalone underwriting tool. Retail broker POS, consumer application wizards, and borrower-facing portals are out of this repo.

Four layers:

| Layer | Path | Role |
| --- | --- | --- |
| Parser | `services/doc-parser` | Stateless FastAPI. Bytes in, JSON out. No PDF persist. |
| Math | `packages/mortgage-engine` | Form 1084 / Form 91 / HUD 4000.1 / USDA rules (v9). |
| Data | `packages/database` | Prisma / Supabase multi-tenant schema and RLS. |
| UI | `apps/underwriting-console` (Vite lab) and `apps/underwriter-portal` (Next.js) | Split-screen QA, audit ledger, billing, Encompass routes. |

Encompass eFolder is the system of record for original PDFs. FreeFlow streams or receives bytes, returns coordinates and labels, and does not keep binaries.

---

## 2. Repository map (as implemented)

```text
Freeflow/
├── apps/
│   ├── underwriting-console/          # Local Vite console :3000 (Parser Lab + split v7)
│   │   └── src/
│   │       ├── components/            # Split v7, Audit, USDA, Parser Lab
│   │       └── server/summaryPdfMiddleware.ts  # PDFKit 1084 summary (RAM stream)
│   ├── underwriter-portal/            # Next.js B2B portal (billing, Encompass)
│   │   └── src/pages/api/underwrite/
│   │       ├── summary-pdf.ts         # PDFKit 1084 income summary sheet
│   │       └── process.ts             # Forwards bytes to live parser :8080
│   └── web/                           # Leftover POS-era tree; not the live local UI
├── packages/
│   ├── mortgage-engine/src/
│   │   ├── calculateForm1084Income.ts # v9 (Architecture drop calculateForm1084Income-v9.ts)
│   │   ├── generateIncomeSummaryPdf.ts # PDFKit draw instructions (no disk)
│   │   ├── payload-guard.ts
│   │   ├── usda-projected-income-engine-v2.ts
│   │   └── usda-ssi-rules-engine.ts
│   ├── database/prisma/schema.prisma
│   └── rules-engine/                  # Encompass field map + share-token rules
├── services/doc-parser/
│   ├── src/server.py                  # POST /parse, POST /api/underwrite/process
│   ├── src/ai_pdf_converter.py        # pypdfium2 + RapidOCR, relative boxes [0,1]
│   ├── src/pdf_splitter.py            # v5 See-Statement regex, in-memory only
│   ├── Dockerfile                     # Python 3.12, no Poppler/Tesseract
│   ├── requirements.txt
│   └── ecs-task-definition.json       # Fargate 8 GB (floor is 2 vCPU / 4 GB)
├── docs/
│   ├── ARCHITECTURE.md                # This file
│   ├── b2b-income-monorepo-structure-v4.md
│   ├── income-pdf-summary-spec.md     # 1084 summary sheet (PDFKit / ZDR stream)
│   ├── summary-pdf-route.ts           # Drop source for the Next route
│   ├── b2b-qa-sandbox-playbook.md     # QA phases (Phase 2 sandwich checks are obsolete)
│   └── UnderwriterSplitViewDemo-v7.tsx
├── copy-assets-v5.sh                  # Hardened migrator (does not overlay live parser)
├── docker-compose.yml
├── pnpm-workspace.yaml
└── turbo.json
```

Canonical spec drop: `docs/b2b-income-monorepo-structure-v4.md`. Where that file still says sandwich PDF, Poppler, Tesseract, or `Dockerfile-v2`, **this document wins**.

---

## 3. Parser contract

`POST /parse` and `POST /api/underwrite/process` accept raw `application/pdf` or multipart `file`. Response is JSON only:

- page indices, form labels, relative boxes `(x, y, w, h) ∈ [0, 1]`
- confidences, flags, unresolved “See Statement” hits
- **no** sandwich PDF, **no** `sliced_pdf_payload_b64`

Pipeline:

1. Native-text skip via `pypdf` when a page has enough extractable characters.
2. Otherwise render one page at a time with **pypdfium2** at 300 DPI (in-process, no `/tmp` PNGs).
3. CLAHE + deskew; Sauvola retry if mean OCR confidence is below 55.
4. **RapidOCR (ONNX)** — local neural OCR, not Textract, not Tesseract.
5. `pdf_splitter.py` classifies from in-memory text. Empty keep set + `no_core_forms_detected` if nothing matches. No “first 4 pages” fallback. No PDF write.

Logs must not print OCR word text. CloudWatch is the leak surface, not the container disk.

Fargate: do not request 2 vCPU / 2 GB (invalid). Current task JSON is **8 GB**. tmpfs is a small tripwire (~64 MiB), not a document store.

Local: `docker run -p 8080:8080 --memory=4g freeflow-doc-parser:v3`. Vite proxies `/parse` and `/health` to `127.0.0.1:8080`.

---

## 4. Split-screen QA

Live canvas is **`UnderwriterSplitViewDemo-v7`**: flipped workspace (source on the left, ledger / overrides on the right), W-2 withholding fraud sim, FHA multi-family decline, share-link modal.

Overlay math: parser boxes are **0–1 relative**. Render as `x * canvasWidth`. Demo fixtures in v7 still use 0–100 style numbers; the Parser Lab uses the live 0–1 JSON.

Older split files (v3, v5) are under `archive/`.

---

## 5. Income engine (v9)

`calculateUnifiedIncome` in `packages/mortgage-engine/src/calculateForm1084Income.ts`:

- Declining self-employed / variable income → most recent 12 months when required
- FHA multi-family rental decline (HUD 4000.1, 20% tripwire)
- C-corp &lt; 25% ownership → W-2 + dividends only; ≥ 25% + liquidity test
- Schedule E rental vs royalty (depletion / 3-year continuance)
- Gross-up caps: FHA 1.15, Conventional/VA 1.25
- Subject-property rental (v9)
- USDA dual-track helpers in `usda-projected-income-engine-v2.ts`

Tests under `packages/mortgage-engine/tests/` import this file (not the old v5/v6/v7 filenames).

---

## 6. Security (ZDR as built)

- Memory-only PDF processing; path inputs raise `TypeError`
- JSON coordinates only; original PDF stays in Encompass
- No OCR text in application logs
- Multi-tenant `tenant_id` + RLS in Prisma (when the portal DB is wired)
- Stripe volumetric gate lives on the portal webhook (`stripe-billing-router-v4`)

Do not treat MinIO/S3 in `.env.development` as a place to park tax PDFs in production.

---

## 7. Local run

| Service | URL |
| --- | --- |
| Underwriting console | http://localhost:3000 |
| Parser | http://127.0.0.1:8080/health |
| Bulk PDF harness | `docs/bulk-accuracy-test-runner.sh` (needs `./test-docs/*.pdf`) |

Parser Lab tab POSTs to `/parse`. Split View **Print 1084 Summary** streams a PDFKit income sheet from RAM (`/api/underwrite/summary-pdf`). Audit / USDA tabs are fixture UIs until they consume parse JSON. Split View numbers are still demo fixtures.

Do **not** use `ai_pdf_converter-v2.py` or `docs/underwrite-process-route-v2.ts` as live ingest. Those write `/tmp` PDFs and exec the old sandwich converter. Live ingest is FastAPI + the scripted `services/doc-parser/src/ai_pdf_converter.py`.

---

## 8. What the v4 drop still gets wrong

Update these when you next edit the v4 spec itself:

- Renderer is **pypdfium2**, not pdf2image/Poppler.
- OCR is **RapidOCR**, not Tesseract (`TESSDATA_PREFIX` in `.env.slicer` is leftover).
- Container file is **`Dockerfile`**, not `Dockerfile-v2`.
- Migrator on disk: `copy-assets-v5.sh` (hardened) and `docs/copy-assets-v7.sh` (do not overlay converter-v2 / process-v2 onto live src).
- Live local UI is **`apps/underwriting-console`**, not only `underwriter-portal`.
- `docs/b2b-qa-sandbox-playbook.md` Phase 2 still asks for sandwich PDF / `sliced_pdf_payload_b64`. Those checks are obsolete.

---

## 9. Form 1084 income summary PDF

This is a **generated worksheet**, not a filled FNMA 1084 AcroForm and not a sandwich of the borrower's tax PDF.

| Path | Role |
| --- | --- |
| `packages/mortgage-engine/src/generateIncomeSummaryPdf.ts` | Draw instructions + demo fixture |
| `apps/underwriting-console/src/server/summaryPdfMiddleware.ts` | Vite `:3000` stream (`GET /api/underwrite/summary-pdf`) |
| `apps/underwriter-portal/src/pages/api/underwrite/summary-pdf.ts` | Next.js stream; Prisma when `DATABASE_URL` has a loan row |

No write to `/tmp`. Converter stays `services/doc-parser/src/ai_pdf_converter.py` (pypdfium2 + RapidOCR).
