# Encompass connector service

Separate private ECS service for the custom Encompass connector. It is not
part of the portal process and holds no real LOS credentials.

## Implemented

- Authenticated service contract: `GET /health`, attachment list, and download.
- Server-authoritative tenant/lender/deployment binding through
  `PrismaBindingStore` with forced RLS.
- Non-production Bearer S2S stub. `NODE_ENV=production` refuses to boot it.
- Default `CustomConnectorService` remains fail-closed with
  `CONNECTOR_NOT_IMPLEMENTED`.
- Explicit `synthetic-freeflow-dev` mode returns one deterministic attachment
  and constructs a deterministic PDF in memory.
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
- Developer Connect and the document-pull worker remain off.
- Production still requires a future mTLS or signed/replay-protected S2S mode.

## Local validation

```bash
pnpm --filter @mortgage-pos/encompass-connector test
pnpm --filter @mortgage-pos/encompass-connector build
```

The compiled image contains:

- `dist/index.js` — service runtime
- `dist/bootstrapSyntheticBinding.js` — idempotent migrator-only dev bootstrap
- `dist/privateSmoke.js` — private-boundary smoke caller

After an authorized freeflow-dev Terraform apply, run the binding bootstrap
task once, then run `dist/privateSmoke.js` as a one-off task with the application
security group. The smoke validates missing/invalid auth, claim mismatches,
forbidden LOS credential keys, deterministic list/download behavior, PDF
signature, and the response SHA-256 header.
