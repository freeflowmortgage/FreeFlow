# Form templates (PyMuPDF grid maps)

Official IRS blanks live here so we can rebuild bounding-box maps when a form year changes.

| Form | Blank | Map | Extractor |
| --- | --- | --- | --- |
| Schedule E Page 1 (rentals A/B/C) | `f1040se.pdf` | `schedule_e_map.json` | `src/schedule_e_grid.py` |
| W-2, C, F, K-1, 1120, 1040, B/D, 4562, Form 8825, Sch L, paystub, WVOE | live widget snap + label clips | (runtime) | `src/irs_form_extract.py` |

Schedule E keeps a baked widget map because values sit in A/B/C columns off the label line. Other income forms snap to the nearest live AcroForm widget, then clip right/below the IRS label, and merge `/V`.

Rebuild the Schedule E map:

```bash
PYTHONPATH=services/doc-parser/src python -c \
  "from schedule_e_grid import generate_template_map; generate_template_map()"
```
