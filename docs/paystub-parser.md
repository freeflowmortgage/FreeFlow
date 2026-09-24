# Pay stub parser

Extracts base and variable income from a pay stub. Lives at
`services/doc-parser/src/paystub/` so it ships in the income-parser image, and
`irs_form_extract` delegates pay stub pages to it. It shares no code with the
legacy table reader, which remains as a fallback for pages this parser cannot
reconcile.

```python
from paystub import parse_paystub

result = parse_paystub(pdf_bytes)          # bytes or bytearray, never a path

result.income.base_ytd                     # Decimal('103287.66')
result.income.monthly_base_at_current_rate # Decimal('9012.52')
result.reconciliation.balanced             # True
result.warnings                            # lines a human needs to look at
```

## What it reads

| Field | Source |
| --- | --- |
| Employer, employee, employee ID | Identity block |
| Pay period begin/end, check date | Identity block |
| Base income | Hourly rate x hours worked, per earnings line |
| Base YTD | Regular, sick, vacation, holiday, floating/my holiday, PTO, plus education, training, jury duty, bereavement and military leave |
| Variable pay | Overtime, bonus, commission, tips, stock awards, shift differential |
| Pay frequency | Derived from the period span, then used for monthly figures |

Variable pay is split into the boxes the income tool reports: `overtime_ytd`,
`bonus_ytd`, `commission_ytd`, `tips_ytd`, `rsu_ytd`, `other_variable_ytd`.

**Shift differential reports inside overtime.** Shift, night, and weekend
differential are premium pay on worked hours, so they behave like overtime
rather than like a bonus. Each stub carrying one adds a disclosure to
`result.disclosures` for display beneath the income boxes:

> Shift differential is included in overtime pay. Confirm continuance and
> history. (Night Differential, $1,300.00 YTD)

`disclosures` is deliberately separate from `warnings`: a disclosure is
underwriter messaging, a warning is data the parser could not resolve.

## How it is reached from the service

`irs_form_extract.extract_page_fields` calls this parser for any page that
classifies as a pay stub. The delegation is gated on the parser's own
reconciliation: it claims a page only when the earnings lines sum to the
printed earnings total and the cash lines sum to printed gross pay. A page it
cannot balance falls back to the legacy `_extract_paystub_table`, because
wrong values carrying confident overlay boxes are worse than no fields.

Look for `paystub_parser_used` or `paystub_parser_declined` in the service log
to see which path handled a page.

## Overlay boxes for underwriter QA

`income_fields(result)` returns `formExtracts` records in the shape the
console already renders for W-2 and Schedule E, reusing the `ps-*` field IDs
it maps today, so pay stub highlights work without a UI change:

```python
from paystub import income_fields, parse_paystub

income_fields(parse_paystub(pdf_bytes))
# [{'pageIndex': 0, 'sourceFieldId': 'ps-base-ytd', 'value': '103,287.66',
#   'numericValue': 103287.66, 'box': {'x': 0.55, 'y': 0.277, 'w': 0.053, 'h': 0.14},
#   'componentBoxes': [...8 source cells...], 'entityId': 'paystub-p0', ...}]
```

Two rules keep highlights from silently vanishing:

* Boxes point at the **numeric cell**, not the row label, and aggregates carry
  `componentBoxes` for every contributing cell.
* Every box is padded above the console's `isUsableOverlayBox` floor of 0.004.
  A box tight around a thin glyph such as `1` falls under that on a letter
  page and is discarded by the viewer while the field still looks populated.

A field with no located cell is **omitted entirely** rather than reported with
a zero box. The console claims a field ID as soon as the parser returns it and
then skips its own word-based fallback, so a dead box permanently suppresses
geometry the console could have derived itself.

## Why the output can be trusted

Classification is guesswork unless it ties out, so the parser checks itself
against three figures the stub prints on its own. All three are reported on
`result.reconciliation`, and `balanced` is false if any fails.

1. **Lines sum to the earnings footer.** Catches a row that was missed or
   double-counted.
2. **Cash lines sum to gross pay.** Catches imputed income. Employer-paid
   items such as group term life and `LTD (ER)` are printed inside the
   earnings table but excluded from gross pay; counting them would overstate
   income. On the stub this was built against, the difference was exactly the
   $285.00 of non-cash lines.
3. **Hours x rate reproduces each amount.** Also proves the recovered column
   grid is correct, since a shifted or swapped column would break the product.

Two behaviors matter when reading results:

* **An unrecognized earning code is never guessed into a bucket.** It is left
  `UNKNOWN`, excluded from every total, and raised as a warning. Employer-
  specific codes are common, and quietly folding one into base pay overstates
  qualifying income.
* **Repeated descriptions are kept as separate lines.** Payroll systems run
  distinct earning codes behind one label. The reference stub carried two
  `Regular Hourly` codes with separate YTD balances, $78,184.10 and
  $8,439.82; keying totals by description would have silently dropped the
  smaller one.

## Zero document retention

The document stays in memory from end to end. PDFium parses from a byte
buffer, rendering lands in a NumPy array, and OCR runs in-process against ONNX
weights bundled in the wheel. There is no temporary file, no spooled upload,
no cached raster, and no OCR vendor call, so no third party retains anything.

Two controls in `paystub.memory` cover what the code path alone cannot, and
both report failure rather than raising, since a parser that refuses to start
is worse than one that reports a weaker guarantee:

```python
from paystub import disable_core_dumps, lock_memory

locked, detail = lock_memory()   # mlockall: keeps pages out of swap
disable_core_dumps()             # stops a crash dumping document bytes
```

