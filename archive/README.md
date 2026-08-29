# Archived superseded versions

Live code is the newest drop in each family. Older numbered copies and Windows `(1)`/`(2)` duplicates live here.

## What is running

| Family | Live file |
| --- | --- |
| Split-screen QA | `apps/underwriting-console/src/components/UnderwriterSplitViewDemo-v7.tsx` (also portal) |
| Parser | `services/doc-parser/src/{server,ai_pdf_converter,pdf_splitter}.py` + `Dockerfile` |
| Form 1084 | `packages/mortgage-engine/src/calculateForm1084Income.ts` (v9, identical to Architecture v9) |
| USDA engine | `packages/mortgage-engine/src/usda-projected-income-engine-v2.ts` |
| Migrator | `copy-assets-v5.sh` |

## Layout

- `split-view-qa/` — split-screen Demo **v3**
- `superseded/parser/` — path-based slicer v4/v5, converter v2, Poppler Dockerfile-v2, duplicate ECS JSON
- `superseded/math/` — Form 1084 **v4**, duplicate v9 `(1)`, extra USDA v2 copy
- `superseded/ui/` — unversioned `apps/web` split-view (was already v5)
- `superseded/stripe/` — `stripe-billing-router-v4 (1).ts`
- `superseded/migrator/` — `copy-assets.ps1` (v2) and older docs `copy-assets-v5.sh`
- `superseded/docs-dupes/` — `pre-deployment-checklist (1).md`
