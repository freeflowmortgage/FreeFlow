import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  ArrowRight,
  CheckSquare,
  Square,
  ClipboardList,
  Layers,
  FileSpreadsheet,
  Activity,
  AlertCircle,
  Link,
  Lock,
  Upload,
  Loader2,
  Home,
  PlusCircle,
  Trash2,
  Monitor,
  MonitorX,
  Maximize2,
  Minimize2,
  Tractor,
  Coins,
  PiggyBank,
  Printer,
} from 'lucide-react';
import { PAYSTUB_HIGHLIGHT_BOXES } from '../paystubLayout';
import type { LiveDocument, LiveParseSession, ScheduleEExpenseDetermination, ScheduleEPropertyExtract } from '../parseTypes';
import { mapIncomeFields, RENTAL_YEAR_KEY_TO_SOURCE, reviewNotesForPage, scheduleEGridFieldId } from '../incomeFieldMap';
import { liveAssetPatch, liveBorrowerName, liveScheduleLPatch, owningBusinessReturns } from '../liveHydrate';
import {
  calculateRetirementIncome,
  EMPTY_RETIREMENT_RETURN,
  IRA_CONTINUANCE_MONTHS,
  mostRecentRetirementReturn,
  retirementMethodLabel,
  retirementReturnsFromFields,
  type IraContinuanceDecision,
  type RetirementReturnLines,
} from '../retirementIncome';
import {
  allScheduleEExtracts,
  fieldForInspection,
  fieldForInspectionWithin,
  inspectNavigation,
  inspectOverlayFromField,
  kindsOf,
  pageForKind,
  pickDocumentForTab,
  scheduleEFilings,
  tabForKinds,
  w2TaxYearLookup,
  type DocKind,
  type InspectOverlay,
  type WorkspaceTab,
} from '../livePacket';
import {
  seedCCorpFromLocation,
  seedFarmFromLocation,
  seedPartnershipFromLocation,
  seedSCorpFromLocation,
  seedScheduleCFromLocation,
  seedW2FromLocation,
} from '../hydrateFromUrlA';
import {
  assignmentKey,
  locateIncomeEntities,
  pagesFromParsePages,
  discoveredSelectId,
  type LocateResult,
  type LocatedMatch,
} from '../locateIncomeEntities';
import {
  DEMO_BORROWERS,
  DEMO_URLA_ENTITIES,
  borrowersFromUrlA,
  employmentEntitiesFromUrlA,
  namesMatch,
} from '../urlaEmploymentRoster';
import type { LoanBorrower } from '../borrowers';
import { loadIntakeSession } from '../intake/sessionStore';
import { buildEncompassPayloadFromIntake } from '../intake/encompassExport';
import UrlAEntityRoster from './UrlAEntityRoster';
import BorrowerWarningsPanel from './BorrowerWarningsPanel';
import type { ProtectedWorkspaceContext } from '../protectedWorkspace';
import { SPLIT_DOC_CHANNEL, type DocPaneSnapshot, type SplitDocMessage } from '../splitDocSync';
import PdfDocumentViewer from './PdfDocumentViewer';
import FixturePdfViewer from './FixturePdfViewer';
import { usePdfViewer } from '../hooks/usePdfViewer';
import {
  CorpLines,
  CCorpLines,
  DemoDocumentCanvas,
  EMPTY_PNL,
  IncomeChoicePanel,
  InspectNote,
  LiquidityBlock,
  ProfitLossBlock,
  SchCLines,
  SelfEmployedPanel,
  YearStack,
  chosenMonthly,
  cCorpBusinessAnnual,
  corpBusinessAnnual,
  corpDistributionSupport,
  corpMinorityAnnual,
  distributionShortfallBadge,
  distributionShortfallMessage,
  liquidityReason,
  monthlyFromYears,
  schCAnnual,
  scheduleLQuickRatio,
  seAvgOptions,
  seRecommend,
  usd,
  type CCorpYear,
  type CorpYear,
  type SchCYear,
  type ScheduleL,
  type YtdPnl,
} from './selfEmployedIncome';
import {
  compactSourceLines,
  computeRental1038CashFlow,
  qualifyingProgramNote,
  chosenW2Income,
  splitIncomeByBorrower,
  w2BaseMethods,
  w2VariableMethods,
  DEFAULT_YTD_MONTHS_ELAPSED,
  BONUS_FREQUENCIES,
  bonusFrequencyLabel,
  bonusMonthsCovered,
  isBonusFrequency,
  payFrequencyLabel,
  payPeriodsPerYear,
  type BonusFrequency,
  type Form1084BorrowerIncome,
  type W2MethodContext,
} from '@mortgage-pos/mortgage-engine';
import { IncomeEntitySelector, type IncomeEntityOption } from './IncomeEntitySelector';
import UsdaDistributionToggle from './UsdaDistributionToggle';
import { scrollIntoViewWithin } from '../scrollWithin';
import { MoneyField, ReviewNotesPanel } from './WageFieldControls';

// TS Type Signatures for clean data structures
interface OCRField {
  id: string;
  category: 'METADATA' | 'EARNINGS' | 'DEDUCTIONS' | 'SCHL_BALANCE_SHEET';
  label: string;
  value: string;
  numericValue: number;
  isDiscrepancy: boolean;
  boxCoordinates: { x: number; y: number; width: number; height: number; page: number };
}

interface PrevEmployerW2 {
  employerName: string;
  ein: string;
  year: number;
  box5Wages: number;
  box12Bonus: number;
  box14Overtime: number;
}

interface W2Employer {
  id: string;
  documentIds?: string[];
  /** The borrower whose wages these are; unset means the primary borrower. */
  borrowerId?: string;
  employerName: string;
  ein: string;
  employmentStartDate: string;
  role: 'PRIMARY' | 'SECONDARY';
  monthsAtJob: number;
  payFrequency: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
  /** Coverage of the paystub YTD column derived from its pay-period end date. */
  ytdMonthsElapsed?: number;
  wageDocSource: 'PAYSTUB' | 'WVOE';
  hourlyRate: number;
  weeklyHours: number;
  currentPeriodBasePay: number;
  baseYtd: number;
  bonusYtd: number;
  overtimeYtd: number;
  tipsYtd: number;
  commissionYtd: number;
  rsuYtd: number;
  otherYtd: number;
  wvoeBonus: number;
  wvoeOvertime: number;
  wvoeOther: number;
  /** Wage source ids the parser located on the document, when one was parsed. */
  extractedFieldIds?: string[];
  wvoeMonths: number;
  /** How often this employer pays its bonus; unset averages bonus over the same months as overtime. */
  bonusFrequency?: BonusFrequency;
  w2Year1Box5: number;
  /** The year printed on the W-2 that `w2Year1Box5` was read from. */
  w2Year1TaxYear?: number;
  w2Year1Bonus: number;
  w2Year1Ot: number;
  w2Year2Box5: number;
  w2Year2Bonus: number;
  w2Year2Ot: number;
}

function formatElapsedMonths(value: number): string {
  return String(Number(value.toFixed(2)));
}

function emptyW2Employer(id: string, patch: Partial<W2Employer> = {}): W2Employer {
  return {
    id,
    documentIds: [],
    employerName: 'Parsed employer',
    ein: '',
    employmentStartDate: '',
    role: 'PRIMARY',
    monthsAtJob: 12,
    payFrequency: 'SEMIMONTHLY',
    wageDocSource: 'PAYSTUB',
    hourlyRate: 0,
    weeklyHours: 40,
    currentPeriodBasePay: 0,
    baseYtd: 0,
    bonusYtd: 0,
    overtimeYtd: 0,
    tipsYtd: 0,
    commissionYtd: 0,
    rsuYtd: 0,
    otherYtd: 0,
    wvoeBonus: 0,
    wvoeOvertime: 0,
    wvoeOther: 0,
    wvoeMonths: 12,
    w2Year1Box5: 0,
    w2Year1Bonus: 0,
    w2Year1Ot: 0,
    w2Year2Box5: 0,
    w2Year2Bonus: 0,
    w2Year2Ot: 0,
    ...patch,
  };
}

function emptySchCYear(year: number): SchCYear {
  return { year, line31: 0, line13: 0, line30: 0, line44aMiles: 0, line24bMeals: 0 };
}

function emptyCorpYear(year: number): CorpYear {
  return {
    year, ordinaryIncome: 0, netRentalRealEstate: 0, otherNetRental: 0, depreciation: 0,
    gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 0, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 0, distributions: 0,
  };
}

function emptyCCorpYear(year: number): CCorpYear {
  return {
    year, taxableIncome: 0, totalTaxPaid: 0, depreciation: 0, depletion: 0, amortization: 0,
    mealsM1: 0, nol: 0, w2Wages: 0, dividends: 0,
  };
}

function emptyFarmYear(year: number): ScheduleFYear {
  return {
    year, netFarmProfitLoss: 0, depreciation: 0, depletion: 0, amortization: 0,
    casualtyLoss: 0, businessUseOfHome: 0, mealsExclusion: 0, nonrecurringIncome: 0,
  };
}

const EMPTY_SCHEDULE_L: ScheduleL = {
  cash: 0, receivables: 0, allowance: 0, taxExempt: 0, otherCurrentAssets: 0,
  accountsPayable: 0, notesLt1Yr: 0, otherCurrentLiab: 0, currentLiabilities: 0,
};

function scheduleLFromFields(
  fields: Parameters<typeof liveScheduleLPatch>[0],
  allowed: Set<string>,
): ScheduleL {
  const patch = liveScheduleLPatch(
    fields.filter((field) => (field.sourceFieldId ?? '').startsWith('sch-l-') && allowed.has(`${field.documentId ?? ''}:${field.pageIndex}`)),
  );
  return {
    ...EMPTY_SCHEDULE_L,
    cash: patch?.cash ?? 0,
    receivables: patch?.receivables ?? 0,
    taxExempt: patch?.taxExempt ?? 0,
    accountsPayable: patch?.accountsPayable ?? 0,
    notesLt1Yr: patch?.notesLt1Yr ?? 0,
    otherCurrentLiab: patch?.otherCurrentLiab ?? 0,
    currentLiabilities: patch?.currentLiabilities ?? 0,
  };
}

interface BusinessEntity<TYear> {
  id: string;
  /** The borrower who owns this business interest; unset means the primary borrower. */
  borrowerId?: string;
  businessName: string;
  ein: string;
  years: [TYear, TYear];
}

interface SCorpEntity extends BusinessEntity<CorpYear> {
  ownershipPct: number;
  scheduleL: ScheduleL;
  hasStableDistributions: boolean;
}

interface PartnershipEntity extends BusinessEntity<CorpYear> {
  profitPctEnd: number;
  capitalPctEnd: number;
  scheduleL: ScheduleL;
  hasStableDistributions: boolean;
}

interface CCorpEntity extends BusinessEntity<CCorpYear> {
  ownershipPct: number;
  scheduleL: ScheduleL;
}

interface ScheduleFYear {
  year: number;
  netFarmProfitLoss: number;
  depreciation: number;
  depletion: number;
  amortization: number;
  casualtyLoss: number;
  businessUseOfHome: number;
  mealsExclusion: number;
  nonrecurringIncome: number;
}

interface AssetIncomeYear {
  year: number;
  interestIncome: number;
  dividendIncome: number;
  capitalGainsNetLoss: number;
}

type SplitViewSource = 'demo' | 'live';

type IncomeTab =
  | 'PAYSTUB_RECONCILIATION'
  | 'SCHEDULE_C'
  | 'SCORP'
  | 'CCORP'
  | 'PARTNERSHIP'
  | 'SCHEDULE_F'
  | 'ASSET_INCOME'
  | 'RETIREMENT'
  | 'SCHEDULE_E'
  | 'ENCOMPASS_SYNC';

/** Demo return: an IRA distribution that stays excluded until the underwriter confirms continuance. */
const DEMO_RETIREMENT_RETURN: RetirementReturnLines = {
  ...EMPTY_RETIREMENT_RETURN,
  year: 2025,
  iraTotal: 24000,
  iraTaxable: 18000,
};

type RetirementLineKey = 'iraTotal' | 'iraTaxable' | 'pensionTotal' | 'pensionTaxable' | 'ssTotal' | 'ssTaxable';
const RETIREMENT_LINES: ReadonlyArray<readonly [string, string, RetirementLineKey, string]> = [
  ['Line 4a', 'IRA distributions', 'iraTotal', 'f1040-ira-total'],
  ['Line 4b', 'Taxable IRA distributions', 'iraTaxable', 'f1040-ira-taxable'],
  ['Line 5a', 'Pensions and annuities', 'pensionTotal', 'f1040-pensions-total'],
  ['Line 5b', 'Taxable pensions', 'pensionTaxable', 'f1040-pensions-taxable'],
  ['Line 6a', 'Social Security benefits', 'ssTotal', 'f1040-ss-total'],
  ['Line 6b', 'Taxable Social Security', 'ssTaxable', 'f1040-ss-taxable'],
];

// ── Rental Income (Schedule E Page 1 · Form 1084 / 1038 worksheet) ────────────

/** One year of Schedule E data for a single rental property (full 1084 line set) */
interface RentalPropertyYear {
  year: number;
  rentsReceived: number;    // Line 3  – gross rents
  insurance: number;        // Line 9  – add-back
  mortgageInterest: number; // Line 12 – add-back
  taxes: number;            // Line 16 – add-back
  depreciation: number;     // Line 18 – add-back
  hoaDues: number;          // Line 19 – HOA / association dues add-back (when in PITIA)
  totalExpenses: number;    // Line 20 – total expenses (includes lines 5–19)
  netIncomeLoss: number | null; // Line 21 – prefer this when parsed; null reconstructs from L3 − L20
  extraordinaryAddBack: number; // UW extraordinary / other allowed add-back (not an IRS line)
  fairRentalDays: number;   // Line 2  – (0 = full year / 365)
  expenseDetermination?: ScheduleEExpenseDetermination;
  source?: { documentId: string; pageIndex: number; column: 'A' | 'B' | 'C' };
}

interface RentalProperty {
  id: string;
  /** Borrower whose return this is, when the Schedule E was assigned to one. */
  ownerId?: string;
  address: string;
  propertyType: 'SFR' | 'DUPLEX' | 'TRIPLEX' | 'FOURPLEX' | 'COMMERCIAL' | 'VACATION';
  isSubjectProperty: boolean;
  /**
   * Subject-property income method:
   *  SCHEDULE_E  – returns history exists (refinance) → 1084 cash flow − proposed PITIA
   *  MARKET_RENT – no history (purchase) → 75% of Form 1007/1025 gross market rent − proposed PITIA
   */
  subjectMethod: 'SCHEDULE_E' | 'MARKET_RENT';
  /** Gross monthly market rent from Form 1007 / 1025 / lease (subject MARKET_RENT method) */
  marketRent: number;
  /** Borrower occupies one unit of a 2–4 unit subject primary — deficit routes to housing expense, not liabilities */
  isPrimary2To4: boolean;
  /** Full monthly PITIA for the property. null = not yet available; UW must fill. */
  pitia: number | null;
  /** Where the PITIA figure came from */
  pitiaSource: 'ENCOMPASS' | 'UW' | null;
  /** Most recent year entry (always required) */
  year1: RentalPropertyYear;
  /** Prior year entry (used when twoYears === true) */
  year2: RentalPropertyYear;
}

/**
 * PITIA parsed from the loan application (1003 / Encompass REO), not Schedule E.
 * The 1038 calculator subtracts this after days-rented averaging.
 * When the app has a PITIA for the property, the box is prefilled; otherwise it
 * stays blank for the underwriter to complete.
 */
const ENCOMPASS_REO_PITIA: Record<string, number> = {
  '742 Evergreen Terrace, Springfield, IL': 1450,
};

function normalizeReoAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|road|rd|court|ct|drive|dr|boulevard|blvd|lane|ln|unit|apt|#)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match Schedule E / REO addresses to the PITIA the income tool parsed from the app. */
function pitiaFromApp(address: string): number | undefined {
  if (!address) return undefined;
  if (Object.prototype.hasOwnProperty.call(ENCOMPASS_REO_PITIA, address)) {
    return ENCOMPASS_REO_PITIA[address];
  }
  const needle = normalizeReoAddress(address);
  if (!needle) return undefined;
  for (const [key, value] of Object.entries(ENCOMPASS_REO_PITIA)) {
    const hay = normalizeReoAddress(key);
    if (needle === hay || needle.startsWith(hay) || hay.startsWith(needle)) return value;
  }
  return undefined;
}

/**
 * Simulated Encompass proposed-loan PITIA for the subject property. The subject
 * loan's proposed housing payment is always available from the loan file, so a
 * property flagged as Subject uses this figure (not the REO section).
 */
const ENCOMPASS_SUBJECT_PROPOSED_PITIA = 2350;

function emptyRentalYear(year: number): RentalPropertyYear {
  return {
    year,
    rentsReceived: 0,
    insurance: 0,
    mortgageInterest: 0,
    taxes: 0,
    depreciation: 0,
    hoaDues: 0,
    totalExpenses: 0,
    netIncomeLoss: null,
    extraordinaryAddBack: 0,
    fairRentalDays: 0,
  };
}

function mapScheduleEPropertyType(raw: string): RentalProperty['propertyType'] {
  const code = (raw.match(/[1-8]/) || [])[0];
  if (code === '2') return 'DUPLEX';
  if (code === '3') return 'VACATION';
  if (code === '4') return 'COMMERCIAL';
  return 'SFR';
}

function rentalYearFromExtract(extract: ScheduleEPropertyExtract & { documentId?: string }): RentalPropertyYear {
  const financials = extract.financials || {};
  return {
    year: extract.year ?? 0,
    rentsReceived: financials['3'] ?? 0,
    insurance: financials['9'] ?? 0,
    mortgageInterest: financials['12'] ?? 0,
    taxes: financials['16'] ?? 0,
    depreciation: financials['18'] ?? 0,
    hoaDues: financials['19'] ?? 0,
    totalExpenses: financials['20'] ?? 0,
    netIncomeLoss: financials['21'] ?? null,
    extraordinaryAddBack: 0,
    fairRentalDays: extract.fairRentalDays || 0,
    expenseDetermination: extract.determination,
    source: extract.documentId
      ? { documentId: extract.documentId, pageIndex: extract.pageIndex, column: extract.column }
      : undefined,
  };
}

/** Group every Schedule E column by address and owner so two tax years become year1 / year2. */
function rentalPropertiesFromExtracts<T extends ScheduleEPropertyExtract & { documentId?: string }>(
  extracts: T[],
  ownerOf?: (extract: T) => string | undefined,
): RentalProperty[] {
  return scheduleEFilings(extracts, ownerOf).map(({ latest, prior, ownerId }, index) => {
    const address = latest.address.trim() || `Schedule E ${latest.column} · page ${latest.pageIndex + 1}`;
    const encompassPitia = pitiaFromApp(address);
    return {
      id: `live-e-${index + 1}`,
      ownerId,
      address,
      propertyType: mapScheduleEPropertyType(latest.propertyType),
      isSubjectProperty: false,
      subjectMethod: 'SCHEDULE_E' as const,
      marketRent: 0,
      isPrimary2To4: false,
      pitia: encompassPitia ?? null,
      pitiaSource: encompassPitia !== undefined ? ('ENCOMPASS' as const) : null,
      year1: rentalYearFromExtract(latest),
      year2: prior ? rentalYearFromExtract(prior) : emptyRentalYear((latest.year ?? 1) - 1),
    };
  });
}

