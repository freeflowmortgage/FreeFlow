# Drop-in appraisal document

Place a URAR 1004 PDF here named `1004urar.pdf` (also accepted: `urar-1004.pdf`
or `1004.pdf`) and the appraisal demo serves it instead of the generated
facsimile. Two modes:

- **Blank with fillable AcroForm text fields** — auto-filled with the demo
  subject data (Sarah K. Vance · 742 Whispering Pines Dr, Austin TX). Field
  *names* are matched against keywords (borrower, address, city, state, zip,
  value, appraiser, license, year built, GLA, …) in `src/appraisalDemoFill.ts`.
- **Already filled out (or a flat scan)** — served exactly as dropped, so a
  1004 you completed by hand becomes the demo document.

When a drop-in document is active the workspace shows a "Custom 1004 from
fixtures" badge and hides the facsimile-coordinate finding highlights (they
only line up with the generated layout). The pager follows the document's real
page count.

The same auto-fill also runs in the browser for any fillable PDF selected via
the appraisal workspace's Upload PDF button, so you can test without
committing a file.
