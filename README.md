# FreeFlow B2B Income Suite

Standalone mortgage income-underwriting tool: in-memory PDF parse, Form 1084 math, split-screen QA.

This repo does **not** include `.env`, `.env.slicer`, `node_modules`, or Python `.venv`. Those are local. Templates and install files are in git.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20 or 22 | Both web apps |
| pnpm | 9.12.0 (`corepack enable`) | All JavaScript installs; npm cannot install this repo |
| Python | 3.11 | Running either parser outside Docker |
| Docker | any current release | Parsers, Postgres, Redis, MinIO |

Only Node and pnpm are required to bring the console up on port 3000.

## Clone

```bash
git clone https://github.com/freeflowmortgage/FreeFlow.git
cd FreeFlow
```

## Install

This is a pnpm workspace. Install once from the repo root, not from inside an
app directory:

```bash
corepack enable
pnpm install
```

Do not use `npm install`. The apps depend on local packages through the
`workspace:*` protocol, which npm cannot resolve:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

## Environment files

Only `.env.example` and `.env.production.example` are tracked. Every other env
file is local and git-ignored, so create the one you need by copying a template:

```bash
cp .env.example .env
cp docs/Architecture/env.slicer-v2 .env.slicer   # optional slicer workflow
```

On Windows use `copy` instead of `cp`.

The console on port 3000 reads no env file in demo mode. You need `.env` only
for the portal, which talks to Postgres and Redis.

| File | Policy |
| --- | --- |
| `.env.example` | Tracked template of the local development contract; copy to `.env` |
| `.env` | Local-only and ignored; what the portal and Docker Compose actually read |
| `.env.slicer` | Local-only; copy from `docs/Architecture/env.slicer-v2` |
| `.env.production.example` | Tracked production variable contract with placeholders only |
| `.env.production` | Local-only and ignored; ECS production secrets come from Secrets Manager/SSM |

Never put a real credential in a tracked environment file or Docker build context.

## Run locally

### Just the site (fastest path to port 3000)

From the repo root, after `pnpm install`:

```bash
pnpm --filter underwriting-console dev
```

Open http://localhost:3000. You get the marketing landing page; the tab title
is **FreeFlow Mortgage Solutions**. Click any product card, or jump straight in
with http://localhost:3000/#workspace.

This needs no Docker, no database, and no env file. Uploading a PDF does need
the income parser below, because **Parser Lab** and **Income** post to `/parse`,
which Vite proxies to port 8080.

Port 3000 is fixed (`strictPort`), so the dev server exits if something else
already holds it. Find the owner with `lsof -nP -iTCP:3000 -sTCP:LISTEN` on
macOS or Linux, or `netstat -ano | findstr :3000` on Windows.

### Income parser (port 8080)

Docker:

```bash
cd services/doc-parser
docker build -t freeflow-doc-parser:v3 -f Dockerfile .
docker run -d --name freeflow-parser -p 8080:8080 --memory=4g freeflow-doc-parser:v3
```

Or run it directly with Python 3.11, which is quicker to iterate on:

```bash
cd services/doc-parser
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHONPATH=src .venv/bin/python -m uvicorn server:app --port 8080
```

Open http://127.0.0.1:8080 for a status page, or http://127.0.0.1:8080/health
for JSON. The underwriting UI is on port 3000, not 8080.

### Appraisal parser and rules (port 8081)

An independent service. Appraisal PDFs are sent only here; they do not pass
through the income parser or AI 1003 runtime.

```bash
cd services/appraisal-parser
docker build -t freeflow-appraisal-parser -f Dockerfile .
docker run -d --name freeflow-appraisal-parser -p 8081:8081 \
  --tmpfs /tmp/appraisal_scratch:rw,size=512m freeflow-appraisal-parser
```

Health check: http://127.0.0.1:8081/health.

### Underwriter Portal (Next.js, port 3001)

The portal needs Postgres and Redis, so start the infrastructure first with
`docker compose up -d postgres redis`, then:

```bash
cp .env.example .env
pnpm --filter @mortgage-pos/database exec prisma migrate deploy
pnpm --filter underwriter-portal dev
```

### Full stack with Docker Compose

All services and infrastructure at once:

```bash
docker compose up --build -d
```

Services started:
- `underwriting-console` on `http://localhost:3000`
- `underwriter-portal` on `http://localhost:3001`
- `income-parser` on `http://localhost:8080`
- `appraisal-parser` on `http://localhost:8081`
- `postgres` on `localhost:5432`
- `redis` on `localhost:6379`
- `minio` on `localhost:9000` (API) & `localhost:9001` (Console)

## Layout

| Path | What it is |
| --- | --- |
| `apps/underwriting-console` | Live local UI |
| `apps/underwriter-portal` | Next.js billing / Encompass routes |
| `services/doc-parser` | FastAPI: bytes in, JSON boxes out (no sandwich PDF) |
| `services/appraisal-parser` | Independent FastAPI appraisal extraction and agency-rule overlays |
| `packages/mortgage-engine` | Form 1084 v9 |
| `docs/ARCHITECTURE.md` | Live architecture |

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Monorepo map v4](docs/b2b-income-monorepo-structure-v4.md)
- [Production deployment readiness](docs/deployment-readiness/README.md)