export default function UnderwriterSplitViewDemo({
  liveSession = null,
  liveDocuments = [],
  source = 'demo',
  parseBusy = false,
  parseError = null,
  onParseFile,
  onParseFiles,
  onUseDemo,
  onUseLive,
  protectedContext = null,
  onOpenAuthoritativeWorkflow,
  fixtureDocumentPrefix = '/fixtures/docs',
}: {
  liveSession?: LiveParseSession | null;
  liveDocuments?: LiveDocument[];
  source?: SplitViewSource;
  parseBusy?: boolean;
  parseError?: string | null;
  onParseFile?: (file: File) => void;
  onParseFiles?: (files: File[]) => void;
  onUseDemo?: () => void;
  onUseLive?: () => void;
  protectedContext?: ProtectedWorkspaceContext | null;
  onOpenAuthoritativeWorkflow?: () => void;
  /** `/fixtures/docs` behind Cognito, or `/solo-demo/docs` for the public sales demo. */
  fixtureDocumentPrefix?: string;
} = {}) {
  const packet: LiveDocument[] = liveDocuments.length
    ? liveDocuments
    : liveSession
      ? [{ id: 'single', sha256: '', file: liveSession.file, fileName: liveSession.fileName, result: liveSession.result }]
      : [];
  // The protected workspace is live before its first document is selected.
  // Keep its real empty state visible instead of falling back to demo values.
  const isLive = source === 'live';
  const viewer = usePdfViewer(2);
  const [livePageIndex, setLivePageIndex] = useState(0);
  const [inspectOverlay, setInspectOverlay] = useState<InspectOverlay | null>(null);
  const activePdfPage = viewer.currentPage;
  const setActivePdfPage = viewer.setPage;
  const mappedFields = useMemo(
    () =>
      packet.flatMap((doc) =>
        mapIncomeFields(doc.result).map((field) => ({ ...field, documentId: doc.id })),
      ),
    [packet.map((doc) => doc.id).join('|')],
  );
  const scheduleEExtracts = useMemo(() => allScheduleEExtracts(packet), [packet.map((doc) => doc.id).join('|')]);
  const urlARoster = useMemo(
    () => (protectedContext ? [] : isLive ? employmentEntitiesFromUrlA(loadIntakeSession()?.answers) : DEMO_URLA_ENTITIES),
    [isLive, protectedContext],
  );
  const loanBorrowers = useMemo<LoanBorrower[]>(
    () => (protectedContext ? protectedContext.borrowers : isLive ? borrowersFromUrlA(loadIntakeSession()?.answers) : DEMO_BORROWERS),
    [isLive, protectedContext],
  );
  /** Underwriter's "assign to borrower" choices for documents that name nobody on the 1003. */
  const [borrowerAssignments, setBorrowerAssignments] = useState<Record<string, string>>(
    () => protectedContext?.borrowerAssignments ?? {},
  );
  useEffect(() => {
    if (protectedContext) setBorrowerAssignments(protectedContext.borrowerAssignments);
  }, [protectedContext]);
  const locateResult: LocateResult = useMemo(() => {
    if (!isLive) {
      return {
        borrowers: DEMO_BORROWERS,
        roster: DEMO_URLA_ENTITIES.map((entity) => {
          const kind =
            entity.kind === 'wages'
              ? 'w2'
              : entity.kind === 'rental'
                ? 'schedule-e'
                : /farm/i.test(entity.name)
                  ? 'schedule-f'
                  : /advisory/i.test(entity.name)
                    ? 'scorp'
                    : /horizon|property partners/i.test(entity.name)
                      ? 'partnership'
                      : /summit|manufacturing/i.test(entity.name)
                        ? 'ccorp'
                        : 'schedule-c';
          const form =
            kind === 'w2'
              ? 'W-2'
              : kind === 'schedule-e'
                ? 'Schedule E'
                : kind === 'schedule-f'
                  ? 'Schedule F'
                  : kind === 'scorp'
                    ? 'Form 1120-S'
                    : kind === 'partnership'
                      ? 'Form 1065'
                      : kind === 'ccorp'
                        ? 'Form 1120'
                        : 'Schedule C';
          return {
            entity,
            located: true,
            matches: [
              {
                entityId: entity.id,
                form: form as LocatedMatch['form'],
                kind,
                pageIndex: 0,
                name: entity.name,
                ein: entity.ein,
                fields: [],
              },
            ],
          };
        }),
        discovered: [
          {
            entityId: 'partnership-undisclosed-side',
            form: 'Form 1065',
            kind: 'partnership',
            pageIndex: 0,
            name: 'Undisclosed Side LLC',
            ein: '11-2233445',
            fields: [],
          },
        ],
      };
    }
    return locateIncomeEntities({
      roster: urlARoster,
      borrowers: loanBorrowers,
      assignments: borrowerAssignments,
      fields: mappedFields,
      pages: packet.flatMap((doc) => pagesFromParsePages(doc.result.pages, doc.id)),
      rentals: scheduleEExtracts.map((extract) => ({
        address: extract.address,
        pageIndex: extract.pageIndex,
        documentId: extract.documentId,
        column: extract.column,
      })),
    });
  }, [isLive, urlARoster, loanBorrowers, borrowerAssignments, mappedFields, packet, scheduleEExtracts]);
  const borrowers = locateResult.borrowers?.length ? locateResult.borrowers : loanBorrowers;
  const multipleBorrowers = borrowers.length > 1;
  const borrowerName = (id: string | undefined) =>
    borrowers.find((borrower) => borrower.id === (id ?? borrowers[0]?.id))?.name ?? '';
  /** The previous-employer history on the 1003 is the primary borrower's, so only their jobs merge it. */
  const ownedByPrimary = (entry: { borrowerId?: string }) =>
    !multipleBorrowers || !entry.borrowerId || entry.borrowerId === borrowers[0]?.id;

  // 1. Navigation & View States
  const [activeTab, setActiveTab] = useState<IncomeTab>('PAYSTUB_RECONCILIATION');
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null);
  const qaPointerTargetRef = useRef<HTMLElement | null>(null);

  const availableTabs = useMemo(() => {
    const allTabs = [
      ['PAYSTUB_RECONCILIATION', 'Wages', ClipboardList],
      ['SCHEDULE_C', 'Sch C', FileSpreadsheet],
      ['SCORP', '1120-S', FileSpreadsheet],
      ['CCORP', '1120', FileSpreadsheet],
      ['PARTNERSHIP', '1065', FileSpreadsheet],
      ['SCHEDULE_F', 'Sch F', Tractor],
      ['ASSET_INCOME', 'Assets', Coins],
      ['RETIREMENT', 'Retirement', PiggyBank],
      ['SCHEDULE_E', 'Rental', Home],
      ['ENCOMPASS_SYNC', 'Reconcile', Lock],
    ] as const;

    if (!isLive) return allTabs; // Demo mode shows all tabs for walkthrough

    const packetKinds = packet.flatMap((doc) => kindsOf(doc));
    const hasKind = (...want: Array<(typeof packetKinds)[number]>) => want.some((kind) => packetKinds.includes(kind));

    return allTabs.filter(([id]) => {
      if (id === 'ENCOMPASS_SYNC') return true;
      if (id === 'PAYSTUB_RECONCILIATION') return true;
      if (id === 'SCHEDULE_C') return hasKind('schedule-c');
      if (id === 'SCORP') return hasKind('scorp');
      if (id === 'CCORP') return hasKind('ccorp');
      if (id === 'PARTNERSHIP') return hasKind('partnership');
      if (id === 'SCHEDULE_F') return hasKind('schedule-f');
      if (id === 'ASSET_INCOME') return hasKind('asset');
      if (id === 'RETIREMENT') return hasKind('retirement');
      if (id === 'SCHEDULE_E') return hasKind('schedule-e');
      return false;
    });
  }, [isLive, packet]);

  // Each document is offered in the pane for the tab it belongs to. Wages
  // splits pay stubs from W-2s; a document of no known kind stays reachable
  // there, since that is where it has always routed.
  const tabDocGroups = useMemo(() => {
    type Group = { label: string; kind?: DocKind; wageDocKind?: 'paystub' | 'w2'; docs: typeof packet };
    const having = (kind: DocKind) => packet.filter((doc) => kindsOf(doc).includes(kind));
    const groups: Group[] = (() => {
      switch (activeTab) {
        case 'PAYSTUB_RECONCILIATION':
          return [
            { label: 'Pay stub', kind: 'paystub', wageDocKind: 'paystub', docs: having('paystub') },
            { label: 'W-2', kind: 'w2', wageDocKind: 'w2', docs: having('w2') },
            { label: 'Other', docs: packet.filter((doc) => kindsOf(doc).length === 0) },
          ];
        case 'SCHEDULE_C': return [{ label: 'Sch C', kind: 'schedule-c', docs: having('schedule-c') }];
        case 'SCORP': return [{ label: '1120-S', kind: 'scorp', docs: having('scorp') }];
        case 'CCORP': return [{ label: '1120', kind: 'ccorp', docs: having('ccorp') }];
        case 'PARTNERSHIP': return [{ label: '1065', kind: 'partnership', docs: having('partnership') }];
        case 'SCHEDULE_F': return [{ label: 'Sch F', kind: 'schedule-f', docs: having('schedule-f') }];
        case 'ASSET_INCOME': return [{ label: 'Assets', kind: 'asset', docs: having('asset') }];
        case 'RETIREMENT': return [{ label: 'Form 1040', kind: 'retirement', docs: having('retirement') }];
        case 'SCHEDULE_E': return [{ label: 'Sch E', kind: 'schedule-e', docs: having('schedule-e') }];
        default: return [{ label: 'All', docs: packet }];
      }
    })();
    return groups.filter((group) => group.docs.length > 0);
  }, [activeTab, packet]);

  // Ensure active tab is valid
  React.useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.find(([id]) => id === activeTab)) {
      setActiveTab(availableTabs[0][0]);
    }
  }, [availableTabs, activeTab]);

  const [canvasYearIndex, setCanvasYearIndex] = useState<0 | 1>(0);
  // The only Schedule E blank is the 2025 revision, so a "prior year" fill of it
  // is a second 2025 return. The template packet shows one Schedule E.
  const docYearIndex: 0 | 1 = activeTab === 'SCHEDULE_E' ? 0 : canvasYearIndex;
  /** Left-pane document style: interactive facsimile or the real filled source PDF. */
  const [docMode, setDocMode] = useState<'facsimile' | 'pdf'>('pdf');
  const [wageDocKind, setWageDocKind] = useState<'paystub' | 'w2'>('paystub');
  const [inspectDocId, setInspectDocId] = useState<string | null>(null);
  const packetKey = packet.map((doc) => doc.id).join('|');
  const [parserEngine, setParserEngine] = useState('checking…');
  useEffect(() => {
    void fetch('/health')
      .then((response) => response.json())
      .then((payload: { engine?: string }) => setParserEngine(payload.engine || 'unknown'))
      .catch(() => setParserEngine('offline'));
  }, []);
  const prevPacketKeyRef = useRef('');
  const skipPageResetRef = useRef(false);
  useEffect(() => {
    if (!isLive || packetKey === prevPacketKeyRef.current) {
      prevPacketKeyRef.current = packetKey;
      return;
    }
    const addedId = packetKey.split('|').filter((id) => id && !prevPacketKeyRef.current.split('|').includes(id)).pop();
    prevPacketKeyRef.current = packetKey;
    const added = packet.find((doc) => doc.id === addedId);
    if (!added) return;
    const next = tabForKinds(kindsOf(added));
    setActiveTab(next.tab);
    if (next.wageDocKind) setWageDocKind(next.wageDocKind);
    setInspectDocId(added.id);
    setLivePageIndex(pageForKind(added.result, kindsOf(added)[0]));
  }, [isLive, packetKey]);
  const canvasDoc = pickDocumentForTab(packet, activeTab as WorkspaceTab, wageDocKind, inspectDocId);
  const canvasFields = mappedFields.filter((field) => !canvasDoc || field.documentId === canvasDoc.id);
  const hasLivePaystub = packet.some((doc) => kindsOf(doc).includes('paystub') || kindsOf(doc).includes('unknown'));
  const hasLiveW2 = packet.some((doc) => kindsOf(doc).includes('w2'));
  useEffect(() => {
    if (!isLive || (activeTab !== 'PAYSTUB_RECONCILIATION' && activeTab !== 'ENCOMPASS_SYNC')) return;
    if (wageDocKind === 'paystub' && !hasLivePaystub && hasLiveW2) setWageDocKind('w2');
    if (wageDocKind === 'w2' && !hasLiveW2 && hasLivePaystub) setWageDocKind('paystub');
  }, [isLive, activeTab, wageDocKind, hasLivePaystub, hasLiveW2]);
  useEffect(() => {
    if (!isLive || !canvasDoc) return;
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      return;
    }
    const want =
      activeTab === 'PAYSTUB_RECONCILIATION' || activeTab === 'ENCOMPASS_SYNC'
        ? wageDocKind
        : activeTab === 'SCHEDULE_E'
          ? 'schedule-e'
          : kindsOf(canvasDoc)[0];
    setLivePageIndex(pageForKind(canvasDoc.result, want));
  }, [isLive, canvasDoc?.id, activeTab, wageDocKind]);
  const [twoYearSchC, setTwoYearSchC] = useState(false);
  const [twoYearScorp, setTwoYearScorp] = useState(false);
  const [twoYearCCorp, setTwoYearCCorp] = useState(false);
  const [twoYearPartnership, setTwoYearPartnership] = useState(false);
  const [twoYearScheduleF, setTwoYearScheduleF] = useState(false);
  const [twoYearAssetIncome, setTwoYearAssetIncome] = useState(false);
  const [twoYearRental, setTwoYearRental] = useState(false);
  const [rentalChoice, setRentalChoice] = useState<string | null>(null);

  const [rentalProperties, setRentalProperties] = useState<RentalProperty[]>(() => {
    if (isLive) return [];
    const props: Array<Omit<RentalProperty, 'pitia' | 'pitiaSource'>> = [
      {
        id: 'prop-1',
        address: '742 Evergreen Terrace, Springfield, IL',
        propertyType: 'SFR',
        isSubjectProperty: false,
        subjectMethod: 'SCHEDULE_E',
        marketRent: 0,
        isPrimary2To4: false,
        year1: { year: 2025, rentsReceived: 24000, insurance: 1200, mortgageInterest: 4800, taxes: 2900, depreciation: 3500, hoaDues: 0, totalExpenses: 14500, netIncomeLoss: 9500, extraordinaryAddBack: 0, fairRentalDays: 0 },
        year2: { year: 2024, rentsReceived: 22800, insurance: 1150, mortgageInterest: 4900, taxes: 2800, depreciation: 3500, hoaDues: 0, totalExpenses: 14200, netIncomeLoss: 8600, extraordinaryAddBack: 0, fairRentalDays: 0 },
      },
      {
        id: 'prop-2',
        address: '1600 Pennsylvania Ave NW, Unit 4B, Washington, DC',
        propertyType: 'DUPLEX',
        isSubjectProperty: false,
        subjectMethod: 'SCHEDULE_E',
        marketRent: 3200,
        isPrimary2To4: false,
        year1: { year: 2025, rentsReceived: 36000, insurance: 1800, mortgageInterest: 7200, taxes: 4300, depreciation: 5200, hoaDues: 2400, totalExpenses: 22700, netIncomeLoss: 13300, extraordinaryAddBack: 0, fairRentalDays: 0 },
        year2: { year: 2024, rentsReceived: 34000, insurance: 1750, mortgageInterest: 7400, taxes: 4200, depreciation: 5200, hoaDues: 2400, totalExpenses: 22100, netIncomeLoss: 11900, extraordinaryAddBack: 0, fairRentalDays: 0 },
      },
    ];
    // Prefill PITIA from the application REO parse when the property is on the 1003.
    return props.map((p) => {
      const encompassPitia = pitiaFromApp(p.address);
      return {
        ...p,
        pitia: encompassPitia ?? null,
        pitiaSource: encompassPitia !== undefined ? ('ENCOMPASS' as const) : null,
      };
    });
  });

  const scheduleEOwners = useMemo(
    () =>
      scheduleEExtracts.map(
        (extract) =>
          borrowerAssignments[assignmentKey({ documentId: extract.documentId, pageIndex: extract.pageIndex, form: 'Schedule E' })] ?? '',
      ),
    [scheduleEExtracts, borrowerAssignments],
  );
  const scheduleEOwnerKey = scheduleEOwners.join('|');
  useEffect(() => {
    const extracts = scheduleEExtracts;
    if (!isLive || !extracts.length) return;
    const next = rentalPropertiesFromExtracts(extracts, (extract) => scheduleEOwners[extracts.indexOf(extract)] || undefined);
    setRentalProperties(next);
    setTwoYearRental(next.some((property) => {
      const prior = property.year2;
      return Boolean(prior.rentsReceived || prior.totalExpenses || prior.netIncomeLoss || prior.fairRentalDays);
    }));
  }, [isLive, scheduleEExtracts, scheduleEOwnerKey]);

  const [w2BaseChoices, setW2BaseChoices] = useState<Record<string, string | null>>({});
  const [w2VarChoices, setW2VarChoices] = useState<Record<string, string | null>>({});
  const [schCChoices, setSchCChoices] = useState<Record<string, string | null>>({});
  const [sCorpChoices, setSCorpChoices] = useState<Record<string, string | null>>({});
  const [cCorpChoices, setCCorpChoices] = useState<Record<string, string | null>>({});
  const [partnershipChoices, setPartnershipChoices] = useState<Record<string, string | null>>({});
  const [scheduleFChoices, setScheduleFChoices] = useState<Record<string, string | null>>({});

  // 2. Variable Continuity & Job Transition States
  const [mergePreviousEmployerVariable, setMergePreviousEmployerVariable] = useState<boolean>(!isLive);
  const [monthsAtPreviousJob, setMonthsAtPreviousJob] = useState<number>(isLive ? 0 : 16); // Remainder of the 24-month verification window

  // Previous Job Variable History
  const [prevEmployerW2, setPrevEmployerW2] = useState<PrevEmployerW2>(isLive ? {
    employerName: '',
    ein: '',
    year: 0,
    box5Wages: 0,
    box12Bonus: 0,
    box14Overtime: 0,
  } : {
    employerName: 'Digital Solutions Corp',
    ein: '94-87654321',
    year: 2025,
    box5Wages: 78500,
    box12Bonus: 18000,     // Previous bonus history
    box14Overtime: 6000     // Previous overtime history
  });

  const [w2Employers, setW2Employers] = useState<W2Employer[]>(isLive ? [emptyW2Employer('w2-live', { employerName: '' })] : [
    {
      id: 'w2-apex',
      employerName: 'Apex Technology Partners LLC',
      ein: '74-1234567',
      employmentStartDate: '2025-12-15',
      role: 'PRIMARY',
      monthsAtJob: 8,
      payFrequency: 'SEMIMONTHLY',
      wageDocSource: 'PAYSTUB',
      hourlyRate: 45,
      weeklyHours: 40,
      currentPeriodBasePay: 3600,
      baseYtd: 54000,
      bonusYtd: 12500,
      overtimeYtd: 4200,
      tipsYtd: 0,
      commissionYtd: 0,
      rsuYtd: 0,
      otherYtd: 0,
      wvoeBonus: 18000,
      wvoeOvertime: 6000,
      wvoeOther: 0,
      wvoeMonths: 12,
      w2Year1Box5: 78500,
      w2Year1Bonus: 18000,
      w2Year1Ot: 6000,
      w2Year2Box5: 74200,
      w2Year2Bonus: 15000,
      w2Year2Ot: 4800,
    },
    {
      id: 'w2-meridian',
      employerName: 'Meridian Health Systems',
      ein: '52-7654321',
      employmentStartDate: '2024-03-01',
      role: 'SECONDARY',
      monthsAtJob: 29,
      payFrequency: 'BIWEEKLY',
      wageDocSource: 'WVOE',
      hourlyRate: 22,
      weeklyHours: 12,
      currentPeriodBasePay: 528,
      baseYtd: 7920,
      bonusYtd: 0,
      overtimeYtd: 0,
      tipsYtd: 0,
      commissionYtd: 0,
      rsuYtd: 0,
      otherYtd: 0,
      wvoeBonus: 0,
      wvoeOvertime: 0,
      wvoeOther: 0,
      wvoeMonths: 24,
      w2Year1Box5: 11440,
      w2Year1Bonus: 0,
      w2Year1Ot: 0,
      w2Year2Box5: 10920,
      w2Year2Bonus: 0,
      w2Year2Ot: 0,
    },
  ]);
  const [activeW2EmployerId, setActiveW2EmployerId] = useState(isLive ? 'w2-live' : 'w2-apex');
  const activeW2Employer = w2Employers.find((entry) => entry.id === activeW2EmployerId) ?? w2Employers[0];
  const patchW2Employer = (patch: Partial<W2Employer>) =>
    setW2Employers((entries) => entries.map((entry) => (entry.id === activeW2Employer.id ? { ...entry, ...patch } : entry)));
  // Anything that cites a W-2's year reads it off the form, and says nothing
  // when the form carries none. Naming a year the document does not carry is
  // worse than naming none, because the figure beside it then looks verified
  // against a return nobody supplied. The prior-year method prefers this
  // employer's own W-2 and falls back to the previous job's, so the year
  // follows the same order.
  const priorW2Year =
    (activeW2Employer.w2Year1Box5 ? activeW2Employer.w2Year1TaxYear : prevEmployerW2.year) || undefined;
  const priorW2YearPrefix = priorW2Year ? `${priorW2Year} ` : '';
  const priorJobW2YearPrefix = prevEmployerW2.year ? `${prevEmployerW2.year} ` : '';
  const currentHourlyRate = activeW2Employer.hourlyRate;
  const currentWeeklyHours = activeW2Employer.weeklyHours;
  const currentPeriodBasePay = activeW2Employer.currentPeriodBasePay;
  const currentBaseYtd = activeW2Employer.baseYtd;
  const currentBonusYtd = activeW2Employer.bonusYtd;
  const currentOtYtd = activeW2Employer.overtimeYtd;
  const currentTipsYtd = activeW2Employer.tipsYtd;
  const currentCommissionYtd = activeW2Employer.commissionYtd;
  const currentRsuYtd = activeW2Employer.rsuYtd;
  const currentOtherYtd = activeW2Employer.otherYtd;
  const monthsAtCurrentJob = activeW2Employer.monthsAtJob;

  // Everything the parser flagged about the wage documents. These were computed
  // and discarded before, so an excluded earning code reached a decision unseen.
  const wageReviewNotes = useMemo(() => reviewNotesForPage(mappedFields), [mappedFields]);

  // A figure the parser never located is not a zero. Only claim a field is
  // missing once we know which ones were extracted, so the demo packet and any
  // hand-entered value keep rendering normally.
  const wageFieldExtracted = (sourceId: string): boolean | undefined => {
    const extracted = activeW2Employer.extractedFieldIds;
    if (!extracted) return undefined;
    return extracted.includes(sourceId);
  };
  const setCurrentHourlyRate = (value: number) => patchW2Employer({ hourlyRate: value });
  const setCurrentWeeklyHours = (value: number) => patchW2Employer({ weeklyHours: value });
  const setCurrentPeriodBasePay = (value: number) => patchW2Employer({ currentPeriodBasePay: value });
  const setCurrentBaseYtd = (value: number) => patchW2Employer({ baseYtd: value });
  const setCurrentBonusYtd = (value: number) => patchW2Employer({ bonusYtd: value });
  const setCurrentOtYtd = (value: number) => patchW2Employer({ overtimeYtd: value });
  const setCurrentTipsYtd = (value: number) => patchW2Employer({ tipsYtd: value });
  const setCurrentCommissionYtd = (value: number) => patchW2Employer({ commissionYtd: value });
  const setCurrentRsuYtd = (value: number) => patchW2Employer({ rsuYtd: value, otherYtd: value });
  const setCurrentOtherYtd = (value: number) => patchW2Employer({ otherYtd: value });
  const setMonthsAtCurrentJob = (value: number) => patchW2Employer({ monthsAtJob: value });
  const w2BaseChoice = w2BaseChoices[activeW2Employer.id] ?? null;
  const w2VarChoice = w2VarChoices[activeW2Employer.id] ?? null;
  const setW2BaseChoice = (value: string | null) =>
    setW2BaseChoices((choices) => ({ ...choices, [activeW2Employer.id]: value }));
  const setW2VarChoice = (value: string | null) =>
    setW2VarChoices((choices) => ({ ...choices, [activeW2Employer.id]: value }));

  const [schCEntities, setSchCEntities] = useState<Array<BusinessEntity<SchCYear>>>(isLive ? [{
    id: 'schc-live',
    businessName: '',
    ein: '',
    years: [emptySchCYear(2025), emptySchCYear(2024)],
  }] : [
    {
      id: 'schc-vance',
      businessName: 'Vance Technology Consulting',
      ein: '81-2345678',
      years: [
        { year: 2025, line31: 115000, line13: 8500, line30: 2400, line44aMiles: 4500, line24bMeals: 1800 },
        { year: 2024, line31: 98000, line13: 7200, line30: 2100, line44aMiles: 3800, line24bMeals: 1500 },
      ],
    },
    {
      id: 'schc-studio',
      businessName: 'Vance Design Studio',
      ein: '81-8765432',
      years: [
        { year: 2025, line31: 32000, line13: 2100, line30: 0, line44aMiles: 1100, line24bMeals: 400 },
        { year: 2024, line31: 28000, line13: 1800, line30: 0, line44aMiles: 900, line24bMeals: 350 },
      ],
    },
  ]);
  const [activeSchCId, setActiveSchCId] = useState(isLive ? 'schc-live' : 'schc-vance');
  const activeSchC = schCEntities.find((entry) => entry.id === activeSchCId) ?? schCEntities[0];
  const schCYears = activeSchC.years;
  const setSchCYears = (update: React.SetStateAction<[SchCYear, SchCYear]>) =>
    setSchCEntities((entities) =>
      entities.map((entity) =>
        entity.id === activeSchC.id
          ? { ...entity, years: typeof update === 'function' ? update(entity.years) : update }
          : entity,
      ),
    );
  const schCChoice = schCChoices[activeSchC.id] ?? null;
  const setSchCChoice = (value: string | null) =>
    setSchCChoices((choices) => ({ ...choices, [activeSchC.id]: value }));

  const baseSCorpScheduleL: ScheduleL = {
    cash: 125000, receivables: 25000, allowance: 2500, taxExempt: 5000,
    otherCurrentAssets: 15000, accountsPayable: 60000, notesLt1Yr: 30000, otherCurrentLiab: 10000, currentLiabilities: 0,
  };
  const [sCorpEntities, setSCorpEntities] = useState<SCorpEntity[]>(isLive ? [{
    id: 'scorp-live',
    businessName: '',
    ein: '',
    ownershipPct: 100,
    hasStableDistributions: true,
    scheduleL: { ...EMPTY_SCHEDULE_L },
    years: [emptyCorpYear(2025), emptyCorpYear(2024)],
  }] : [
    {
      id: 'scorp-apex', businessName: 'Apex Advisory Holdings', ein: '74-9876543', ownershipPct: 35,
      hasStableDistributions: true,
      scheduleL: baseSCorpScheduleL,
      years: [
        { year: 2025, ordinaryIncome: 142000, netRentalRealEstate: 12000, otherNetRental: 0, depreciation: 18500, gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 2200, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 48000, distributions: 62000 },
        { year: 2024, ordinaryIncome: 128000, netRentalRealEstate: 9500, otherNetRental: 0, depreciation: 16200, gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 1900, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 45000, distributions: 55000 },
      ],
    },
  ]);
  const [activeSCorpId, setActiveSCorpId] = useState(isLive ? 'scorp-live' : 'scorp-apex');
  const activeSCorp = sCorpEntities.find((entry) => entry.id === activeSCorpId) ?? sCorpEntities[0];
  const sCorpYears = activeSCorp.years;
  const setSCorpYears = (update: React.SetStateAction<[CorpYear, CorpYear]>) =>
    setSCorpEntities((entities) => entities.map((entity) => entity.id === activeSCorp.id
      ? { ...entity, years: typeof update === 'function' ? update(entity.years) : update } : entity));
  const sCorpChoice = sCorpChoices[activeSCorp.id] ?? null;
  const setSCorpChoice = (value: string | null) =>
    setSCorpChoices((choices) => ({ ...choices, [activeSCorp.id]: value }));

  const basePartnershipScheduleL: ScheduleL = {
    cash: 210000, receivables: 18000, allowance: 0, taxExempt: 0,
    otherCurrentAssets: 8000, accountsPayable: 42000, notesLt1Yr: 15000, otherCurrentLiab: 6000, currentLiabilities: 0,
  };
  const [partnershipEntities, setPartnershipEntities] = useState<PartnershipEntity[]>(isLive ? [{
    id: 'partnership-live',
    businessName: '',
    ein: '',
    profitPctEnd: 100,
    capitalPctEnd: 100,
    hasStableDistributions: true,
    scheduleL: { ...EMPTY_SCHEDULE_L },
    years: [emptyCorpYear(2025), emptyCorpYear(2024)],
  }] : [
    {
      id: 'partnership-horizon', businessName: 'Horizon Property Partners', ein: '52-2468101',
      profitPctEnd: 50, capitalPctEnd: 50, hasStableDistributions: true, scheduleL: basePartnershipScheduleL,
      years: [
        { year: 2025, ordinaryIncome: 96000, netRentalRealEstate: 18000, otherNetRental: 2400, depreciation: 12000, gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 800, guaranteedPayments: 24000, otherNoncash: 1500, w2Wages: 0, distributions: 48000 },
        { year: 2024, ordinaryIncome: 88000, netRentalRealEstate: 16500, otherNetRental: 2200, depreciation: 11000, gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 700, guaranteedPayments: 24000, otherNoncash: 1200, w2Wages: 0, distributions: 45000 },
      ],
    },
    {
      id: 'partnership-undisclosed-side', businessName: 'Undisclosed Side LLC', ein: '11-2233445',
      profitPctEnd: 25, capitalPctEnd: 25, hasStableDistributions: true, scheduleL: basePartnershipScheduleL,
      years: [
        { year: 2025, ordinaryIncome: 41000, netRentalRealEstate: 0, otherNetRental: 0, depreciation: 4000, gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 200, guaranteedPayments: 8000, otherNoncash: 0, w2Wages: 0, distributions: 12000 },
        { year: 2024, ordinaryIncome: 38000, netRentalRealEstate: 0, otherNetRental: 0, depreciation: 3800, gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 180, guaranteedPayments: 8000, otherNoncash: 0, w2Wages: 0, distributions: 11000 },
      ],
    },
  ]);
  const [activePartnershipId, setActivePartnershipId] = useState(isLive ? 'partnership-live' : 'partnership-horizon');
  const activePartnership = partnershipEntities.find((entry) => entry.id === activePartnershipId) ?? partnershipEntities[0];
  const partnershipYears = activePartnership.years;
  const setPartnershipYears = (update: React.SetStateAction<[CorpYear, CorpYear]>) =>
    setPartnershipEntities((entities) => entities.map((entity) => entity.id === activePartnership.id
      ? { ...entity, years: typeof update === 'function' ? update(entity.years) : update } : entity));
  const partnershipChoice = partnershipChoices[activePartnership.id] ?? null;
  const setPartnershipChoice = (value: string | null) =>
    setPartnershipChoices((choices) => ({ ...choices, [activePartnership.id]: value }));
  /** GSE investor drives which K-1 Item J ending percentage qualifies: FNMA = % capital, Freddie Mac = % profit */
  const [gseInvestor, setGseInvestor] = useState<'FNMA' | 'FREDDIE'>('FNMA');
  /** S-Corp K-1: single end-of-year stock ownership percentage */
  const sCorpShareholderPct = activeSCorp.ownershipPct;
  const setSCorpShareholderPct = (value: number) =>
    setSCorpEntities((entities) => entities.map((entity) => entity.id === activeSCorp.id ? { ...entity, ownershipPct: value } : entity));
  /** Partnership K-1 Item J END-of-year percentages (beginning % is never used to qualify) */
  const partnershipProfitPctEnd = activePartnership.profitPctEnd;
  const partnershipCapitalPctEnd = activePartnership.capitalPctEnd;
  const setPartnershipProfitPctEnd = (value: number) =>
    setPartnershipEntities((entities) => entities.map((entity) => entity.id === activePartnership.id ? { ...entity, profitPctEnd: value } : entity));
  const setPartnershipCapitalPctEnd = (value: number) =>
    setPartnershipEntities((entities) => entities.map((entity) => entity.id === activePartnership.id ? { ...entity, capitalPctEnd: value } : entity));
  // FNMA qualifies on ending capital, Freddie Mac on ending profit. When they
  // differ the lower is used for either agency, matching resolve1065Ownership.
  const partnershipAgencyPct = gseInvestor === 'FREDDIE' ? partnershipProfitPctEnd : partnershipCapitalPctEnd;
  const partnershipPct = Math.min(partnershipProfitPctEnd, partnershipCapitalPctEnd);
  const partnershipPctNote =
    partnershipProfitPctEnd !== partnershipCapitalPctEnd
      ? `Ending profit ${partnershipProfitPctEnd}% and capital ${partnershipCapitalPctEnd}% differ. The lower ${partnershipPct}% is applied${
          partnershipPct < partnershipAgencyPct ? ` instead of ${gseInvestor === 'FREDDIE' ? 'Freddie Mac' : 'FNMA'}'s ${partnershipAgencyPct}%` : ''
        }. Confirm the partnership agreement before using the higher figure.`
      : null;
  const sCorpL = activeSCorp.scheduleL;
  const setSCorpL = (value: React.SetStateAction<ScheduleL>) =>
    setSCorpEntities((entities) => entities.map((entity) => entity.id === activeSCorp.id
      ? { ...entity, scheduleL: typeof value === 'function' ? value(entity.scheduleL) : value } : entity));
  const partnershipL = activePartnership.scheduleL;
  const setPartnershipL = (value: React.SetStateAction<ScheduleL>) =>
    setPartnershipEntities((entities) => entities.map((entity) => entity.id === activePartnership.id
      ? { ...entity, scheduleL: typeof value === 'function' ? value(entity.scheduleL) : value } : entity));

  const baseCCorpScheduleL: ScheduleL = {
    cash: 180000, receivables: 42000, allowance: 4000, taxExempt: 0,
    otherCurrentAssets: 12000, accountsPayable: 55000, notesLt1Yr: 22000, otherCurrentLiab: 8000, currentLiabilities: 0,
  };
  const [cCorpEntities, setCCorpEntities] = useState<CCorpEntity[]>(isLive ? [{
    id: 'ccorp-live',
    businessName: '',
    ein: '',
    ownershipPct: 100,
    scheduleL: { ...EMPTY_SCHEDULE_L },
    years: [emptyCCorpYear(2025), emptyCCorpYear(2024)],
  }] : [
    {
      id: 'ccorp-summit', businessName: 'Summit Manufacturing Inc', ein: '36-5551212', ownershipPct: 40,
      scheduleL: baseCCorpScheduleL,
      years: [
        { year: 2025, taxableIncome: 210000, totalTaxPaid: 44100, depreciation: 28000, depletion: 0, amortization: 4000, mealsM1: 1800, nol: 0, w2Wages: 72000, dividends: 8000 },
        { year: 2024, taxableIncome: 188000, totalTaxPaid: 39480, depreciation: 25100, depletion: 0, amortization: 3600, mealsM1: 1600, nol: 0, w2Wages: 68000, dividends: 6500 },
      ],
    },
  ]);
  const [activeCCorpId, setActiveCCorpId] = useState(isLive ? 'ccorp-live' : 'ccorp-summit');
  const activeCCorp = cCorpEntities.find((entry) => entry.id === activeCCorpId) ?? cCorpEntities[0];
  const cCorpYears = activeCCorp.years;
  const setCCorpYears = (update: React.SetStateAction<[CCorpYear, CCorpYear]>) =>
    setCCorpEntities((entities) => entities.map((entity) => entity.id === activeCCorp.id
      ? { ...entity, years: typeof update === 'function' ? update(entity.years) : update } : entity));
  const cCorpChoice = cCorpChoices[activeCCorp.id] ?? null;
  const setCCorpChoice = (value: string | null) =>
    setCCorpChoices((choices) => ({ ...choices, [activeCCorp.id]: value }));
  const cCorpOwnershipPct = activeCCorp.ownershipPct;
  const setCCorpOwnershipPct = (value: number) =>
    setCCorpEntities((entities) => entities.map((entity) => entity.id === activeCCorp.id ? { ...entity, ownershipPct: value } : entity));
  const cCorpL = activeCCorp.scheduleL;
  const setCCorpL = (value: React.SetStateAction<ScheduleL>) =>
    setCCorpEntities((entities) => entities.map((entity) => entity.id === activeCCorp.id
      ? { ...entity, scheduleL: typeof value === 'function' ? value(entity.scheduleL) : value } : entity));

  const [scheduleFEntities, setScheduleFEntities] = useState<Array<BusinessEntity<ScheduleFYear>>>(isLive ? [{
    id: 'farm-live',
    businessName: '',
    ein: '',
    years: [emptyFarmYear(2025), emptyFarmYear(2024)],
  }] : [
    {
      id: 'farm-vance', businessName: 'Vance Family Farm', ein: '74-1122334',
      years: [
        { year: 2025, netFarmProfitLoss: 64000, depreciation: 9800, depletion: 0, amortization: 1200, casualtyLoss: 0, businessUseOfHome: 0, mealsExclusion: 800, nonrecurringIncome: 0 },
        { year: 2024, netFarmProfitLoss: 58000, depreciation: 9100, depletion: 0, amortization: 1100, casualtyLoss: 0, businessUseOfHome: 0, mealsExclusion: 700, nonrecurringIncome: 0 },
      ],
    },
  ]);
  const [activeScheduleFId, setActiveScheduleFId] = useState(isLive ? 'farm-live' : 'farm-vance');
  const activeScheduleF = scheduleFEntities.find((entry) => entry.id === activeScheduleFId) ?? scheduleFEntities[0];
  const scheduleFChoice = scheduleFChoices[activeScheduleF.id] ?? null;
  const setScheduleFChoice = (value: string | null) =>
    setScheduleFChoices((choices) => ({ ...choices, [activeScheduleF.id]: value }));
  const patchScheduleFYear = (index: number, patch: Partial<ScheduleFYear>) =>
    setScheduleFEntities((entities) => entities.map((entity) => entity.id === activeScheduleF.id
      ? { ...entity, years: entity.years.map((year, i) => i === index ? { ...year, ...patch } : year) as [ScheduleFYear, ScheduleFYear] }
      : entity));

  const [assetIncomeYears, setAssetIncomeYears] = useState<[AssetIncomeYear, AssetIncomeYear]>(isLive ? [
    { year: 2025, interestIncome: 0, dividendIncome: 0, capitalGainsNetLoss: 0 },
    { year: 2024, interestIncome: 0, dividendIncome: 0, capitalGainsNetLoss: 0 },
  ] : [
    { year: 2025, interestIncome: 4200, dividendIncome: 7600, capitalGainsNetLoss: 12500 },
    { year: 2024, interestIncome: 3900, dividendIncome: 7100, capitalGainsNetLoss: 9800 },
  ]);
  const [assetIncomeIncluded, setAssetIncomeIncluded] = useState(false);
  const [retirementReturn, setRetirementReturn] = useState<RetirementReturnLines>(
    isLive ? EMPTY_RETIREMENT_RETURN : DEMO_RETIREMENT_RETURN,
  );
  /** Customer-entered vested balance from the most recent retirement account statement. */
  const [iraBalanceInput, setIraBalanceInput] = useState('');
  const [iraContinuance, setIraContinuance] = useState<IraContinuanceDecision | null>(null);
  const [loanProgram, setLoanProgram] = useState<'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA'>(
    protectedContext?.loanProgram ?? 'CONVENTIONAL',
  );
  useEffect(() => {
    if (protectedContext) setLoanProgram(protectedContext.loanProgram);
  }, [protectedContext?.loanProgram]);
  const [schCPnl, setSchCPnl] = useState<YtdPnl>(EMPTY_PNL);
  const [sCorpPnl, setSCorpPnl] = useState<YtdPnl>(EMPTY_PNL);
  const [cCorpPnl, setCCorpPnl] = useState<YtdPnl>(EMPTY_PNL);
  const [partnershipPnl, setPartnershipPnl] = useState<YtdPnl>(EMPTY_PNL);

  const governmentTwoYear = loanProgram === 'FHA' || loanProgram === 'VA' || loanProgram === 'USDA';

  useEffect(() => {
    setTwoYearRental(governmentTwoYear);
    setTwoYearSchC(governmentTwoYear);
    setTwoYearScorp(governmentTwoYear);
    setTwoYearCCorp(governmentTwoYear);
    setTwoYearPartnership(governmentTwoYear);
    setTwoYearScheduleF(governmentTwoYear);
  }, [governmentTwoYear]);

  useEffect(() => {
    if (!isLive || !packet.length) return;
    const documentLabels = packet.flatMap((doc) => Object.values(doc.result.classifications).flat()).join(' ');
    if (/USDA|Rural Development|3555/i.test(documentLabels)) setLoanProgram('USDA');
    else if (/FHA|HUD-92800|HUD 92900/i.test(documentLabels)) setLoanProgram('FHA');
    else if (/VA|Notice of Value|26-7/i.test(documentLabels)) setLoanProgram('VA');
  }, [isLive, packet.map((doc) => doc.id).join('|')]);

  useEffect(() => {
    if (!isLive) return;
    const kinds = new Set(packet.flatMap((doc) => kindsOf(doc)));
    const { current, previous } = seedW2FromLocation(
      locateResult,
      mappedFields,
      w2TaxYearLookup(packet),
    );
    const w2Rows = current.map((seed) =>
      emptyW2Employer(seed.id, {
        ...seed.patch,
        documentIds: seed.documentIds,
        borrowerId: seed.borrowerId,
        employerName: seed.employerName,
        ein: seed.ein,
        role: seed.role,
        w2Year1TaxYear: seed.w2TaxYear,
        wageDocSource: seed.patch?.wageDocSource ?? 'PAYSTUB',
      }),
    );
    setW2Employers(w2Rows.length ? w2Rows : [emptyW2Employer('w2-live')]);
    setActiveW2EmployerId(w2Rows[0]?.id ?? 'w2-live');
    if (previous) {
      setPrevEmployerW2({
        employerName: previous.employerName || 'Prior employer',
        ein: previous.ein || '',
        // The year the W-2 covers, which is not always the year before this
        // one: a 2024 W-2 can arrive during a 2026 application.
        year: previous.taxYear ?? new Date().getFullYear() - 1,
        box5Wages: previous.box5Wages ?? 0,
        box12Bonus: 0,
        box14Overtime: 0,
      });
      setMergePreviousEmployerVariable(Boolean(previous.box5Wages));
    } else {
      setPrevEmployerW2({ employerName: '', ein: '', year: 0, box5Wages: 0, box12Bonus: 0, box14Overtime: 0 });
      setMergePreviousEmployerVariable(false);
      setMonthsAtPreviousJob(0);
    }

    const schCSeeds = seedScheduleCFromLocation(locateResult);
    setSchCEntities(
      schCSeeds.length
        ? schCSeeds.map((seed) => ({
            id: seed.id,
            borrowerId: seed.borrowerId,
            businessName: seed.businessName,
            ein: seed.ein,
            years: [
              { ...emptySchCYear(2025), ...seed.years[0] },
              { ...emptySchCYear(2024), ...seed.years[1] },
            ],
          }))
        : [{ id: 'schc-live', businessName: 'No Schedule C in packet', ein: '', years: [emptySchCYear(2025), emptySchCYear(2024)] }],
    );
    setActiveSchCId(schCSeeds[0]?.id ?? 'schc-live');

    const scorpSeeds = seedSCorpFromLocation(locateResult);
    const partnershipSeeds = seedPartnershipFromLocation(locateResult);
    const ccorpSeeds = seedCCorpFromLocation(locateResult);
    const schedulePages = packet.flatMap((doc) =>
      doc.result.pages.map((page) => ({ documentId: doc.id, index: page.index, formIds: page.formIds })),
    );
    const businessCount = [scorpSeeds, partnershipSeeds, ccorpSeeds].filter((seeds) => seeds.length > 0).length;
    const returnOwners = owningBusinessReturns(schedulePages);
    const pageKeys = (matches: (page: { documentId: string; index: number; formIds: string[] }) => boolean) =>
      new Set(schedulePages.filter(matches).map((page) => `${page.documentId}:${page.index}`));
    const sheetFor = (pattern: RegExp, seedCount: number): ScheduleL => {
      if (seedCount !== 1) return { ...EMPTY_SCHEDULE_L };
      const owned = scheduleLFromFields(
        mappedFields,
        new Set([...returnOwners].filter(([, owner]) => pattern.test(owner)).map(([key]) => key)),
      );
      const used = (sheet: ScheduleL) =>
        Boolean(sheet.cash || sheet.receivables || sheet.taxExempt || sheet.accountsPayable || sheet.notesLt1Yr || sheet.otherCurrentLiab || sheet.currentLiabilities);
      if (used(owned)) return owned;
      // No masthead reached the balance sheet: a partial upload, or a title the
      // classifier could not read. One business in the packet leaves only one
      // return the sheet can belong to.
      const loose = scheduleLFromFields(mappedFields, pageKeys((page) => /schedule\s*l/i.test(page.formIds.join(' '))));
      if (businessCount === 1 && used(loose)) return loose;
      return { ...EMPTY_SCHEDULE_L };
    };
    const scorpSheet = sheetFor(/1120-?s/i, scorpSeeds.length);
    const partnershipSheet = sheetFor(/\b1065\b/i, partnershipSeeds.length);
    const ccorpSheet = sheetFor(/form\s*1120(?!-?\s*s)\b|c-corporation/i, ccorpSeeds.length);
    setSCorpEntities(
      scorpSeeds.length
        ? scorpSeeds.map((seed) => {
            const year1 = seed.years[0] ?? {};
            const year2 = seed.years[1] ?? {};
            const { ownershipPct, businessName: _n1, ein: _e1, ...rest1 } = year1;
            const { ownershipPct: _o2, businessName: _n2, ein: _e2, ...rest2 } = year2;
            return {
              id: seed.id,
              borrowerId: seed.borrowerId,
              businessName: seed.businessName,
              ein: seed.ein,
              ownershipPct: ownershipPct ?? 100,
              hasStableDistributions: true,
              scheduleL: scorpSheet,
              years: [{ ...emptyCorpYear(2025), ...rest1 }, { ...emptyCorpYear(2024), ...rest2 }] as [CorpYear, CorpYear],
            };
          })
        : [{
            id: 'scorp-live',
            businessName: 'No S-Corp in packet',
            ein: '',
            ownershipPct: 100,
            hasStableDistributions: true,
            scheduleL: { ...EMPTY_SCHEDULE_L },
            years: [emptyCorpYear(2025), emptyCorpYear(2024)],
          }],
    );
    setActiveSCorpId(scorpSeeds[0]?.id ?? 'scorp-live');

    setPartnershipEntities(
      partnershipSeeds.length
        ? partnershipSeeds.map((seed) => {
            const year1 = seed.years[0] ?? {};
            const year2 = seed.years[1] ?? {};
            const { profitPctEnd, capitalPctEnd, ownershipPct: _o1, businessName: _n1, ein: _e1, ...rest1 } = year1;
            const { profitPctEnd: _p2, capitalPctEnd: _c2, ownershipPct: _o2, businessName: _n2, ein: _e2, ...rest2 } = year2;
            return {
              id: seed.id,
              borrowerId: seed.borrowerId,
              businessName: seed.businessName,
              ein: seed.ein,
              profitPctEnd: profitPctEnd ?? 100,
              capitalPctEnd: capitalPctEnd ?? 100,
              hasStableDistributions: true,
              scheduleL: partnershipSheet,
              years: [{ ...emptyCorpYear(2025), ...rest1 }, { ...emptyCorpYear(2024), ...rest2 }] as [CorpYear, CorpYear],
            };
          })
        : [{
            id: 'partnership-live',
            businessName: 'No partnership in packet',
            ein: '',
            profitPctEnd: 100,
            capitalPctEnd: 100,
            hasStableDistributions: true,
            scheduleL: { ...EMPTY_SCHEDULE_L },
            years: [emptyCorpYear(2025), emptyCorpYear(2024)],
          }],
    );
    setActivePartnershipId(partnershipSeeds[0]?.id ?? 'partnership-live');

    setCCorpEntities(
      ccorpSeeds.length
        ? ccorpSeeds.map((seed) => {
            const { businessName: _n1, ein: _e1, ...rest1 } = seed.years[0] ?? {};
            const { businessName: _n2, ein: _e2, ...rest2 } = seed.years[1] ?? {};
            return {
              id: seed.id,
              borrowerId: seed.borrowerId,
              businessName: seed.businessName,
              ein: seed.ein,
              ownershipPct: 100,
              scheduleL: ccorpSheet,
              years: [{ ...emptyCCorpYear(2025), ...rest1 }, { ...emptyCCorpYear(2024), ...rest2 }] as [CCorpYear, CCorpYear],
            };
          })
        : [{
            id: 'ccorp-live',
            businessName: 'No C-Corp in packet',
            ein: '',
            ownershipPct: 100,
            scheduleL: { ...EMPTY_SCHEDULE_L },
            years: [emptyCCorpYear(2025), emptyCCorpYear(2024)],
          }],
    );
    setActiveCCorpId(ccorpSeeds[0]?.id ?? 'ccorp-live');

    const farmSeeds = seedFarmFromLocation(locateResult);
    setScheduleFEntities(
      farmSeeds.length
        ? farmSeeds.map((seed) => {
            const { businessName: _n1, ein: _e1, ...rest1 } = seed.years[0] ?? {};
            const { businessName: _n2, ein: _e2, ...rest2 } = seed.years[1] ?? {};
            return {
              id: seed.id,
              borrowerId: seed.borrowerId,
              businessName: seed.businessName,
              ein: seed.ein,
              years: [{ ...emptyFarmYear(2025), ...rest1 }, { ...emptyFarmYear(2024), ...rest2 }] as [ScheduleFYear, ScheduleFYear],
            };
          })
        : [{ id: 'farm-live', businessName: 'No Schedule F in packet', ein: '', years: [emptyFarmYear(2025), emptyFarmYear(2024)] }],
    );
    setActiveScheduleFId(farmSeeds[0]?.id ?? 'farm-live');

    const asset = liveAssetPatch(mappedFields);
    setAssetIncomeYears([
      { year: 2025, interestIncome: 0, dividendIncome: 0, capitalGainsNetLoss: 0, ...asset },
      { year: 2024, interestIncome: 0, dividendIncome: 0, capitalGainsNetLoss: 0 },
    ]);
    setAssetIncomeIncluded(Boolean(asset) || kinds.has('asset'));
    const retirementReturns = retirementReturnsFromFields(mappedFields, (documentId, pageIndex) =>
      packet.find((doc) => doc.id === documentId)?.result.pages.find((page) => page.index === pageIndex));
    setRetirementReturn(mostRecentRetirementReturn(retirementReturns) ?? EMPTY_RETIREMENT_RETURN);
    setIraBalanceInput('');
    setIraContinuance(null);
    if (!kinds.has('schedule-e') && scheduleEExtracts.length === 0) {
      setRentalProperties([]);
    }
    setSchCPnl(EMPTY_PNL);
    setSCorpPnl(EMPTY_PNL);
    setCCorpPnl(EMPTY_PNL);
    setPartnershipPnl(EMPTY_PNL);
  }, [isLive, mappedFields, locateResult, packet, scheduleEExtracts]);

  // Demo keeps the sample borrower. A live upload starts blank and takes the name from the PDF, then the 1003 draft.
  const intakeBorrowerName = isLive ? loadIntakeSession()?.answers.borrowerName?.trim() : '';
  const borrowerMetadata = {
    loanId: protectedContext?.loanId ?? (isLive ? 'Live' : 'LN-2026-88042'),
    borrowerName: protectedContext?.borrowers[0]?.name ?? (isLive ? (liveBorrowerName(mappedFields) || intakeBorrowerName || '—') : 'Sarah K. Vance'),
    /** Everyone on the loan, for the header. The single-name field above feeds the pay stub checks. */
    borrowerNames: multipleBorrowers ? borrowers.map((borrower) => borrower.name).join(' & ') : '',
    currentEmployer: activeW2Employer.employerName,
    employmentStartDate: activeW2Employer.employmentStartDate,
    loanProgram,
  };

  // Demo-only facsimile boxes for the generated /fixtures/docs/paystub.pdf stub.
  // Live inspect must use mappedFields.box + pageIndex, not these coordinates.
  const fieldCoordinatesMapping = useMemo<OCRField[]>(() => [
    { id: 'ps-emp-name', category: 'METADATA', label: 'Employer Name', value: borrowerMetadata.currentEmployer, numericValue: 0, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-emp-name'] },
    { id: 'ps-ee-name', category: 'METADATA', label: 'Employee Name', value: borrowerMetadata.borrowerName, numericValue: 0, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-ee-name'] },
    { id: 'ps-period', category: 'METADATA', label: 'Pay Period', value: '2026-08-01 to 2026-08-15', numericValue: 0, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-period'] },
    { id: 'ps-frequency', category: 'METADATA', label: 'Pay Frequency', value: 'Semi-Monthly (24 Pays/Yr)', numericValue: 24, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-frequency'] },
    { id: 'ps-hourly-rate', category: 'EARNINGS', label: 'Hourly Pay Rate', value: `$${currentHourlyRate.toFixed(2)}/hr`, numericValue: currentHourlyRate, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-hourly-rate'] },
    { id: 'ps-hours-week', category: 'EARNINGS', label: 'Standard Weekly Hours', value: `${currentWeeklyHours} hrs`, numericValue: currentWeeklyHours, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-hours-week'] },
    { id: 'ps-current-base', category: 'EARNINGS', label: 'Current Period Base Pay', value: `$${currentPeriodBasePay.toLocaleString()}`, numericValue: currentPeriodBasePay, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-current-base'] },
    { id: 'ps-base-ytd', category: 'EARNINGS', label: 'Base Wages YTD', value: `$${currentBaseYtd.toLocaleString()}`, numericValue: currentBaseYtd, isDiscrepancy: true, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-base-ytd'] },
    { id: 'ps-bonus-ytd', category: 'EARNINGS', label: 'Bonus Income YTD', value: `$${currentBonusYtd.toLocaleString()}`, numericValue: currentBonusYtd, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-bonus-ytd'] },
    { id: 'ps-ot-ytd', category: 'EARNINGS', label: 'Overtime Income YTD', value: `$${currentOtYtd.toLocaleString()}`, numericValue: currentOtYtd, isDiscrepancy: false, boxCoordinates: PAYSTUB_HIGHLIGHT_BOXES['ps-ot-ytd'] },
  ], [
    currentHourlyRate, 
    currentWeeklyHours, 
    currentPeriodBasePay, 
    currentBaseYtd, 
    currentBonusYtd, 
    currentOtYtd,
  ]);

  // ==================== 5. COMPLEX CALCULATORS & MATHEMATICAL MODELS ====================

  // A. 4-Way Base Wage Reconciliation [cite: 177]
  const w2ContextFor = (entry: W2Employer): W2MethodContext => ({
    ownedByPrimary: ownedByPrimary(entry),
    priorEmployer: prevEmployerW2,
    ytdMonthsElapsed: entry.ytdMonthsElapsed,
  });
  const baseWageReconciliation = useMemo(() => {
    const methods = w2BaseMethods(activeW2Employer, w2ContextFor(activeW2Employer));
    const monthly = (id: string) => methods.options.find((option) => option.id === id)?.monthly ?? 0;
    return {
      hourlyMethod: monthly('hourly'),
      periodAnnualizedMethod: monthly('period'),
      ytdAverageMethod: monthly('ytd'),
      priorYearW2Average: monthly('prior'),
      maxVariancePct: methods.maxVariancePct,
      ytdMonthsElapsed: activeW2Employer.ytdMonthsElapsed ?? DEFAULT_YTD_MONTHS_ELAPSED,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownedByPrimary reads borrowers
  }, [activeW2Employer, prevEmployerW2, borrowers]);

  // B. Variable Income Rolling & Continuity (Job Transition Adapter) [cite: 177]
  const variableContinuityCalculations = useMemo(() => {
    const fromWvoe = activeW2Employer.wageDocSource === 'WVOE';
    const currentBonusOtTotal = fromWvoe
      ? activeW2Employer.wvoeBonus + activeW2Employer.wvoeOvertime
      : currentBonusYtd + currentOtYtd + currentTipsYtd + currentCommissionYtd;
    const currentMonths = fromWvoe ? Math.max(activeW2Employer.wvoeMonths, 1) : monthsAtCurrentJob;
    const currentMonthlyVariableAvg =
      w2VariableMethods(activeW2Employer, {
        ownedByPrimary: false,
        ytdMonthsElapsed: activeW2Employer.ytdMonthsElapsed,
      }).options.find((option) => option.id === 'current')?.monthly ?? 0;

    const previousBonusOtTotal = prevEmployerW2.box12Bonus + prevEmployerW2.box14Overtime;
    const previousMonthlyVariableAvg = previousBonusOtTotal / 12;

    const aggregatedVariableTotal = mergePreviousEmployerVariable
      ? currentBonusOtTotal + previousBonusOtTotal
      : currentBonusOtTotal;

    const totalRollingMonths = mergePreviousEmployerVariable
      ? currentMonths + 12
      : currentMonths;

    const qualifyingRollingVariableAvg = aggregatedVariableTotal / totalRollingMonths;

    return {
      currentMonthlyVariableAvg,
      previousMonthlyVariableAvg,
      qualifyingRollingVariableAvg,
      aggregatedVariableTotal,
      totalRollingMonths
    };
  }, [activeW2Employer, currentBonusYtd, currentOtYtd, currentTipsYtd, currentCommissionYtd, monthsAtCurrentJob, mergePreviousEmployerVariable, prevEmployerW2]);

  const schCFlow = useMemo(() => {
    const y1 = schCAnnual(schCYears[0]);
    const y2 = schCAnnual(schCYears[1]);
    return { y1, y2 };
  }, [schCYears]);

  // Employers not on screen still count with the method the underwriter chose for
  // them (or the recommended one), so each borrower's share matches their own tab.
  const w2IncomeOf = (entry: W2Employer) =>
    chosenW2Income(entry, w2ContextFor(entry), { base: w2BaseChoices[entry.id], variable: w2VarChoices[entry.id] });
  const w2BaseMonthlyOf = (entry: W2Employer) => w2IncomeOf(entry).baseMonthly;
  const w2VariableMonthlyOf = (entry: W2Employer) => w2IncomeOf(entry).variableMonthly;
  const additionalW2Monthly = useMemo(
    () =>
      w2Employers
        .filter((entry) => entry.id !== activeW2Employer.id)
        .reduce(
          (totals, entry) => ({
            base: totals.base + w2BaseMonthlyOf(entry),
            variable: totals.variable + w2VariableMonthlyOf(entry),
          }),
          { base: 0, variable: 0 },
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the per-entry helpers read only these
    [w2Employers, activeW2Employer.id, w2BaseChoices, w2VarChoices, prevEmployerW2, borrowers],
  );

  const sCorpLRatio = useMemo(() => scheduleLQuickRatio(sCorpL), [sCorpL]);
  const partnershipLRatio = useMemo(() => scheduleLQuickRatio(partnershipL), [partnershipL]);

  const sCorpFlow = useMemo(() => {
    const isMinority = sCorpShareholderPct < 25;
    const y1W2 = sCorpYears[0].w2Wages;
    const y2W2 = sCorpYears[1].w2Wages;
    const w2Monthly = monthlyFromYears(y1W2, y2W2, twoYearScorp);

    if (isMinority) {
      // <25% ownership: not self-employed. K-1 boxes 1/2/3 usable as ordinary income
      // (no business add-backs, capped at distributions); Schedule L gate does not apply.
      const m1 = corpMinorityAnnual(sCorpYears[0], sCorpShareholderPct);
      const m2 = corpMinorityAnnual(sCorpYears[1], sCorpShareholderPct);
      return {
        y1: m1.capped + y1W2,
        y2: m2.capped + y2W2,
        w2Monthly,
        dropped: false,
        isMinority: true,
        wasCapped: m1.wasCapped || m2.wasCapped,
        shortfall: null,
      };
    }

    const y1BizRaw = corpBusinessAnnual(sCorpYears[0], sCorpShareholderPct);
    const y2BizRaw = corpBusinessAnnual(sCorpYears[1], sCorpShareholderPct);
    // A balance sheet that was never read is no liquidity route, so pass null
    // rather than its failing ratio: the two lead to different advice.
    const liquidity = sCorpLRatio.provided || sCorpLRatio.overridden ? sCorpLRatio.passes : null;
    const s1 = corpDistributionSupport(sCorpYears[0], y1BizRaw, activeSCorp.hasStableDistributions, liquidity);
    const s2 = corpDistributionSupport(sCorpYears[1], y2BizRaw, activeSCorp.hasStableDistributions, liquidity);
    return {
      y1: s1.annual + y1W2,
      y2: s2.annual + y2W2,
      w2Monthly,
      dropped: !sCorpLRatio.passes,
      isMinority: false,
      wasCapped: s1.annual < y1BizRaw || s2.annual < y2BizRaw,
      shortfall: s1.shortfall ?? s2.shortfall,
    };
  }, [sCorpYears, sCorpShareholderPct, twoYearScorp, sCorpLRatio, activeSCorp.hasStableDistributions]);

  const partnershipFlow = useMemo(() => {
    const isMinority = partnershipPct < 25;
    const gpMonthly = monthlyFromYears(
      partnershipYears[0].guaranteedPayments,
      partnershipYears[1].guaranteedPayments,
      twoYearPartnership,
    );

    if (isMinority) {
      const m1 = corpMinorityAnnual(partnershipYears[0], partnershipPct);
      const m2 = corpMinorityAnnual(partnershipYears[1], partnershipPct);
      return {
        y1: m1.capped,
        y2: m2.capped,
        gpMonthly,
        dropped: false,
        isMinority: true,
        wasCapped: m1.wasCapped || m2.wasCapped,
        shortfall: null,
      };
    }

    const y1Raw = corpBusinessAnnual(partnershipYears[0], partnershipPct);
    const y2Raw = corpBusinessAnnual(partnershipYears[1], partnershipPct);
    const liquidity = partnershipLRatio.provided || partnershipLRatio.overridden ? partnershipLRatio.passes : null;
    const s1 = corpDistributionSupport(partnershipYears[0], y1Raw, activePartnership.hasStableDistributions, liquidity);
    const s2 = corpDistributionSupport(partnershipYears[1], y2Raw, activePartnership.hasStableDistributions, liquidity);
    return {
      y1: s1.annual,
      y2: s2.annual,
      gpMonthly,
      dropped: !partnershipLRatio.passes,
      isMinority: false,
      wasCapped: s1.annual < y1Raw || s2.annual < y2Raw,
      shortfall: s1.shortfall ?? s2.shortfall,
    };
  }, [partnershipYears, partnershipPct, twoYearPartnership, partnershipLRatio, activePartnership.hasStableDistributions]);

  const cCorpLRatio = useMemo(() => scheduleLQuickRatio(cCorpL), [cCorpL]);
  const cCorpFlow = useMemo(() => {
    const y1 = cCorpBusinessAnnual(cCorpYears[0], cCorpOwnershipPct, cCorpLRatio.passes);
    const y2 = cCorpBusinessAnnual(cCorpYears[1], cCorpOwnershipPct, cCorpLRatio.passes);
    const w2Monthly = monthlyFromYears(cCorpYears[0].w2Wages + cCorpYears[0].dividends, cCorpYears[1].w2Wages + cCorpYears[1].dividends, twoYearCCorp);
    return {
      y1,
      y2,
      w2Monthly,
      dropped: cCorpOwnershipPct >= 25 && !cCorpLRatio.passes,
      isMinority: cCorpOwnershipPct < 25,
    };
  }, [cCorpYears, cCorpOwnershipPct, cCorpLRatio.passes, twoYearCCorp]);

  const scheduleFAnnual = (year: ScheduleFYear) =>
    year.netFarmProfitLoss +
    year.depreciation +
    year.depletion +
    year.amortization +
    year.casualtyLoss +
    year.businessUseOfHome -
    year.mealsExclusion -
    year.nonrecurringIncome;

  const scheduleFFlow = useMemo(
    () => ({ y1: scheduleFAnnual(activeScheduleF.years[0]), y2: scheduleFAnnual(activeScheduleF.years[1]) }),
    [activeScheduleF],
  );

  // Monthly income of an entity that is not the one open in its tab. The open
  // one uses the underwriter's chosen method instead (`*Chosen.monthly`).
  const schCMonthlyOf = (entity: BusinessEntity<SchCYear>) =>
    monthlyFromYears(schCAnnual(entity.years[0]), schCAnnual(entity.years[1]), twoYearSchC);
  const scheduleFMonthlyOf = (entity: BusinessEntity<ScheduleFYear>) =>
    monthlyFromYears(scheduleFAnnual(entity.years[0]), scheduleFAnnual(entity.years[1]), twoYearScheduleF);
  const sCorpMonthlyOf = (entity: SCorpEntity) => {
    const ratio = scheduleLQuickRatio(entity.scheduleL);
    const first = entity.ownershipPct < 25
      ? corpMinorityAnnual(entity.years[0], entity.ownershipPct).capped + entity.years[0].w2Wages
      : (ratio.passes ? corpBusinessAnnual(entity.years[0], entity.ownershipPct) : 0) + entity.years[0].w2Wages;
    const second = entity.ownershipPct < 25
      ? corpMinorityAnnual(entity.years[1], entity.ownershipPct).capped + entity.years[1].w2Wages
      : (ratio.passes ? corpBusinessAnnual(entity.years[1], entity.ownershipPct) : 0) + entity.years[1].w2Wages;
    return monthlyFromYears(first, second, twoYearScorp);
  };
  const partnershipMonthlyOf = (entity: PartnershipEntity) => {
    const pct = Math.min(entity.profitPctEnd, entity.capitalPctEnd);
    const ratio = scheduleLQuickRatio(entity.scheduleL);
    const first = pct < 25
      ? corpMinorityAnnual(entity.years[0], pct).capped
      : ratio.passes ? corpBusinessAnnual(entity.years[0], pct) : entity.years[0].guaranteedPayments;
    const second = pct < 25
      ? corpMinorityAnnual(entity.years[1], pct).capped
      : ratio.passes ? corpBusinessAnnual(entity.years[1], pct) : entity.years[1].guaranteedPayments;
    return monthlyFromYears(first, second, twoYearPartnership);
  };
  const cCorpMonthlyOf = (entity: CCorpEntity) => {
    const ratio = scheduleLQuickRatio(entity.scheduleL);
    const first = cCorpBusinessAnnual(entity.years[0], entity.ownershipPct, ratio.passes);
    const second = cCorpBusinessAnnual(entity.years[1], entity.ownershipPct, ratio.passes);
    return monthlyFromYears(first, second, twoYearCCorp);
  };

  const additionalBusinessMonthly = useMemo(() => {
    const sumOthers = <T extends { id: string }>(entities: T[], activeId: string, monthlyOf: (entity: T) => number) =>
      entities.filter((entity) => entity.id !== activeId).reduce((sum, entity) => sum + monthlyOf(entity), 0);
    return {
      scheduleC: sumOthers(schCEntities, activeSchC.id, schCMonthlyOf),
      scheduleF: sumOthers(scheduleFEntities, activeScheduleF.id, scheduleFMonthlyOf),
      sCorp: sumOthers(sCorpEntities, activeSCorp.id, sCorpMonthlyOf),
      partnership: sumOthers(partnershipEntities, activePartnership.id, partnershipMonthlyOf),
      cCorp: sumOthers(cCorpEntities, activeCCorp.id, cCorpMonthlyOf),
    };
  }, [
    schCEntities, activeSchC.id, twoYearSchC, scheduleFEntities, activeScheduleF.id, twoYearScheduleF,
    sCorpEntities, activeSCorp.id, twoYearScorp, partnershipEntities, activePartnership.id,
    gseInvestor, twoYearPartnership, cCorpEntities, activeCCorp.id, twoYearCCorp,
  ]);

  // ── Rental Income (Schedule E Page 1 · Form 1084 / 1038 worksheet) ──────────

  /**
   * FNMA Form 1038 / 1038A: prefer Line 21, then add back 9/12/16/18/19 + UW extraordinary.
   * Line 20 is not rebuilt — used only when Line 21 is absent (L3 − L20 + the same add-backs).
   */
  function rentalAnnualCashFlow(y: RentalPropertyYear) {
    const flow = computeRental1038CashFlow({
      year: y.year,
      propertyAddress: '',
      propertyType: 'RENTAL',
      rentsReceived: y.rentsReceived,
      totalExpenses: y.totalExpenses,
      netIncomeLoss: y.netIncomeLoss ?? undefined,
      insurance: y.insurance,
      mortgageInterest: y.mortgageInterest,
      taxes: y.taxes,
      depreciation: y.depreciation,
      hoaDues: y.hoaDues,
      extraordinaryAddBack: y.extraordinaryAddBack,
      fairRentalDays: y.fairRentalDays,
    });
    return {
      adjusted: flow.totalAnnualCashFlow.toNumber(),
      addBacks: flow.addBacks.toNumber(),
      months: flow.monthsInService,
      monthly: flow.monthlyAverage.toNumber(),
    };
  }

  interface RentalPropertyResult {
    id: string;
    address: string;
    propertyType: string;
    isSubjectProperty: boolean;
    subjectMethod: 'SCHEDULE_E' | 'MARKET_RENT';
    isPrimary2To4: boolean;
    y1Annual: number;
    y2Annual: number;
    y1Monthly: number;
    y2Monthly: number;
    isDecline: boolean;
    declinePct: number;
    /** Monthly cash flow before PITIA (1084 decline-aware, or 75% market rent for subject purchases) */
    grossMonthly: number;
    /** PITIA applied (0 when missing) */
    pitiaApplied: number;
    pitiaMissing: boolean;
    /** Net = grossMonthly − PITIA */
    netMonthly: number;
    note: string;
  }

  interface RentalRouting {
    /** Positive rental income added to qualifying income */
    incomeMonthly: number;
    /** Net rental losses redirected as a proposed monthly liability on the 1003 */
    liabilityDebtMonthly: number;
    /** Subject 2–4 unit primary deficit applied to the primary housing expense */
    housingExpenseAdjustment: number;
  }

  /**
   * Route per-property nets the way the 1084 engine does:
   *  - Non-subject (REO) properties aggregate together. A negative aggregate reduces
   *    income directly on VA; Conventional/FHA/USDA clamp income at $0 and move the
   *    loss to proposed liabilities.
   *  - Subject property nets are handled individually: positive adds to income; a
   *    deficit on a 2–4 unit primary adjusts the housing expense (not a liability),
   *    while a subject investment deficit becomes a proposed liability.
   */
  function routeRentalNets(
    nets: Array<{ net: number; isSubject: boolean; isPrimary2To4: boolean }>,
    isVa: boolean,
  ): RentalRouting {
    let incomeMonthly = 0;
    let liabilityDebtMonthly = 0;
    let housingExpenseAdjustment = 0;

    const nonSubjectTotal = nets.filter((n) => !n.isSubject).reduce((s, n) => s + n.net, 0);
    if (nonSubjectTotal < 0) {
      if (isVa) incomeMonthly += nonSubjectTotal;
      else liabilityDebtMonthly += Math.abs(nonSubjectTotal);
    } else {
      incomeMonthly += nonSubjectTotal;
    }

    for (const n of nets.filter((x) => x.isSubject)) {
      if (n.net > 0) incomeMonthly += n.net;
      else if (n.isPrimary2To4) housingExpenseAdjustment += Math.abs(n.net);
      else liabilityDebtMonthly += Math.abs(n.net);
    }

    return { incomeMonthly, liabilityDebtMonthly, housingExpenseAdjustment };
  }

  const rentalFlow = useMemo((): {
    properties: RentalPropertyResult[];
    routing: RentalRouting;
    totalMonthly: number;
    anyPitiaMissing: boolean;
  } => {
    const loanProgram = borrowerMetadata.loanProgram as 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
    const isFha = loanProgram === 'FHA';

    const properties: RentalPropertyResult[] = rentalProperties.map((prop) => {
      const cf1 = rentalAnnualCashFlow(prop.year1);
      const cf2 = rentalAnnualCashFlow(prop.year2);

      const y1Monthly = cf1.monthly;
      const y2Monthly = cf2.monthly;

      const isDecline = twoYearRental && y2Monthly > 0 && y1Monthly < y2Monthly;
      const declinePct = isDecline ? ((y2Monthly - y1Monthly) / Math.abs(y2Monthly)) * 100 : 0;

      const useMarketRent = prop.isSubjectProperty && prop.subjectMethod === 'MARKET_RENT';
      const isTwoToFour = prop.propertyType === 'DUPLEX' || prop.propertyType === 'TRIPLEX' || prop.propertyType === 'FOURPLEX';

      let grossMonthly: number;
      let note: string;

      if (useMarketRent) {
        // Subject purchase / no Schedule E history: Form 1007/1025 gross market rent × 75%
        grossMonthly = prop.marketRent * 0.75;
        note = 'Subject property — 75% of gross market rent (Form 1007/1025, 25% vacancy factor).';
      } else if (!twoYearRental) {
        grossMonthly = y1Monthly;
        note = 'One-year: most recent year 1038 cash flow ÷ rental months.';
      } else if (isFha && isTwoToFour && isDecline) {
        if (declinePct <= 5) {
          grossMonthly = (y1Monthly + y2Monthly) / 2;
          note = `FHA 2–4 unit: decline ${declinePct.toFixed(1)}% ≤ 5% — 24-month average used.`;
        } else if (declinePct <= 20) {
          grossMonthly = y1Monthly;
          note = `FHA 2–4 unit: decline ${declinePct.toFixed(1)}% (5–20%) — restricted to most recent year per HUD 4000.1.`;
        } else {
          grossMonthly = 0;
          note = `FHA 2–4 unit: decline ${declinePct.toFixed(1)}% > 20% — income disqualified per HUD 4000.1.`;
        }
      } else if (isDecline) {
        grossMonthly = (y1Monthly + y2Monthly) / 2;
        note = `Income declined ${declinePct.toFixed(1)}% — 24-month average used (warning only).`;
      } else {
        grossMonthly = (y1Monthly + y2Monthly) / 2;
        note = 'Two years in file — 24-month average.';
      }

      if (prop.isSubjectProperty && !useMarketRent) {
        note = `Subject property (refinance — Schedule E history) — ${note.charAt(0).toLowerCase()}${note.slice(1)} Proposed PITIA of the new loan applied.`;
      }

      const pitiaMissing = prop.pitia === null;
      const pitiaApplied = prop.pitia ?? 0;
      const netMonthly = grossMonthly - pitiaApplied;

      if (pitiaMissing) {
        note += ' PITIA not yet entered — net shown before housing expense.';
      } else if (netMonthly < 0) {
        if (prop.isSubjectProperty && prop.isPrimary2To4) {
          note += ` Deficit of ${Math.abs(netMonthly).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo applies to the primary housing expense (2–4 unit primary), not consumer liabilities.`;
        } else if (prop.isSubjectProperty) {
          note += ` Subject investment deficit of ${Math.abs(netMonthly).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo maps to a proposed monthly liability.`;
        } else {
          note += ` Net after PITIA is negative — aggregates with other REO rentals (${loanProgram === 'VA' ? 'VA: reduces income directly' : 'clamped to $0 income; loss becomes a proposed liability'}).`;
        }
      }

      return {
        id: prop.id,
        address: prop.address,
        propertyType: prop.propertyType,
        isSubjectProperty: prop.isSubjectProperty,
        subjectMethod: prop.subjectMethod,
        isPrimary2To4: prop.isPrimary2To4,
        y1Annual: cf1.adjusted,
        y2Annual: cf2.adjusted,
        y1Monthly,
        y2Monthly,
        isDecline,
        declinePct,
        grossMonthly,
        pitiaApplied,
        pitiaMissing,
        netMonthly,
        note,
      };
    });

    const routing = routeRentalNets(
      properties.map((p) => ({ net: p.netMonthly, isSubject: p.isSubjectProperty, isPrimary2To4: p.isPrimary2To4 })),
      loanProgram === 'VA',
    );
    const anyPitiaMissing = properties.some((p) => p.pitiaMissing);
    return { properties, routing, totalMonthly: routing.incomeMonthly, anyPitiaMissing };
  }, [rentalProperties, twoYearRental, borrowerMetadata.loanProgram]);

  const rentalPicks = useMemo(() => {
    const isVa = borrowerMetadata.loanProgram === 'VA';

    // Per-property net under an alternate averaging method. Subject properties on the
    // market-rent method are unaffected by averaging (75% of 1007/1025 market rent).
    const netsFor = (pick: (y1: number, y2: number) => number) =>
      rentalProperties.map((p) => {
        const useMarketRent = p.isSubjectProperty && p.subjectMethod === 'MARKET_RENT';
        const gross = useMarketRent
          ? p.marketRent * 0.75
          : pick(rentalAnnualCashFlow(p.year1).monthly, rentalAnnualCashFlow(p.year2).monthly);
        return { net: gross - (p.pitia ?? 0), isSubject: p.isSubjectProperty, isPrimary2To4: p.isPrimary2To4 };
      });

    const routingByOption: Record<string, RentalRouting> = {
      guideline: rentalFlow.routing,
      y1: routeRentalNets(netsFor((m1) => m1), isVa),
      ...(twoYearRental
        ? {
            avg24: routeRentalNets(netsFor((m1, m2) => (m1 + m2) / 2), isVa),
            lower: routeRentalNets(netsFor((m1, m2) => Math.min(m1, m2)), isVa),
          }
        : {}),
      not_used: { incomeMonthly: 0, liabilityDebtMonthly: 0, housingExpenseAdjustment: 0 },
    };

    const options = [
      { id: 'guideline', label: 'Guideline (per-property)', monthly: routingByOption.guideline.incomeMonthly, formula: 'Decline-aware 1084 calc − PITIA' },
      { id: 'y1', label: 'Most recent year all props', monthly: routingByOption.y1.incomeMonthly, formula: 'Sum of Y1 monthly − PITIA' },
      ...(twoYearRental
        ? [
            { id: 'avg24', label: '24-month average all props', monthly: routingByOption.avg24.incomeMonthly, formula: '(Y1 + Y2) / 2 − PITIA per property' },
            { id: 'lower', label: 'Lower of two years all props', monthly: routingByOption.lower.incomeMonthly, formula: 'Min(Y1, Y2) − PITIA per property' },
          ]
        : []),
      { id: 'not_used', label: 'Not used', monthly: 0, formula: 'Underwriter elected to exclude' },
    ];
    const hasAnyDecline = rentalFlow.properties.some((p) => p.isDecline && p.declinePct >= 20);
    let reason = hasAnyDecline
      ? 'One or more properties declined. Two years in file uses a 24-month average except FHA 2–4 unit HUD 4000.1 bands (5–20% most recent year; >20% $0).'
      : rentalFlow.properties.some((p) => p.isDecline)
        ? 'Declining income detected. Guideline keeps the 24-month average (warning only) except FHA 2–4 unit HUD 4000.1 bands.'
        : twoYearRental
          ? 'Two years in file — 24-month average net of PITIA is the guideline pick.'
          : 'Single-year entry. Most recent year 1038 cash flow net of PITIA.';
    if (rentalFlow.properties.some((p) => p.isSubjectProperty)) {
      reason += ' Subject property routed separately: positive net adds to income; a deficit adjusts housing expense (2–4 unit primary) or maps to liabilities (investment).';
    }
    if (rentalFlow.anyPitiaMissing) {
      reason += ' PITIA is missing on at least one property — totals are before full housing expense until the UW completes the PITIA box.';
    }
    return { options, recommendedId: 'guideline', reason, routingByOption };
  }, [rentalFlow, rentalProperties, twoYearRental, borrowerMetadata.loanProgram]);

  const w2BasePicks = useMemo(() => {
    // The annualization already follows the pay frequency the parser read off
    // the stub. The cited formula has to name the same one, or a biweekly file
    // reads as though it had been annualized at 24 semi-monthly periods.
    const payFrequency = activeW2Employer.payFrequency;
    const options = [
      { id: 'hourly', label: 'Hourly rate', monthly: baseWageReconciliation.hourlyMethod, formula: '(Rate × hours × 52) / 12' },
      { id: 'period', label: 'Pay period annualized', monthly: baseWageReconciliation.periodAnnualizedMethod, formula: `(${payFrequencyLabel(payFrequency)} pay × ${payPeriodsPerYear(payFrequency)}) / 12` },
      { id: 'ytd', label: 'YTD average', monthly: baseWageReconciliation.ytdAverageMethod, formula: `YTD base / ${formatElapsedMonths(baseWageReconciliation.ytdMonthsElapsed)} months elapsed` },
      { id: 'prior', label: 'Prior year W-2', monthly: baseWageReconciliation.priorYearW2Average, formula: `${priorW2YearPrefix}W-2 Box 5 / 12` },
      { id: 'not_used', label: 'Not used', monthly: 0, formula: 'Underwriter elected to exclude' },
    ];
    if (baseWageReconciliation.maxVariancePct > 10) {
      const id = baseWageReconciliation.hourlyMethod <= baseWageReconciliation.ytdAverageMethod ? 'hourly' : 'ytd';
      return {
        options,
        recommendedId: id,
        reason: `The four methods vary by ${baseWageReconciliation.maxVariancePct.toFixed(1)}%. Guideline uses Base Hourly, or Monthly salaried depending on the type, cite supported by ytd and historical earnings.`,
      };
    }
    return {
      options,
      recommendedId: 'period',
      reason: 'Hourly, period, and YTD are within 10%. Guideline uses Base Hourly, or Monthly salaried depending on the type, cite supported by ytd and historical earnings.',
    };
  }, [baseWageReconciliation, priorW2YearPrefix, activeW2Employer.payFrequency]);

  const w2VarMethods = useMemo(
    () => w2VariableMethods(activeW2Employer, w2ContextFor(activeW2Employer)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownedByPrimary reads borrowers
    [activeW2Employer, prevEmployerW2, borrowers],
  );

  const w2VarPicks = useMemo(() => {
    const methods = w2VarMethods;
    const current = methods.options.find((option) => option.id === 'current')?.monthly ?? 0;
    const merged = methods.options.find((option) => option.id === 'avg24')?.monthly ?? 0;
    const withPrior = methods.mergesPriorEmployer;
    const frequency = activeW2Employer.bonusFrequency;
    const payout = frequency ? bonusFrequencyLabel(frequency).toLowerCase() : '';
    const options = [
      {
        id: 'current',
        label: 'Current job only',
        monthly: current,
        formula: frequency
          ? `Bonus / ${methods.bonusMonths} months its ${payout} payouts cover + OT / ${methods.variableMonths} months`
          : `(Bonus YTD + OT YTD) / ${methods.variableMonths} months`,
      },
      {
        id: 'avg24',
        label: '24-month merged',
        monthly: merged,
        formula: !withPrior
          ? 'No previous employer on the 1003 for this borrower; same as current job'
          : frequency
            ? `(Bonus + prior W-2 bonus) / ${bonusMonthsCovered(monthsAtCurrentJob, frequency) + 12} months + (OT + prior W-2 OT) / ${monthsAtCurrentJob + 12} months`
            : `(Current variable + prior W-2 bonus/OT) / ${monthsAtCurrentJob + 12} months`,
      },
      { id: 'not_used', label: 'Not used', monthly: 0, formula: 'Underwriter elected to exclude' },
    ];
    if (monthsAtCurrentJob < 12 && withPrior) {
      return {
        options,
        recommendedId: 'avg24',
        reason: `Tenure at the current job is ${monthsAtCurrentJob} months. Guideline uses a 24-month average that includes prior-job bonus and overtime.`,
      };
    }
    return {
      options,
      recommendedId: 'current',
      reason: withPrior
        ? 'Twelve or more months at the current job. Guideline uses the current-job variable average unless the underwriter elects the 24-month merge.'
        : ownedByPrimary(activeW2Employer)
          ? 'No previous employer on the 1003, so variable income uses this job only.'
          : `The previous-employer history on the 1003 is ${borrowerName(undefined)}'s, so ${borrowerName(activeW2Employer.borrowerId)}'s variable income uses this job only.`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownedByPrimary reads borrowers
  }, [w2VarMethods, activeW2Employer, prevEmployerW2, monthsAtCurrentJob, borrowers]);

  const schCPicks = useMemo(() => {
    const rec = seRecommend(schCFlow.y1, schCFlow.y2, twoYearSchC, false, loanProgram);
    return { options: seAvgOptions(schCFlow.y1, schCFlow.y2, twoYearSchC), recommendedId: rec.id, reason: rec.reason };
  }, [schCFlow, twoYearSchC, loanProgram]);

  const sCorpPicks = useMemo(() => {
    const rec = seRecommend(sCorpFlow.y1, sCorpFlow.y2, twoYearScorp, sCorpFlow.dropped, loanProgram);
    let reason = rec.reason;
    if (sCorpFlow.isMinority) {
      reason = `Ownership ${sCorpShareholderPct}% is under 25% — borrower is not self-employed. K-1 boxes 1/2/3 count as ordinary income with no business add-backs${sCorpFlow.wasCapped ? ', capped at distributions received' : ''}; the Schedule L liquidity test does not apply. ${rec.reason}`;
    }
    return {
      options: seAvgOptions(sCorpFlow.y1, sCorpFlow.y2, twoYearScorp, sCorpFlow.dropped, sCorpFlow.w2Monthly),
      recommendedId: rec.id,
      reason,
    };
  }, [sCorpFlow, twoYearScorp, sCorpShareholderPct, loanProgram]);

  const cCorpPicks = useMemo(() => {
    const rec = seRecommend(cCorpFlow.y1, cCorpFlow.y2, twoYearCCorp, cCorpFlow.dropped, loanProgram);
    let reason = rec.reason;
    if (cCorpFlow.isMinority) {
      reason = `Ownership ${cCorpOwnershipPct}% is under 25% — only officer W-2 and documented dividends qualify. ${rec.reason}`;
    }
    return {
      options: seAvgOptions(cCorpFlow.y1, cCorpFlow.y2, twoYearCCorp, cCorpFlow.dropped, cCorpFlow.w2Monthly),
      recommendedId: rec.id,
      reason,
    };
  }, [cCorpFlow, twoYearCCorp, cCorpOwnershipPct, loanProgram]);

  const partnershipPicks = useMemo(() => {
    const rec = seRecommend(partnershipFlow.y1, partnershipFlow.y2, twoYearPartnership, partnershipFlow.dropped, loanProgram);
    let reason = rec.reason;
    if (partnershipFlow.isMinority) {
      reason = `Ending ${gseInvestor === 'FREDDIE' ? 'profit' : 'capital'} % (${partnershipPct}%) is under 25% — borrower is not self-employed. K-1 boxes 1/2/3 + guaranteed payments count as ordinary income with no business add-backs${partnershipFlow.wasCapped ? ', capped at distributions received' : ''}; the Schedule L liquidity test does not apply. ${rec.reason}`;
    }
    return {
      options: seAvgOptions(partnershipFlow.y1, partnershipFlow.y2, twoYearPartnership, partnershipFlow.dropped, partnershipFlow.gpMonthly),
      recommendedId: rec.id,
      reason,
    };
  }, [partnershipFlow, twoYearPartnership, gseInvestor, partnershipPct, loanProgram]);

  const scheduleFPicks = useMemo(() => {
    const rec = seRecommend(scheduleFFlow.y1, scheduleFFlow.y2, twoYearScheduleF, false, loanProgram);
    return {
      options: seAvgOptions(scheduleFFlow.y1, scheduleFFlow.y2, twoYearScheduleF),
      recommendedId: rec.id,
      reason: `Schedule F farm cash flow uses net profit or loss adjusted for documented non-cash and nonrecurring items. ${rec.reason}`,
    };
  }, [scheduleFFlow, twoYearScheduleF, loanProgram]);

  const assetIncomeAnnual = useMemo(
    () => assetIncomeYears.map((entry) => entry.interestIncome + entry.dividendIncome + entry.capitalGainsNetLoss) as [number, number],
    [assetIncomeYears],
  );
  const assetIncomeMonthly = twoYearAssetIncome
    ? (assetIncomeAnnual[0] + assetIncomeAnnual[1]) / 24
    : assetIncomeAnnual[0] / 12;
  const assetIncomePicks = useMemo(
    () => ({
      options: [
        { id: 'excluded', label: 'Excluded', monthly: 0, formula: 'Detected data retained · not used by default' },
        {
          id: 'include',
          label: 'Include with UW approval',
          monthly: assetIncomeMonthly,
          formula: twoYearAssetIncome ? '24-month average after continuance review' : 'Most recent year / 12 after continuance review',
        },
      ],
      recommendedId: 'excluded',
      reason:
        'Interest, dividends, and capital gains are retained for review but excluded from qualifying income by default. The UW may include them after verifying receipt history, continuance, and sufficient supporting assets.',
    }),
    [assetIncomeMonthly, twoYearAssetIncome],
  );

  const iraAccountBalance = iraBalanceInput.trim() !== '' && Number.isFinite(Number(iraBalanceInput))
    ? Number(iraBalanceInput)
    : null;
  const retirement = useMemo(
    () => calculateRetirementIncome(retirementReturn, { iraAccountBalance, iraContinuance }, loanProgram),
    [retirementReturn, iraAccountBalance, iraContinuance, loanProgram],
  );

  const w2BaseChosen = chosenMonthly(w2BasePicks.options, w2BaseChoice, w2BasePicks.recommendedId);
  const w2VarChosen = chosenMonthly(w2VarPicks.options, w2VarChoice, w2VarPicks.recommendedId);
  const schCChosen = chosenMonthly(schCPicks.options, schCChoice, schCPicks.recommendedId);
  const sCorpChosen = chosenMonthly(sCorpPicks.options, sCorpChoice, sCorpPicks.recommendedId);
  const cCorpChosen = chosenMonthly(cCorpPicks.options, cCorpChoice, cCorpPicks.recommendedId);
  const partnershipChosen = chosenMonthly(partnershipPicks.options, partnershipChoice, partnershipPicks.recommendedId);
  const scheduleFChosen = chosenMonthly(scheduleFPicks.options, scheduleFChoice, scheduleFPicks.recommendedId);
  const assetIncomeChosen = chosenMonthly(
    assetIncomePicks.options,
    assetIncomeIncluded ? 'include' : null,
    assetIncomePicks.recommendedId,
  );
  const rentalChosen = chosenMonthly(rentalPicks.options, rentalChoice, rentalPicks.recommendedId);

  const form1084CashFlow = {
    qualifyingMonthlySelfEmployed: schCChosen.monthly + additionalBusinessMonthly.scheduleC,
    sCorpShareholderDraw: sCorpChosen.monthly + additionalBusinessMonthly.sCorp,
    cCorpMonthly: cCorpChosen.monthly + additionalBusinessMonthly.cCorp,
    partnershipMonthly: partnershipChosen.monthly + additionalBusinessMonthly.partnership,
    scheduleFMonthly: scheduleFChosen.monthly + additionalBusinessMonthly.scheduleF,
    assetIncomeMonthly: assetIncomeChosen.monthly,
    socialSecurityMonthly: retirement.socialSecurityMonthly,
    retirementIncomeMonthly: retirement.retirementIncomeMonthly,
    w2BaseMonthly: w2BaseChosen.monthly + additionalW2Monthly.base,
    w2VariableMonthly: w2VarChosen.monthly + additionalW2Monthly.variable,
    rentalMonthly: rentalChosen.monthly,
    finalTotalQualifyingMonthly:
      schCChosen.monthly +
      sCorpChosen.monthly +
      cCorpChosen.monthly +
      partnershipChosen.monthly +
      additionalBusinessMonthly.scheduleC +
      additionalBusinessMonthly.sCorp +
      additionalBusinessMonthly.cCorp +
      additionalBusinessMonthly.partnership +
      scheduleFChosen.monthly +
      additionalBusinessMonthly.scheduleF +
      assetIncomeChosen.monthly +
      retirement.socialSecurityMonthly +
      retirement.retirementIncomeMonthly +
      w2BaseChosen.monthly +
      additionalW2Monthly.base +
      w2VarChosen.monthly +
      additionalW2Monthly.variable +
      rentalChosen.monthly,
  };

  // Each borrower's share of the 1084, so the Encompass export writes each
  // person's income to their own fields instead of crediting the primary with all of it.
  const incomeByBorrower: Form1084BorrowerIncome[] = (() => {
    if (!multipleBorrowers) return [];
    const businessShares = <T extends { id: string; borrowerId?: string }>(
      entities: T[],
      activeId: string,
      activeMonthly: number,
      monthlyOf: (entity: T) => number,
    ) => entities.map((entity) => ({
      borrowerId: entity.borrowerId,
      monthly: entity.id === activeId ? activeMonthly : monthlyOf(entity),
    }));
    return splitIncomeByBorrower({
      borrowers,
      w2: w2Employers.map((entry) => {
        const active = entry.id === activeW2Employer.id;
        return {
          borrowerId: entry.borrowerId,
          baseMonthly: active ? w2BaseChosen.monthly : w2BaseMonthlyOf(entry),
          variableMonthly: active ? w2VarChosen.monthly : w2VariableMonthlyOf(entry),
        };
      }),
      selfEmployed: [
        ...businessShares(schCEntities, activeSchC.id, schCChosen.monthly, schCMonthlyOf),
        ...businessShares(sCorpEntities, activeSCorp.id, sCorpChosen.monthly, sCorpMonthlyOf),
        ...businessShares(partnershipEntities, activePartnership.id, partnershipChosen.monthly, partnershipMonthlyOf),
        ...businessShares(cCorpEntities, activeCCorp.id, cCorpChosen.monthly, cCorpMonthlyOf),
        ...businessShares(scheduleFEntities, activeScheduleF.id, scheduleFChosen.monthly, scheduleFMonthlyOf),
      ],
      jointMonthly: form1084CashFlow.rentalMonthly
        + form1084CashFlow.assetIncomeMonthly
        + form1084CashFlow.socialSecurityMonthly
        + form1084CashFlow.retirementIncomeMonthly,
    });
  })();

  const intakeAnswers = isLive ? loadIntakeSession()?.answers : undefined;
  const encompassPayload = intakeAnswers
    ? buildEncompassPayloadFromIntake(intakeAnswers, {
        qualifyingMonthlyIncome: form1084CashFlow.finalTotalQualifyingMonthly,
        w2BaseMonthly: form1084CashFlow.w2BaseMonthly,
        w2VariableMonthly: form1084CashFlow.w2VariableMonthly,
        scheduleC_MonthlyTotal: form1084CashFlow.qualifyingMonthlySelfEmployed,
        form1120S_MonthlyTotal: form1084CashFlow.sCorpShareholderDraw,
        form1065_MonthlyTotal: form1084CashFlow.partnershipMonthly,
        form1120_MonthlyTotal: form1084CashFlow.cCorpMonthly,
        scheduleF_MonthlyTotal: form1084CashFlow.scheduleFMonthly,
        assetIncomeMonthly: form1084CashFlow.assetIncomeMonthly,
        socialSecurityMonthly: form1084CashFlow.socialSecurityMonthly,
        retirementIncomeMonthly: form1084CashFlow.retirementIncomeMonthly,
        rentalMonthly: form1084CashFlow.rentalMonthly,
        byBorrower: incomeByBorrower.length ? incomeByBorrower : undefined,
      })
    : null;
  const unassignedDocuments = locateResult.unidentified?.length ?? 0;

  const summarySourceLines = compactSourceLines([
    { source: 'W-2 base', method: w2BaseChosen.label, monthly: form1084CashFlow.w2BaseMonthly },
    { source: 'W-2 variable', method: w2VarChosen.label, monthly: form1084CashFlow.w2VariableMonthly },
    { source: 'Schedule C', method: schCChosen.label, monthly: form1084CashFlow.qualifyingMonthlySelfEmployed },
    { source: 'S-Corp', method: sCorpChosen.label, monthly: form1084CashFlow.sCorpShareholderDraw },
    { source: 'C-Corp', method: cCorpChosen.label, monthly: form1084CashFlow.cCorpMonthly },
    { source: 'Partnership', method: partnershipChosen.label, monthly: form1084CashFlow.partnershipMonthly },
    { source: 'Schedule F', method: scheduleFChosen.label, monthly: form1084CashFlow.scheduleFMonthly },
    { source: 'Asset income', method: assetIncomeChosen.label, monthly: form1084CashFlow.assetIncomeMonthly },
    { source: 'Social Security', method: retirementMethodLabel(retirementReturn.year, 'Line 6a/6b'), monthly: form1084CashFlow.socialSecurityMonthly },
    { source: 'Retirement', method: retirementMethodLabel(retirementReturn.year, retirement.ira?.confirmed ? 'Lines 4–5 · IRA continuance confirmed' : 'Line 5a/5b'), monthly: form1084CashFlow.retirementIncomeMonthly },
  ]);

  const chosenRentalRouting = rentalPicks.routingByOption[rentalChosen.id] ?? rentalFlow.routing;
  const rentalSchedule = {
    properties: rentalProperties.map((property) => {
      const result = rentalFlow.properties.find((row) => row.id === property.id);
      return {
        address: property.address,
        rent: property.year1.rentsReceived,
        form1038: result?.netMonthly ?? 0,
        pitia: property.pitia,
      };
    }),
    toIncome: chosenRentalRouting.incomeMonthly,
    toLiability: chosenRentalRouting.liabilityDebtMonthly,
    toHousing: chosenRentalRouting.housingExpenseAdjustment,
  };

  const printIncomeSummary = async () => {
    const response = await fetch('/api/underwrite/summary-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanId: borrowerMetadata.loanId,
        primaryBorrowerName: borrowerMetadata.borrowerName,
        programUsed: loanProgram,
        calculatedIncome: form1084CashFlow.finalTotalQualifyingMonthly,
        sourceLines: summarySourceLines,
        rentalSchedule,
        programNote: qualifyingProgramNote(loanProgram),
      }),
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
  };

  const usdaSelfEmployment = useMemo(
    () => [
      ...schCEntities.map((entity) => ({
        type: 'SCHEDULE_C' as const,
        entityId: entity.id,
        businessName: entity.businessName,
        ein: entity.ein,
        netProfitLoss: entity.years[0].line31,
        depreciation: entity.years[0].line13,
        businessUseOfHome: entity.years[0].line30,
        mealsExclusion: entity.years[0].line24bMeals,
      })),
      ...scheduleFEntities.map((entity) => ({
        type: 'SCHEDULE_F' as const,
        entityId: entity.id,
        businessName: entity.businessName,
        ein: entity.ein,
        netFarmProfitLoss: entity.years[0].netFarmProfitLoss,
        depreciation: entity.years[0].depreciation,
        businessUseOfHome: entity.years[0].businessUseOfHome,
        amortizationCasualtyLossDepletion:
          entity.years[0].amortization + entity.years[0].casualtyLoss + entity.years[0].depletion,
        nonrecurringOtherIncomeLoss: -entity.years[0].nonrecurringIncome,
      })),
    ],
    [schCEntities, scheduleFEntities],
  );

  // Core Orchestrated Warnings
  const activeIncomeWarnings = useMemo(() => {
    const list: { id: string; type: 'ERROR' | 'WARNING'; message: string }[] = [];

    for (const warning of locateResult.warnings ?? []) {
      list.push({
        id: warning.code,
        type: warning.code === 'UNIDENTIFIED_BORROWER' ? 'ERROR' : 'WARNING',
        message: warning.message,
      });
    }

    // Job tenure warning
    if (monthsAtCurrentJob < 12) {
      list.push({
        id: 'TENURE_WARN',
        type: 'WARNING',
        message: `Borrower job tenure is under 12 months (${monthsAtCurrentJob} months calculated). Variable income must have documented previous employer continuity.`
      });
    }

    // A fixed dollar floor cannot work here: the same YTD figure is
    // unremarkable for a part-time borrower and alarming for a senior one, and
    // any stub from early in the year sits below any constant. The parser
    // measures the borrower against their own rate and hours instead, and
    // surfaces the result through review notes.

    // Corporate Liquidity Deficit (only applies to self-employed 25%+ owners)
    if (!sCorpLRatio.passes && !sCorpFlow.isMinority) {
      list.push({
        id: 'SCORP_LIQUIDITY',
        type: 'ERROR',
        message: `S-Corp ${liquidityReason(sCorpLRatio)}. Business income is excluded; officer W-2 still counts.`,
      });
    }
    if (!partnershipLRatio.passes && !partnershipFlow.isMinority) {
      list.push({
        id: 'PARTNERSHIP_LIQUIDITY',
        type: 'ERROR',
        message: `Partnership ${liquidityReason(partnershipLRatio)}. Ordinary income is excluded; guaranteed payments still count.`,
      });
    }

    // A recorded distribution history the K-1 contradicts. Without it the
    // income needs the liquidity route, so say which one is holding it up.
    if (sCorpFlow.shortfall) {
      list.push({
        id: 'SCORP_DISTRIBUTIONS_BELOW_INCOME',
        type: sCorpFlow.shortfall.restsOnLiquidity ? 'WARNING' : 'ERROR',
        message: distributionShortfallMessage('S-Corp', 'Box 16D', sCorpFlow.shortfall, sCorpLRatio),
      });
    }
    if (partnershipFlow.shortfall) {
      list.push({
        id: 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME',
        type: partnershipFlow.shortfall.restsOnLiquidity ? 'WARNING' : 'ERROR',
        message: distributionShortfallMessage('Partnership', 'Box 19A', partnershipFlow.shortfall, partnershipLRatio),
      });
    }

    // Under-25% minority K-1 treatment notices
    if (sCorpFlow.isMinority) {
      list.push({
        id: 'SCORP_MINORITY_K1',
        type: 'WARNING',
        message: `S-Corp ownership ${sCorpShareholderPct}% is under 25%: borrower is not self-employed. Usable income limited to K-1 boxes 1/2/3 (no business add-backs)${sCorpFlow.wasCapped ? ' and capped at distributions received' : ''}. Document a 2-year receipt history.`,
      });
    }
    if (partnershipFlow.isMinority) {
      list.push({
        id: 'PARTNERSHIP_MINORITY_K1',
        type: 'WARNING',
        message: `Partnership ending ${gseInvestor === 'FREDDIE' ? 'profit' : 'capital'} percentage ${partnershipPct}% is under 25%: borrower is not self-employed. Usable income limited to K-1 boxes 1/2/3 + guaranteed payments (no business add-backs)${partnershipFlow.wasCapped ? ' and capped at distributions received' : ''}. Document a 2-year receipt history.`,
      });
    }

    // Base wage variance
    if (baseWageReconciliation.maxVariancePct > 10.0) {
      list.push({
        id: 'WAGE_VARIANCE_WARN',
        type: 'WARNING',
        message: `Wage Variance Alert: Current hourly annualization ($${baseWageReconciliation.hourlyMethod.toFixed(2)}) differs from the YTD monthly average ($${baseWageReconciliation.ytdAverageMethod.toFixed(2)}) by ${baseWageReconciliation.maxVariancePct.toFixed(1)}%.`
      });
    }

    if (assetIncomeAnnual.some((amount) => amount !== 0)) {
      list.push({
        id: assetIncomeIncluded ? 'ASSET_INCOME_UW_INCLUDED' : 'ASSET_INCOME_EXCLUDED',
        type: 'WARNING',
        message: assetIncomeIncluded
          ? 'Interest, dividend, and capital-gain income was included by UW election. Verify stable receipt history, three-year continuance, and sufficient supporting asset balances before final approval.'
          : 'Interest, dividend, and capital-gain income was detected and retained, but excluded from qualifying income by default. Additional income may be eligible; the underwriter may elect to include it after continuance and asset-support review.',
      });
    }

    list.push(...retirement.alerts);

    // Rental PITIA missing (Encompass loan details did not include the property)
    if (rentalFlow.anyPitiaMissing) {
      const missing = rentalFlow.properties.filter((p) => p.pitiaMissing).map((p) => p.address || 'Unnamed property');
      list.push({
        id: 'RENTAL_PITIA_MISSING',
        type: 'WARNING',
        message: `PITIA not available from Encompass loan details for: ${missing.join('; ')}. Underwriter must enter the full monthly housing expense before final rental income can qualify.`,
      });
    }

    // Non-subject (REO) rental net loss after PITIA
    const reoLossProps = rentalFlow.properties.filter((p) => !p.isSubjectProperty && !p.pitiaMissing && p.netMonthly < 0);
    if (reoLossProps.length > 0) {
      const isVa = borrowerMetadata.loanProgram === 'VA';
      list.push({
        id: 'RENTAL_NET_LOSS',
        type: 'WARNING',
        message: `Net rental loss after PITIA on: ${reoLossProps.map((p) => `${p.address} ($${Math.abs(p.netMonthly).toFixed(2)}/mo)`).join('; ')}. ${isVa ? 'VA: aggregated loss reduces gross qualifying income directly.' : 'Aggregated REO loss is clamped to $0 income and redirected as a proposed monthly liability on the 1003.'}`,
      });
    }

    // Subject property deficits
    const subjPrimaryDeficit = rentalFlow.properties.filter((p) => p.isSubjectProperty && p.isPrimary2To4 && !p.pitiaMissing && p.netMonthly < 0);
    if (subjPrimaryDeficit.length > 0) {
      list.push({
        id: 'RENTAL_SUBJECT_PRIMARY_DEFICIT',
        type: 'WARNING',
        message: `Subject 2–4 unit primary residence rental deficit of $${subjPrimaryDeficit.reduce((s, p) => s + Math.abs(p.netMonthly), 0).toFixed(2)}/mo applies as an adjustment to the primary housing expense, bypassing consumer liability categorization.`,
      });
    }
    const subjInvestDeficit = rentalFlow.properties.filter((p) => p.isSubjectProperty && !p.isPrimary2To4 && !p.pitiaMissing && p.netMonthly < 0);
    if (subjInvestDeficit.length > 0) {
      list.push({
        id: 'RENTAL_SUBJECT_INVESTMENT_DEFICIT',
        type: 'WARNING',
        message: `Subject investment property net rental loss of $${subjInvestDeficit.reduce((s, p) => s + Math.abs(p.netMonthly), 0).toFixed(2)}/mo has been mapped as a proposed monthly liability debt.`,
      });
    }

    return list;
  }, [locateResult.warnings, monthsAtCurrentJob, currentBaseYtd, sCorpLRatio, partnershipLRatio, baseWageReconciliation, rentalFlow, borrowerMetadata.loanProgram, sCorpFlow, partnershipFlow, sCorpShareholderPct, partnershipPct, gseInvestor, assetIncomeAnnual, assetIncomeIncluded, retirement.alerts]);

  // ==================== 6. INTERACTIVE ACTIONS ====================

  const handleInspectField = (fieldId: string, documentId?: string, clicked?: HTMLElement | null) => {
    const originatedInQaPanel = Boolean(clicked ?? qaPointerTargetRef.current);
    skipPageResetRef.current = true;
    setHighlightFieldId(fieldId);
    setDocMode('pdf');
    const isWageField = fieldId.startsWith('w2-') || fieldId.startsWith('ps-');
    if (fieldId.startsWith('ent2-')) setActiveTab('SCHEDULE_E');
    let live = fieldForInspection(mappedFields, fieldId, canvasDoc?.id, documentId, livePageIndex);

    // A wage click still must never jump to another employer's W-2 merely
    // because that PDF carries the same field id. But refusing to look past the
    // open document meant clicking a W-2 value while the pay stub was open
    // resolved to nothing: no highlight, no page change, and the underwriter
    // had to switch documents by hand before the click did anything. Retrying
    // within this employer's own uploads keeps the protection and still lands
    // on the document the figure came from.
    if (!live && isWageField) {
      live = fieldForInspectionWithin(
        mappedFields,
        fieldId,
        activeW2Employer.documentIds,
        livePageIndex,
      );
    }

    if (live?.documentId) setInspectDocId(live.documentId);
    else if (documentId && !isWageField) setInspectDocId(documentId);

    // pickDocumentForTab only ranks documents whose kind matches the tab, so on
    // a wage tab the preferred id is ignored unless the wage kind matches the
    // field being inspected.
    if (isWageField && live?.documentId) {
      setWageDocKind(fieldId.startsWith('w2-') ? 'w2' : 'paystub');
    }
    const overlay = inspectOverlayFromField(live);
    if (overlay) {
      setInspectOverlay(overlay);
      viewer.triggerHighlight({
        pageIndex: overlay.pageIndex,
        box: [overlay.box.x, overlay.box.y, overlay.box.w, overlay.box.h],
      });
    } else {
      setInspectOverlay(null);
    }

    const fromEntity = fieldId.match(/schedule-e-p(\d+)-/i);
    const facsimile = fieldCoordinatesMapping.find((f) => f.id === fieldId);
    const nav = inspectNavigation({
      isLive,
      livePageIndex: overlay ? overlay.pageIndex : live?.pageIndex,
      entityPageIndex: fromEntity ? Number(fromEntity[1]) : undefined,
      facsimilePage: facsimile?.boxCoordinates.page,
    });
    if (nav.livePageIndex != null) setLivePageIndex(nav.livePageIndex);
    if (nav.facsimilePage != null) setActivePdfPage(nav.facsimilePage);
    if (fieldId.endsWith('-y2')) setCanvasYearIndex(1);
    else if (fieldId.endsWith('-y1')) setCanvasYearIndex(0);
    requestAnimationFrame(() => {
      // The underwriter already had to see a QA control to click it. Moving the
      // right pane after that click is both unnecessary and disorienting. Only
      // navigation originating elsewhere (PDF overlay, split window, keyboard)
      // should bring a QA field into view.
      if (originatedInQaPanel) return;
      // Only the worksheet field is scrolled here, and only within its own
      // pane. scrollIntoView walks every scrollable ancestor, so scrolling the
      // PDF overlay box from here dragged the whole page and sent the QA panel
      // back to the top on every click. PdfDocumentViewer scrolls its own pane.
      // Prefer the element that was actually clicked. Field ids can repeat
      // across documents (two Schedule Es each have a page 1 column A), so a
      // selector returns the first match, which sat at the top of the panel
      // and dragged it there on every click below property 3.
      scrollIntoViewWithin(
        clicked ?? document.querySelector<HTMLElement>(`[data-qa-field="${fieldId}"]`),
      );
    });
  };

  const borrowerTag = (borrowerId: string | undefined) => (multipleBorrowers ? borrowerName(borrowerId) : '');

  const asEntityOptions = <T extends { id: string; businessName?: string; employerName?: string; ein?: string; borrowerId?: string }>(
    entries: T[],
  ): IncomeEntityOption[] =>
    entries.map((entry) => {
      const name = entry.businessName ?? entry.employerName ?? '';
      const on1003 =
        locateResult.roster.find((row) => row.entity.id === entry.id) ??
        locateResult.roster.find(
          (row) => namesMatch(row.entity.name, name) && (!entry.borrowerId || row.entity.borrowerId === entry.borrowerId),
        );
      const onReturn = locateResult.discovered.find(
        (match) => match.entityId === entry.id || namesMatch(match.name ?? '', name),
      );
      const source = on1003
        ? on1003.located
          ? 'From 1003 · located'
          : 'From 1003 · not in packet'
        : onReturn
          ? 'Undisclosed · on return, not on 1003'
          : undefined;
      const owner = borrowerTag(entry.borrowerId);
      return {
        id: entry.id,
        name: name || 'Unnamed entity',
        ein: entry.ein,
        detail: [owner, source].filter(Boolean).join(' · ') || undefined,
      };
    });

  const selectLocatedKind = (
    kind: LocatedMatch['kind'] | undefined,
    name: string,
    id: string,
    rentalFallback = false,
  ) => {
    if (kind === 'w2' || kind === 'paystub') {
      setActiveTab('PAYSTUB_RECONCILIATION');
      const match = w2Employers.find((entry) => entry.id === id || namesMatch(entry.employerName, name));
      if (match) setActiveW2EmployerId(match.id);
      return;
    }
    if (kind === 'schedule-c') {
      setActiveTab('SCHEDULE_C');
      const match = schCEntities.find((entry) => entry.id === id || namesMatch(entry.businessName, name));
      if (match) setActiveSchCId(match.id);
      return;
    }
    if (kind === 'scorp') {
      setActiveTab('SCORP');
      const match = sCorpEntities.find((entry) => entry.id === id || namesMatch(entry.businessName, name));
      if (match) setActiveSCorpId(match.id);
      return;
    }
    if (kind === 'partnership') {
      setActiveTab('PARTNERSHIP');
      const match = partnershipEntities.find((entry) => entry.id === id || namesMatch(entry.businessName, name));
      if (match) setActivePartnershipId(match.id);
      return;
    }
    if (kind === 'ccorp') {
      setActiveTab('CCORP');
      const match = cCorpEntities.find((entry) => entry.id === id || namesMatch(entry.businessName, name));
      if (match) setActiveCCorpId(match.id);
      return;
    }
    if (kind === 'schedule-f') {
      setActiveTab('SCHEDULE_F');
      const match = scheduleFEntities.find((entry) => entry.id === id || namesMatch(entry.businessName, name));
      if (match) setActiveScheduleFId(match.id);
      return;
    }
    if (kind === 'schedule-e' || rentalFallback) {
      setActiveTab('SCHEDULE_E');
    }
  };

  const selectUrlAEntity = (rosterId: string) => {
    const row = locateResult.roster.find((item) => item.entity.id === rosterId);
    if (row) {
      const kind = row.matches[0]?.kind ?? (row.entity.kind === 'wages' ? 'w2' : row.entity.kind === 'rental' ? 'schedule-e' : undefined);
      selectLocatedKind(kind, row.entity.name, rosterId, row.entity.kind === 'rental');
      return;
    }
    const discovered = locateResult.discovered.find((match) => discoveredSelectId(match) === rosterId);
    if (!discovered) return;
    selectLocatedKind(discovered.kind, discovered.name ?? '', discovered.entityId);
  };

  const addW2Employer = () => {
    const id = `w2-${crypto.randomUUID()}`;
    setW2Employers((entries) => [...entries, emptyW2Employer(id, { employerName: `New Employer ${entries.length + 1}`, role: 'SECONDARY' })]);
    setActiveW2EmployerId(id);
  };

  const selectW2Employer = (id: string) => {
    setActiveW2EmployerId(id);
    const employer = w2Employers.find((entry) => entry.id === id);
    const documentIds = employer?.documentIds ?? [];
    if (!isLive || !documentIds.length || (canvasDoc && documentIds.includes(canvasDoc.id))) return;
    const candidates = packet.filter((doc) => documentIds.includes(doc.id));
    const nextDoc = candidates.find((doc) => kindsOf(doc).includes(wageDocKind)) ?? candidates[0];
    if (!nextDoc) return;
    const next = tabForKinds(kindsOf(nextDoc));
    if (next.wageDocKind) setWageDocKind(next.wageDocKind);
    setInspectDocId(nextDoc.id);
    setLivePageIndex(pageForKind(nextDoc.result, kindsOf(nextDoc)[0]));
  };

  const removeW2Employer = (id: string) => {
    const remaining = w2Employers.filter((entry) => entry.id !== id);
    setW2Employers(remaining);
    setActiveW2EmployerId(remaining[0].id);
  };

  const addScheduleCEntity = () => {
    const id = `schc-${crypto.randomUUID()}`;
    setSchCEntities((entities) => [...entities, {
      id, businessName: `New Schedule C Business ${entities.length + 1}`, ein: '',
      years: [
        { year: 2025, line31: 0, line13: 0, line30: 0, line44aMiles: 0, line24bMeals: 0 },
        { year: 2024, line31: 0, line13: 0, line30: 0, line44aMiles: 0, line24bMeals: 0 },
      ],
    }]);
    setActiveSchCId(id);
  };

  const addSCorpEntity = () => {
    const id = `scorp-${crypto.randomUUID()}`;
    const emptyYear = (year: number): CorpYear => ({
      year, ordinaryIncome: 0, netRentalRealEstate: 0, otherNetRental: 0, depreciation: 0,
      gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 0, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 0, distributions: 0,
    });
    setSCorpEntities((entities) => [...entities, {
      id, businessName: `New S-Corporation ${entities.length + 1}`, ein: '', ownershipPct: 100,
      hasStableDistributions: true, scheduleL: { ...baseSCorpScheduleL }, years: [emptyYear(2025), emptyYear(2024)],
    }]);
    setActiveSCorpId(id);
  };

  const addPartnershipEntity = () => {
    const id = `partnership-${crypto.randomUUID()}`;
    const emptyYear = (year: number): CorpYear => ({
      year, ordinaryIncome: 0, netRentalRealEstate: 0, otherNetRental: 0, depreciation: 0,
      gain4797: 0, otherIncome: 0, depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 0, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 0, distributions: 0,
    });
    setPartnershipEntities((entities) => [...entities, {
      id, businessName: `New Partnership ${entities.length + 1}`, ein: '', profitPctEnd: 100, capitalPctEnd: 100,
      hasStableDistributions: true, scheduleL: { ...basePartnershipScheduleL }, years: [emptyYear(2025), emptyYear(2024)],
    }]);
    setActivePartnershipId(id);
  };

  const addCCorpEntity = () => {
    const id = `ccorp-${crypto.randomUUID()}`;
    const emptyYear = (year: number): CCorpYear => ({
      year, taxableIncome: 0, totalTaxPaid: 0, depreciation: 0, depletion: 0, amortization: 0,
      mealsM1: 0, nol: 0, w2Wages: 0, dividends: 0,
    });
    setCCorpEntities((entities) => [...entities, {
      id, businessName: `New C-Corporation ${entities.length + 1}`, ein: '', ownershipPct: 100,
      scheduleL: { ...baseCCorpScheduleL }, years: [emptyYear(2025), emptyYear(2024)],
    }]);
    setActiveCCorpId(id);
  };

  const addScheduleFEntity = () => {
    const id = `farm-${crypto.randomUUID()}`;
    const emptyYear = (year: number): ScheduleFYear => ({
      year, netFarmProfitLoss: 0, depreciation: 0, depletion: 0, amortization: 0,
      casualtyLoss: 0, businessUseOfHome: 0, mealsExclusion: 0, nonrecurringIncome: 0,
    });
    setScheduleFEntities((entities) => [...entities, {
      id, businessName: `New Farm ${entities.length + 1}`, ein: '', years: [emptyYear(2025), emptyYear(2024)],
    }]);
    setActiveScheduleFId(id);
  };

  // ==================== DUAL-MONITOR DOCUMENT PANE (UW / QA) ====================
  // "Dual monitor" pops the document canvas into its own browser window so the
  // underwriter or QA reviewer can drag it to a second monitor. State stays in
  // this window; the pane receives snapshots and sends interactions back over a
  // BroadcastChannel, so highlights, year switches, and paging remain in sync.

  const [docPopout, setDocPopout] = useState(false);
  const [workspaceFull, setWorkspaceFull] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const docChannelRef = useRef<BroadcastChannel | null>(null);
  const docWinRef = useRef<Window | null>(null);

  const twoYearForCanvas =
    activeTab === 'SCHEDULE_C'
      ? twoYearSchC
      : activeTab === 'SCORP'
        ? twoYearScorp
        : activeTab === 'CCORP'
          ? twoYearCCorp
        : activeTab === 'PARTNERSHIP'
          ? twoYearPartnership
          : activeTab === 'SCHEDULE_F'
            ? twoYearScheduleF
          : activeTab === 'SCHEDULE_E'
            ? false
            : true;

  const docSnapshot = useMemo<DocPaneSnapshot>(
    () => ({
      mode: isLive ? 'live' : 'demo',
      loanId: borrowerMetadata.loanId,
      borrowerName: borrowerMetadata.borrowerName,
      activeTab,
      yearIndex: docYearIndex,
      twoYear: twoYearForCanvas,
      selectedId: highlightFieldId,
      schC: schCYears[canvasYearIndex],
      corp: activeTab === 'PARTNERSHIP' ? partnershipYears[canvasYearIndex] : sCorpYears[canvasYearIndex],
      scheduleL: activeTab === 'PARTNERSHIP' ? partnershipL : sCorpL,
      showLiquidity: activeTab === 'SCORP' || activeTab === 'PARTNERSHIP',
      paystub: {
        employer: borrowerMetadata.currentEmployer,
        borrower: borrowerMetadata.borrowerName,
        hourly: currentHourlyRate,
        hours: currentWeeklyHours,
        periodPay: currentPeriodBasePay,
        ytd: currentBaseYtd,
      },
      live:
        isLive && canvasDoc
          ? {
              file: canvasDoc.file,
              fileName: canvasDoc.fileName,
              pageIndex: livePageIndex,
              pageCount: canvasDoc.result.total_pages_scanned,
              fields: canvasFields,
              highlight: inspectOverlay,
            }
          : null,
    }),
    [
      isLive,
      liveSession,
      canvasDoc,
      activeTab,
      canvasYearIndex,
      docYearIndex,
      twoYearForCanvas,
      highlightFieldId,
      schCYears,
      partnershipYears,
      sCorpYears,
      partnershipL,
      sCorpL,
      currentHourlyRate,
      currentWeeklyHours,
      currentPeriodBasePay,
      currentBaseYtd,
      livePageIndex,
      mappedFields,
      canvasFields,
      inspectOverlay,
    ],
  );

  const docSnapshotRef = useRef(docSnapshot);
  docSnapshotRef.current = docSnapshot;
  const handleInspectFieldRef = useRef(handleInspectField);
  handleInspectFieldRef.current = handleInspectField;
  const lastSentFileKeyRef = useRef<string | null>(null);

  const sendDocSnapshot = (channel: BroadcastChannel, snapshot: DocPaneSnapshot) => {
    // Attach the PDF File only when it changed — steady-state sync messages are a
    // tiny JSON-like snapshot, so the pane never re-parses an unchanged document.
    let outgoing = snapshot;
    if (snapshot.live?.file) {
      const key = `${snapshot.live.file.name}-${snapshot.live.file.size}-${snapshot.live.file.lastModified}`;
      if (lastSentFileKeyRef.current === key) {
        outgoing = { ...snapshot, live: { ...snapshot.live, file: null } };
      } else {
        lastSentFileKeyRef.current = key;
      }
    }
    try {
      channel.postMessage({ type: 'snapshot', snapshot: outgoing } satisfies SplitDocMessage);
    } catch {
      // File transfer can fail in older browsers — retry without the binary
      lastSentFileKeyRef.current = null;
      try {
        channel.postMessage({
          type: 'snapshot',
          snapshot: { ...snapshot, live: snapshot.live ? { ...snapshot.live, file: null } : null },
        } satisfies SplitDocMessage);
      } catch {
        // channel closed — popout effect will clean up
      }
    }
  };

  useEffect(() => {
    const channel = new BroadcastChannel(SPLIT_DOC_CHANNEL);
    docChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<SplitDocMessage>) => {
      const msg = event.data;
      if (msg.type === 'doc-ready') {
        setDocPopout(true);
        lastSentFileKeyRef.current = null; // new pane needs the full file once
        sendDocSnapshot(channel, docSnapshotRef.current);
      } else if (msg.type === 'doc-closed') {
        setDocPopout(false);
      } else if (msg.type === 'select-field') {
        handleInspectFieldRef.current(msg.id);
      } else if (msg.type === 'year-index') {
        setCanvasYearIndex(msg.index);
      } else if (msg.type === 'page-change') {
        setLivePageIndex(msg.index);
      }
    };
    return () => {
      channel.close();
      docChannelRef.current = null;
    };
  }, []);

  // Push a fresh snapshot to the pane whenever synced state changes
  useEffect(() => {
    if (!docPopout || !docChannelRef.current) return;
    sendDocSnapshot(docChannelRef.current, docSnapshot);
  }, [docSnapshot, docPopout]);

  // Fallback: detect the pane window being closed without a beforeunload message
  useEffect(() => {
    if (!docPopout) return;
    const timer = setInterval(() => {
      if (docWinRef.current && docWinRef.current.closed) setDocPopout(false);
    }, 1500);
    return () => clearInterval(timer);
  }, [docPopout]);

  const toggleWorkspaceFull = () => {
    const node = workspaceRef.current;
    if (!node) return;
    if (document.fullscreenElement || workspaceFull) {
      if (document.fullscreenElement) void document.exitFullscreen();
      setWorkspaceFull(false);
      return;
    }
    setWorkspaceFull(true);
    if (node.requestFullscreen) void node.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement === workspaceRef.current) setWorkspaceFull(true);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!workspaceFull) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorkspaceFull(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [workspaceFull]);

  const openDocWindow = () => {
    docWinRef.current = window.open(
      `${window.location.pathname}#split-doc`,
      'freeflow-doc-pane',
      'width=1280,height=960',
    );
  };

  const bringBackDoc = () => {
    docChannelRef.current?.postMessage({ type: 'close-doc' } satisfies SplitDocMessage);
    setDocPopout(false);
  };

  const handleExportSync = () => {
    const perBorrower = incomeByBorrower.length
      ? `\n\nBy borrower:\n${incomeByBorrower
          .map((row) => `- ${borrowers[row.borrowerIndex]?.name}: $${row.qualifyingMonthlyIncome.toFixed(2)}/mo`)
          .join('\n')}`
      : '';
    const heldOut = unassignedDocuments ? `\n\n${unassignedDocuments} unassigned document(s) left out.` : '';
    alert(
      `Payload Locked & Transmitted to Encompass eFolder successfully!\n\nStandard Fields Mapped:\n- Field 108 (W-2 base): $${form1084CashFlow.w2BaseMonthly.toFixed(2)}\n- Field 109 (W-2 variable): $${form1084CashFlow.w2VariableMonthly.toFixed(2)}\n- Field 110 (Schedule C): $${form1084CashFlow.qualifyingMonthlySelfEmployed.toFixed(2)}\n- Field 111 (S-Corp): $${form1084CashFlow.sCorpShareholderDraw.toFixed(2)}\n- Field 112 (Partnership): $${form1084CashFlow.partnershipMonthly.toFixed(2)}\n- Field 113 (Rental Income): $${form1084CashFlow.rentalMonthly.toFixed(2)}${perBorrower}${heldOut}`,
    );
  };

  const visibleWarnings = activeIncomeWarnings.filter((alert) => {
    if (alert.id === 'SCORP_LIQUIDITY' || alert.id === 'SCORP_MINORITY_K1') return activeTab === 'SCORP' || activeTab === 'ENCOMPASS_SYNC';
    if (alert.id === 'PARTNERSHIP_LIQUIDITY' || alert.id === 'PARTNERSHIP_MINORITY_K1') return activeTab === 'PARTNERSHIP' || activeTab === 'ENCOMPASS_SYNC';
    if (alert.id === 'TENURE_WARN' || alert.id === 'WAGE_DEFICIT_WARN' || alert.id === 'WAGE_VARIANCE_WARN') {
      return activeTab === 'PAYSTUB_RECONCILIATION' || activeTab === 'ENCOMPASS_SYNC';
    }
    if (alert.id.startsWith('RENTAL_')) {
      return activeTab === 'SCHEDULE_E' || activeTab === 'ENCOMPASS_SYNC';
    }
    // Shown with its assign control above the tabs; repeated only where the export is reviewed.
    if (alert.id === 'UNIDENTIFIED_BORROWER' || alert.id === 'UNCONFIRMED_BORROWERS') return activeTab === 'ENCOMPASS_SYNC';
    return true;
  });

  // ── Rental Property helpers ─────────────────────────────────────────────────
  const PROPERTY_TYPE_LABELS: Record<RentalProperty['propertyType'], string> = {
    SFR: 'SFR',
    DUPLEX: 'Duplex',
    TRIPLEX: 'Triplex',
    FOURPLEX: 'Fourplex',
    COMMERCIAL: 'Commercial',
    VACATION: 'Vacation',
  };

  function addRentalProperty() {
    const emptyYear = (year: number): RentalPropertyYear => ({
      year,
      rentsReceived: 0,
      insurance: 0,
      mortgageInterest: 0,
      taxes: 0,
      depreciation: 0,
      hoaDues: 0,
      totalExpenses: 0,
      netIncomeLoss: null,
      extraordinaryAddBack: 0,
      fairRentalDays: 0,
    });
    const newProp: RentalProperty = {
      id: `prop-${Date.now()}`,
      address: '',
      propertyType: 'SFR',
      isSubjectProperty: false,
      subjectMethod: 'SCHEDULE_E',
      marketRent: 0,
      isPrimary2To4: false,
      pitia: null,
      pitiaSource: null,
      year1: emptyYear(2025),
      year2: emptyYear(2024),
    };
    setRentalProperties((prev) => [...prev, newProp]);
  }

  function removeRentalProperty(id: string) {
    setRentalProperties((prev) => prev.filter((p) => p.id !== id));
  }

  function patchRentalProperty(id: string, patch: Partial<Omit<RentalProperty, 'year1' | 'year2'>>) {
    setRentalProperties((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        // Address changed: re-check Encompass loan details for a PITIA unless the UW keyed one manually
        if (patch.address !== undefined && !next.isSubjectProperty && next.pitiaSource !== 'UW') {
          const encompassPitia = pitiaFromApp(patch.address);
          if (encompassPitia !== undefined) {
            next.pitia = encompassPitia;
            next.pitiaSource = 'ENCOMPASS';
          }
        }
        // Subject flag toggled: swap the PITIA source unless the UW keyed one manually
        if (patch.isSubjectProperty !== undefined && next.pitiaSource !== 'UW') {
          if (patch.isSubjectProperty) {
            // Subject loan's proposed PITIA is always on the loan file in Encompass
            next.pitia = ENCOMPASS_SUBJECT_PROPOSED_PITIA;
            next.pitiaSource = 'ENCOMPASS';
          } else {
            const encompassPitia = pitiaFromApp(next.address);
            next.pitia = encompassPitia ?? null;
            next.pitiaSource = encompassPitia !== undefined ? 'ENCOMPASS' : null;
          }
        }
        return next;
      }),
    );
  }

  function setRentalPitia(id: string, raw: string) {
    setRentalProperties((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (raw.trim() === '') return { ...p, pitia: null, pitiaSource: null };
        return { ...p, pitia: Number(raw), pitiaSource: 'UW' as const };
      }),
    );
  }

  function patchRentalYear(id: string, yearKey: 'year1' | 'year2', patch: Partial<RentalPropertyYear>) {
    setRentalProperties((prev) => prev.map((p) => (p.id === id ? { ...p, [yearKey]: { ...p[yearKey], ...patch } } : p)));
  }

  /**
   * Demo-only generated PDF for the active tab. The dev server fills official
   * IRS blanks (or draws a pay stub) from worksheet state so the facsimile
   * always matches the reconciliation math. Live uploads render in
   * PdfPagePreview instead — this URL is not the source document.
   */
  const fixturePdf = useMemo<{ url: string; label: string } | null>(() => {
    const q = (pairs: Record<string, string | number>) =>
      new URLSearchParams(Object.entries(pairs).map(([k, v]) => [k, String(v)])).toString();
    switch (activeTab) {
      case 'PAYSTUB_RECONCILIATION':
      case 'ENCOMPASS_SYNC':
        if (wageDocKind === 'w2') {
          return {
            label: `Form W-2 (${prevEmployerW2.year})`,
            url: `${fixtureDocumentPrefix}/w2.pdf?${q({
              year: prevEmployerW2.year,
              employer: prevEmployerW2.employerName,
              ein: prevEmployerW2.ein,
              borrower: borrowerMetadata.borrowerName,
              box1: Math.max(0, prevEmployerW2.box5Wages - 4500),
              box5: prevEmployerW2.box5Wages,
              bonus: prevEmployerW2.box12Bonus,
              ot: prevEmployerW2.box14Overtime,
            })}`,
          };
        }
        return {
          label: 'Earnings statement',
          url: `${fixtureDocumentPrefix}/paystub.pdf?${q({
            employer: borrowerMetadata.currentEmployer,
            borrower: borrowerMetadata.borrowerName,
            hourly: currentHourlyRate,
            hours: currentWeeklyHours,
            period: currentPeriodBasePay,
            ytdBase: currentBaseYtd,
            ytdBonus: currentBonusYtd,
            ytdOt: currentOtYtd,
          })}`,
        };
      case 'SCHEDULE_E': {
        const props: Record<string, string | number> = { year: 2025 };
        (['a', 'b'] as const).forEach((prefix, i) => {
          const y = rentalProperties[i]?.year1;
          if (!y) return;
          props[`${prefix}Rents`] = y.rentsReceived;
          props[`${prefix}Insurance`] = y.insurance;
          props[`${prefix}Interest`] = y.mortgageInterest;
          props[`${prefix}Taxes`] = y.taxes;
          props[`${prefix}Depreciation`] = y.depreciation;
          props[`${prefix}Hoa`] = y.hoaDues;
          props[`${prefix}Total`] = y.totalExpenses;
        });
        return {
          label: `Schedule E (${props.year})`,
          url: `${fixtureDocumentPrefix}/schedule-e.pdf?${q(props)}`,
        };
      }
      case 'SCHEDULE_C': {
        const y = schCYears[canvasYearIndex];
        return {
          label: `Schedule C (${y.year})`,
          url: `${fixtureDocumentPrefix}/schedule-c.pdf?${q({
            line31: y.line31,
            line13: y.line13,
            line30: y.line30,
            miles: y.line44aMiles,
            meals: y.line24bMeals,
          })}`,
        };
      }
      case 'SCORP': {
        const y = sCorpYears[canvasYearIndex];
        return {
          label: `Schedule K-1 1120-S (${y.year})`,
          url: `${fixtureDocumentPrefix}/k1-1120s.pdf?${q({
            ordinary: y.ordinaryIncome,
            rental: y.netRentalRealEstate,
            otherRental: y.otherNetRental,
            distributions: y.distributions,
            ownershipPct: sCorpShareholderPct,
          })}`,
        };
      }
      case 'PARTNERSHIP': {
        const y = partnershipYears[canvasYearIndex];
        return {
          label: `Schedule K-1 1065 (${y.year})`,
          url: `${fixtureDocumentPrefix}/k1-1065.pdf?${q({
            ordinary: y.ordinaryIncome,
            rental: y.netRentalRealEstate,
            otherRental: y.otherNetRental,
            guaranteed: y.guaranteedPayments,
            distributions: y.distributions,
            profitPct: partnershipProfitPctEnd,
            capitalPct: partnershipCapitalPctEnd,
          })}`,
        };
      }
      default:
        return null;
    }
  }, [
    activeTab,
    canvasYearIndex,
    borrowerMetadata.currentEmployer,
    borrowerMetadata.borrowerName,
    currentHourlyRate,
    currentWeeklyHours,
    currentPeriodBasePay,
    currentBaseYtd,
    currentBonusYtd,
    currentOtYtd,
    wageDocKind,
    prevEmployerW2,
    rentalProperties,
    schCYears,
    sCorpYears,
    partnershipYears,
    sCorpShareholderPct,
    partnershipProfitPctEnd,
    partnershipCapitalPctEnd,
    fixtureDocumentPrefix,
  ]);

  const docChips = (
    <div className="space-y-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2">
      {tabDocGroups.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-[10px] font-black uppercase tracking-wider text-slate-400">{group.label}</span>
          {group.docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              title={doc.fileName}
              onClick={() => {
                setHighlightFieldId(null);
                setInspectOverlay(null);
                viewer.clearHighlight();
                if (group.wageDocKind) setWageDocKind(group.wageDocKind);
                setInspectDocId(doc.id);
                const employer = w2Employers.find((entry) => entry.documentIds?.includes(doc.id));
                if (employer) setActiveW2EmployerId(employer.id);
                setLivePageIndex(pageForKind(doc.result, group.kind ?? kindsOf(doc)[0]));
              }}
              className={`max-w-[14rem] truncate rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                canvasDoc?.id === doc.id
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {doc.fileName}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={workspaceRef}
      className={`flex min-h-0 w-full flex-col overflow-hidden bg-white font-sans text-slate-800 ${
        workspaceFull ? 'fixed inset-0 z-50 h-screen rounded-none' : 'h-full rounded-xl border border-slate-200'
      }`}
    >
      <div className="flex shrink-0 flex-col justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-950">
              Income
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                ZDR
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              <span data-testid="header-borrowers">{borrowerMetadata.borrowerNames || borrowerMetadata.borrowerName}</span> · {borrowerMetadata.loanId}
              {borrowerMetadata.currentEmployer ? ` · ${borrowerMetadata.currentEmployer}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
            Program
            <select
              value={loanProgram}
              onChange={(event) => setLoanProgram(event.target.value as typeof loanProgram)}
              disabled={Boolean(protectedContext)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800 outline-none"
              aria-label="Loan program"
            >
              <option value="CONVENTIONAL">Conventional</option>
              <option value="FHA">FHA</option>
              <option value="VA">VA</option>
              <option value="USDA">USDA Rural Development</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void printIncomeSummary()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-200"
          >
            <Printer className="h-4 w-4" />
            Print summary
          </button>
          <button
            type="button"
            onClick={toggleWorkspaceFull}
            title={workspaceFull ? 'Leave full screen and return to the page' : 'Fill this window with the document and income QA, still side by side'}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-200"
          >
            {workspaceFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {workspaceFull ? 'Exit full screen' : 'Full screen'}
          </button>
          {!docPopout ? (
            <button
              type="button"
              onClick={openDocWindow}
              title="Open the document canvas in a separate window for a second monitor"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-200"
            >
              <Monitor className="h-4 w-4" />
              Dual monitor
            </button>
          ) : (
            <button
              type="button"
              onClick={bringBackDoc}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-600"
            >
              <MonitorX className="h-4 w-4" />
              Bring documents back
            </button>
          )}
          {onParseFiles || onParseFile ? (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-800">
              {parseBusy ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : <Upload className="h-4 w-4 text-emerald-600" />}
              {parseBusy ? 'Parsing…' : 'Load live PDF'}
              <input
                data-testid="live-pdf-input"
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                disabled={parseBusy}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (!files.length) return;
                  if (onParseFiles) onParseFiles(files);
                  else files.forEach((file) => onParseFile?.(file));
                }}
              />
            </label>
          ) : null}
          {packet.length > 0 && !protectedContext ? (
            <button
              type="button"
              onClick={() => (isLive ? onUseDemo?.() : onUseLive?.())}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
            >
              {isLive ? 'Use demo' : 'Use live PDF'}
            </button>
          ) : null}
        </div>
        {parseError ? <p className="w-full text-xs text-rose-600">{parseError}</p> : null}
      </div>

      {protectedContext ? (
        <div data-testid="protected-workspace-banner" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-[11px] text-indigo-950">
          <span>
            <strong>1. Upload &amp; review.</strong> Verify OCR fields, highlights, worksheet math, and borrower assignments here. Continue to submission only when the package looks right.
          </span>
          {protectedContext.authoritativeMonthlyIncome !== null ? (
            <span data-testid="workspace-authoritative-income" className="rounded bg-white px-2 py-1 font-black text-indigo-900">
              Authoritative {usd(protectedContext.authoritativeMonthlyIncome)}/mo
            </span>
          ) : null}
        </div>
      ) : null}

      <UrlAEntityRoster result={locateResult} onSelect={selectUrlAEntity} />
      <BorrowerWarningsPanel
        borrowers={borrowers}
        warnings={locateResult.warnings ?? []}
        onAssign={(key, borrowerId) => setBorrowerAssignments((current) => ({ ...current, [key]: borrowerId }))}
        assignmentLockedMessage={protectedContext ? 'Review assignment' : undefined}
        onOpenAuthoritativeReview={onOpenAuthoritativeWorkflow}
      />


      {/* Always split on this surface (desk / laptop). Dual monitor pops the document out. */}
      <div className="flex min-h-0 flex-1">
        
        {/* ==================== LEFT PANEL: PDF COORDINATES VISUAL CANVAS ==================== */}
        {/* Unmounted (not just hidden) while the canvas lives in its own window, so the
            main window does no duplicate PDF/canvas rendering work in dual-monitor mode */}
        {!docPopout && (
        <div className="flex min-h-0 w-1/2 min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                <Layers className="h-3.5 w-3.5 text-emerald-500" />
                Source PDF
              </span>
              <div className="flex items-center gap-2">
                {!isLive && fixturePdf && (
                  <div className="flex rounded-md border border-slate-200 p-0.5">
                    <button
                      type="button"
                      onClick={() => setDocMode('facsimile')}
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${docMode === 'facsimile' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      Facsimile
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocMode('pdf')}
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${docMode === 'pdf' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      Source PDF
                    </button>
                  </div>
                )}
                {(activeTab === 'PAYSTUB_RECONCILIATION' || activeTab === 'ENCOMPASS_SYNC') && !(isLive && tabDocGroups.length) && (
                  <div className="flex rounded-md border border-slate-200 p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setWageDocKind('paystub');
                        setInspectDocId(null);
                      }}
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${wageDocKind === 'paystub' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      Paystub
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWageDocKind('w2');
                        setInspectDocId(null);
                      }}
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${wageDocKind === 'w2' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      W-2
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isLive && tabDocGroups.length ? docChips : null}

            {isLive && canvasDoc ? (
              <PdfDocumentViewer
                file={canvasDoc.file}
                pageIndex={livePageIndex}
                pageCount={canvasDoc.result.total_pages_scanned}
                fields={canvasFields}
                selectedFieldId={highlightFieldId}
                highlight={inspectOverlay}
                onSelectField={handleInspectField}
                onPageChange={setLivePageIndex}
                ocrPages={canvasDoc.result.pages}
                fillHeight
              />
            ) : parseBusy ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-10 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                <p className="text-xs font-semibold text-slate-700">Reading the document…</p>
                <p className="max-w-xs text-[11px] leading-relaxed text-slate-500">
                  Scanned pages are run through OCR on the server, which usually takes
                  10 to 20 seconds. The extracted figures appear here when it finishes.
                </p>
              </div>
            ) : isLive ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                No {activeTab === 'PAYSTUB_RECONCILIATION' && wageDocKind === 'w2' ? 'W-2' : activeTab === 'PAYSTUB_RECONCILIATION' ? 'paystub' : 'matching'} PDF on file for this tab. Load live PDF keeps each document — it does not replace the last one.
              </p>
            ) : docMode === 'pdf' && fixturePdf ? (
              <div className="space-y-2">
                {(activeTab === 'SCHEDULE_C' || activeTab === 'SCORP' || activeTab === 'CCORP' || activeTab === 'PARTNERSHIP') &&
                  (activeTab === 'SCHEDULE_C' ? twoYearSchC : activeTab === 'SCORP' ? twoYearScorp : activeTab === 'CCORP' ? twoYearCCorp : twoYearPartnership) && (
                    <div className="flex gap-1">
                      {[0, 1].map((i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setCanvasYearIndex(i as 0 | 1)}
                          className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${canvasYearIndex === i ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
                        >
                          Year {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                <FixturePdfViewer
                  url={fixturePdf.url}
                  label={fixturePdf.label}
                  selectedId={highlightFieldId}
                  locate={
                    activeTab === 'PAYSTUB_RECONCILIATION' || activeTab === 'ENCOMPASS_SYNC'
                      ? wageDocKind === 'w2'
                        ? [
                            { id: 'w2-box5', needle: prevEmployerW2.box5Wages.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
                            { id: 'w2-box12-bonus', needle: prevEmployerW2.box12Bonus.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), lineHint: 'BONUS' },
                            { id: 'w2-box14-ot', needle: prevEmployerW2.box14Overtime.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), lineHint: 'OT  ' },
                          ]
                        : [
                          { id: 'ps-emp-name', needle: borrowerMetadata.currentEmployer },
                          { id: 'ps-ee-name', needle: borrowerMetadata.borrowerName },
                          { id: 'ps-period', needle: '08/01/2026' },
                          { id: 'ps-frequency', needle: 'Semi-monthly' },
                          { id: 'ps-hours-week', needle: `${currentWeeklyHours} hr/wk` },
                          { id: 'ps-hourly-rate', lineHint: 'Regular', moneyIndex: 0 },
                          { id: 'ps-current-base', lineHint: 'Regular', moneyIndex: 2 },
                          { id: 'ps-base-ytd', lineHint: 'Regular', moneyIndex: 3 },
                          { id: 'ps-ot-ytd', lineHint: 'Overtime', moneyIndex: 3 },
                          { id: 'ps-bonus-ytd', lineHint: 'Bonus', moneyIndex: 1 },
                        ]
                      : []
                  }
                  boxes={fieldCoordinatesMapping
                    .filter((field) => activeTab === 'PAYSTUB_RECONCILIATION' || activeTab === 'ENCOMPASS_SYNC')
                    .map((field) => ({
                      id: field.id,
                      x: field.boxCoordinates.x,
                      y: field.boxCoordinates.y,
                      width: field.boxCoordinates.width,
                      height: field.boxCoordinates.height,
                      selected: highlightFieldId === field.id,
                    }))}
                  onSelect={handleInspectField}
                />
              </div>
            ) : activeTab === 'SCHEDULE_F' ? (
              <div className="h-[540px] overflow-auto rounded-lg border border-slate-300 bg-[#f8f6f1] p-4 shadow-inner">
                <div className="min-h-full rounded border-2 border-slate-900 bg-white p-4">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Department of the Treasury — Internal Revenue Service</p>
                  <h3 className="border-b-2 border-slate-900 pb-2 text-sm font-black">Schedule F (Form 1040) · Profit or Loss From Farming</h3>
                  <p className="py-3 text-xs font-bold">{activeScheduleF.businessName} · EIN {activeScheduleF.ein || 'pending'}</p>
                  <div className="space-y-2">
                    {Object.entries(activeScheduleF.years[canvasYearIndex]).map(([key, value]) => (
                      <div key={key} className="flex justify-between rounded border border-slate-200 px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-600">{key.replace(/([A-Z])/g, ' $1')}</span>
                        <span className="font-mono font-black">{typeof value === 'number' ? value.toLocaleString() : value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTab === 'ASSET_INCOME' ? (
              <div className="h-[540px] overflow-auto rounded-lg border border-slate-300 bg-[#f8f6f1] p-4 shadow-inner">
                <div className="min-h-full rounded border-2 border-slate-900 bg-white p-4">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Department of the Treasury — Internal Revenue Service</p>
                  <h3 className="border-b-2 border-slate-900 pb-2 text-sm font-black">Schedule B / Schedule D</h3>
                  <p className="py-3 text-xs font-bold">{assetIncomeYears[canvasYearIndex].year} extracted asset income</p>
                  {[
                    ['Taxable interest', assetIncomeYears[canvasYearIndex].interestIncome],
                    ['Ordinary dividends', assetIncomeYears[canvasYearIndex].dividendIncome],
                    ['Net capital gain / (loss)', assetIncomeYears[canvasYearIndex].capitalGainsNetLoss],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="mb-2 flex justify-between rounded border border-slate-200 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-600">{label}</span>
                      <span className="font-mono font-black">{usd(Number(value))}</span>
                    </div>
                  ))}
                  <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                    Data retained. Excluded from qualifying income unless the UW elects inclusion.
                  </div>
                </div>
              </div>
            ) : activeTab === 'RETIREMENT' ? (
              <div className="h-[540px] overflow-auto rounded-lg border border-slate-300 bg-[#f8f6f1] p-4 shadow-inner">
                <div className="min-h-full rounded border-2 border-slate-900 bg-white p-4">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Department of the Treasury — Internal Revenue Service</p>
                  <h3 className="border-b-2 border-slate-900 pb-2 text-sm font-black">Form 1040 · U.S. Individual Income Tax Return</h3>
                  <p className="py-3 text-xs font-bold">{retirementReturn.year ?? 'Most recent'} return · Lines 4–6</p>
                  {RETIREMENT_LINES.map(([line, label, key]) => (
                    <div key={key} className="mb-2 flex justify-between rounded border border-slate-200 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-600"><span className="mr-2 font-mono font-black">{line}</span>{label}</span>
                      <span className="font-mono font-black">{usd(retirementReturn[key])}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DemoDocumentCanvas
                tab={activeTab}
                yearIndex={docYearIndex}
                onYearIndex={setCanvasYearIndex}
                twoYear={
                  activeTab === 'SCHEDULE_C'
                    ? twoYearSchC
                    : activeTab === 'SCORP'
                      ? twoYearScorp
                      : activeTab === 'CCORP'
                        ? twoYearCCorp
                        : activeTab === 'SCHEDULE_E'
                          ? false
                          : twoYearPartnership
                }
                selectedId={highlightFieldId}
                onSelect={handleInspectField}
                schC={schCYears[canvasYearIndex]}
                corp={activeTab === 'PARTNERSHIP' ? partnershipYears[canvasYearIndex] : sCorpYears[canvasYearIndex]}
                scheduleL={activeTab === 'PARTNERSHIP' ? partnershipL : activeTab === 'CCORP' ? cCorpL : sCorpL}
                showLiquidity={activeTab === 'SCORP' || activeTab === 'PARTNERSHIP' || activeTab === 'CCORP'}
                paystub={{
                  employer: borrowerMetadata.currentEmployer,
                  borrower: borrowerMetadata.borrowerName,
                  hourly: currentHourlyRate,
                  hours: currentWeeklyHours,
                  periodPay: currentPeriodBasePay,
                  ytd: currentBaseYtd,
                }}
              />
            )}

            <InspectNote />
          </div>
        </div>
        )}

        {/* ==================== RIGHT PANEL: TAB-DRIVEN CALCULATION ENGINES ==================== */}
        {/* The income type tabs sit above the QA panel they switch, not above the
            document, and stay put while the panel below them scrolls. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <div className="flex shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-2">
            {availableTabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  setInspectDocId(null);
                  setHighlightFieldId(null);
                  setCanvasYearIndex(0);
                }}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-bold transition ${
                  activeTab === id
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        {docPopout && isLive && tabDocGroups.length ? docChips : null}
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6"
          onPointerDownCapture={(event) => {
            qaPointerTargetRef.current = event.target instanceof HTMLElement ? event.target : null;
            window.setTimeout(() => { qaPointerTargetRef.current = null; }, 0);
          }}
        >
          {docPopout && (
            <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs">
              <span className="flex items-center gap-2 font-bold text-indigo-800">
                <Monitor className="h-4 w-4" />
                Document canvas is open in a second window — drag it to your other monitor. Highlights and paging stay in sync.
              </span>
              <button type="button" onClick={bringBackDoc} className="font-black uppercase text-indigo-700 hover:underline">
                Bring back
              </button>
            </div>
          )}

          {loanProgram === 'USDA' && (
            <UsdaDistributionToggle
              embedded
              loanId={borrowerMetadata.loanId}
              borrowerName={borrowerMetadata.borrowerName}
              borrowerEarnedIncomeMonthly={form1084CashFlow.w2BaseMonthly + form1084CashFlow.w2VariableMonthly}
              borrowerSelfEmployment={usdaSelfEmployment}
            />
          )}
          
          {/* ==================== TAB 1: 4-WAY BASE WAGE RECONCILIATION ==================== */}
          {activeTab === 'PAYSTUB_RECONCILIATION' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <h3 className="border-b border-slate-100 pb-3 text-sm font-bold text-slate-900">Wage inputs</h3>

              <IncomeEntitySelector
                label="Employer / W-2"
                entities={w2Employers.map((entry) => ({
                  id: entry.id,
                  name: entry.employerName || 'Unnamed entity',
                  detail: borrowerTag(entry.borrowerId) || undefined,
                }))}
                activeId={activeW2Employer.id}
                onSelect={selectW2Employer}
                onAdd={addW2Employer}
                onRemove={removeW2Employer}
              />
              <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs [&>label]:px-3 [&>label]:py-2">
                <label className="font-bold text-slate-500">
                  Employer name
                  <input
                    value={activeW2Employer.employerName}
                    onChange={(event) => patchW2Employer({ employerName: event.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-slate-900"
                  />
                </label>
                <label className="font-bold text-slate-500">
                  EIN
                  <input
                    value={activeW2Employer.ein}
                    onChange={(event) => patchW2Employer({ ein: event.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-slate-900"
                  />
                </label>
                <label className="font-bold text-slate-500">
                  Job relationship
                  <select
                    value={activeW2Employer.role}
                    onChange={(event) => patchW2Employer({ role: event.target.value as W2Employer['role'] })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-slate-900"
                  >
                    <option value="PRIMARY">Primary current employer</option>
                    <option value="SECONDARY">Secondary employer</option>
                  </select>
                </label>
                <label className="font-bold text-slate-500">
                  Pay frequency
                  <select
                    value={activeW2Employer.payFrequency}
                    onChange={(event) => patchW2Employer({ payFrequency: event.target.value as W2Employer['payFrequency'] })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-slate-900"
                  >
                    {(['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'] as const).map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {payFrequencyLabel(frequency)} · {payPeriodsPerYear(frequency)} pays/yr
                      </option>
                    ))}
                  </select>
                </label>
                <label className="font-bold text-slate-500 md:col-span-2">
                  Wage source
                  <div className="mt-1 flex rounded-md border border-slate-300 p-0.5">
                    <button
                      type="button"
                      onClick={() => patchW2Employer({ wageDocSource: 'PAYSTUB' })}
                      className={`flex-1 rounded px-2 py-1.5 text-[10px] font-black uppercase ${
                        activeW2Employer.wageDocSource === 'PAYSTUB' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      Paystub + W-2
                    </button>
                    <button
                      type="button"
                      onClick={() => patchW2Employer({ wageDocSource: 'WVOE' })}
                      className={`flex-1 rounded px-2 py-1.5 text-[10px] font-black uppercase ${
                        activeW2Employer.wageDocSource === 'WVOE' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      WVOE
                    </button>
                  </div>
                </label>
              </div>

              {/* Core interactive variable modification boxes */}
              <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs [&>div]:px-3 [&>div]:py-2">
                <MoneyField
                  label="Hourly rate of pay"
                  value={currentHourlyRate}
                  onChange={setCurrentHourlyRate}
                  fieldId="ps-hourly-rate"
                  onInspect={handleInspectField}
                  highlighted={highlightFieldId === 'ps-hourly-rate'}
                  extracted={wageFieldExtracted('ps-hourly-rate')}
                  decimals={4}
                />
                <MoneyField
                  label="Standard weekly hours"
                  value={currentWeeklyHours}
                  onChange={setCurrentWeeklyHours}
                  fieldId="ps-hours-week"
                  onInspect={handleInspectField}
                  highlighted={highlightFieldId === 'ps-hours-week'}
                  extracted={wageFieldExtracted('ps-hours-week')}
                />
                <MoneyField
                  label="Current period base pay"
                  value={currentPeriodBasePay}
                  onChange={setCurrentPeriodBasePay}
                  fieldId="ps-current-base"
                  onInspect={handleInspectField}
                  highlighted={highlightFieldId === 'ps-current-base'}
                  extracted={wageFieldExtracted('ps-current-base')}
                />
                <MoneyField
                  label="Base wages YTD"
                  value={currentBaseYtd}
                  onChange={setCurrentBaseYtd}
                  fieldId="ps-base-ytd"
                  onInspect={handleInspectField}
                  highlighted={highlightFieldId === 'ps-base-ytd'}
                  extracted={wageFieldExtracted('ps-base-ytd')}
                />
                <MoneyField
                  label={priorW2Year ? `${priorW2Year} W-2 Box 5` : 'Prior year W-2 Box 5'}
                  value={activeW2Employer.w2Year1Box5}
                  onChange={(value) => patchW2Employer({ w2Year1Box5: value })}
                  fieldId="w2-box5"
                  onInspect={handleInspectField}
                  highlighted={highlightFieldId === 'w2-box5'}
                  extracted={wageFieldExtracted('w2-box5')}
                />
                <MoneyField
                  label="Other income YTD"
                  value={currentOtherYtd}
                  onChange={setCurrentOtherYtd}
                  extracted={wageFieldExtracted('ps-other-ytd')}
                />
              </div>

              <ReviewNotesPanel notes={wageReviewNotes} />

              {/* Variable income stays on the Base Income tab */}
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Variable income</h3>
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                  <button 
                    onClick={() => setMergePreviousEmployerVariable(!mergePreviousEmployerVariable)} 
                    className="focus:outline-none"
                  >
                    {mergePreviousEmployerVariable ? <CheckSquare className="h-4.5 w-4.5 text-indigo-600" /> : <Square className="h-4.5 w-4.5 text-slate-300" />}
                  </button>
                  <span className="text-[10px] font-extrabold text-indigo-950 uppercase">Merge Prior Job History (24-Mo Rolling)</span>
                </div>
              </div>

              {/* Tenure configuration inputs */}
              <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-xs [&>label]:px-3 [&>label]:py-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Months at Current Job (Hire Date: Dec 2025)</label>
                  <input
                    type="number"
                    value={monthsAtCurrentJob}
                    onChange={(e) => setMonthsAtCurrentJob(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-slate-400 block mt-1">Less than 12 months at current job mandates prior job variable history.</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Months at Previous Job (Rolling Window)</label>
                  <input
                    type="number"
                    value={monthsAtPreviousJob}
                    onChange={(e) => setMonthsAtPreviousJob(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                    disabled={!mergePreviousEmployerVariable}
                  />
                  <span className="text-[9px] text-slate-400 block mt-1">Number of rolling months required to complete the qualifying window.</span>
                </div>
              </div>

              {/* Side-by-Side Job Variable Details */}
              <div className="flex flex-col gap-6">
                
                {/* Current Job variable inputs */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5 border-b pb-1">
                    <Activity className="h-4 w-4 text-indigo-500" />
                    {activeW2Employer.wageDocSource === 'WVOE' ? 'WVOE variable history' : 'Current Job YTD Variable Extractions'}
                  </h4>
                  <div className="text-xs">
                    <label htmlFor="bonus-frequency" className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Bonus paid</label>
                    <select
                      id="bonus-frequency"
                      data-qa-field="bonus-frequency"
                      value={activeW2Employer.bonusFrequency ?? ''}
                      onChange={(e) => patchW2Employer({ bonusFrequency: isBonusFrequency(e.target.value) ? e.target.value : undefined })}
                      className="w-full rounded border border-slate-300 bg-white p-2 font-semibold focus:outline-none"
                    >
                      <option value="">With each paycheck</option>
                      {BONUS_FREQUENCIES.map((frequency) => (
                        <option key={frequency} value={frequency}>{bonusFrequencyLabel(frequency)}</option>
                      ))}
                    </select>
                    <span className="text-[9px] text-slate-400 block mt-1">
                      {activeW2Employer.bonusFrequency
                        ? `Bonus averages over the ${w2VarMethods.bonusMonths} months its ${bonusFrequencyLabel(activeW2Employer.bonusFrequency).toLowerCase()} payouts cover, not the ${w2VarMethods.variableMonths}-month window.`
                        : 'Averages bonus over the same months as overtime. Choose a schedule when bonus is paid in lump sums.'}
                    </span>
                  </div>
                  {activeW2Employer.wageDocSource === 'WVOE' ? (
                  <div className="flex flex-col divide-y divide-slate-100 text-xs">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">WVOE months</label>
                      <input
                        type="number"
                        value={activeW2Employer.wvoeMonths}
                        onChange={(e) => patchW2Employer({ wvoeMonths: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">WVOE bonus</label>
                      <input
                        type="number"
                        value={activeW2Employer.wvoeBonus}
                        onChange={(e) => patchW2Employer({ wvoeBonus: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">WVOE overtime</label>
                      <input
                        type="number"
                        value={activeW2Employer.wvoeOvertime}
                        onChange={(e) => patchW2Employer({ wvoeOvertime: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                  </div>
                  ) : (
                  <div className="flex flex-col divide-y divide-slate-100 text-xs">
                    <div data-qa-field="ps-bonus-ytd" className={`cursor-pointer ${highlightFieldId === 'ps-bonus-ytd' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('ps-bonus-ytd')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Bonus Income YTD</label>
                      <input
                        type="number"
                        value={currentBonusYtd}
                        onChange={(e) => setCurrentBonusYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div data-qa-field="ps-ot-ytd" className={`cursor-pointer ${highlightFieldId === 'ps-ot-ytd' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('ps-ot-ytd')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Overtime Income YTD</label>
                      <input
                        type="number"
                        value={currentOtYtd}
                        onChange={(e) => setCurrentOtYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div data-qa-field="ps-tips-ytd" className={`cursor-pointer ${highlightFieldId === 'ps-tips-ytd' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('ps-tips-ytd')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Tips YTD</label>
                      <input
                        type="number"
                        value={currentTipsYtd}
                        onChange={(e) => setCurrentTipsYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div data-qa-field="ps-commission-ytd" className={`cursor-pointer ${highlightFieldId === 'ps-commission-ytd' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('ps-commission-ytd')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Commission YTD</label>
                      <input
                        type="number"
                        value={currentCommissionYtd}
                        onChange={(e) => setCurrentCommissionYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div data-qa-field="ps-rsu-ytd" className={`cursor-pointer ${highlightFieldId === 'ps-rsu-ytd' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('ps-rsu-ytd')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">RSU YTD</label>
                      <input
                        type="number"
                        value={currentRsuYtd}
                        onChange={(e) => setCurrentRsuYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                  </div>
                  )}
                </div>

                {/* Prior Job Variable inputs */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5 border-b pb-1">
                    <Link className="h-4 w-4 text-indigo-500" />
                    Prior Job {priorJobW2YearPrefix}W-2 Variable Extractions
                  </h4>
                  <div className="flex flex-col divide-y divide-slate-100 text-xs">
                    <div data-qa-field="w2-box12-bonus" className={`cursor-pointer ${highlightFieldId === 'w2-box12-bonus' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('w2-box12-bonus')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Box 12 Bonus History</label>
                      <input
                        type="number"
                        value={prevEmployerW2.box12Bonus}
                        onChange={(e) => setPrevEmployerW2({ ...prevEmployerW2, box12Bonus: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                        disabled={!mergePreviousEmployerVariable}
                      />
                    </div>
                    <div data-qa-field="w2-box14-ot" className={`cursor-pointer ${highlightFieldId === 'w2-box14-ot' ? 'rounded-md ring-2 ring-emerald-500 p-1' : ''}`} onClick={() => handleInspectField('w2-box14-ot')}>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Box 14 Overtime History</label>
                      <input
                        type="number"
                        value={prevEmployerW2.box14Overtime}
                        onChange={(e) => setPrevEmployerW2({ ...prevEmployerW2, box14Overtime: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                        disabled={!mergePreviousEmployerVariable}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-bold text-slate-900">Income calculation</h3>
                {currentOtherYtd > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-xs leading-relaxed text-amber-800">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold uppercase block tracking-wider text-amber-950">Other Income Detected</span>
                      Other income of ${currentOtherYtd.toLocaleString()} found. Please validate the continuance of this other income type (e.g., probability of continued receipt for at least 3 years) per guidelines.
                    </div>
                  </div>
                )}
                <IncomeChoicePanel
                  options={w2BasePicks.options}
                  recommendedId={w2BasePicks.recommendedId}
                  reason={w2BasePicks.reason}
                  selectedId={w2BaseChoice}
                  onSelect={setW2BaseChoice}
                />
                <div className="flex justify-between rounded bg-slate-50 p-3 text-xs">
                  <span className="font-semibold text-slate-500">Current monthly variable average</span>
                  <span className="font-black text-slate-800">${variableContinuityCalculations.currentMonthlyVariableAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo</span>
                </div>
                <div className="flex justify-between rounded bg-slate-50 p-3 text-xs">
                  <span className="font-semibold text-slate-500">Prior monthly variable average</span>
                  <span className={`font-black text-slate-800 ${!mergePreviousEmployerVariable ? 'opacity-40' : ''}`}>
                    ${variableContinuityCalculations.previousMonthlyVariableAvg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                  </span>
                </div>
                <IncomeChoicePanel
                  options={w2VarPicks.options}
                  recommendedId={w2VarPicks.recommendedId}
                  reason={w2VarPicks.reason}
                  selectedId={w2VarChoice}
                  onSelect={setW2VarChoice}
                />
              </div>
            </div>
          )}

          {activeTab === 'SCHEDULE_C' && (
            <SelfEmployedPanel
              title="Schedule C · sole proprietor"
              twoYears={twoYearSchC}
              onTwoYears={(next) => {
                setTwoYearSchC(next);
                if (!next) setCanvasYearIndex(0);
              }}
              choiceOptions={schCPicks.options}
              recommendedId={schCPicks.recommendedId}
              reason={schCPicks.reason}
              choiceId={schCChoice}
              onChoice={setSchCChoice}
            >
              <IncomeEntitySelector
                label="Schedule C business"
                entities={asEntityOptions(schCEntities)}
                activeId={activeSchC.id}
                onSelect={setActiveSchCId}
                onAdd={addScheduleCEntity}
                onUpdate={(id, patch) => setSchCEntities((entities) => entities.map((entity) =>
                  entity.id === id ? { ...entity, businessName: patch.name ?? entity.businessName, ein: patch.ein ?? entity.ein } : entity,
                ))}
                onRemove={(id) => {
                  const remaining = schCEntities.filter((entity) => entity.id !== id);
                  setSchCEntities(remaining);
                  setActiveSchCId(remaining[0].id);
                }}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
                {schCYears.slice(0, twoYearSchC ? 2 : 1).map((row, index) => (
                  <YearStack
                    key={row.year}
                    title={`${row.year} return`}
                    subtitle={index === 0 ? 'Most recent' : 'Prior year'}
                  >
                    <SchCLines
                      row={row}
                      yearKey={index === 0 ? 'y1' : 'y2'}
                      selectedId={highlightFieldId}
                      onSelect={handleInspectField}
                      onChange={(patch) =>
                        setSchCYears((prev) => {
                          const next: [SchCYear, SchCYear] = [...prev];
                          next[index] = { ...next[index], ...patch };
                          return next;
                        })
                      }
                    />
                    <p className="pt-1 text-right font-mono text-xs font-black text-slate-900">
                      Annual cash flow {usd(schCAnnual(row))}
                    </p>
                  </YearStack>
                ))}
              </div>
              <ProfitLossBlock pnl={schCPnl} onChange={setSchCPnl} loanProgram={loanProgram} />
            </SelfEmployedPanel>
          )}

          {activeTab === 'SCORP' && (
            <SelfEmployedPanel
              title="S-Corp · Form 1120-S / K-1"
              twoYears={twoYearScorp}
              onTwoYears={(next) => {
                setTwoYearScorp(next);
                if (!next) setCanvasYearIndex(0);
              }}
              choiceOptions={sCorpPicks.options}
              recommendedId={sCorpPicks.recommendedId}
              reason={sCorpPicks.reason}
              choiceId={sCorpChoice}
              onChoice={setSCorpChoice}
              extra={
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                  End-of-year stock ownership %
                  <input
                    type="number"
                    value={sCorpShareholderPct}
                    onChange={(event) => setSCorpShareholderPct(Number(event.target.value))}
                    className={`w-16 rounded border px-2 py-1 font-mono text-sm ${sCorpShareholderPct < 25 ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                  />
                  {sCorpShareholderPct < 25 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                      &lt;25% · not self-employed
                    </span>
                  )}
                  <label className="ml-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={activeSCorp.hasStableDistributions}
                      onChange={(event) =>
                        setSCorpEntities((entities) =>
                          entities.map((entity) =>
                            entity.id === activeSCorp.id ? { ...entity, hasStableDistributions: event.target.checked } : entity,
                          ),
                        )
                      }
                    />
                    Stable distribution history
                    {distributionShortfallBadge(sCorpFlow.shortfall) && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                        {distributionShortfallBadge(sCorpFlow.shortfall)}
                      </span>
                    )}
                  </label>
                </label>
              }
            >
              <IncomeEntitySelector
                label="S-Corporation"
                entities={asEntityOptions(sCorpEntities)}
                activeId={activeSCorp.id}
                onSelect={setActiveSCorpId}
                onAdd={addSCorpEntity}
                onUpdate={(id, patch) => setSCorpEntities((entities) => entities.map((entity) =>
                  entity.id === id ? { ...entity, businessName: patch.name ?? entity.businessName, ein: patch.ein ?? entity.ein } : entity,
                ))}
                onRemove={(id) => {
                  const remaining = sCorpEntities.filter((entity) => entity.id !== id);
                  setSCorpEntities(remaining);
                  setActiveSCorpId(remaining[0].id);
                }}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
                {sCorpYears.slice(0, twoYearScorp ? 2 : 1).map((row, index) => (
                  <YearStack key={row.year} title={`${row.year} 1120-S and K-1`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    <CorpLines
                      row={row}
                      yearKey={index === 0 ? 'y1' : 'y2'}
                      kind="scorp"
                      ownershipPct={sCorpShareholderPct}
                      total={
                        (sCorpShareholderPct < 25
                          ? corpMinorityAnnual(row, sCorpShareholderPct).capped
                          : corpBusinessAnnual(row, sCorpShareholderPct)) + row.w2Wages
                      }
                      selectedId={highlightFieldId}
                      onSelect={handleInspectField}
                      onChange={(patch) =>
                        setSCorpYears((prev) => {
                          const next: [CorpYear, CorpYear] = [...prev];
                          next[index] = { ...next[index], ...patch };
                          return next;
                        })
                      }
                    />
                  </YearStack>
                ))}
              </div>
              <LiquidityBlock sheet={sCorpL} onChange={setSCorpL} selectedId={highlightFieldId} onSelect={handleInspectField} />
              <ProfitLossBlock pnl={sCorpPnl} onChange={setSCorpPnl} loanProgram={loanProgram} />
            </SelfEmployedPanel>
          )}

          {activeTab === 'CCORP' && (
            <SelfEmployedPanel
              title="C-Corp · Form 1120"
              twoYears={twoYearCCorp}
              onTwoYears={(next) => {
                setTwoYearCCorp(next);
                if (!next) setCanvasYearIndex(0);
              }}
              choiceOptions={cCorpPicks.options}
              recommendedId={cCorpPicks.recommendedId}
              reason={cCorpPicks.reason}
              choiceId={cCorpChoice}
              onChoice={setCCorpChoice}
              extra={
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                  Ownership %
                  <input
                    type="number"
                    value={cCorpOwnershipPct}
                    onChange={(event) => setCCorpOwnershipPct(Number(event.target.value))}
                    className={`w-16 rounded border px-2 py-1 font-mono text-sm ${cCorpOwnershipPct < 25 ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                  />
                </label>
              }
            >
              <IncomeEntitySelector
                label="C-Corporation"
                entities={asEntityOptions(cCorpEntities)}
                activeId={activeCCorp.id}
                onSelect={setActiveCCorpId}
                onAdd={addCCorpEntity}
                onUpdate={(id, patch) => setCCorpEntities((entities) => entities.map((entity) =>
                  entity.id === id ? { ...entity, businessName: patch.name ?? entity.businessName, ein: patch.ein ?? entity.ein } : entity,
                ))}
                onRemove={(id) => {
                  const remaining = cCorpEntities.filter((entity) => entity.id !== id);
                  setCCorpEntities(remaining);
                  setActiveCCorpId(remaining[0].id);
                }}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
                {cCorpYears.slice(0, twoYearCCorp ? 2 : 1).map((row, index) => (
                  <YearStack key={row.year} title={`${row.year} Form 1120`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    <CCorpLines
                      row={row}
                      yearKey={index === 0 ? 'y1' : 'y2'}
                      selectedId={highlightFieldId}
                      onSelect={handleInspectField}
                      onChange={(patch) =>
                        setCCorpYears((prev) => {
                          const next: [CCorpYear, CCorpYear] = [...prev];
                          next[index] = { ...next[index], ...patch };
                          return next;
                        })
                      }
                    />
                    <p className="pt-1 text-right font-mono text-xs font-black text-slate-900">
                      Qualifying cash flow {usd(cCorpBusinessAnnual(row, cCorpOwnershipPct, cCorpLRatio.passes))}
                    </p>
                  </YearStack>
                ))}
              </div>
              <LiquidityBlock sheet={cCorpL} onChange={setCCorpL} selectedId={highlightFieldId} onSelect={handleInspectField} />
              <ProfitLossBlock pnl={cCorpPnl} onChange={setCCorpPnl} loanProgram={loanProgram} />
            </SelfEmployedPanel>
          )}

          {activeTab === 'PARTNERSHIP' && (
            <SelfEmployedPanel
              title="Partnership · Form 1065 / K-1"
              twoYears={twoYearPartnership}
              onTwoYears={(next) => {
                setTwoYearPartnership(next);
                if (!next) setCanvasYearIndex(0);
              }}
              choiceOptions={partnershipPicks.options}
              recommendedId={partnershipPicks.recommendedId}
              reason={partnershipPicks.reason}
              choiceId={partnershipChoice}
              onChoice={setPartnershipChoice}
              extra={
                <div className="flex flex-wrap items-center gap-3">
                  {/* GSE selector: which K-1 Item J ENDING percentage qualifies */}
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setGseInvestor('FNMA')}
                      className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${gseInvestor === 'FNMA' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                    >
                      FNMA · % capital
                    </button>
                    <button
                      type="button"
                      onClick={() => setGseInvestor('FREDDIE')}
                      className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${gseInvestor === 'FREDDIE' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                    >
                      Freddie · % profit
                    </button>
                  </div>
                  <label className={`flex items-center gap-1.5 text-[11px] font-semibold ${gseInvestor === 'FREDDIE' ? 'text-slate-900' : 'text-slate-400'}`}>
                    Ending profit %
                    <input
                      type="number"
                      value={partnershipProfitPctEnd}
                      onChange={(event) => setPartnershipProfitPctEnd(Number(event.target.value))}
                      className={`w-16 rounded border px-2 py-1 font-mono text-sm ${gseInvestor === 'FREDDIE' ? 'border-slate-400' : 'border-slate-200 text-slate-400'}`}
                    />
                  </label>
                  <label className={`flex items-center gap-1.5 text-[11px] font-semibold ${gseInvestor === 'FNMA' ? 'text-slate-900' : 'text-slate-400'}`}>
                    Ending capital %
                    <input
                      type="number"
                      value={partnershipCapitalPctEnd}
                      onChange={(event) => setPartnershipCapitalPctEnd(Number(event.target.value))}
                      className={`w-16 rounded border px-2 py-1 font-mono text-sm ${gseInvestor === 'FNMA' ? 'border-slate-400' : 'border-slate-200 text-slate-400'}`}
                    />
                  </label>
                  {partnershipPctNote ? (
                    <p className="w-full rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                      {partnershipPctNote}
                    </p>
                  ) : null}
                  {partnershipPct < 25 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                      &lt;25% · not self-employed
                    </span>
                  )}
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={activePartnership.hasStableDistributions}
                      onChange={(event) =>
                        setPartnershipEntities((entities) =>
                          entities.map((entity) =>
                            entity.id === activePartnership.id
                              ? { ...entity, hasStableDistributions: event.target.checked }
                              : entity,
                          ),
                        )
                      }
                    />
                    Stable distribution history
                    {distributionShortfallBadge(partnershipFlow.shortfall) && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                        {distributionShortfallBadge(partnershipFlow.shortfall)}
                      </span>
                    )}
                  </label>
                </div>
              }
            >
              <IncomeEntitySelector
                label="Partnership"
                entities={asEntityOptions(partnershipEntities)}
                activeId={activePartnership.id}
                onSelect={setActivePartnershipId}
                onAdd={addPartnershipEntity}
                onUpdate={(id, patch) => setPartnershipEntities((entities) => entities.map((entity) =>
                  entity.id === id ? { ...entity, businessName: patch.name ?? entity.businessName, ein: patch.ein ?? entity.ein } : entity,
                ))}
                onRemove={(id) => {
                  const remaining = partnershipEntities.filter((entity) => entity.id !== id);
                  setPartnershipEntities(remaining);
                  setActivePartnershipId(remaining[0].id);
                }}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
                {partnershipYears.slice(0, twoYearPartnership ? 2 : 1).map((row, index) => (
                  <YearStack key={row.year} title={`${row.year} 1065 and K-1`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    <CorpLines
                      row={row}
                      yearKey={index === 0 ? 'y1' : 'y2'}
                      kind="partnership"
                      ownershipPct={partnershipPct}
                      total={
                        partnershipPct < 25
                          ? corpMinorityAnnual(row, partnershipPct).capped
                          : corpBusinessAnnual(row, partnershipPct)
                      }
                      selectedId={highlightFieldId}
                      onSelect={handleInspectField}
                      onChange={(patch) =>
                        setPartnershipYears((prev) => {
                          const next: [CorpYear, CorpYear] = [...prev];
                          next[index] = { ...next[index], ...patch };
                          return next;
                        })
                      }
                    />
                  </YearStack>
                ))}
              </div>
              <LiquidityBlock
                sheet={partnershipL}
                onChange={setPartnershipL}
                selectedId={highlightFieldId}
                onSelect={handleInspectField}
              />
              <ProfitLossBlock pnl={partnershipPnl} onChange={setPartnershipPnl} loanProgram={loanProgram} />
            </SelfEmployedPanel>
          )}

          {activeTab === 'SCHEDULE_F' && (
            <SelfEmployedPanel
              title="Schedule F · farm income"
              twoYears={twoYearScheduleF}
              onTwoYears={(next) => {
                setTwoYearScheduleF(next);
                if (!next) setCanvasYearIndex(0);
              }}
              choiceOptions={scheduleFPicks.options}
              recommendedId={scheduleFPicks.recommendedId}
              reason={scheduleFPicks.reason}
              choiceId={scheduleFChoice}
              onChoice={setScheduleFChoice}
            >
              <IncomeEntitySelector
                label="Farm business"
                entities={asEntityOptions(scheduleFEntities)}
                activeId={activeScheduleF.id}
                onSelect={setActiveScheduleFId}
                onAdd={addScheduleFEntity}
                onUpdate={(id, patch) => setScheduleFEntities((entities) => entities.map((entity) =>
                  entity.id === id ? { ...entity, businessName: patch.name ?? entity.businessName, ein: patch.ein ?? entity.ein } : entity,
                ))}
                onRemove={(id) => {
                  const remaining = scheduleFEntities.filter((entity) => entity.id !== id);
                  setScheduleFEntities(remaining);
                  setActiveScheduleFId(remaining[0].id);
                }}
              />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
                {activeScheduleF.years.slice(0, twoYearScheduleF ? 2 : 1).map((year, index) => (
                  <YearStack key={year.year} title={`${year.year} Schedule F`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    {[
                      ['Line 34', 'Net farm profit / (loss)', 'netFarmProfitLoss'],
                      ['Line 14', 'Depreciation', 'depreciation'],
                      ['Line 32', 'Depletion', 'depletion'],
                      ['Line 32', 'Amortization', 'amortization'],
                      ['Line 32', 'Casualty loss', 'casualtyLoss'],
                      ['Form 8829', 'Business use of home', 'businessUseOfHome'],
                      ['Line 24b', 'Meals exclusion', 'mealsExclusion'],
                      ['Other', 'Nonrecurring income', 'nonrecurringIncome'],
                    ].map(([line, label, key]) => (
                      <label key={key} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-2 text-xs">
                        <span className="w-20 shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">{line}</span>
                        <span className="min-w-0 flex-1 font-semibold text-slate-700">{label}</span>
                        <input
                          type="number"
                          value={year[key as keyof ScheduleFYear]}
                          onChange={(event) => patchScheduleFYear(index, { [key]: Number(event.target.value) })}
                          className="w-28 rounded border border-slate-300 px-2 py-1.5 text-right font-mono font-bold"
                        />
                      </label>
                    ))}
                    <p className="pt-1 text-right font-mono text-xs font-black text-slate-900">
                      Adjusted annual farm cash flow {usd(scheduleFAnnual(year))}
                    </p>
                  </YearStack>
                ))}
              </div>
            </SelfEmployedPanel>
          )}

          {activeTab === 'ASSET_INCOME' && (
            <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
                      <Coins className="h-5 w-5 text-amber-600" />
                      Interest, Dividends & Capital Gains
                    </h3>
                  </div>
                  <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                    <button type="button" onClick={() => setTwoYearAssetIncome(false)} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${!twoYearAssetIncome ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>1 year</button>
                    <button type="button" onClick={() => setTwoYearAssetIncome(true)} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${twoYearAssetIncome ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>2 years</button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <p>
                  <strong className="block uppercase tracking-wider">Excluded from qualifying income by default</strong>
                  Additional income from these sources may be eligible. The underwriter may choose to include it after verifying receipt history, expected continuance, and sufficient supporting asset balances.
                </p>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
                {assetIncomeYears.slice(0, twoYearAssetIncome ? 2 : 1).map((year, index) => (
                  <YearStack key={year.year} title={`${year.year} tax return`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    {[
                      ['Schedule B', 'Taxable interest', 'interestIncome'],
                      ['Schedule B', 'Ordinary dividends', 'dividendIncome'],
                      ['Schedule D', 'Net capital gain / (loss)', 'capitalGainsNetLoss'],
                    ].map(([line, label, key]) => (
                      <label key={key} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-2 text-xs">
                        <span className="w-20 shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">{line}</span>
                        <span className="min-w-0 flex-1 font-semibold text-slate-700">{label}</span>
                        <input
                          type="number"
                          value={year[key as keyof AssetIncomeYear]}
                          onChange={(event) =>
                            setAssetIncomeYears((entries) => entries.map((entry, i) =>
                              i === index ? { ...entry, [key]: Number(event.target.value) } : entry,
                            ) as [AssetIncomeYear, AssetIncomeYear])
                          }
                          className="w-28 rounded border border-slate-300 px-2 py-1.5 text-right font-mono font-bold"
                        />
                      </label>
                    ))}
                    <p className="pt-1 text-right font-mono text-xs font-black text-slate-900">
                      Detected annual total {usd(assetIncomeAnnual[index])}
                    </p>
                  </YearStack>
                ))}
              </div>
              <IncomeChoicePanel
                options={assetIncomePicks.options}
                recommendedId={assetIncomePicks.recommendedId}
                reason={assetIncomePicks.reason}
                selectedId={assetIncomeIncluded ? 'include' : null}
                onSelect={(id) => setAssetIncomeIncluded(id === 'include')}
              />
            </div>
          )}
          
          {activeTab === 'RETIREMENT' && (
            <div data-testid="retirement-panel" className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
                  <PiggyBank className="h-5 w-5 text-emerald-600" />
                  Retirement Income · Form 1040 Lines 4–6
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">
                    {retirementReturn.year ? `${retirementReturn.year} return` : 'Most recent return'}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700">
                    {loanProgram} gross-up {Math.round((retirement.multiplier - 1) * 100)}%
                  </span>
                </div>
              </div>
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Uses the most recent return only. The non-taxable part of Social Security and pensions is grossed up for the program. IRA distributions count only after the customer enters the account balance and the underwriter confirms {IRA_CONTINUANCE_MONTHS}-month continuance. SSI is not reported on Form 1040; document it with the award letter.
              </p>

              <YearStack title="Form 1040" subtitle={retirementReturn.year ? `${retirementReturn.year} · most recent` : 'Most recent'}>
                {RETIREMENT_LINES.map(([line, label, key, sourceId]) => (
                  <label key={key} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-2 text-xs">
                    <button
                      type="button"
                      onClick={(event) => handleInspectField(sourceId, retirementReturn.documentId, event.currentTarget)}
                      className="w-16 shrink-0 text-left font-mono text-[10px] font-black uppercase text-slate-500 hover:text-indigo-600"
                    >
                      {line}
                    </button>
                    <span className="min-w-0 flex-1 font-semibold text-slate-700">{label}</span>
                    <input
                      type="number"
                      min={0}
                      aria-label={`${line} ${label}`}
                      value={retirementReturn[key]}
                      onChange={(event) => setRetirementReturn((lines) => ({ ...lines, [key]: Math.max(0, Number(event.target.value) || 0) }))}
                      className="w-28 rounded border border-slate-300 px-2 py-1.5 text-right font-mono font-bold"
                    />
                  </label>
                ))}
              </YearStack>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <span className="text-[10px] font-black uppercase text-slate-400">Social Security</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(retirement.socialSecurityMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <span className="text-[10px] font-black uppercase text-slate-400">Pensions and annuities</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(retirement.pensionMonthly)}/mo</span>
                </div>
              </div>

              {retirement.ira ? (
                <div data-testid="ira-review" className="space-y-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-sm font-extrabold text-slate-900">IRA distributions</h4>
                    <span className="text-xs font-semibold text-slate-600">
                      {usd(retirement.ira.totalDistributions)} reported · {usd(retirement.ira.taxableDistributions)} taxable · {usd(retirement.ira.monthlyDistribution)}/mo
                    </span>
                  </div>
                  <label className="block text-xs">
                    <span className="mb-1 block font-black uppercase tracking-wider text-slate-500">Customer · IRA account balance from the most recent statement</span>
                    <input
                      type="number"
                      min={0}
                      max={1_000_000_000}
                      step={0.01}
                      data-testid="ira-balance-input"
                      value={iraBalanceInput}
                      onChange={(event) => setIraBalanceInput(event.target.value)}
                      placeholder="Vested balance"
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono font-bold"
                    />
                    {retirement.ira.monthsOfContinuance != null ? (
                      <span className={`mt-1 block font-semibold ${retirement.ira.monthsOfContinuance >= IRA_CONTINUANCE_MONTHS ? 'text-emerald-700' : 'text-rose-700'}`}>
                        Balance covers {retirement.ira.monthsOfContinuance} months at the current distribution rate ({IRA_CONTINUANCE_MONTHS} required).
                      </span>
                    ) : null}
                  </label>
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-xs font-black uppercase tracking-wider text-slate-500">Underwriter · {IRA_CONTINUANCE_MONTHS}-month continuance</legend>
                    {([
                      ['CONFIRMED_GROSS_UP', `Confirmed ${IRA_CONTINUANCE_MONTHS}+ months · gross up non-taxable portion ${Math.round((retirement.multiplier - 1) * 100)}% (${loanProgram})`, retirement.ira.monthlyIfConfirmed.grossUp],
                      ['CONFIRMED', `Confirmed ${IRA_CONTINUANCE_MONTHS}+ months · no gross-up`, retirement.ira.monthlyIfConfirmed.noGrossUp],
                      ['NOT_CONFIRMED', 'Not confirmed · exclude from qualifying income', 0],
                    ] as const).filter(([id]) => id !== 'CONFIRMED_GROSS_UP' || retirement.ira!.nonTaxableDistributions > 0).map(([id, label, monthly]) => (
                      <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-xs ${iraContinuance === id ? 'border-indigo-400 bg-white ring-2 ring-indigo-200' : 'border-slate-200 bg-white/70'}`}>
                        <input
                          type="radio"
                          name="ira-continuance"
                          value={id}
                          checked={iraContinuance === id}
                          onChange={() => setIraContinuance(id)}
                        />
                        <span className="flex-1 font-semibold text-slate-700">{label}</span>
                        <span className="font-mono font-black text-slate-900">{usd(monthly)}/mo</span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-right text-xs font-black text-slate-900">
                    Qualifying IRA income {usd(retirement.ira.qualifyingMonthly)}/mo
                  </p>
                </div>
              ) : null}

              <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-xs">
                <div className="flex justify-between"><span className="font-semibold text-indigo-800">CX.FREEFLOW.SOCIAL.SECURITY</span><span className="font-mono font-black text-indigo-900">{usd(retirement.socialSecurityMonthly)}/mo</span></div>
                <div className="mt-1 flex justify-between"><span className="font-semibold text-indigo-800">CX.FREEFLOW.RETIREMENT (pension + IRA)</span><span className="font-mono font-black text-indigo-900">{usd(retirement.retirementIncomeMonthly)}/mo</span></div>
              </div>
            </div>
          )}

          {/* ==================== TAB: RENTAL INCOME (SCHEDULE E PAGE 1) ==================== */}
          {activeTab === 'SCHEDULE_E' && (
            <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Home className="h-5 w-5 text-indigo-600" />
                    Rental Income · Schedule E Page 1
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-[10px] font-black uppercase text-indigo-700">
                    {borrowerMetadata.loanProgram}
                  </span>
                  {/* 1 / 2 year toggle */}
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setTwoYearRental(false)}
                      className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${!twoYearRental ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                    >
                      1 year
                    </button>
                    <button
                      type="button"
                      onClick={() => setTwoYearRental(true)}
                      className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${twoYearRental ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                    >
                      2 years
                    </button>
                  </div>
                </div>
              </div>

              {/* Per-property entries */}
              <div className="space-y-4">
                {rentalProperties.map((prop, propIdx) => {
                  const result = rentalFlow.properties.find((r) => r.id === prop.id);
                  const disqualified = result ? result.grossMonthly === 0 && result.isDecline : false;
                  const declining = result ? result.isDecline : false;

                  return (
                    <div
                      key={prop.id}
                      className={`rounded-xl border p-4 space-y-4 ${
                        disqualified
                          ? 'border-rose-300 bg-rose-50/40'
                          : declining
                            ? 'border-amber-300 bg-amber-50/40'
                            : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      {/* Property header row */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600">
                          Property {propIdx + 1}
                        </span>
                        {multipleBorrowers && prop.ownerId ? (
                          <span className="rounded bg-indigo-100 px-2 py-0.5 text-[9px] font-black uppercase text-indigo-700">
                            {borrowerName(prop.ownerId)}
                          </span>
                        ) : null}
                        {prop.year1.source && rentalProperties.some(
                          (other) =>
                            other.id !== prop.id &&
                            Boolean(other.year1.source) &&
                            other.year1.year === prop.year1.year &&
                            other.address.trim().toLowerCase() === prop.address.trim().toLowerCase() &&
                            other.ownerId === prop.ownerId,
                        ) ? (
                          <span
                            className="rounded bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800"
                            title="Another Schedule E reports this address for the same tax year. Assign each return to its borrower, or remove a duplicate."
                          >
                            Separate {prop.year1.year || ''} return
                          </span>
                        ) : null}
                        {/* Address */}
                        <input
                          type="text"
                          value={prop.address}
                          placeholder="Property address"
                          onFocus={() => {
                            const src = prop.year1.source;
                            if (!src) return;
                            handleInspectField(
                              scheduleEGridFieldId(scheduleEExtracts, src.pageIndex, src.column, 'ent2-address'),
                              src.documentId,
                            );
                          }}
                          onChange={(e) => patchRentalProperty(prop.id, { address: e.target.value })}
                          className="flex-1 min-w-[200px] rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                        />
                        {/* Type selector */}
                        <select
                          value={prop.propertyType}
                          onChange={(e) => patchRentalProperty(prop.id, { propertyType: e.target.value as RentalProperty['propertyType'] })}
                          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-500"
                        >
                          {Object.entries(PROPERTY_TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                        {/* Subject property toggle */}
                        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600 cursor-pointer">
                          <button
                            type="button"
                            onClick={() => patchRentalProperty(prop.id, { isSubjectProperty: !prop.isSubjectProperty })}
                          >
                            {prop.isSubjectProperty
                              ? <CheckSquare className="h-4 w-4 text-indigo-600" />
                              : <Square className="h-4 w-4 text-slate-300" />}
                          </button>
                          Subject Property
                        </label>
                        {prop.isSubjectProperty && (
                          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">
                            Subject
                          </span>
                        )}
                        {/* Remove button */}
                        {rentalProperties.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRentalProperty(prop.id)}
                            className="ml-auto rounded-md p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Subject property method controls */}
                      {prop.isSubjectProperty && (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
                          <span className="font-mono text-[10px] font-black uppercase text-indigo-700 w-[4.5rem] shrink-0">Method</span>
                          <div className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-1.5 py-1">
                            <button
                              type="button"
                              onClick={() => patchRentalProperty(prop.id, { subjectMethod: 'SCHEDULE_E' })}
                              className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${prop.subjectMethod === 'SCHEDULE_E' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                            >
                              Schedule E history
                            </button>
                            <button
                              type="button"
                              onClick={() => patchRentalProperty(prop.id, { subjectMethod: 'MARKET_RENT' })}
                              className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${prop.subjectMethod === 'MARKET_RENT' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
                            >
                              Market rent × 75%
                            </button>
                          </div>
                          {prop.subjectMethod === 'MARKET_RENT' && (
                            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600">
                              Gross market rent (1007/1025)
                              <input
                                type="number"
                                value={prop.marketRent}
                                onChange={(e) => patchRentalProperty(prop.id, { marketRent: Number(e.target.value) })}
                                className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                              />
                            </label>
                          )}
                          <label className="ml-auto flex items-center gap-1 text-[10px] font-bold text-slate-600 cursor-pointer">
                            <button
                              type="button"
                              onClick={() => patchRentalProperty(prop.id, { isPrimary2To4: !prop.isPrimary2To4 })}
                            >
                              {prop.isPrimary2To4
                                ? <CheckSquare className="h-4 w-4 text-indigo-600" />
                                : <Square className="h-4 w-4 text-slate-300" />}
                            </button>
                            2–4 unit primary (borrower occupies)
                          </label>
                        </div>
                      )}

                      {/* PITIA box — from Encompass loan details when available, else UW-entered */}
                      <div className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 ${
                        prop.pitia === null ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
                      }`}>
                        <span className="font-mono text-[10px] font-black uppercase text-slate-500 w-[4.5rem] shrink-0">PITIA</span>
                        <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800">
                          {prop.isSubjectProperty ? 'Proposed PITIA (subject loan)' : 'Monthly housing expense'}
                        </span>
                        {prop.pitiaSource === 'ENCOMPASS' ? (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-black uppercase text-indigo-700">
                            From Encompass
                          </span>
                        ) : prop.pitiaSource === 'UW' ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600">
                            UW entered
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                            Not in Encompass — UW entry required
                          </span>
                        )}
                        <input
                          type="number"
                          value={prop.pitia ?? ''}
                          placeholder="—"
                          onChange={(e) => setRentalPitia(prop.id, e.target.value)}
                          className={`w-28 shrink-0 rounded-md border px-2 py-1.5 text-right font-mono text-sm font-bold outline-none focus:border-indigo-500 ${
                            prop.pitia === null ? 'border-amber-400 bg-white text-amber-900' : 'border-slate-300 bg-white text-slate-950'
                          }`}
                        />
                      </div>

                      {/* Year columns (informational only when subject uses market rent) */}
                      {prop.isSubjectProperty && prop.subjectMethod === 'MARKET_RENT' && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
                          Schedule E history below is informational — qualifying uses 75% of market rent
                        </p>
                      )}
                      <div className={`grid gap-4 ${twoYearRental ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-1 max-w-sm'} ${
                        prop.isSubjectProperty && prop.subjectMethod === 'MARKET_RENT' ? 'opacity-50' : ''
                      }`}>
                        {(['year1', ...(twoYearRental ? ['year2'] : [])] as ('year1' | 'year2')[]).map((yk) => {
                          const y = prop[yk];
                          const cf = rentalAnnualCashFlow(y);
                          const isY1 = yk === 'year1';
                          return (
                            <div key={yk} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between mb-1">
                                <h5 className="text-[10px] font-black uppercase text-slate-700 tracking-wider">
                                  {isY1 ? 'Most Recent Year' : 'Prior Year'}
                                </h5>
                                {/* Year input */}
                                <input
                                  type="number"
                                  value={y.year}
                                  onChange={(e) => patchRentalYear(prop.id, yk, { year: Number(e.target.value) })}
                                  className="w-20 rounded border border-slate-200 px-2 py-1 text-right font-mono text-xs font-bold focus:outline-none focus:border-indigo-500"
                                />
                              </div>

                              {/* Line fields — full Form 1084 Schedule E line set */}
                              {[
                                { line: 'Line 3', label: 'Rents received', key: 'rentsReceived' as const },
                                { line: 'Line 9', label: 'Insurance', key: 'insurance' as const },
                                { line: 'Line 12', label: 'Mortgage interest', key: 'mortgageInterest' as const },
                                { line: 'Line 16', label: 'Taxes', key: 'taxes' as const },
                                { line: 'Line 18', label: 'Depreciation', key: 'depreciation' as const },
                                { line: 'Line 19', label: 'HOA dues', key: 'hoaDues' as const },
                                { line: 'Line 20', label: 'Total expenses', key: 'totalExpenses' as const },
                                { line: 'Line 2', label: 'Fair rental days', key: 'fairRentalDays' as const },
                              ].map(({ line, label, key }) => (
                                <div
                                  key={key}
                                  data-qa-field={y.source ? scheduleEGridFieldId(scheduleEExtracts, y.source.pageIndex, y.source.column, RENTAL_YEAR_KEY_TO_SOURCE[key]) : undefined}
                                  className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 ${
                                    y.source &&
                                    highlightFieldId ===
                                      scheduleEGridFieldId(scheduleEExtracts, y.source.pageIndex, y.source.column, RENTAL_YEAR_KEY_TO_SOURCE[key])
                                      ? 'border-emerald-300 bg-emerald-50'
                                      : 'border-slate-100 bg-slate-50'
                                  }`}
                                  onClick={(event) => {
                                    if (!y.source) return;
                                    const sourceId = RENTAL_YEAR_KEY_TO_SOURCE[key];
                                    handleInspectField(
                                      scheduleEGridFieldId(scheduleEExtracts, y.source.pageIndex, y.source.column, sourceId),
                                      y.source.documentId,
                                      event.currentTarget,
                                    );
                                  }}
                                >
                                  <span className="w-[4.5rem] shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">{line}</span>
                                  <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800 truncate">
                                    {label}
                                  </span>
                                  <input
                                    type="number"
                                    value={y[key]}
                                    onChange={(e) => patchRentalYear(prop.id, yk, { [key]: Number(e.target.value) })}
                                    className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                                  />
                                </div>
                              ))}

                              {y.expenseDetermination?.daysStatus && (
                                <p
                                  className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${
                                    y.expenseDetermination.daysStatus === 'missing'
                                      ? 'border border-amber-200 bg-amber-50 text-amber-900'
                                      : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                                  }`}
                                >
                                  {y.expenseDetermination.daysStatus === 'missing'
                                    ? 'Line 2 blank · 12 months'
                                    : y.expenseDetermination.daysStatus === 'full-year'
                                      ? `Line 2 · ${y.expenseDetermination.fairRentalDays} days · 12 months`
                                      : `Line 2 · ${y.expenseDetermination.fairRentalDays} days · ${y.expenseDetermination.rentalMonths} months`}
                                </p>
                              )}
                              {y.expenseDetermination && y.expenseDetermination.status !== 'incomplete' && (
                                <p
                                  className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${
                                    y.expenseDetermination.status === 'confirmed'
                                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                                      : y.expenseDetermination.status === 'reconstructed'
                                        ? 'border border-indigo-200 bg-indigo-50 text-indigo-800'
                                        : 'border border-amber-200 bg-amber-50 text-amber-900'
                                  }`}
                                >
                                  {y.expenseDetermination.status === 'confirmed' && (
                                    y.expenseDetermination.recheckValidated
                                      ? `Form re-read L${y.expenseDetermination.recheckedLine} · ${y.expenseDetermination.recheckedFrom?.toLocaleString('en-US')} → ${y.expenseDetermination.recheckedTo?.toLocaleString('en-US')}`
                                      : 'Parse confirmed'
                                  )}
                                  {y.expenseDetermination.status === 'reconstructed' && 'Line 20 filled from itemized'}
                                  {y.expenseDetermination.status === 'mismatch' && 'Line 20 kept · itemized differs'}
                                </p>
                              )}

                              <div
                                className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 ${
                                  y.source &&
                                  highlightFieldId ===
                                    scheduleEGridFieldId(scheduleEExtracts, y.source.pageIndex, y.source.column, 'ent2-net')
                                    ? 'border-indigo-300 bg-indigo-50'
                                    : 'border-indigo-100 bg-indigo-50/50'
                                }`}
                                onClick={(event) => {
                                  if (!y.source) return;
                                  handleInspectField(
                                    scheduleEGridFieldId(scheduleEExtracts, y.source.pageIndex, y.source.column, 'ent2-net'),
                                    y.source.documentId,
                                    event.currentTarget,
                                  );
                                }}
                              >
                                <span className="w-[4.5rem] shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">Line 21</span>
                                <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800 truncate">
                                  Net income / (loss)
                                </span>
                                <input
                                  type="number"
                                  value={y.netIncomeLoss ?? ''}
                                  placeholder="—"
                                  onChange={(e) =>
                                    patchRentalYear(prop.id, yk, {
                                      netIncomeLoss: e.target.value.trim() === '' ? null : Number(e.target.value),
                                    })
                                  }
                                  className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                                />
                              </div>
                              <div className="flex items-center gap-2 rounded border border-amber-100 bg-amber-50/60 px-2.5 py-2">
                                <span className="w-[4.5rem] shrink-0 font-mono text-[10px] font-black uppercase text-amber-700">UW</span>
                                <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800 truncate">
                                  Extraordinary / other add-back
                                </span>
                                <input
                                  type="number"
                                  value={y.extraordinaryAddBack}
                                  onChange={(e) => patchRentalYear(prop.id, yk, { extraordinaryAddBack: Number(e.target.value) })}
                                  className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                                />
                              </div>

                              {/* Annual 1038 adjusted cash flow summary */}
                              <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs space-y-1">
                                <div className="flex items-center justify-between text-[10px] text-slate-400">
                                  <span>Add-backs</span>
                                  <span className="font-mono font-bold text-slate-500">
                                    +{cf.addBacks.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 font-semibold">
                                    1038 adjusted annual cash flow
                                    {y.fairRentalDays > 0 && <span className="ml-1 text-slate-400">({cf.months} rental months)</span>}
                                  </span>
                                  <span className={`font-black font-mono ${cf.adjusted < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                                    {cf.adjusted.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Per-property result: 1084 gross − PITIA = net */}
                      {result && (
                        <div className={`rounded-lg px-3 py-2 text-xs border space-y-1.5 ${
                          disqualified
                            ? 'bg-rose-100 border-rose-300 text-rose-800'
                            : result.netMonthly < 0 && !result.pitiaMissing
                              ? 'bg-rose-50 border-rose-200 text-rose-800'
                              : declining || result.pitiaMissing
                                ? 'bg-amber-50 border-amber-300 text-amber-800'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        }`}>
                          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-mono">
                            <span>
                              {result.isSubjectProperty && result.subjectMethod === 'MARKET_RENT' ? '75% market rent' : '1084 monthly'}&nbsp;
                              <span className="font-black">{result.grossMonthly.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
                            </span>
                            <span>
                              − PITIA&nbsp;
                              <span className="font-black">
                                {result.pitiaMissing ? '(pending)' : result.pitiaApplied.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                              </span>
                            </span>
                            <span className="font-black text-sm">
                              = Net {result.netMonthly.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo
                            </span>
                          </div>
                          <p className="font-semibold">{result.note}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add property button */}
              <button
                type="button"
                onClick={addRentalProperty}
                className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition w-full justify-center"
              >
                <PlusCircle className="h-4 w-4" />
                Add Rental Property
              </button>

              {/* Aggregate choice panel */}
              <IncomeChoicePanel
                options={rentalPicks.options}
                recommendedId={rentalPicks.recommendedId}
                reason={rentalPicks.reason}
                selectedId={rentalChoice}
                onSelect={setRentalChoice}
              />

              {/* DTI routing summary for the chosen option */}
              {(() => {
                const routing = rentalPicks.routingByOption[rentalChosen.id] ?? rentalFlow.routing;
                if (routing.liabilityDebtMonthly <= 0 && routing.housingExpenseAdjustment <= 0) return null;
                return (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {routing.liabilityDebtMonthly > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs">
                        <span className="font-bold text-rose-900">
                          Proposed monthly liability (1003)
                          <span className="block font-normal text-rose-700">Net rental losses redirected to DTI debts</span>
                        </span>
                        <span className="font-black font-mono text-base text-rose-800">
                          {routing.liabilityDebtMonthly.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo
                        </span>
                      </div>
                    )}
                    {routing.housingExpenseAdjustment > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs">
                        <span className="font-bold text-amber-900">
                          Primary housing expense adjustment
                          <span className="block font-normal text-amber-700">Subject 2–4 unit primary deficit</span>
                        </span>
                        <span className="font-black font-mono text-base text-amber-800">
                          {routing.housingExpenseAdjustment.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          )}

          {/* ==================== TAB 4: ENCOMPASS SYNC INTERFACE ==================== */}
          {activeTab === 'ENCOMPASS_SYNC' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                  <Lock className="h-5 w-5 text-indigo-600" />
                  Final reconciliation
                </h3>
                <p className="text-xs text-slate-500 mt-1">Every income selection on this file. Review them here, then sync.</p>
              </div>

              <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 108</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">W-2 base · {w2BaseChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.w2BaseMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 109</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">W-2 variable · {w2VarChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.w2VariableMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 110</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Schedule C · {schCChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.qualifyingMonthlySelfEmployed)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 111</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">S-Corp · {sCorpChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.sCorpShareholderDraw)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Form 1120</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">C-Corp · {cCorpChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.cCorpMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 112</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Partnership · {partnershipChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.partnershipMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Schedule F</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Farm income · {scheduleFChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.scheduleFMonthly)}/mo</span>
                </div>
                <div className={`rounded-lg border p-4 ${assetIncomeIncluded ? 'border-amber-300 bg-amber-50' : 'bg-slate-50'}`}>
                  <span className="text-[10px] font-black uppercase text-slate-400">Asset income</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Interest / dividends / gains · {assetIncomeChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.assetIncomeMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <span className="text-[10px] font-black uppercase text-slate-400">Social Security</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Form 1040 Line 6a/6b · grossed up</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.socialSecurityMonthly)}/mo</span>
                </div>
                <div className={`rounded-lg border p-4 ${retirement.ira && !retirement.ira.confirmed ? 'border-amber-300 bg-amber-50' : 'bg-slate-50'}`}>
                  <span className="text-[10px] font-black uppercase text-slate-400">Retirement</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Pension + IRA · {retirement.ira ? (retirement.ira.confirmed ? 'IRA continuance confirmed' : 'IRA excluded pending continuance') : 'Line 5a/5b'}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.retirementIncomeMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4 ring-2 ring-indigo-200">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 113</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Rental Income · {rentalChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.rentalMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4 ring-2 ring-indigo-200">
                  <span className="text-[10px] font-black uppercase text-indigo-500">Total qualifying income</span>
                  <span className="mt-0.5 block text-[11px] text-indigo-700">{loanProgram} calculation</span>
                  <span className="mt-1 block text-xl font-black text-indigo-900">{usd(form1084CashFlow.finalTotalQualifyingMonthly)}/mo</span>
                </div>
              </div>

              {unassignedDocuments > 0 ? (
                <p data-testid="held-out-documents" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
                  {unassignedDocuments} document{unassignedDocuments === 1 ? '' : 's'} name{unassignedDocuments === 1 ? 's' : ''} someone not on the 1003 and{' '}
                  {unassignedDocuments === 1 ? 'is' : 'are'} left out of these totals and the export. Assign them to a borrower above to include them.
                </p>
              ) : null}

              {incomeByBorrower.length ? (
                <div data-testid="income-by-borrower" className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Borrower</th>
                        <th className="px-3 py-2 text-right">W-2 base</th>
                        <th className="px-3 py-2 text-right">W-2 variable</th>
                        <th className="px-3 py-2 text-right">Self-employed</th>
                        <th className="px-3 py-2 text-right">Qualifying</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {incomeByBorrower.map((row) => {
                        const borrower = borrowers[row.borrowerIndex];
                        return (
                          <tr key={borrower.id} data-testid="borrower-income-row">
                            <td className="px-3 py-2 font-bold text-slate-900">
                              {borrower.name}
                              <span className="ml-1.5 font-semibold text-slate-500">
                                {row.borrowerIndex === 0 ? 'Borrower' : 'Co-borrower'}
                                {row.borrowerIndex === 0 ? ' · incl. rental & asset income' : ''}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">{usd(row.w2BaseMonthly ?? 0)}</td>
                            <td className="px-3 py-2 text-right">{usd(row.w2VariableMonthly ?? 0)}</td>
                            <td className="px-3 py-2 text-right">{usd(row.selfEmployedMonthly ?? 0)}</td>
                            <td className="px-3 py-2 text-right font-black text-indigo-800">{usd(row.qualifyingMonthlyIncome)}/mo</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {encompassPayload ? (
                <details data-testid="encompass-preview" className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                  <summary className="cursor-pointer font-bold text-slate-800">
                    Encompass export · {encompassPayload.loan.applications.length} application
                    {encompassPayload.loan.applications.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {encompassPayload.loan.applications.flatMap((application, index) =>
                      application.employment.map((job, jobIndex) => {
                        const person = job.owner === 'CoBorrower' ? application.coborrower : application.borrower;
                        const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ');
                        return (
                          <li key={`${index}-${jobIndex}`} data-testid="encompass-employment-row" className="text-slate-700">
                            Application {index + 1} · {job.owner === 'CoBorrower' ? 'Co-borrower' : 'Borrower'} {name}:{' '}
                            <strong>{job.employerName || 'Employer'}</strong>
                            {job.currentEmploymentIndicator ? '' : ' (prior)'}
                            {job.monthlyIncomeAmount != null ? ` · ${usd(job.monthlyIncomeAmount)}/mo` : ''}
                          </li>
                        );
                      }),
                    )}
                  </ul>
                  <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-100">
                    {JSON.stringify({ applications: encompassPayload.loan.applications, fieldWriter: encompassPayload.fieldWriter.fields }, null, 2)}
                  </pre>
                </details>
              ) : null}

              <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 md:flex-row md:items-center">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{protectedContext ? 'Ready to submit this reviewed package?' : 'Sync these selections'}</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    {protectedContext
                      ? 'Submission validates borrower assignments and required fields before creating the official server calculation. Approval and delivery happen in the next step.'
                      : 'Writes the amounts above to the eFolder. Nothing syncs until you click here.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={protectedContext ? onOpenAuthoritativeWorkflow : handleExportSync}
                  className="flex items-center gap-2 self-end rounded-lg bg-emerald-500 px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-sm transition hover:bg-emerald-600"
                >
                  {protectedContext ? 'Continue to submission' : 'Sync'} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ==================== SYSTEM-WIDE EXCEPTIONS LOG (BOTTOM GRID) ==================== */}
          {visibleWarnings.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                <h3 className="font-extrabold text-rose-900 text-sm">Active Underwriting Compliance Warnings ({visibleWarnings.length})</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                {visibleWarnings.map((alert) => (
                  <div key={`${alert.id}:${alert.message}`} className="flex gap-2.5 bg-white p-3 rounded-lg border border-rose-100 text-xs shadow-sm">
                    <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase self-start ${
                      alert.type === 'ERROR' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {alert.type}
                    </span>
                    <p className="text-slate-700 leading-relaxed font-semibold">
                      <strong className="text-slate-900">{alert.id}:</strong> {alert.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

