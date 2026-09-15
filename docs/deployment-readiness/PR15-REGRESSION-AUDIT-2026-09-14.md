# PR 15 Regression Audit — 2026-09-14

## Scope and release boundary

This audit compares `nwjenson/Freeflow#15` (merge commit `e847ab3f`) with the local branch at `b0a8ab0` plus the uncommitted repairs listed below. It covers document classification, parser handoff, UI document/entity synchronization, overlay provenance, and local runtime qualification. It does not change mortgage calculations or deploy to AWS. No PR should be opened until user acceptance testing is complete.

## Decision

Do not revert wholesale to PR 15. PR 15 is a useful behavioral baseline, but it loses later parser coverage and contains pre-existing document-navigation defects. Keep the later W-2 front/back filtering, IRS form extraction, URLA entity discovery, performance gating, tenant/security work, and infrastructure changes. Remove or repair only the regressions identified below.

## Evidence from supplied documents

| Document | PR 15 baseline | Repaired current parser | Decision |
| --- | --- | --- | --- |
| `nates.pdf` | Kept pages 1 and 3 as W-2 pages (back copies); about 53 s in the isolated cold run | Kept pages 0 and 2 as W-2 pages (front copies); Box 5 `168,641.08`; 21.7 s through the rebuilt console | Keep later front/back filtering |
| `20 Locality name.pdf` | OCR ran but no W-2 page was retained; about 63 s | Page 0 retained as W-2 with Box 5 `90,064.58`; 14.6 s through the rebuilt console | Keep later W-2 recognition/extraction |
| `mypay.pdf` | Classified all 3 pages as paystubs but supplied no backend form extracts; about 53 s | Classified all 3 pages and extracted hourly rate `51.9953`, current base `4,159.64`, weekly hours `40`, and page-zero base YTD `91,309.08`; 0.42 s through the rebuilt console | Keep ordered native-row extraction and repair its coordinates |
| `2025 Tax Return Documents (Jenson, Nathan & Katherine).pdf` | Schedule E extraction was correct, but 13 unnecessary OCR pages drove the full parse to about 167 s and beyond the console's old 90 s timeout | 60 pages scanned, 13 retained, only 2 OCR'd; 17.9 s through the rebuilt console. Schedule E remains confirmed with rents `38,677`, expenses `56,097`, and net `-17,420` | Keep Schedule E behavior; retain the label-rich native-text OCR gate |

Times are local observations, not service-level guarantees. Cold OCR remains a launch risk and needs a representative staging performance budget.

## Confirmed regressions and repairs

1. **Employer dropdown collapsed to one PDF.** Commit `fc9f769` replaced packet-level employer hydration with a single row derived from `canvasDoc`. The local repair restores all located wage entities and treats the document chip as an inspection control, not the source of the employer list.
2. **Cross-PDF page collision.** Paystub matching used only `pageIndex`; every PDF begins at page zero. The local repair keys matching by `documentId:pageIndex`.
3. **Conflicting paystub silently attached or discarded.** With one W-2 candidate, an explicitly different paystub identity could be attached to it; an unmatched paystub could then be discarded. The local repair refuses the conflicting attachment and preserves the paystub as a separate discovered wage source.
4. **Wage field click changed documents.** This behavior predates PR 15. The local repair scopes W-2/paystub field inspection to the currently open PDF. Tax/entity navigation retains its packet-wide behavior.
5. **Document chip and employer selector drifted.** Wage seeds now retain contributing document IDs. Selecting a wage document activates its employer, while selecting an employer chooses one of that employer's documents only when the current document does not belong to it.
6. **Paystub overlays targeted labels.** The ordered-row extractor emitted the label rectangle for numeric fields and selected the first repeated label on the page. The local repair walks repeated row labels and emits the exact numeric token rectangle, while preserving the extracted value.

## Intentionally retained behavior

- A 1040 packet containing Schedule E routes to the rental worksheet. PR 15 explicitly required this. This is not evidence that the tax parser became a rental-only parser; the UI should eventually label mixed tax packets more clearly.
- Qualifying W-2 history currently uses Box 5. That is a mortgage/domain decision added after PR 15 and previously requested. It requires partner/domain-owner confirmation rather than an engineering rollback.
- W-2 back-copy exclusion and duplicate-copy handling remain enabled.
- Parser OCR gating and blank native AcroForm shortcuts remain enabled. A scanned-value/blank-widget adversarial case still needs staging coverage.

## Verification completed

- Mortgage-engine and console mapping tests: **84 passed across 14 suites**.
- Parser tests: **61 passed**; the focused overlay suite includes repeated-label paystub coverage and label-rich native-tax-page OCR gating.
- Underwriting console production build: **passed** (`tsc -b` and Vite build).
- Rebuilt local `income-parser` and `underwriting-console` images.
- Local health checks passed at `http://localhost:8080/health` and `http://localhost:3000/health`.
- Reparsed all four supplied documents through the rebuilt local console-to-parser path; every response used `python-ocr` and none used the native fallback.

## User acceptance checklist

At `http://localhost:3000`, load `nates.pdf`, `20 Locality name.pdf`, and `mypay.pdf` into one packet and verify:

1. The employer selector contains separate wage entities instead of only the current PDF.
2. Clicking each top document chip changes the PDF and activates the contributing employer where applicable.
3. Clicking Prior Year W-2 Box 5 does not switch away from the open PDF.
4. On `mypay.pdf`, Hourly Rate, Current Period Base Pay, Hours, and Base Wages YTD highlight their numeric cells, not `Regular Hourly`.
5. The two W-2 PDFs remain separate unless their employer identity genuinely matches.
6. The tax sample continues to route to Schedule E when the packet contains rental schedules.

## Remaining production gaps exposed by this audit

- Before repair, the supplied 60-page tax packet took about 167 seconds locally, and the console's 90-second timeout silently replaced the authoritative response with a native-text fallback lacking the Schedule E grid. The optimized packet now completes in 17.9-21.2 seconds locally (about 7.9x faster) while retaining the confirmed Schedule E values. Local Compose also allows 300 seconds as a safety boundary. Production still needs an asynchronous job/queue boundary and explicit timeout errors rather than silent capability degradation.
- Root cause of that latency was the numeric-overlay rescue gate forcing OCR on 13 label-rich state-tax and comparison pages that the native pre-splitter had already excluded. The gate now retains native text when a page has at least 20 distinct label words, while value-only W-2 overlays and blank scanned W-2 pages continue to OCR. The supplied tax packet now OCRs only pages 7 and 28; W-2 OCR selection remains unchanged.
- Add browser-level tests for multi-PDF chip/entity/field-click behavior; unit tests alone did not catch the regression.
- Define cold and warm parser SLOs by page count/document type and enforce them in staging.
- Build a golden-document manifest with expected classification, retained pages, extracted values, and coordinate tolerances for every supported document type.
- Add a provenance indicator when an accumulated UI value comes from multiple source rows/pages; a single overlay cannot represent a computed aggregate.
- Resolve the Docker Compose obsolete `version` warning and console bundle-size warning separately; neither blocks this local correctness test.
