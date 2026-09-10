/**
 * Fills real (blank) IRS form PDFs with the FreeFlow demo persona's data so the
 * income demo can show authentic-looking source documents instead of facsimiles.
 *
 * Blanks are the official IRS PDFs (public domain) committed under ./forms.
 * Field names were mapped from each form's AcroForm dictionary; values arrive
 * as query params so the rendered PDF always matches the live workspace state.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, type PDFForm, type PDFPage } from 'pdf-lib';

// The Vite dev server runs with the app directory as cwd; import.meta.url is
// unreliable here because Vite bundles the config (and this middleware) into a
// temporary file.
const FORM_DIRS = [
  path.resolve(process.cwd(), 'src/server/forms'),
  path.resolve(process.cwd(), '../../services/doc-parser/templates'),
];

const blankCache = new Map<string, Promise<Uint8Array>>();

async function readFirstExisting(file: string): Promise<Uint8Array> {
  const errors: string[] = [];
  for (const dir of FORM_DIRS) {
    try {
      return new Uint8Array(await readFile(path.join(dir, file)));
    } catch (error) {
      errors.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Missing form ${file}. Looked in ${FORM_DIRS.join(', ')}. ${errors.join(' | ')}`);
}

function loadBlank(file: string): Promise<Uint8Array> {
  let cached = blankCache.get(file);
  if (!cached) {
    cached = readFirstExisting(file);
    blankCache.set(file, cached);
  }
  return cached;
}

/**
 * Set a text field addressed by the unique tail of its fully-qualified name,
 * optionally scoped to names containing a marker (several IRS forms repeat the
 * same field numbers across sub-forms, e.g. the W-2 copies).
 */
function setText(form: PDFForm, nameTail: string, value: string, mustInclude?: string) {
  const field = form
    .getFields()
    .find((f: any) => f.getName().endsWith(nameTail) && (!mustInclude || f.getName().includes(mustInclude)));
  if (!field) return;
  try {
    form.getTextField(field.getName()).setText(value);
  } catch {
    /* field exists but is not a text field – skip */
  }
}

/**
 * The IRS blanks are XFA hybrids whose checkbox "on" appearance streams are
 * empty, so pdf-lib's check() + flatten() renders nothing. Instead, collect
 * each checkbox widget's rectangle and draw an X there after flattening.
 */
interface CheckMark {
  page: PDFPage;
  x: number;
  y: number;
  size: number;
}

function collectCheckMark(doc: PDFDocument, form: PDFForm, nameTail: string): CheckMark | null {
  const field = form.getFields().find((f: any) => f.getName().endsWith(nameTail));
  const widget = (field as any)?.acroField.getWidgets()[0];
  if (!field || !widget) return null;
  const rect = widget.getRectangle();
  const pageRef = widget.P();
  const page = doc.getPages().find((p: any) => pageRef && p.ref === pageRef) ?? doc.getPages()[0];
  const size = Math.min(rect.height, rect.width) * 0.9;
  return { page, x: rect.x + (rect.width - size * 0.7) / 2, y: rect.y + (rect.height - size * 0.75) / 2, size };
}

async function drawCheckMarks(doc: PDFDocument, marks: Array<CheckMark | null>) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const mark of marks) {
    if (!mark) continue;
    mark.page.drawText('X', { x: mark.x, y: mark.y, size: mark.size, font });
  }
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const money = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(params: URLSearchParams, key: string, fallback: string): string {
  return params.get(key)?.trim() || fallback;
}

const BORROWER = 'Sarah K. Vance';
const BORROWER_SSN = 'XXX-XX-1847';
const BORROWER_ADDRESS = '1847 Juniper Loop, Austin, TX 78741';

// ---------------------------------------------------------------------------
// W-2 — fills the employee Copy B page of the official IRS fw2.pdf
// ---------------------------------------------------------------------------

