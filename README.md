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
| `.env.development` | `.env.example` (same content as `Docs/env.development`) |
| `.env.slicer` | `Docs/Architecture/env.slicer-v2` |

Do not commit those two files.

## Run locally

**Parser** (Docker, port 8080):

```bash
cd services/doc-parser
docker build -t freeflow-doc-parser:v3 -f Dockerfile .
docker run -d --name freeflow-parser -p 8080:8080 --memory=4g freeflow-doc-parser:v3
```

Health check: http://127.0.0.1:8080/health

**Underwriting console** (Vite, port 3000):

```bash
cd Apps/underwriting-console
npm install
npm run dev
```

Open http://localhost:3000 — **Parser Lab** posts PDFs to `/parse` (proxied to the container). **Split View** is Demo v7.

Optional: `docker compose up -d` at the repo root for local Postgres / Redis / MinIO if you are wiring the Next portal.

## Layout

| Path | What it is |
| --- | --- |
| `Apps/underwriting-console` | Live local UI |
| `Apps/underwriter-portal` | Next.js billing / Encompass routes |
| `services/doc-parser` | FastAPI: bytes in, JSON boxes out (no sandwich PDF) |
| `Packages/mortgage-engine` | Form 1084 v9 |
| `Docs/ARCHITECTURE.md` | Live architecture |

## Docs

- [Architecture](Docs/ARCHITECTURE.md)
- [Monorepo map v4](Docs/b2b-income-monorepo-structure-v4.md)
