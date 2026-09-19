# Encompass connector service (skeleton)

Separate ECS/service package for the **custom** Encompass connector. It is
not part of the portal process.

This is a **service skeleton only**. It is not live-wired, not deployed, and
does not hold LOS credentials.

## What is implemented

| Piece | Status |
| --- | --- |
| HTTP contract (`CONNECTOR_SERVICE_CONTRACT` v1) | Shell: `GET /health`, `POST /v1/attachments/list`, `POST /v1/attachments/download` |
| `CustomConnectorService` implements `EncompassConnector` | Stub: both methods throw `CONNECTOR_NOT_IMPLEMENTED` |
| Tenant → lender binding | Enforced **server-side** from an in-memory store. Caller ids are never trusted alone |
| S2S auth abstraction | Interfaces + **NON-PROD** Bearer stub (replaceable) |
| Dockerfile / `package.json` / health | Present for a future separate ECS service |

`CustomConnectorAdapter` in `@mortgage-pos/encompass-connector-contract` is
the portal-side HTTP/S2S client for this service. Document-pull routes and
the worker do **not** call it yet.

## What is stubbed

- **LOS I/O** — no Encompass / Developer Connect calls
- **PDF download** — not implemented; when it is, bytes stay in memory (ZDR)
- **Bearer S2S** — test/skeleton only; `NODE_ENV=production` refuses to boot while this stub is selected
- **Binding store** — in-memory, fail-closed unless env bindings are set
- **Health** — liveness only; does not probe LOS

## What is forbidden

- LOS credentials anywhere (Encompass client secrets, sandbox GUIDs-as-secrets, SM population)
- PDF persistence (disk, S3, `/tmp`)
- Wiring portal document-pull APIs, SQS workers, or job orchestration to this service
- Enabling Developer Connect or `enable_encompass_document_pull_worker`
- Deploying this image / applying Terraform / modifying freeflow-dev live infra

Service tokens and LOS credentials are **different types and stores**. The
auth abstraction has no LOS credential fields.

## Live-wiring gates (follow-ups)

1. **Binding** — persist and operate tenant→lender deployment bindings in the live connector, then point the portal/worker at this service
2. **S2S > Bearer** — replace the Bearer stub with mTLS and/or signed+replay-protected tokens
3. **Token ≠ LOS** — keep service tokens and LOS secrets in separate stores in production
4. **ZDR** — in-memory PDF bytes only; no disk/S3; zero buffers after send
5. **Blast-radius** — run as a separate ECS service (this package); do not host LOS I/O in the portal task

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
