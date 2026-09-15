# Adversarial Document Qualification

This is a release gate, not a demo checklist. A document does not pass merely
because it was classified or produced non-empty output. Each supported field
must match recorded ground truth and remain linked to the correct source page.

## Corpus scope

| Family | Required document/layout coverage | Current evidence |
|---|---|---|
| Wage | W-2 current/prior layouts, four-copy sheets, front/back packets, Paystub digital/scanned, WVOE/Form 1005 | W-2 and digital paystub live samples pass locally; WVOE pending |
| Individual | Form 1040; Schedules B, C page 1/2, D, E page 1/2/Part III, F | Existing clean fixtures only; adversarial qualification pending |
| Partnership | Form 1065; K-1 1065; Schedule L/M-1/M-2; Form 8825; Form 4562 | Existing clean fixtures only; adversarial qualification pending |
| S corporation | Form 1120-S; K-1 1120-S; Schedule L/M-1/M-2; Form 8825; Form 4562 | Existing clean fixtures only; adversarial qualification pending |
| C corporation | Form 1120; Schedule L/M-1/M-2; Form 8825; Form 4562 | Existing clean fixtures only; adversarial qualification pending |
| Trust/estate | K-1 1041 and Schedule E Part III routing | Classification coverage only; field qualification pending |
| Appraisal | Every form admitted by the appraisal upload route, currently including URAR 1004/70 | Clean native/AcroForm only; scan/OCR qualification is an open production blocker |
| Unsupported | Instructions, blank backs, unrelated PDFs/images, encrypted/corrupt/polyglot/oversize inputs | Must fail closed or produce an explicit unsupported/manual-review result; never silent zeroes |

The executable inventory must be generated from parser classifiers and upload
admission code during CI. A new admitted type without a corpus manifest entry
fails the release gate.

## Authoritative sources

- Current IRS forms: `https://www.irs.gov/forms-instructions`
- Prior-year IRS forms: `https://www.irs.gov/forms-pubs/prior-year`
- Fannie Mae Selling and Servicing Guide forms, including 1004 and 1005:
  `https://singlefamily.fanniemae.com/selling-servicing-guide-forms`
- FUNSD noisy scanned-form benchmark for local artifact calibration only:
  `https://github.com/crcresearch/FUNSD`
- DocLayNet for permissively licensed general layout stress testing:
  `https://github.com/DS4SD/DocLayNet`

Do not commit public documents containing personal information. Do not
redistribute research-only datasets. Pin the source URL, retrieval date,
document revision, SHA-256, and license/provenance in the local corpus manifest.

## Ground-truth tiers

1. **Blank official form:** correct classification, correct page inclusion, and
   zero extracted borrower values. Any hallucinated value is a failure.
2. **Filled official form:** known non-PII values in every supported field,
   including negative, zero, comma-separated, decimal, percentage, and EIN
   values. Every value and page/entity association must match exactly.
3. **Rendered scan:** rasterize the filled official form so no native text or
   AcroForm value remains. The expected values are identical to tier 2.
4. **Adversarial scan:** apply one controlled artifact and then mixed artifacts.
   The expected values remain identical; otherwise the parser must return an
   explicit low-confidence/manual-review outcome instead of a plausible wrong
   value.
5. **Mixed packet:** reorder years and entities; add duplicate pages, blank
   backs, instructions, unrelated pages, and multiple document types. No value
   may cross its document, page, year, or entity boundary.

## Required adversarial variants

- rotations of 90, 180, and 270 degrees, including an image rotated inside an
  upright PDF page;
- skew at +/-2, +/-5, and +/-10 degrees;
- 300, 200, 150, and 100 DPI rasterization;
- JPEG quality 85, 50, and 25; fax-like monochrome and repeated print/scan noise;
- low contrast, uneven lighting, shadows, blur, moire, background texture, and
  colored security paper;
- edge crop, perspective warp, torn/folded edges, hole punches, staples, stamps,
  signatures, highlighting, and handwritten marks near—but not replacing—the
  ground-truth field;
- tiny multi-copy layouts, dense tables, values touching grid lines, negative
  parentheses, leading dollar signs, commas, decimal loss, and nearby box/EIN
  numbers designed to look like the target value;
- native-text overlays that contain values but omit labels; mixed native/OCR
  pages; duplicate and contradictory layers;
- encrypted, malformed, truncated, oversized, excessive-page, and PDF/polyglot
  inputs for fail-closed admission testing.

## Release acceptance

- Critical identity and monetary fields: exact normalized match on every clean,
  native, and supported rendered-scan case.
- Adversarial cases: exact match or explicit manual-review/unsupported status;
  a confident wrong value is never acceptable.
- No values from excluded backs, instruction pages, blank forms, or neighboring
  cells; no cross-document or cross-entity UI display.
- Bounding evidence must be on the same page and overlap the actual source cell;
  template-only or zero-coordinate evidence fails.
- Repeat runs are deterministic. No raw document, OCR text, or PII is persisted
  or logged.
- Latency and memory are reported by document type, page count, and artifact.
  Performance optimizations may skip OCR only when the higher-integrity source
  layer has been positively established.

## Current gate status

The ordinary parser suite passes 54 tests. Local end-to-end samples currently
pass for a four-page W-2 packet, a sideways single-page W-2, and a three-page
digital paystub. This does **not** satisfy the adversarial release gate. Every
other row above remains open until a pinned corpus entry, exact expected output,
and production-like endpoint result are recorded.
