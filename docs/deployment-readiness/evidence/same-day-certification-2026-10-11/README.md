# Same-Day Certification Evidence

This directory consolidates sanitized execution metadata for the 2026-10-11 standalone and Encompass completion work.

It contains no source-document bytes, OCR text, customer data, credentials, tokens, SSNs, or raw Encompass field values.

## Files

- `execution-report.json` — strict workflow and release-gate classifications.
- `standalone-live-cli-playwright.json` — historical `d72c1fad...` UI/backend/database/parser lifecycle metadata; its original artifacts were not retained.
- `database-security-gate.json` — migrations, RLS, app-role, worker-role, and cleanup results.
- `test-suite-summary.json` — commands and final suite/build results.
- `artifact-manifest.json` — byte/hash inventory for this directory and the three sibling evidence manifests.

## Evidence boundaries

- The strongest standalone result is the current-source run `20261011-live-d7f7a43-01` at revision `d7f7a432bed0292bc6d800ec05800d2105ceba95`. Its seven generated evidence files are retained in [`../standalone-live-application-2026-10-11`](../standalone-live-application-2026-10-11/), whose manifest SHA-256 is `8aa3335a864fb246f047d57acea38ac8782815e5fd432f49b5c760e9c75523b8`.
- The current run used CLI Playwright because the in-app browser was unavailable. Only synthetic development authentication and local runtime configuration were supplied. No business API response was mocked.
- The current run used a disposable local stack, two server-side synthetic tenant identities, and two fixed-upstream loopback gateways. The committed `two-tenant-bootstrap.sql` and `local-live-gateway.mjs` preserve that boundary, while service startup and per-portal development-auth configuration remain manual rather than CI-automated.
- The retained current-run JSON/XML/PDF and aggregate result records are independently rehashable. The source PDF and raw OCR were not retained. The retained PDF received a post-run visual inspection; automated visual regression remains open.
- `standalone-live-cli-playwright.json` remains an explicitly historical record for runtime `d72c1fad...`. That run's input and downloaded files were erased, so its hashes are observed metadata and cannot be independently rehashed.
- The separate `$8,000` component-export bundle retains its own synthetic JSON/XML/PDF files and is not the live application run.
- The Encompass `$21,600` fixture is a post-parse plus connector simulator. It is not a real provider or full application workflow.
- The standalone `$8,000` component-export fixture, `$5,721.67` live lifecycle, and `$21,600` Encompass simulator are different fixtures and must not be combined into a full-path parity claim.
- Official MISMO XSD validation was not performed.
- Real Encompass interoperability was not performed.
- Production identity, AWS, and production deployment were not exercised.

The authoritative narrative and remediation plan are in [`../../SAME-DAY-STANDALONE-ENCOMPASS-COMPLETION-2026-10-11.md`](../../SAME-DAY-STANDALONE-ENCOMPASS-COMPLETION-2026-10-11.md).
