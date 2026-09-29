# Encompass connector service

Separate private ECS service for the custom Encompass connector. It is not
part of the portal process. In real mode it is the only process that resolves
the lender-scoped LOS credential secret.

## Implemented

- Authenticated service contract: `GET /health`, attachment list/download,
  bounded approved-income PATCH, and allowlisted field reads for reconciliation.
- Server-authoritative tenant/lender/deployment binding through
  `PrismaBindingStore` with forced RLS.
- Non-production Bearer S2S stub. `NODE_ENV=production` refuses to boot it.
- Real mode uses ICE client credentials inside this service and does not expose
  credentials to portal or worker request bodies.
- Explicit `synthetic-freeflow-dev` mode returns the deterministic in-memory
  W-2 attachment `synthetic-income-document-1` and five read-only morning-pack
  fixture attachments. Fixture bytes are baked into the image and are not
  written back to disk.
- Compiled Node runtime, UID 1001, read-only-root compatibility, and health.

The synthetic implementation is selected only when `NODE_ENV`,
`FREEFLOW_RUNTIME_ENV`, `CONNECTOR_MODE`, and `CONNECTOR_BOUND_TENANT_ID` all
match the freeflow-dev development configuration. It performs no Encompass or
Developer Connect calls.

## Security boundaries

- Service tokens, database credentials, and future LOS credentials are
  different types and stores.
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
