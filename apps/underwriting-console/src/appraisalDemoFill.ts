/**
 * Best-effort demo fill for a real (fillable) URAR 1004 appraisal PDF.
 *
 * Vendor 1004s use arbitrary AcroForm field names, so fields are matched by
 * keyword heuristics against the demo subject-property data. Runs in both the
 * browser (Upload PDF in the appraisal workspace) and the dev server (a blank
 * dropped into public/fixtures/blank/).
 */
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';

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

const CHECKBOX_RULES: Array<{ match: RegExp; exclude?: RegExp }> = [
  { match: /owner.?occup(?:ied|ant)|occupancy.*owner/i, exclude: /tenant|vacant/i },
  { match: /fee.?simple|property.?rights.*fee/i, exclude: /leasehold/i },
  { match: /purchase(?:.?transaction)?|transaction.*purchase/i, exclude: /refinance/i },
  { match: /highest.*best.*use.*yes|highest.*best.*use.*existing/i, exclude: /no/i },
  { match: /utilities.*(?:active|on)|(?:active|on).*utilities/i, exclude: /inactive|off/i },
];

const CHOICE_RULES: Array<{ match: RegExp; values: string[] }> = [
  { match: /occupancy|occupant/i, values: ['Owner', 'Owner Occupied', 'Owner-Occupied'] },
  { match: /property.?rights|ownership/i, values: ['Fee Simple', 'FeeSimple'] },
  { match: /transaction.?type|assignment.?type/i, values: ['Purchase', 'Purchase Transaction'] },
  { match: /highest.*best.*use/i, values: ['Yes', 'Existing Use'] },
];

export interface AppraisalFillResult {
  bytes: Uint8Array;
  filledCount: number;
  fieldCount: number;
}

/**
 * Returns a filled PDF, or null when no safely matched AcroForm fields exist.
 * Fields remain interactive so their values can be extracted by the appraisal
 * API after upload.
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
    try {
      if (field instanceof PDFTextField && rule) {
        field.setText(rule.value);
        filledCount += 1;
        continue;
      }
      if (field instanceof PDFCheckBox) {
        const checkRule = CHECKBOX_RULES.find((r) => r.match.test(name) && !(r.exclude && r.exclude.test(name)));
        if (checkRule) {
          field.check();
          filledCount += 1;
        }
        continue;
      }
      if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
        const choiceRule = CHOICE_RULES.find((candidate) => candidate.match.test(name));
        const requestedValues = rule ? [rule.value] : choiceRule?.values ?? [];
        const option = safelyMatchedOption(field.getOptions(), requestedValues);
        if (option) {
          field.select(option);
          filledCount += 1;
        }
      }
    } catch {
      /* Read-only or malformed vendor field – leave it unchanged. */
    }
  }
  if (filledCount === 0) return null;

  try {
    form.updateFieldAppearances();
  } catch {
    /* Values remain in the AcroForm even when a vendor appearance fails. */
  }
  const bytes = await doc.save();
  return { bytes, filledCount, fieldCount: fields.length };
}

function safelyMatchedOption(options: string[], values: string[]): string | null {
  const normalizedValues = new Set(values.map(normalizeOption));
  const exact = options.filter((option) => normalizedValues.has(normalizeOption(option)));
  return exact.length === 1 ? exact[0] : null;
}

function normalizeOption(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
