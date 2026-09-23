# Deploying this change to AWS

What has to change in an existing dev/staging/production environment when this
branch lands. Items are ordered by consequence: the first two will bite you,
the rest are tuning and hygiene.

Measured on this build, 300 dpi scanned pages through the full pipeline:

| Pages OCR'd | Wall time | Per page | Peak RSS |
| --- | --- | --- | --- |
| 1 | 5.3 s | 5.3 s | 731 MB |
| 5 | 16.3 s | 3.3 s | 904 MB |
| 10 | 31.7 s | 3.2 s | 914 MB |

Memory plateaus near 900 MB because pages are rendered and released one at a
time, so the existing 4 GB task is comfortable. **Time is the binding
constraint**, not memory.

## 1. Required: add `DOCUMENT_ID_HMAC_KEY`

The parse response now carries `document_id`, a digest of the uploaded bytes
that is identical for every submission of the same file. That is what lets the
caller recognise a resubmission and not bill for it twice. `transaction_id` is
a random UUID per request and cannot do this.

Without the key the service still runs, logs `document_id_unkeyed` at startup,
and falls back to a bare SHA-256. A bare digest is reproducible by anyone
holding the same file, so an outsider could confirm that a specific document
passed through the service. Keying it removes that while keeping dedup working.

```hcl
resource "aws_secretsmanager_secret" "document_id_hmac" {
  name                    = "${local.name_prefix}/document-id-hmac-key"
  description             = "Keys the content-derived document id used for submission dedup"
  recovery_window_in_days = 7
}

# In the income-parser container definition:
secrets = [
  { name = "DOCUMENT_ID_HMAC_KEY", valueFrom = aws_secretsmanager_secret.document_id_hmac.arn },
]
```

**The key must be stable for the life of the environment.** Rotating it changes
every `document_id`, so every previously seen document looks new and gets
billed again. Use a different key per environment so dev ids never collide with
production ids.

## 2. Required: raise the ALB idle timeout, or lower the OCR page budget

Scanned pages that used to be skipped are now OCR'd. That is the point of the
fix, but it makes large scanned packets take materially longer.

The current chain caps out at the ALB:

| Hop | Limit |
| --- | --- |
| ALB `idle_timeout` (`edge.tf`) | **180 s** |
| Console `DOC_PARSER_TIMEOUT_MS` | 300 s |
| Parser `OCR_PAGE_BUDGET` | 80 pages |

At 3.2 s/page a full 80-page budget is about 256 s, which the ALB cuts at 180 s.
Pick one:

* **Raise the timeout** to `idle_timeout = 300` in `edge.tf`. Keeps the 80-page
  budget usable end to end.
* **Or cap the work** with `OCR_PAGE_BUDGET=50` on the parser task, which lands
  around 160 s and fits inside the existing 180 s with headroom.

A packet that exceeds the budget is not silently truncated: the parser logs
`ocr_budget_exceeded` with the skipped page indices, and prefers pages that
were already recognised.

Longer term this wants to be asynchronous, with the upload returning a job id
and the console polling. That is a larger change than this branch.

## 3. Optional environment variables

| Variable | Default | Why you would set it |
| --- | --- | --- |
| `OCR_PAGE_BUDGET` | `80` | Bound worst-case request time (see above) |
| `ORT_DISABLE_TELEMETRY` | `1`, set in code | Set explicitly for defence in depth |
| `DOCUMENT_ID_HMAC_KEY` | unset | Required, see above |

`ORT_DISABLE_TELEMETRY` is applied by `ai_pdf_converter` and `server` before
ONNX Runtime loads. Left at its own default the runtime writes a persistent
device identifier and a telemetry database under
`~/.cache/Microsoft/DeveloperTools/.onnxruntime` plus a debug log in `/tmp`.
With `readonlyRootFilesystem = true` those writes would fail rather than
succeed, but they are now not attempted at all.

## 4. Zero retention on Fargate

Worth stating plainly, because the local compose file can mislead: the
`tmpfs: /tmp` mount in `docker-compose.yml` **does not exist on Fargate**.
`linuxParameters.tmpfs` is EC2-only. The `parser-tmp` volume mounted at
`/tmp/freeflow` in `compute.tf` is task ephemeral storage, which is disk.

So the zero-retention guarantee in production rests on the service not writing
anything, not on the filesystem being volatile. A syscall audit of the full
pipeline now records **0 writable opens** per parse, and
`tests/test_paystub_zero_retention.py` fails if that regresses. Supporting
controls already in place:

* `readonlyRootFilesystem = true` and `user = 8888`
* Fargate platform `1.4.0`, where ephemeral storage is AES-256 encrypted
* core dumps disabled at startup, the remaining way an in-memory parser could
  spill a document to disk

No infrastructure change is needed here. Do not add an EFS volume to the parser
task; it has nothing to persist.

## 5. Nothing to change, but verify

* **Task size.** `compute.tf` gives the parser 1024 CPU / 4096 MB. Peak RSS is
  ~900 MB, so memory is fine. CPU is what sets the 3.2 s/page figure; doubling
  it is the lever if you need it faster.
* **Image size.** `main` added `templates/fw2.pdf` (~2 MB). No action.
* **Health check.** Unchanged. OCR model warmup runs on a background thread, so
  `/health` still answers during startup.
* **API response.** `document_id` and `reviewNotes` are additive. Existing
  consumers are unaffected; `reviewNotes` is optional on `FormFieldExtract`.

## 6. Recommended: build the console in CI

`main` was failing `tsc -b` on the console and one jest suite on the engine, and
nobody noticed because none of the three workflows build either one. The dev
server does not typecheck, so the break only shows up in a production build.

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm --filter underwriting-console exec tsc -b
- run: pnpm --filter @mortgage-pos/mortgage-engine test
- run: pip install -r services/doc-parser/requirements-dev.txt
- run: python -m pytest services/doc-parser/tests
```

## 7. Post-deploy checks

```bash
# 1. The document id is keyed, and stable across resubmission.
curl -s -X POST "$PARSER/parse" -H 'content-type: application/pdf' \
  --data-binary @stub.pdf | jq -r .document_id
# expect hmac-sha256:... and the same value on a second call

# 2. A pay stub returns real figures with usable overlay boxes.
python services/doc-parser/scripts/local_parse_report.py stub.pdf
```

In CloudWatch, confirm the delegation is live and the telemetry is gone:

| Log line | Meaning |
| --- | --- |
| `paystub_parser_used page=N fields=7` | The dedicated parser reconciled the page |
| `paystub_parser_declined` | Fell back to the legacy reader; investigate that stub |
| `ocr_budget_exceeded` | Packet larger than the budget; pages were skipped |
| `document_id_unkeyed` | `DOCUMENT_ID_HMAC_KEY` is missing |
| `core_dumps_not_disabled` | The task could dump document bytes on crash |