export async function fillW2(params: URLSearchParams): Promise<Uint8Array> {
  const employer = str(params, 'employer', 'Digital Solutions Corp');
  const ein = str(params, 'ein', '94-8765432');
  const year = str(params, 'year', '2025');
  const box1 = num(params, 'box1', 74000);
  const bonus = num(params, 'bonus', 18000);
  const overtime = num(params, 'ot', 6000);
  const retirement = num(params, 'retirement', 4500);
  const box5Param = params.get('box5');
  const ssMedicareWages =
    box5Param != null && box5Param !== '' ? num(params, 'box5', 78500) : box1 + bonus + overtime;
  const fedWithheld = Math.round(box1 * 0.12);
  const ssTax = ssMedicareWages * 0.062;
  const medicareTax = ssMedicareWages * 0.0145;

  // fw2.pdf is the 2025 revision (one W-2 per copy page). Field numbers repeat
  // across the copies, so matching is scoped to the CopyB sub-form.
  const doc = await PDFDocument.load(await loadBlank('fw2.pdf'));
  const form = doc.getForm();
  const t = (i: number, value: string) =>
    setText(form, `f2_${String(i).padStart(2, '0')}[0]`, value, 'CopyB[0]');

  t(1, BORROWER_SSN);                            // a  Employee SSN
  t(2, ein);                                     // b  Employer EIN
  t(3, `${employer}\n2210 Riverside Pkwy\nAustin, TX 78704`); // c
  t(4, `DS-${year}-0447`);                       // d  Control number
  t(5, 'Sarah K.');                              // e  First name
  t(6, 'Vance');                                 //    Last name
  t(8, BORROWER_ADDRESS.replace(', Austin', '\nAustin')); // f Address
  t(9, money(box1));                             // 1  Wages
  t(10, money(fedWithheld));                     // 2  Fed income tax withheld
  t(11, money(ssMedicareWages));                 // 3  SS wages
  t(12, money(ssTax));                           // 4  SS tax
  t(13, money(ssMedicareWages));                 // 5  Medicare wages
  t(14, money(medicareTax));                     // 6  Medicare tax
  t(20, 'D');                                    // 12a code (401k)
  t(21, money(retirement));                      // 12a amount
  t(28, `BONUS ${money(bonus)}\nOT ${money(overtime)}`); // 14 Other
  t(29, 'TX');                                   // 15 State
  t(30, '12-999-8842-1');                        //    Employer state ID

  const retirementMark = collectCheckMark(doc, form, 'CopyB[0].Col_Right[0].Retirement_ReadOrder[0].c2_3[0]');
  form.flatten();
  await drawCheckMarks(doc, [retirementMark]);

  // Serve only the Copy B page (page 4 of the 11-page IRS packet).
  const single = await PDFDocument.create();
  const [copyB] = await single.copyPages(doc, [3]);
  single.addPage(copyB);
  return single.save();
}

// ---------------------------------------------------------------------------
// Schedule E page 1 — two rental properties from the demo REO section
// ---------------------------------------------------------------------------

interface RentalYear {
  rents: number;
  insurance: number;
  mortgageInterest: number;
  taxes: number;
  depreciation: number;
  hoa: number;
  total: number;
}

function rentalDefaults(year: string): [RentalYear, RentalYear] {
  if (year === '2024') {
    return [
      { rents: 22800, insurance: 1150, mortgageInterest: 4900, taxes: 2800, depreciation: 3500, hoa: 0, total: 14200 },
      { rents: 34000, insurance: 1750, mortgageInterest: 7400, taxes: 4200, depreciation: 5200, hoa: 2400, total: 22100 },
    ];
  }
  return [
    { rents: 24000, insurance: 1200, mortgageInterest: 4800, taxes: 2900, depreciation: 3500, hoa: 0, total: 14500 },
    { rents: 36000, insurance: 1800, mortgageInterest: 7200, taxes: 4300, depreciation: 5200, hoa: 2400, total: 22700 },
  ];
}

