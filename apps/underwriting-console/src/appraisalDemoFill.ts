/**
 * Best-effort demo fill for a real (fillable) URAR 1004 appraisal PDF.
 *
 * Vendor 1004s use arbitrary AcroForm field names, so fields are matched by
 * keyword heuristics against the demo subject-property data. Runs in both the
 * browser (Upload PDF in the appraisal workspace) and the dev server (a blank
 * dropped into public/fixtures/blank/).
 */
import { PDFDocument } from 'pdf-lib';

/** Matches the SUBJECT / appraiser data used across the appraisal workspace. */
const DEMO_RULES: Array<{ match: RegExp; exclude?: RegExp; value: string }> = [
  { match: /borrower/i, value: 'Sarah K. Vance' },
  { match: /property.?address|subject.?address|street/i, value: '742 Whispering Pines Dr' },
  { match: /city/i, value: 'Austin' },
  { match: /state/i, exclude: /estate/i, value: 'TX' },
  { match: /zip|postal/i, value: '78745' },
  { match: /county/i, value: 'Travis' },
  { match: /legal.?desc/i, value: 'Lot 14 Blk C Whispering Pines Sec 2' },
  { match: /parcel|apn|assessor/i, value: '04-1102-0314-0000' },
  { match: /tax.?year/i, value: '2026' },
  { match: /r\.?e\.?.?tax|real.?estate.?tax/i, value: '8,540' },
  { match: /occupant/i, value: 'Owner' },
  { match: /lender|client/i, value: 'FreeFlow Mortgage Solutions' },
  { match: /file.?(no|num|#)|case.?(no|num|#)/i, value: 'LN-2026-9043' },
  { match: /contract.?price|sale.?price|sales.?price|purchase.?price/i, value: '$425,000' },
  { match: /appraised.?value|opinion.?of.?value|market.?value/i, value: '$425,000' },
  { match: /effective.?date|date.?of.?appraisal/i, value: '08/24/2026' },
  { match: /appraiser.?name|^appraiser$|signature.?name/i, value: 'Robert J. Miller' },
  { match: /license|certification.?(no|num|#)/i, value: 'TX A-1084' },
  { match: /year.?built/i, value: '1974' },
  { match: /gross.?living.?area|gla|square.?feet|sq.?ft/i, value: '1,850' },
  { match: /bedroom|beds/i, value: '3' },
  { match: /bath/i, value: '2' },
  { match: /neighborhood/i, value: 'South Manchaca' },
  { match: /census/i, value: '0024.07' },
];

export interface AppraisalFillResult {
  bytes: Uint8Array;
  filledCount: number;
  fieldCount: number;
}

/**
 * Returns the filled + flattened PDF, or null when the document has no
 * fillable text fields (flat scans can't be auto-filled).
 */
export async function fillAppraisalPdfWithDemoData(source: ArrayBuffer | Uint8Array): Promise<AppraisalFillResult | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(source, { ignoreEncryption: true });
  } catch {
    return null;
  }

  const form = doc.getForm();
  const fields = form.getFields();
  if (fields.length === 0) return null;

  let filledCount = 0;
  for (const field of fields) {
    const name = field.getName();
    const rule = DEMO_RULES.find((r) => r.match.test(name) && !(r.exclude && r.exclude.test(name)));
    if (!rule) continue;
    try {
      form.getTextField(name).setText(rule.value);
      filledCount += 1;
    } catch {
      /* checkbox/radio or read-only field – skip */
    }
  }
  if (filledCount === 0) return null;

  try {
    form.flatten();
  } catch {
    /* leave interactive if flattening fails; values are still set */
  }
  const bytes = await doc.save();
  return { bytes, filledCount, fieldCount: fields.length };
}
