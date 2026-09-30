# Encompass connector service

Separate private ECS service for the custom Encompass connector. It is not
part of the portal process. FreeFlow core communicates only through its signed
service contract; a lender-specific direct Encompass implementation is injected
into the separately deployed connector.

## Implemented

- Authenticated service contract: `GET /health`, attachment list/download,
  bounded approved-income PATCH, and allowlisted field reads for reconciliation.
- Server-authoritative tenant/lender/deployment binding through
  `PrismaBindingStore` with forced RLS.
- Non-production Bearer S2S stub. `NODE_ENV=production` refuses to boot it.
- Explicit `synthetic-freeflow-dev` mode returns the deterministic in-memory
  W-2 attachment `synthetic-income-document-1` and thirteen read-only morning-pack
  fixture attachments, including two `synthetic-pack-w2-*` W-2s
  (`synthetic-pack-w2-2021-nates` and `synthetic-pack-w2-2021-coborrower`)
  plus Schedule B/C/D/F, Form 1120, Form 1120-S, and Schedule K-1 1120-S
  income fixtures.
  Fixture bytes are baked into the image and are not written back to disk.
- Compiled Node runtime, UID 1001, read-only-root compatibility, and health.

The synthetic implementation is selected only when `NODE_ENV`,
`FREEFLOW_RUNTIME_ENV`, `CONNECTOR_MODE`, and `CONNECTOR_BOUND_TENANT_ID` all
match the freeflow-dev development configuration. It performs no live
Encompass calls.

## Security boundaries

- Service tokens and database credentials are different types and stores.
- FreeFlow core never accepts or stores lender Encompass credentials.
- Raw PDF bytes are never written to disk, S3, a database, logs, or audit data.
- The response path clears the connector-owned byte buffer after constructing
  the response.
- Document pull and outbound sync resolve the same server-side
  tenant/lender/deployment binding.
- Production mode requires signed, nonce/replay-protected S2S requests.
- Terraform keeps both workers disabled until their explicit feature flags and
  connector prerequisites are enabled.

## Local validation

```bash
pnpm --filter @mortgage-pos/encompass-connector test
pnpm --filter @mortgage-pos/encompass-connector build
```

The compiled image contains:

- `dist/index.js` — service runtime
- `dist/bootstrapSyntheticBinding.js` — idempotent migrator-only dev bootstrap
- `dist/privateSmoke.js` — private-boundary smoke caller
- `fixtures/morning-pack-2026-09-29/` — read-only synthetic pack PDFs

After an authorized freeflow-dev Terraform apply, run the binding bootstrap
task once, then run `dist/privateSmoke.js` as a one-off task with the application
security group. The smoke validates missing/invalid auth, claim mismatches,
forbidden LOS credential keys, deterministic list/download behavior, PDF
signature, and the response SHA-256 header.