export async function fillScheduleE(params: URLSearchParams): Promise<Uint8Array> {
  const year = str(params, 'year', '2025');
  const [defA, defB] = rentalDefaults(year);
  const read = (prefix: string, def: RentalYear): RentalYear => ({
    rents: num(params, `${prefix}Rents`, def.rents),
    insurance: num(params, `${prefix}Insurance`, def.insurance),
    mortgageInterest: num(params, `${prefix}Interest`, def.mortgageInterest),
    taxes: num(params, `${prefix}Taxes`, def.taxes),
    depreciation: num(params, `${prefix}Depreciation`, def.depreciation),
    hoa: num(params, `${prefix}Hoa`, def.hoa),
    total: num(params, `${prefix}Total`, def.total),
  });
  const a = read('a', defA);
  const b = read('b', defB);

  // Sched E line 20 must equal the itemized column sum, so the remainder that
  // the demo doesn't itemize is reported as line 14 repairs.
  const repairs = (p: RentalYear) =>
    Math.max(0, p.total - p.insurance - p.mortgageInterest - p.taxes - p.depreciation - p.hoa);
  const net = (p: RentalYear) => p.rents - p.total;

  const doc = await PDFDocument.load(await loadBlank('f1040se.pdf'));
  const form = doc.getForm();
  const t = (tail: string, value: string) => setText(form, tail, value);

  t('Page1[0].f1_1[0]', BORROWER);
  t('Page1[0].f1_2[0]', BORROWER_SSN);
  t('RowA[0].f1_3[0]', '742 Evergreen Terrace, Springfield, IL 62704');
  t('RowB[0].f1_4[0]', '1600 Pennsylvania Ave NW Unit 4B, Washington, DC 20006');
  t('RowA[0].f1_6[0]', '1');
  t('RowB[0].f1_7[0]', '1');
  t('RowA[0].f1_9[0]', '365');
  t('RowA[0].f1_10[0]', '0');
  t('RowB[0].f1_11[0]', '365');
  t('RowB[0].f1_12[0]', '0');

  // [line, column A value, column B value]
  const rows: Array<[string, string, number | null, number | null]> = [
    ['Line3', 'f1_16[0]', a.rents, null], ['Line3', 'f1_17[0]', null, b.rents],
    ['Line9', 'f1_34[0]', a.insurance, null], ['Line9', 'f1_35[0]', null, b.insurance],
    ['Line12', 'f1_43[0]', a.mortgageInterest, null], ['Line12', 'f1_44[0]', null, b.mortgageInterest],
    ['Line14', 'f1_49[0]', repairs(a), null], ['Line14', 'f1_50[0]', null, repairs(b)],
    ['Line16', 'f1_55[0]', a.taxes, null], ['Line16', 'f1_56[0]', null, b.taxes],
    ['Line17', 'f1_58[0]', 0, null], ['Line17', 'f1_59[0]', null, 0],
    ['Line18', 'f1_61[0]', a.depreciation, null], ['Line18', 'f1_62[0]', null, b.depreciation],
    ['Line19', 'f1_65[0]', a.hoa, null], ['Line19', 'f1_66[0]', null, b.hoa],
    ['Line20', 'f1_68[0]', a.total, null], ['Line20', 'f1_69[0]', null, b.total],
    ['Line21', 'f1_71[0]', net(a), null], ['Line21', 'f1_72[0]', null, net(b)],
  ];
  for (const [line, field, va, vb] of rows) {
    const v = va ?? vb;
    if (v === null || (v === 0 && line !== 'Line21')) continue;
    t(`${line}[0].${field}`, n(v));
  }
  t('Line19[0].f1_64[0]', 'HOA dues');

  t('Page1[0].f1_77[0]', n(a.rents + b.rents));                       // 23a total rents
  t('Page1[0].f1_79[0]', n(a.mortgageInterest + b.mortgageInterest)); // 23c total interest
  t('Page1[0].f1_80[0]', n(a.depreciation + b.depreciation));         // 23d total depreciation
  t('Page1[0].f1_81[0]', n(a.total + b.total));                       // 23e total expenses
  t('Page1[0].f1_82[0]', n(Math.max(net(a), 0) + Math.max(net(b), 0))); // 24 income
  const losses = Math.min(net(a), 0) + Math.min(net(b), 0);
  if (losses < 0) t('Page1[0].f1_83[0]', n(Math.abs(losses)));        // 25 losses (parens preprinted)
  t('Page1[0].f1_84[0]', n(net(a) + net(b)));                         // 26 total

  form.flatten();
  const single = await PDFDocument.create();
  const [page1] = await single.copyPages(doc, [0]);
  single.addPage(page1);
  return single.save();
}

// ---------------------------------------------------------------------------
// Schedule C page 1 — Venture Consulting LLC
// ---------------------------------------------------------------------------

