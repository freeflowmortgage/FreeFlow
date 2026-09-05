# FreeFlow B2B Income Suite

Standalone mortgage income-underwriting tool: in-memory PDF parse, Form 1084 math, split-screen QA.

This repo does **not** include `.env.development`, `.env.slicer`, `node_modules`, or Python `.venv`. Those are local. Templates and install files are in git.

## Clone

```bash
git clone https://github.com/nwjenson/Freeflow.git
cd Freeflow
```

## Environment files

Copy the examples, then edit if your ports or keys differ:

```bash
copy .env.example .env.development
copy Docs\Architecture\env.slicer-v2 .env.slicer
```

On macOS/Linux use `cp` instead of `copy`.

| You create locally | Copied from |
| --- | --- |
| `.env.development` | `.env.example` (same content as `docs/env.development`) |
| `.env.slicer` | `docs/Architecture/env.slicer-v2` |

Do not commit those two files.

## Run locally

**Parser** (Docker, port 8080):

```bash
cd services/doc-parser
docker build -t freeflow-doc-parser:v3 -f Dockerfile .
docker run -d --name freeflow-parser -p 8080:8080 --memory=4g freeflow-doc-parser:v3
```

Open http://127.0.0.1:8080 in a browser for a status page, or http://127.0.0.1:8080/health for JSON.
The underwriting UI is on port 3000, not 8080.

**Appraisal parser and rules** (independent Docker service, port 8081):

```bash
cd services/appraisal-parser
docker build -t freeflow-appraisal-parser -f Dockerfile .
docker run -d --name freeflow-appraisal-parser -p 8081:8081 \
  --tmpfs /tmp/appraisal_scratch:rw,size=512m freeflow-appraisal-parser
```

Health check: http://127.0.0.1:8081/health. Appraisal PDFs are sent only to
this service; they do not pass through the income parser or AI 1003 runtime.

**Underwriting console** (Vite, port 3000):

```bash
cd apps/underwriting-console
npm install
npm run dev
```

Open http://localhost:3000 — **Parser Lab** posts PDFs to `/parse` (proxied to the container). **Split View** is Demo v7.

**Underwriter Portal** (Next.js, port 3001):

```bash
cd apps/underwriter-portal
npm install
npm run dev
```

**Full Stack with Docker Compose** (all services and infrastructure):

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