`lock_memory()` needs `RLIMIT_MEMLOCK` headroom, which in practice means
granting the container `IPC_LOCK`.

CPython cannot wipe an immutable `bytes`. Pass a `bytearray` and the buffer
you own is zeroed:

```python
from paystub import ephemeral

with ephemeral(upload) as buffer:
    result = parse_paystub(buffer)
# buffer is zeroed here, including if parsing raised
```

### ONNX Runtime telemetry is disabled at import

Left at its defaults, ONNX Runtime writes a persistent device identifier and a
telemetry database under `~/.cache/Microsoft/DeveloperTools/.onnxruntime`, plus
a debug log in `/tmp`. None of it holds document bytes, but a document path
that creates files and a stable machine ID cannot claim zero retention.
`paystub.extract` sets `ORT_DISABLE_TELEMETRY=1` before the runtime loads.
`services/doc-parser/tests/test_paystub_zero_retention.py` fails if any of it comes back.

### Callers still have to avoid the usual leaks

The parser cannot enforce these:

* **Do not use FastAPI/Starlette `UploadFile`.** It spools to a real temp file
  once the payload passes its rollover threshold. Read the raw body from
  `request.stream()` instead.
* **Do not let a reverse proxy buffer to disk.** nginx writes large request
  bodies to `client_body_temp` and responses to `proxy_temp`; set
  `client_body_buffer_size` above your size cap and disable proxy buffering.
* **Do not log document content**, and keep parsed values out of error
  reporting, which persists payloads outside your control.

## Tests

```bash
cd services/doc-parser
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

No real pay stub is committed. `services/doc-parser/tests/paystub_fixtures.py` generates a synthetic stub
at test time and emits the PDF by hand, so the suite carries no reporting
dependency. Every end-to-end case runs twice, once against a PDF with a text
layer and once against the same stub flattened to pixels, because a scanned
stub has to underwrite the same as a digital one.

To check a real document without committing it, point the opt-in test at a
path outside the repository:

```bash
PAYSTUB_FIXTURE=/secure/local/stub.pdf .venv/bin/python -m pytest -k real_document
```

`services/doc-parser/tests/test_paystub_zero_retention.py` proves the retention claim two ways: it watches
an empty `TMPDIR` and working directory for new files, and it re-runs a parse
under `strace`, failing if any path is opened for writing. Patching `open`
would prove nothing, because PDFium and ONNX Runtime are C extensions that
call `openat` directly.

## How far it generalizes

Column roles are read from the **earnings header**, not assumed from column
count or order. Candidate readings of the header are scored against the
columns the data actually forms, which is what settles ambiguous wording such
as `Amount | YTD Hours` versus `Amount YTD | Hours`.

`services/doc-parser/tests/paystub_variants.py` holds alternate layouts that each change one thing a
different provider would change, and `services/doc-parser/tests/test_paystub_variants.py` asserts the
totals their arithmetic requires:

| Layout | Exercises |
| --- | --- |
| `rate_before_hours` | `Rate` before `Hours`, `This Period` / `Year to Date` wording, 4 columns |
| `salaried_semimonthly` | Salaried, no hours or rate columns at all, `Current` / `YTD` only |
| `leave_codes` | Weekly; education, training, jury duty, bereavement, differential, tips |

What still has to hold: an `Earnings` section with a header row, numeric
columns that are **right-aligned**, and a `Description` column on the left.
A centre-aligned or fully ruled grid would need different anchoring.

The honest summary is that the parser is no longer tied to the one stub it was
built against, but it has been verified against one real provider plus three
synthetic layouts. The reconciliation gate is what makes an unverified
provider fail loudly instead of silently, so check a new provider with
`PAYSTUB_FIXTURE` before trusting it.

## OpenCV preprocessing was measured and rejected

The parser uses `pypdfium2` for rendering and text, and deliberately does
**not** preprocess images with OpenCV. That was tested, not assumed.

Against a synthetically degraded scan (1.6 degrees of skew, Gaussian blur, 45%
contrast, sensor noise), every classical preprocessing step tried made accuracy
the same or worse:

| Preprocessing | Checks passed |
| --- | --- |
| clean render (upper bound) | 5 / 5 |
| degraded, no preprocessing | 2 / 5 |
| deskew only | 1 / 5 |
| CLAHE only | 1 / 5 |
| unsharp mask only | 0 / 5 |
| Otsu binarization only | 0 / 5 |
| deskew + CLAHE + unsharp | 2 / 5 |

RapidOCR's detector is a CNN trained on photographed and scanned pages, so it
already tolerates moderate skew and contrast loss. Binarization and sharpening
were tuned for an earlier generation of OCR and throw away gradient
information this detector uses. The existing `doc-parser` reaches the same
conclusion structurally by gating its OpenCV path behind a `_looks_like_photo`
check rather than applying it to every page.

What actually protects the underwriter on a bad scan is the reconciliation
gate: the degraded scan above produces `balanced = False` and nine warnings, so
it is flagged for review rather than quietly returning wrong income.

## Known limits

* Reads the first page only. Multi-page stubs and multi-stub packets need page
  selection ahead of this.
* Verified against one real provider and three synthetic layouts; see the
  generalization section above.
* `tidy_text` repairs OCR word-joining by splitting on capitals, so a surname
  like `McDonald` renders as `Mc Donald`. Display only; it cannot change how a
  line is classified.
* An unrecognized earning code is excluded from every total and surfaced as a
  warning. That is intentional, but it means a provider with unusual code names
  will under-report income until its codes are added to `taxonomy.py`.
