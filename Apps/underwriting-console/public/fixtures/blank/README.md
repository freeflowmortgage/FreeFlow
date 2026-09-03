# Drop-in blank appraisal form

Place a real blank URAR 1004 PDF here named `1004urar.pdf` (also accepted:
`urar-1004.pdf` or `1004.pdf`) and the appraisal demo will serve it instead of
the generated facsimile, auto-filled with the demo subject data
(Sarah K. Vance · 742 Whispering Pines Dr, Austin TX).

Requirements:

- The PDF must have fillable AcroForm text fields — filling matches field
  *names* against keywords (borrower, address, city, state, zip, value,
  appraiser, license, year built, GLA, …) in `src/appraisalDemoFill.ts`.
- Flat/scanned blanks have no fields to fill; those are ignored and the
  generated facsimile is served instead (a console warning is logged).

The same auto-fill also runs in the browser for any fillable PDF selected via
the appraisal workspace's Upload PDF button, so you can test a blank without
committing it.