export async function fillScheduleC(params: URLSearchParams): Promise<Uint8Array> {
  const line31 = num(params, 'line31', 115000);
  const line13 = num(params, 'line13', 8500);
  const line30 = num(params, 'line30', 2400);
  const miles = num(params, 'miles', 4500);
  const meals = num(params, 'meals', 1800);

  const car = Math.round(miles * 0.67);
  const legal = 2400;
  const office = 4800;
  const supplies = 3200;
  const travel = 4100;
  const utilities = 5185;
  const other = 18000;
  const line28 = car + line13 + legal + office + supplies + travel + meals + utilities + other;
  const line29 = line31 + line30;
  const gross = line29 + line28;

  const doc = await PDFDocument.load(await loadBlank('f1040sc.pdf'));
  const form = doc.getForm();
  const t = (tail: string, value: string) => setText(form, tail, value);

  t('Page1[0].f1_1[0]', BORROWER);
  t('Page1[0].f1_2[0]', BORROWER_SSN);
  t('Page1[0].f1_3[0]', 'Management consulting services');
  t('BComb[0].f1_4[0]', '541611');
  t('Page1[0].f1_5[0]', 'Venture Consulting LLC');
  t('DComb[0].f1_6[0]', '824471065');
  t('Page1[0].f1_7[0]', '1847 Juniper Loop');
  t('Page1[0].f1_8[0]', 'Austin, TX 78741');
  const marks = [
    collectCheckMark(doc, form, 'Page1[0].c1_1[0]'), // F: Cash accounting method
    collectCheckMark(doc, form, 'Page1[0].c1_2[0]'), // G: materially participated – Yes
  ];

  t('Page1[0].f1_10[0]', n(gross));      // 1  Gross receipts
  t('Page1[0].f1_12[0]', n(gross));      // 3
  t('Page1[0].f1_14[0]', n(gross));      // 5  Gross profit
  t('Page1[0].f1_16[0]', n(gross));      // 7  Gross income
  t('Lines8-17[0].f1_18[0]', n(car));    // 9  Car and truck
  t('Lines8-17[0].f1_22[0]', n(line13)); // 13 Depreciation
  t('Lines8-17[0].f1_27[0]', n(legal));  // 17 Legal & professional
  t('Lines18-27[0].f1_28[0]', n(office));    // 18 Office expense
  t('Lines18-27[0].f1_33[0]', n(supplies));  // 22 Supplies
  t('Lines18-27[0].f1_35[0]', n(travel));    // 24a Travel
  t('Lines18-27[0].f1_36[0]', n(meals));     // 24b Meals
  t('Lines18-27[0].f1_37[0]', n(utilities)); // 25 Utilities
  t('Lines18-27[0].f1_40[0]', n(other));     // 27a Other expenses
  t('Page1[0].f1_41[0]', n(line28));     // 28 Total expenses
  t('Page1[0].f1_42[0]', n(line29));     // 29 Tentative profit
  t('Page1[0].f1_45[0]', n(line30));     // 30 Business use of home
  t('Page1[0].f1_46[0]', n(line31));     // 31 Net profit

  form.flatten();
  await drawCheckMarks(doc, marks);
  const single = await PDFDocument.create();
  const [page1] = await single.copyPages(doc, [0]);
  single.addPage(page1);
  return single.save();
}

// ---------------------------------------------------------------------------
// Schedule K-1 (Form 1065) — Pine Street Holdings LLP
// ---------------------------------------------------------------------------

