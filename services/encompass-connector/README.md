# Encompass connector service

Separate ECS/service package for the **custom** Encompass connector. It is
not part of the portal process.

Terraform defines an internal-only freeflow-dev foundation for this service.
It remains disconnected from every LOS and does not hold LOS credentials.

## What is implemented

| Piece | Status |
| --- | --- |
| HTTP contract (`CONNECTOR_SERVICE_CONTRACT` v1) | Shell: `GET /health`, `POST /v1/attachments/list`, `POST /v1/attachments/download` |
| `CustomConnectorService` implements `EncompassConnector` | Stub: both methods throw `CONNECTOR_NOT_IMPLEMENTED` |
| Tenant → lender binding | Enforced **server-side** through `PrismaBindingStore` and forced RLS. Caller ids are never trusted alone |
| S2S auth abstraction | Interfaces + **NON-PROD** Bearer stub (replaceable) |
| Dockerfile / `package.json` / health | Separate private ECS service with container health checks and CloudWatch logs |

`CustomConnectorAdapter` in `@mortgage-pos/encompass-connector-contract` is
the portal-side HTTP/S2S client for this service. Document-pull routes and
the worker do **not** call it yet.

## What is stubbed

- **LOS I/O** — no Encompass / Developer Connect calls
- **PDF download** — not implemented; when it is, bytes stay in memory (ZDR)
- **Bearer S2S** — test/skeleton only; `NODE_ENV=production` refuses to boot while this stub is selected
- **Health** — liveness only; does not probe LOS

## What is forbidden

- LOS credentials anywhere (Encompass client secrets, sandbox GUIDs-as-secrets, SM population)
- PDF persistence (disk, S3, `/tmp`)
- Wiring portal document-pull APIs, SQS workers, or job orchestration to this service
- Enabling Developer Connect or `enable_encompass_document_pull_worker`
- Applying Terraform or modifying freeflow-dev without Ben's explicit authorization

Service tokens and LOS credentials are **different types and stores**. The
auth abstraction has no LOS credential fields.

## Live-wiring gates (follow-ups)

1. **S2S > Bearer** — replace the Bearer stub with mTLS and/or signed+replay-protected tokens
2. **Token ≠ LOS** — keep service tokens and LOS secrets in separate stores in production
3. **ZDR** — in-memory PDF bytes only; no disk/S3; zero buffers after send
4. **Portal wiring** — point the portal/worker at the private service only after the authenticity gate is complete

Developer Connect and the document-pull worker stay **OFF** until those gates
are explicitly approved.

## Run

```bash
pnpm --filter @mortgage-pos/encompass-connector test
pnpm --filter @mortgage-pos/encompass-connector build
```

Optional local listen (fail-closed with empty stores unless env is set):

```bash
pnpm --filter @mortgage-pos/encompass-connector start
```

Env (skeleton / non-prod only): `PORT`, `CONNECTOR_SERVICE_TOKEN`,
`CONNECTOR_BOUND_TENANT_ID`, `CONNECTOR_BOUND_LENDER_ID`,
`CONNECTOR_BOUND_DEPLOYMENT_ID`. These are S2S/binding identity — never LOS
secrets.

## Deferred freeflow-dev smoke

Do not run these steps until Ben authorizes the Terraform apply. After apply:

1. Run the database migration task so `freeflow_connector_login` is created
   with membership in `freeflow_worker` only.
2. Seed the synthetic tenant/binding fixtures from
   `packages/database/prisma/tests/encompass-connector-bindings.sql` through the
   administrative test workflow; never use borrower data or LOS credentials.
3. From a one-off task in the connector subnets/security group, retrieve the
   connector database URL from `freeflow-dev/database-encompass-connector` and
   run `pnpm --filter @mortgage-pos/encompass-connector test:database-bindings`
   against that synthetic fixture.
4. Verify `GET http://encompass-connector.freeflow.local:8080/health` returns
   HTTP 200 from an application task, the ECS service reports one healthy task,
   and `/ecs/freeflow-dev/encompass-connector` receives its logs.
5. Confirm list/download still return `CONNECTOR_NOT_IMPLEMENTED`, the document
   pull worker remains disabled, and no LOS secret exists in the task definition.
