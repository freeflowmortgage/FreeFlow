# Form templates (PyMuPDF grid maps)

Official IRS blanks live here so we can rebuild bounding-box maps when a form year changes.

| Form | Blank | Map | Extractor |
| --- | --- | --- | --- |
| Schedule E Page 1 (rentals A/B/C) | `f1040se.pdf` | `schedule_e_map.json` | `src/schedule_e_grid.py` |

Use a **grid map** only when values sit off the label line (multi-column A/B/C, or boxes the line-regex mapper misses). Schedule C, W-2, and K-1 stay on the word mapper until they show the same miss.

Rebuild the Schedule E map:

```bash
PYTHONPATH=services/doc-parser/src python -c \
  "from schedule_e_grid import generate_template_map; generate_template_map()"
```