export async function fillK1Partnership(params: URLSearchParams): Promise<Uint8Array> {
  const ordinary = num(params, 'ordinary', 96000);
  const rental = num(params, 'rental', 18000);
  const otherRental = num(params, 'otherRental', 2400);
  const guaranteed = num(params, 'guaranteed', 24000);
  const distributions = num(params, 'distributions', 48000);
  const profitPct = num(params, 'profitPct', 50);
  const capitalPct = num(params, 'capitalPct', 50);

  const doc = await PDFDocument.load(await loadBlank('f1065sk1.pdf'));
  const form = doc.getForm();
  const t = (tail: string, value: string) => setText(form, tail, value);

  t('LeftCol[0].f1_6[0]', '84-7130996');                                   // A Partnership EIN
  t('LeftCol[0].f1_7[0]', 'Pine Street Holdings LLP\n400 Pine St Suite 900\nPortland, OR 97204'); // B
  t('LeftCol[0].f1_8[0]', 'e-file');                                       // C IRS center
  t('LeftCol[0].f1_9[0]', BORROWER_SSN);                                   // E Partner TIN
  t('LeftCol[0].f1_10[0]', `${BORROWER}\n${BORROWER_ADDRESS.replace(', Austin', '\nAustin')}`); // F
  const marks = [
    collectCheckMark(doc, form, 'LeftCol[0].c1_4[1]'), // G Limited partner
    collectCheckMark(doc, form, 'LeftCol[0].c1_5[0]'), // H1 Domestic
  ];
  // J — profit / loss / capital, beginning and ending (% is preprinted)
  t('Profit[0].f1_14[0]', String(profitPct));
  t('Profit[0].f1_15[0]', String(profitPct));
  t('Loss[0].f1_16[0]', String(profitPct));
  t('Loss[0].f1_17[0]', String(profitPct));
  t('Capital[0].f1_18[0]', String(capitalPct));
  t('Capital[0].f1_19[0]', String(capitalPct));
  // K1 — partner share of liabilities
  t('Nonrecourse[0].f1_20[0]', n(310000));
  t('Nonrecourse[0].f1_21[0]', n(295000));
  // L — partner capital account
  t('Row1[0].f1_26[0]', n(185000));
  t('Row2[0].f1_27[0]', n(0));
  t('Row3[0].f1_28[0]', n(ordinary + rental + otherRental + guaranteed));
  t('Row4[0].f1_29[0]', n(0));
  t('Row5[0].f1_30[0]', n(distributions)); // parens preprinted on the form
  t('Row6[0].f1_31[0]', n(185000 + ordinary + rental + otherRental + guaranteed - distributions));

  // Part III
  t('RightCol1[0].f1_34[0]', n(ordinary));      // 1  Ordinary business income
  t('RightCol1[0].f1_35[0]', n(rental));        // 2  Net rental real estate
  t('RightCol1[0].f1_36[0]', n(otherRental));   // 3  Other net rental
  t('RightCol1[0].f1_37[0]', n(guaranteed));    // 4a Guaranteed payments – services
  t('RightCol1[0].f1_39[0]', n(guaranteed));    // 4c Total guaranteed payments
  t('RightCol2[0].Line14[0]', 'A');             // 14 Self-employment earnings code
  t('RightCol2[0].f1_60[0]', n(ordinary + guaranteed));
  t('RightCol2[0].Line19[0]', 'A');             // 19 Distributions code
  t('RightCol2[0].f1_89[0]', n(distributions));

  form.flatten();
  await drawCheckMarks(doc, marks);
  const single = await PDFDocument.create();
  const [page1] = await single.copyPages(doc, [0]);
  single.addPage(page1);
  return single.save();
}

// ---------------------------------------------------------------------------
// Schedule K-1 (Form 1120-S) — Apex Technology Partners LLC
// ---------------------------------------------------------------------------

export async function fillK1SCorp(params: URLSearchParams): Promise<Uint8Array> {
  const ordinary = num(params, 'ordinary', 142000);
  const rental = num(params, 'rental', 12000);
  const otherRental = num(params, 'otherRental', 0);
  const distributions = num(params, 'distributions', 62000);
  const ownershipPct = num(params, 'ownershipPct', 35);

  const doc = await PDFDocument.load(await loadBlank('f1120ssk.pdf'));
  const form = doc.getForm();
  const t = (tail: string, value: string) => setText(form, tail, value);

  t('LeftCol[0].f1_06[0]', '74-2890143');                                  // A Corporation EIN
  t('LeftCol[0].f1_07[0]', 'Apex Technology Partners LLC\n500 Congress Ave Suite 1400\nAustin, TX 78701'); // B
  t('LeftCol[0].f1_08[0]', 'e-file');                                      // C IRS center
  const shares = n(ownershipPct * 100);
  t('LeftCol[0].f1_09[0]', shares);                                        // D shares, beginning
  t('LeftCol[0].f1_10[0]', shares);                                        // D shares, end
  t('LeftCol[0].f1_11[0]', BORROWER_SSN);                                  // E Shareholder TIN
  t('LeftCol[0].f1_12[0]', `${BORROWER}\n${BORROWER_ADDRESS.replace(', Austin', '\nAustin')}`); // F1
  t('LeftCol[0].f1_16[0]', String(ownershipPct));                          // G allocation % (preprinted %)
  t('LeftCol[0].f1_17[0]', shares);                                        // H shares, beginning
  t('LeftCol[0].f1_18[0]', shares);                                        // H shares, end
  // Part III
  t('Lines1-12[0].f1_21[0]', n(ordinary));      // 1  Ordinary business income
  t('Lines1-12[0].f1_22[0]', n(rental));        // 2  Net rental real estate
  if (otherRental > 0) t('Lines1-12[0].f1_23[0]', n(otherRental)); // 3
  t('Lines13-17[0].f1_80[0]', 'D');             // 16 code D – distributions
  t('Lines13-17[0].f1_81[0]', n(distributions));

  form.flatten();
  const single = await PDFDocument.create();
  const [page1] = await single.copyPages(doc, [0]);
  single.addPage(page1);
  return single.save();
}
