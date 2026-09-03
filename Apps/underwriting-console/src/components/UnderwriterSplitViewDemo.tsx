import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  ArrowRight,
  CheckSquare,
  Square,
  ClipboardList,
  Layers,
  UserCheck,
  FileSpreadsheet,
  Eye,
  Activity,
  AlertCircle,
  Calendar,
  Link,
  Lock,
  Upload,
  Loader2,
  Home,
  PlusCircle,
  Trash2,
  Monitor,
  MonitorX,
} from 'lucide-react';
import type { LiveParseSession } from '../parseTypes';
import { mapIncomeFields } from '../incomeFieldMap';
import { SPLIT_DOC_CHANNEL, type DocPaneSnapshot, type SplitDocMessage } from '../splitDocSync';
import PdfPagePreview from './PdfPagePreview';
import { usePdfViewer } from '../hooks/usePdfViewer';
import {
  CorpLines,
  DemoDocumentCanvas,
  IncomeChoicePanel,
  InspectNote,
  LiquidityBlock,
  SchCLines,
  SelfEmployedPanel,
  YearStack,
  chosenMonthly,
  corpBusinessAnnual,
  corpMinorityAnnual,
  monthlyFromYears,
  schCAnnual,
  scheduleLQuickRatio,
  seAvgOptions,
  seRecommend,
  usd,
  type CorpYear,
  type SchCYear,
  type ScheduleL,
} from './selfEmployedIncome';

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
  box1Wages: number;
  box12Bonus: number;
  box14Overtime: number;
}

type SplitViewSource = 'demo' | 'live';

type IncomeTab =
  | 'PAYSTUB_RECONCILIATION'
  | 'W2_CONTINUITY'
  | 'SCHEDULE_C'
  | 'SCORP'
  | 'PARTNERSHIP'
  | 'SCHEDULE_E'
  | 'ENCOMPASS_SYNC';

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
  fairRentalDays: number;   // Line 2  – (0 = full year / 365)
}

interface RentalProperty {
  id: string;
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
 * Simulated Encompass loan-detail REO section: address → full monthly PITIA.
 * When loan details arrive from Encompass with a PITIA for the property, the box
 * is prefilled; otherwise it stays blank for the underwriter to complete.
 */
const ENCOMPASS_REO_PITIA: Record<string, number> = {
  '742 Evergreen Terrace, Springfield, IL': 1450,
};

/**
 * Simulated Encompass proposed-loan PITIA for the subject property. The subject
 * loan's proposed housing payment is always available from the loan file, so a
 * property flagged as Subject uses this figure (not the REO section).
 */
const ENCOMPASS_SUBJECT_PROPOSED_PITIA = 2350;

export default function UnderwriterSplitViewDemo({
  liveSession = null,
  source = 'demo',
  parseBusy = false,
  parseError = null,
  onParseFile,
  onUseDemo,
  onUseLive,
}: {
  liveSession?: LiveParseSession | null;
  source?: SplitViewSource;
  parseBusy?: boolean;
  parseError?: string | null;
  onParseFile?: (file: File) => void;
  onUseDemo?: () => void;
  onUseLive?: () => void;
} = {}) {
  const isLive = source === 'live' && liveSession !== null;
  const viewer = usePdfViewer(2);
  const [livePageIndex, setLivePageIndex] = useState(0);
  const activePdfPage = viewer.currentPage;
  const setActivePdfPage = viewer.setPage;
  const mappedFields = useMemo(
    () => (liveSession ? mapIncomeFields(liveSession.result) : []),
    [liveSession?.result.transaction_id],
  );

  // 1. Navigation & View States
  const [activeTab, setActiveTab] = useState<IncomeTab>('PAYSTUB_RECONCILIATION');
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null);

  const availableTabs = useMemo(() => {
    const allTabs = [
      ['PAYSTUB_RECONCILIATION', 'Base Income', ClipboardList],
      ['W2_CONTINUITY', 'W-2 variable', Calendar],
      ['SCHEDULE_C', 'Schedule C', FileSpreadsheet],
      ['SCORP', 'S-Corp 1120-S', FileSpreadsheet],
      ['PARTNERSHIP', 'Partnership 1065', FileSpreadsheet],
      ['SCHEDULE_E', 'Rental Income', Home],
      ['ENCOMPASS_SYNC', 'Encompass', Lock],
    ] as const;

    if (!isLive) return allTabs; // Demo mode shows all tabs

    const forms = new Set(mappedFields.map((f) => f.form));
    return allTabs.filter(([id]) => {
      if (id === 'ENCOMPASS_SYNC') return true;
      if (id === 'PAYSTUB_RECONCILIATION' || id === 'W2_CONTINUITY') return forms.has('W-2');
      if (id === 'SCHEDULE_C') return forms.has('Schedule C');
      if (id === 'SCORP') return forms.has('Form 1120-S');
      if (id === 'PARTNERSHIP') return forms.has('Form 1065');
      if (id === 'SCHEDULE_E') return forms.has('Schedule E');
      return false;
    });
  }, [isLive, mappedFields]);

  // Ensure active tab is valid
  React.useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.find(([id]) => id === activeTab)) {
      setActiveTab(availableTabs[0][0]);
    }
  }, [availableTabs, activeTab]);

  const [canvasYearIndex, setCanvasYearIndex] = useState<0 | 1>(0);
  const [twoYearSchC, setTwoYearSchC] = useState(true);
  const [twoYearScorp, setTwoYearScorp] = useState(true);
  const [twoYearPartnership, setTwoYearPartnership] = useState(true);
  const [twoYearRental, setTwoYearRental] = useState(true);
  const [rentalChoice, setRentalChoice] = useState<string | null>(null);

  const [rentalProperties, setRentalProperties] = useState<RentalProperty[]>(() => {
    const props: Array<Omit<RentalProperty, 'pitia' | 'pitiaSource'>> = [
      {
        id: 'prop-1',
        address: '742 Evergreen Terrace, Springfield, IL',
        propertyType: 'SFR',
        isSubjectProperty: false,
        subjectMethod: 'SCHEDULE_E',
        marketRent: 0,
        isPrimary2To4: false,
        year1: { year: 2025, rentsReceived: 24000, insurance: 1200, mortgageInterest: 4800, taxes: 2900, depreciation: 3500, hoaDues: 0, totalExpenses: 14500, fairRentalDays: 0 },
        year2: { year: 2024, rentsReceived: 22800, insurance: 1150, mortgageInterest: 4900, taxes: 2800, depreciation: 3500, hoaDues: 0, totalExpenses: 14200, fairRentalDays: 0 },
      },
      {
        id: 'prop-2',
        address: '1600 Pennsylvania Ave NW, Unit 4B, Washington, DC',
        propertyType: 'DUPLEX',
        isSubjectProperty: false,
        subjectMethod: 'SCHEDULE_E',
        marketRent: 3200,
        isPrimary2To4: false,
        year1: { year: 2025, rentsReceived: 36000, insurance: 1800, mortgageInterest: 7200, taxes: 4300, depreciation: 5200, hoaDues: 2400, totalExpenses: 22700, fairRentalDays: 0 },
        year2: { year: 2024, rentsReceived: 34000, insurance: 1750, mortgageInterest: 7400, taxes: 4200, depreciation: 5200, hoaDues: 2400, totalExpenses: 22100, fairRentalDays: 0 },
      },
    ];
    // Prefill PITIA from Encompass loan details when the REO section has the property
    return props.map((p) => {
      const encompassPitia = ENCOMPASS_REO_PITIA[p.address];
      return {
        ...p,
        pitia: encompassPitia ?? null,
        pitiaSource: encompassPitia !== undefined ? ('ENCOMPASS' as const) : null,
      };
    });
  });

  const [w2BaseChoice, setW2BaseChoice] = useState<string | null>(null);
  const [w2VarChoice, setW2VarChoice] = useState<string | null>(null);
  const [schCChoice, setSchCChoice] = useState<string | null>(null);
  const [sCorpChoice, setSCorpChoice] = useState<string | null>(null);
  const [partnershipChoice, setPartnershipChoice] = useState<string | null>(null);

  // 2. Variable Continuity & Job Transition States
  const [mergePreviousEmployerVariable, setMergePreviousEmployerVariable] = useState<boolean>(true);
  const [monthsAtCurrentJob, setMonthsAtCurrentJob] = useState<number>(8); // August 15 paystub represents 8 elapsed months
  const [monthsAtPreviousJob, setMonthsAtPreviousJob] = useState<number>(16); // Remainder of the 24-month verification window

  // Previous Job Variable History
  const [prevEmployerW2, setPrevEmployerW2] = useState<PrevEmployerW2>({
    employerName: 'Digital Solutions Corp',
    ein: '94-87654321',
    year: 2025,
    box1Wages: 78500,
    box12Bonus: 18000,     // Previous bonus history
    box14Overtime: 6000     // Previous overtime history
  });

  // Current paystub raw values inside mock state
  const [currentHourlyRate, setCurrentHourlyRate] = useState<number>(45.00);
  const [currentWeeklyHours, setCurrentWeeklyHours] = useState<number>(40);
  const [currentPeriodBasePay, setCurrentPeriodBasePay] = useState<number>(3600.00); // Semi-monthly gross base
  const [currentBaseYtd, setCurrentBaseYtd] = useState<number>(54000.00); // 8 months elapsed (Wage deficit trigger!)
  const [currentBonusYtd, setCurrentBonusYtd] = useState<number>(12500.00);
  const [currentOtYtd, setCurrentOtYtd] = useState<number>(4200.00);
  const [currentOtherYtd, setCurrentOtherYtd] = useState<number>(0.00);

  const [schCYears, setSchCYears] = useState<[SchCYear, SchCYear]>([
    { year: 2025, line31: 115000, line13: 8500, line30: 2400, line44aMiles: 4500, line24bMeals: 1800 },
    { year: 2024, line31: 98000, line13: 7200, line30: 2100, line44aMiles: 3800, line24bMeals: 1500 },
  ]);
  const [sCorpYears, setSCorpYears] = useState<[CorpYear, CorpYear]>([
    { year: 2025, ordinaryIncome: 142000, netRentalRealEstate: 12000, otherNetRental: 0, depreciation: 18500, depletion: 0, mealsM1: 2200, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 48000, distributions: 62000 },
    { year: 2024, ordinaryIncome: 128000, netRentalRealEstate: 9500, otherNetRental: 0, depreciation: 16200, depletion: 0, mealsM1: 1900, guaranteedPayments: 0, otherNoncash: 0, w2Wages: 45000, distributions: 55000 },
  ]);
  const [partnershipYears, setPartnershipYears] = useState<[CorpYear, CorpYear]>([
    { year: 2025, ordinaryIncome: 96000, netRentalRealEstate: 18000, otherNetRental: 2400, depreciation: 12000, depletion: 0, mealsM1: 800, guaranteedPayments: 24000, otherNoncash: 1500, w2Wages: 0, distributions: 48000 },
    { year: 2024, ordinaryIncome: 88000, netRentalRealEstate: 16500, otherNetRental: 2200, depreciation: 11000, depletion: 0, mealsM1: 700, guaranteedPayments: 24000, otherNoncash: 1200, w2Wages: 0, distributions: 45000 },
  ]);
  /** GSE investor drives which K-1 Item J ending percentage qualifies: FNMA = % capital, Freddie Mac = % profit */
  const [gseInvestor, setGseInvestor] = useState<'FNMA' | 'FREDDIE'>('FNMA');
  /** S-Corp K-1: single end-of-year stock ownership percentage */
  const [sCorpShareholderPct, setSCorpShareholderPct] = useState<number>(35);
  /** Partnership K-1 Item J END-of-year percentages (beginning % is never used to qualify) */
  const [partnershipProfitPctEnd, setPartnershipProfitPctEnd] = useState<number>(50);
  const [partnershipCapitalPctEnd, setPartnershipCapitalPctEnd] = useState<number>(50);
  const partnershipPct = gseInvestor === 'FREDDIE' ? partnershipProfitPctEnd : partnershipCapitalPctEnd;
  const [sCorpL, setSCorpL] = useState<ScheduleL>({
    cash: 125000,
    receivables: 25000,
    allowance: 2500,
    taxExempt: 5000,
    otherCurrentAssets: 15000,
    accountsPayable: 60000,
    notesLt1Yr: 30000,
    otherCurrentLiab: 10000,
  });
  const [partnershipL, setPartnershipL] = useState<ScheduleL>({
    cash: 210000,
    receivables: 18000,
    allowance: 0,
    taxExempt: 0,
    otherCurrentAssets: 8000,
    accountsPayable: 42000,
    notesLt1Yr: 15000,
    otherCurrentLiab: 6000,
  });

  // Borrower Core Metadata Reference
  const borrowerMetadata = {
    loanId: 'LN-2026-88042',
    borrowerName: 'Sarah K. Vance',
    currentEmployer: 'Apex Technology Partners LLC',
    employmentStartDate: '2025-12-15', // Less than 12 months at current job!
    loanProgram: 'CONVENTIONAL',
  };

  // 4. Dynamic Spatial Fields Definitions (For Interactive Highlights)
  const fieldCoordinatesMapping = useMemo<OCRField[]>(() => [
    // Paystub Metadata Fields (Page 1)
    { id: 'ps-emp-name', category: 'METADATA', label: 'Employer Name', value: borrowerMetadata.currentEmployer, numericValue: 0, isDiscrepancy: false, boxCoordinates: { x: 10, y: 5, width: 40, height: 3, page: 1 } },
    { id: 'ps-ee-name', category: 'METADATA', label: 'Employee Name', value: borrowerMetadata.borrowerName, numericValue: 0, isDiscrepancy: false, boxCoordinates: { x: 50, y: 5, width: 40, height: 3, page: 1 } },
    { id: 'ps-period', category: 'METADATA', label: 'Pay Period', value: '2026-08-01 to 2026-08-15', numericValue: 0, isDiscrepancy: false, boxCoordinates: { x: 10, y: 12, width: 40, height: 3, page: 1 } },
    { id: 'ps-frequency', category: 'METADATA', label: 'Pay Frequency', value: 'Semi-Monthly (24 Pays/Yr)', numericValue: 24, isDiscrepancy: false, boxCoordinates: { x: 10, y: 15, width: 40, height: 3, page: 1 } },
    
    // Earnings Statement Fields (Page 1)
    { id: 'ps-hourly-rate', category: 'EARNINGS', label: 'Hourly Pay Rate', value: `$${currentHourlyRate.toFixed(2)}/hr`, numericValue: currentHourlyRate, isDiscrepancy: false, boxCoordinates: { x: 10, y: 22, width: 40, height: 3, page: 1 } },
    { id: 'ps-hours-week', category: 'EARNINGS', label: 'Standard Weekly Hours', value: `${currentWeeklyHours} hrs`, numericValue: currentWeeklyHours, isDiscrepancy: false, boxCoordinates: { x: 50, y: 22, width: 40, height: 3, page: 1 } },
    { id: 'ps-current-base', category: 'EARNINGS', label: 'Current Period Base Pay', value: `$${currentPeriodBasePay.toLocaleString()}`, numericValue: currentPeriodBasePay, isDiscrepancy: false, boxCoordinates: { x: 10, y: 25, width: 40, height: 3, page: 1 } },
    { id: 'ps-base-ytd', category: 'EARNINGS', label: 'Base Wages YTD', value: `$${currentBaseYtd.toLocaleString()}`, numericValue: currentBaseYtd, isDiscrepancy: true, boxCoordinates: { x: 10, y: 28, width: 40, height: 3, page: 1 } },
    { id: 'ps-bonus-ytd', category: 'EARNINGS', label: 'Bonus Income YTD', value: `$${currentBonusYtd.toLocaleString()}`, numericValue: currentBonusYtd, isDiscrepancy: false, boxCoordinates: { x: 50, y: 28, width: 40, height: 3, page: 1 } },
    { id: 'ps-ot-ytd', category: 'EARNINGS', label: 'Overtime Income YTD', value: `$${currentOtYtd.toLocaleString()}`, numericValue: currentOtYtd, isDiscrepancy: false, boxCoordinates: { x: 10, y: 31, width: 40, height: 3, page: 1 } },
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
  const baseWageReconciliation = useMemo(() => {
    const hourlyMethod = (currentHourlyRate * currentWeeklyHours * 52) / 12; // Standard Hourly Pay Rate Method
    const periodAnnualizedMethod = (currentPeriodBasePay * 24) / 12; // Semi-monthly Pay Period Annualized Method
    const ytdAverageMethod = currentBaseYtd / 7.5; // August 15 represents 7.5 elapsed months of the year
    const priorYearW2Average = prevEmployerW2.box1Wages / 12; // Dynamic previous year W-2 base

    return {
      hourlyMethod,
      periodAnnualizedMethod,
      ytdAverageMethod,
      priorYearW2Average,
      maxVariancePct: Math.abs(((hourlyMethod - ytdAverageMethod) / hourlyMethod) * 100)
    };
  }, [currentHourlyRate, currentWeeklyHours, currentPeriodBasePay, currentBaseYtd, prevEmployerW2.box1Wages]);

  // B. Variable Income Rolling & Continuity (Job Transition Adapter) [cite: 177]
  const variableContinuityCalculations = useMemo(() => {
    // Current Job Bonus + Overtime YTD [cite: 177]
    const currentBonusOtTotal = currentBonusYtd + currentOtYtd;
    const currentMonthlyVariableAvg = currentBonusOtTotal / monthsAtCurrentJob;

    // Previous Job W-2 Bonus + Overtime [cite: 177]
    const previousBonusOtTotal = prevEmployerW2.box12Bonus + prevEmployerW2.box14Overtime;
    const previousMonthlyVariableAvg = previousBonusOtTotal / 12; // Standard 12-month average for complete prior tax year

    // 24-Month Weighted Rolling Variable Average [cite: 177]
    const aggregatedVariableTotal = mergePreviousEmployerVariable
      ? currentBonusOtTotal + previousBonusOtTotal
      : currentBonusOtTotal;

    const totalRollingMonths = mergePreviousEmployerVariable
      ? monthsAtCurrentJob + 12 // Current months + complete prior W-2 year
      : monthsAtCurrentJob;

    const qualifyingRollingVariableAvg = aggregatedVariableTotal / totalRollingMonths;

    return {
      currentMonthlyVariableAvg,
      previousMonthlyVariableAvg,
      qualifyingRollingVariableAvg,
      aggregatedVariableTotal,
      totalRollingMonths
    };
  }, [currentBonusYtd, currentOtYtd, monthsAtCurrentJob, mergePreviousEmployerVariable, prevEmployerW2]);

  const schCFlow = useMemo(() => {
    const y1 = schCAnnual(schCYears[0]);
    const y2 = schCAnnual(schCYears[1]);
    return { y1, y2 };
  }, [schCYears]);

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
      };
    }

    const y1Biz = corpBusinessAnnual(sCorpYears[0], sCorpShareholderPct);
    const y2Biz = corpBusinessAnnual(sCorpYears[1], sCorpShareholderPct);
    return {
      y1: y1Biz + y1W2,
      y2: y2Biz + y2W2,
      w2Monthly,
      dropped: !sCorpLRatio.passes,
      isMinority: false,
      wasCapped: false,
    };
  }, [sCorpYears, sCorpShareholderPct, twoYearScorp, sCorpLRatio.passes]);

  const partnershipFlow = useMemo(() => {
    const isMinority = partnershipPct < 25;
    const gpMonthly = monthlyFromYears(
      partnershipYears[0].guaranteedPayments * (partnershipPct / 100),
      partnershipYears[1].guaranteedPayments * (partnershipPct / 100),
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
      };
    }

    const y1 = corpBusinessAnnual(partnershipYears[0], partnershipPct);
    const y2 = corpBusinessAnnual(partnershipYears[1], partnershipPct);
    return { y1, y2, gpMonthly, dropped: !partnershipLRatio.passes, isMinority: false, wasCapped: false };
  }, [partnershipYears, partnershipPct, twoYearPartnership, partnershipLRatio.passes]);

  // ── Rental Income (Schedule E Page 1 · Form 1084 / 1038 worksheet) ──────────

  /**
   * Full Form 1084 / 1038 adjusted annual rental cash flow for one year:
   *   Line 3 Rents − Line 20 Total Expenses
   *   + Line 9 Insurance + Line 12 Mortgage Interest + Line 16 Taxes
   *   + Line 18 Depreciation + Line 19 HOA Dues
   * divided by months in service (Line 2 fair rental days).
   */
  function rentalAnnualCashFlow(y: RentalPropertyYear) {
    const months = y.fairRentalDays > 0 ? Math.max(1, Math.min(12, Math.ceil(y.fairRentalDays / 30))) : 12;
    const addBacks = y.insurance + y.mortgageInterest + y.taxes + y.depreciation + y.hoaDues;
    const adjusted = y.rentsReceived - y.totalExpenses + addBacks;
    return { adjusted, addBacks, months, monthly: adjusted / months };
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

      let grossMonthly: number;
      let note: string;

      if (useMarketRent) {
        // Subject purchase / no Schedule E history: Form 1007/1025 gross market rent × 75%
        grossMonthly = prop.marketRent * 0.75;
        note = 'Subject property — 75% of gross market rent (Form 1007/1025, 25% vacancy factor).';
      } else if (!twoYearRental) {
        grossMonthly = y1Monthly;
        note = 'One-year: most recent year 1084 cash flow ÷ rental months.';
      } else if (!isDecline) {
        grossMonthly = (y1Monthly + y2Monthly) / 2;
        note = 'Two-year average: income stable or increasing.';
      } else if (isFha && prop.propertyType === 'FOURPLEX') {
        if (declinePct <= 5) {
          grossMonthly = (y1Monthly + y2Monthly) / 2;
          note = `FHA multi-family: decline ${declinePct.toFixed(1)}% ≤ 5% — 24-month average used.`;
        } else if (declinePct <= 20) {
          grossMonthly = y1Monthly;
          note = `FHA multi-family: decline ${declinePct.toFixed(1)}% (5–20%) — restricted to most recent year.`;
        } else {
          grossMonthly = 0;
          note = `FHA multi-family: decline ${declinePct.toFixed(1)}% > 20% — income disqualified per HUD 4000.1.`;
        }
      } else {
        grossMonthly = y1Monthly; // y1 is the lower year since isDecline === true
        note = `Income declined ${declinePct.toFixed(1)}% — restricted to most recent (lower) year per guideline.`;
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
      ? 'One or more properties experienced a critical decline (≥20%). Review the per-property breakdown for disqualified properties.'
      : rentalFlow.properties.some((p) => p.isDecline)
        ? 'Declining income detected on one or more properties. Guideline restricts to most recent year for those properties.'
        : twoYearRental
          ? 'Income is stable or increasing across all properties. 24-month average net of PITIA is the guideline pick.'
          : 'Single-year entry. Most recent year 1084 cash flow net of PITIA.';
    if (rentalFlow.properties.some((p) => p.isSubjectProperty)) {
      reason += ' Subject property routed separately: positive net adds to income; a deficit adjusts housing expense (2–4 unit primary) or maps to liabilities (investment).';
    }
    if (rentalFlow.anyPitiaMissing) {
      reason += ' PITIA is missing on at least one property — totals are before full housing expense until the UW completes the PITIA box.';
    }
    return { options, recommendedId: 'guideline', reason, routingByOption };
  }, [rentalFlow, rentalProperties, twoYearRental, borrowerMetadata.loanProgram]);

  const w2BasePicks = useMemo(() => {
    const options = [
      { id: 'hourly', label: 'Hourly rate', monthly: baseWageReconciliation.hourlyMethod, formula: '(Rate × hours × 52) / 12' },
      { id: 'period', label: 'Pay period annualized', monthly: baseWageReconciliation.periodAnnualizedMethod, formula: '(Period pay × 24) / 12' },
      { id: 'ytd', label: 'YTD average', monthly: baseWageReconciliation.ytdAverageMethod, formula: 'YTD base / 7.5 months elapsed' },
      { id: 'prior', label: 'Prior year W-2', monthly: baseWageReconciliation.priorYearW2Average, formula: '2025 W-2 Box 1 / 12' },
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
  }, [baseWageReconciliation]);

  const w2VarPicks = useMemo(() => {
    const current = variableContinuityCalculations.currentMonthlyVariableAvg;
    const merged = (currentBonusYtd + currentOtYtd + prevEmployerW2.box12Bonus + prevEmployerW2.box14Overtime) / (monthsAtCurrentJob + 12);
    const options = [
      { id: 'current', label: 'Current job only', monthly: current, formula: `(Bonus YTD + OT YTD) / ${monthsAtCurrentJob} months` },
      { id: 'avg24', label: '24-month merged', monthly: merged, formula: `(Current variable + prior W-2 bonus/OT) / ${monthsAtCurrentJob + 12} months` },
      { id: 'not_used', label: 'Not used', monthly: 0, formula: 'Underwriter elected to exclude' },
    ];
    if (monthsAtCurrentJob < 12) {
      return {
        options,
        recommendedId: 'avg24',
        reason: `Tenure at the current job is ${monthsAtCurrentJob} months. Guideline uses a 24-month average that includes prior-job bonus and overtime.`,
      };
    }
    return {
      options,
      recommendedId: 'current',
      reason: 'Twelve or more months at the current job. Guideline uses the current-job variable average unless the underwriter elects the 24-month merge.',
    };
  }, [variableContinuityCalculations.currentMonthlyVariableAvg, currentBonusYtd, currentOtYtd, prevEmployerW2.box12Bonus, prevEmployerW2.box14Overtime, monthsAtCurrentJob]);

  const schCPicks = useMemo(() => {
    const rec = seRecommend(schCFlow.y1, schCFlow.y2, twoYearSchC);
    return { options: seAvgOptions(schCFlow.y1, schCFlow.y2, twoYearSchC), recommendedId: rec.id, reason: rec.reason };
  }, [schCFlow, twoYearSchC]);

  const sCorpPicks = useMemo(() => {
    const rec = seRecommend(sCorpFlow.y1, sCorpFlow.y2, twoYearScorp, sCorpFlow.dropped);
    let reason = rec.reason;
    if (sCorpFlow.isMinority) {
      reason = `Ownership ${sCorpShareholderPct}% is under 25% — borrower is not self-employed. K-1 boxes 1/2/3 count as ordinary income with no business add-backs${sCorpFlow.wasCapped ? ', capped at distributions received' : ''}; the Schedule L liquidity test does not apply. ${rec.reason}`;
    }
    return {
      options: seAvgOptions(sCorpFlow.y1, sCorpFlow.y2, twoYearScorp, sCorpFlow.dropped, sCorpFlow.w2Monthly),
      recommendedId: rec.id,
      reason,
    };
  }, [sCorpFlow, twoYearScorp, sCorpShareholderPct]);

  const partnershipPicks = useMemo(() => {
    const rec = seRecommend(partnershipFlow.y1, partnershipFlow.y2, twoYearPartnership, partnershipFlow.dropped);
    let reason = rec.reason;
    if (partnershipFlow.isMinority) {
      reason = `Ending ${gseInvestor === 'FREDDIE' ? 'profit' : 'capital'} % (${partnershipPct}%) is under 25% — borrower is not self-employed. K-1 boxes 1/2/3 + guaranteed payments count as ordinary income with no business add-backs${partnershipFlow.wasCapped ? ', capped at distributions received' : ''}; the Schedule L liquidity test does not apply. ${rec.reason}`;
    }
    return {
      options: seAvgOptions(partnershipFlow.y1, partnershipFlow.y2, twoYearPartnership, partnershipFlow.dropped, partnershipFlow.gpMonthly),
      recommendedId: rec.id,
      reason,
    };
  }, [partnershipFlow, twoYearPartnership, gseInvestor, partnershipPct]);

  const w2BaseChosen = chosenMonthly(w2BasePicks.options, w2BaseChoice, w2BasePicks.recommendedId);
  const w2VarChosen = chosenMonthly(w2VarPicks.options, w2VarChoice, w2VarPicks.recommendedId);
  const schCChosen = chosenMonthly(schCPicks.options, schCChoice, schCPicks.recommendedId);
  const sCorpChosen = chosenMonthly(sCorpPicks.options, sCorpChoice, sCorpPicks.recommendedId);
  const partnershipChosen = chosenMonthly(partnershipPicks.options, partnershipChoice, partnershipPicks.recommendedId);
  const rentalChosen = chosenMonthly(rentalPicks.options, rentalChoice, rentalPicks.recommendedId);

  const form1084CashFlow = {
    qualifyingMonthlySelfEmployed: schCChosen.monthly,
    sCorpShareholderDraw: sCorpChosen.monthly,
    partnershipMonthly: partnershipChosen.monthly,
    w2BaseMonthly: w2BaseChosen.monthly,
    w2VariableMonthly: w2VarChosen.monthly,
    rentalMonthly: rentalChosen.monthly,
    finalTotalQualifyingMonthly:
      schCChosen.monthly +
      sCorpChosen.monthly +
      partnershipChosen.monthly +
      w2BaseChosen.monthly +
      w2VarChosen.monthly +
      rentalChosen.monthly,
  };

  // Core Orchestrated Warnings
  const activeIncomeWarnings = useMemo(() => {
    const list: { id: string; type: 'ERROR' | 'WARNING'; message: string }[] = [];

    // Job tenure warning
    if (monthsAtCurrentJob < 12) {
      list.push({
        id: 'TENURE_WARN',
        type: 'WARNING',
        message: `Borrower job tenure is under 12 months (${monthsAtCurrentJob} months calculated). Variable income must have documented previous employer continuity.`
      });
    }

    // Wage Deficit discrepancy
    if (currentBaseYtd < 50000.00) {
      list.push({
        id: 'WAGE_DEFICIT_WARN',
        type: 'ERROR',
        message: 'Critical Wage Deficit: Extracted YTD Base Wages are lower than expected for a Semi-Monthly payroll processed in mid-August.'
      });
    }

    // Corporate Liquidity Deficit (only applies to self-employed 25%+ owners)
    if (!sCorpLRatio.passes && !sCorpFlow.isMinority) {
      list.push({
        id: 'SCORP_LIQUIDITY',
        type: 'ERROR',
        message: `S-Corp Schedule L quick ratio ${sCorpLRatio.quickRatio.toFixed(2)} is below 1.0. Business income is excluded; officer W-2 still counts.`,
      });
    }
    if (!partnershipLRatio.passes && !partnershipFlow.isMinority) {
      list.push({
        id: 'PARTNERSHIP_LIQUIDITY',
        type: 'ERROR',
        message: `Partnership Schedule L quick ratio ${partnershipLRatio.quickRatio.toFixed(2)} is below 1.0. Ordinary income is excluded; guaranteed payments still count.`,
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
  }, [monthsAtCurrentJob, currentBaseYtd, sCorpLRatio, partnershipLRatio, baseWageReconciliation, rentalFlow, borrowerMetadata.loanProgram, sCorpFlow, partnershipFlow, sCorpShareholderPct, partnershipPct, gseInvestor]);

  // ==================== 6. INTERACTIVE ACTIONS ====================

  const handleInspectField = (fieldId: string) => {
    setHighlightFieldId(fieldId);
    const target = fieldCoordinatesMapping.find((f) => f.id === fieldId);
    if (target) setActivePdfPage(target.boxCoordinates.page);
    if (fieldId.endsWith('-y2')) setCanvasYearIndex(1);
    else if (fieldId.endsWith('-y1')) setCanvasYearIndex(0);
  };

  // ==================== DUAL-MONITOR DOCUMENT PANE (UW / QA) ====================
  // "Dual monitor" pops the document canvas into its own browser window so the
  // underwriter or QA reviewer can drag it to a second monitor. State stays in
  // this window; the pane receives snapshots and sends interactions back over a
  // BroadcastChannel, so highlights, year switches, and paging remain in sync.

  const [docPopout, setDocPopout] = useState(false);
  const docChannelRef = useRef<BroadcastChannel | null>(null);
  const docWinRef = useRef<Window | null>(null);

  const twoYearForCanvas =
    activeTab === 'SCHEDULE_C'
      ? twoYearSchC
      : activeTab === 'SCORP'
        ? twoYearScorp
        : activeTab === 'PARTNERSHIP'
          ? twoYearPartnership
          : activeTab === 'SCHEDULE_E'
            ? twoYearRental
            : true;

  const docSnapshot = useMemo<DocPaneSnapshot>(
    () => ({
      mode: isLive ? 'live' : 'demo',
      loanId: borrowerMetadata.loanId,
      borrowerName: borrowerMetadata.borrowerName,
      activeTab,
      yearIndex: canvasYearIndex,
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
        isLive && liveSession
          ? {
              file: liveSession.file,
              fileName: liveSession.fileName,
              pageIndex: livePageIndex,
              pageCount: liveSession.result.total_pages_scanned,
              fields: mappedFields,
            }
          : null,
    }),
    [
      isLive,
      liveSession,
      activeTab,
      canvasYearIndex,
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
    alert(
      `Payload Locked & Transmitted to Encompass eFolder successfully!\n\nStandard Fields Mapped:\n- Field 108 (W-2 base): $${form1084CashFlow.w2BaseMonthly.toFixed(2)}\n- Field 109 (W-2 variable): $${form1084CashFlow.w2VariableMonthly.toFixed(2)}\n- Field 110 (Schedule C): $${form1084CashFlow.qualifyingMonthlySelfEmployed.toFixed(2)}\n- Field 111 (S-Corp): $${form1084CashFlow.sCorpShareholderDraw.toFixed(2)}\n- Field 112 (Partnership): $${form1084CashFlow.partnershipMonthly.toFixed(2)}\n- Field 113 (Rental Income): $${form1084CashFlow.rentalMonthly.toFixed(2)}`,
    );
  };

  const visibleWarnings = activeIncomeWarnings.filter((alert) => {
    if (alert.id === 'SCORP_LIQUIDITY' || alert.id === 'SCORP_MINORITY_K1') return activeTab === 'SCORP' || activeTab === 'ENCOMPASS_SYNC';
    if (alert.id === 'PARTNERSHIP_LIQUIDITY' || alert.id === 'PARTNERSHIP_MINORITY_K1') return activeTab === 'PARTNERSHIP' || activeTab === 'ENCOMPASS_SYNC';
    if (alert.id === 'TENURE_WARN' || alert.id === 'WAGE_DEFICIT_WARN' || alert.id === 'WAGE_VARIANCE_WARN') {
      return activeTab === 'PAYSTUB_RECONCILIATION' || activeTab === 'W2_CONTINUITY' || activeTab === 'ENCOMPASS_SYNC';
    }
    if (alert.id.startsWith('RENTAL_')) {
      return activeTab === 'SCHEDULE_E' || activeTab === 'ENCOMPASS_SYNC';
    }
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
          const encompassPitia = ENCOMPASS_REO_PITIA[patch.address];
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
            const encompassPitia = ENCOMPASS_REO_PITIA[next.address];
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

  return (
    <div className="mx-auto max-w-7xl p-6 font-sans space-y-6 text-slate-800 bg-slate-50 min-h-screen">
      
      {/* ==================== 1. COMPREHENSIVE WORKSPACE HEADER ==================== */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-7 w-7 text-indigo-600" />
              B2B Professional Income Verification Workspace
            </h1>
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-xs font-bold uppercase">
              ZDR · v11
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Loan ID: <strong className="text-slate-700">{borrowerMetadata.loanId}</strong></span>
            <span>Borrower: <strong className="text-slate-700">{borrowerMetadata.borrowerName}</strong></span>
            <span>Current Job: <strong className="text-slate-700">{borrowerMetadata.currentEmployer} (Hired: {borrowerMetadata.employmentStartDate})</strong></span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!docPopout ? (
            <button
              type="button"
              onClick={openDocWindow}
              title="Open the document canvas in a separate window for a second monitor"
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
            >
              <Monitor className="h-4 w-4" />
              Dual monitor
            </button>
          ) : (
            <button
              type="button"
              onClick={bringBackDoc}
              className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700"
            >
              <MonitorX className="h-4 w-4" />
              Bring documents back
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
            {parseBusy ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : <Upload className="h-4 w-4 text-emerald-600" />}
            {parseBusy ? 'Parsing…' : 'Load live PDF'}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={parseBusy}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) onParseFile?.(next);
              }}
            />
          </label>
          {liveSession ? (
            <button
              type="button"
              onClick={() => (isLive ? onUseDemo?.() : onUseLive?.())}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
            >
              {isLive ? 'Use demo' : 'Use live PDF'}
            </button>
          ) : null}
          <button
            onClick={handleExportSync}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition hover:bg-indigo-700"
          >
            Lock & Sync Encompass eFolder <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {parseError ? <p className="w-full text-xs text-rose-600">{parseError}</p> : null}
      </div>

      {/* ==================== 2. SPLIT SCREEN CONTROL GRID ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* ==================== LEFT PANEL: PDF COORDINATES VISUAL CANVAS ==================== */}
        {/* Unmounted (not just hidden) while the canvas lives in its own window, so the
            main window does no duplicate PDF/canvas rendering work in dual-monitor mode */}
        {!docPopout && (
        <div className="space-y-4 xl:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-indigo-600" />
                <h2 className="font-extrabold text-slate-900 text-sm">PDF Coordinate Canvas View</h2>
              </div>
              <span className="rounded bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                {activeTab === 'SCHEDULE_C'
                  ? 'Schedule C'
                  : activeTab === 'SCORP'
                    ? 'Form 1120-S'
                    : activeTab === 'PARTNERSHIP'
                      ? 'Form 1065'
                      : 'Paystub'}
              </span>
            </div>

            {isLive && liveSession ? (
              <PdfPagePreview
                file={liveSession.file}
                pageIndex={livePageIndex}
                pageCount={liveSession.result.total_pages_scanned}
                fields={mappedFields}
                selectedFieldId={highlightFieldId}
                onSelectField={setHighlightFieldId}
                onPageChange={setLivePageIndex}
              />
            ) : (
              <DemoDocumentCanvas
                tab={activeTab}
                yearIndex={canvasYearIndex}
                onYearIndex={setCanvasYearIndex}
                twoYear={
                  activeTab === 'SCHEDULE_C' ? twoYearSchC : activeTab === 'SCORP' ? twoYearScorp : twoYearPartnership
                }
                selectedId={highlightFieldId}
                onSelect={handleInspectField}
                schC={schCYears[canvasYearIndex]}
                corp={activeTab === 'PARTNERSHIP' ? partnershipYears[canvasYearIndex] : sCorpYears[canvasYearIndex]}
                scheduleL={activeTab === 'PARTNERSHIP' ? partnershipL : sCorpL}
                showLiquidity={activeTab === 'SCORP' || activeTab === 'PARTNERSHIP'}
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

          {/* Core Licensing Profile Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-1.5 text-sm">
              <UserCheck className="h-4.5 w-4.5 text-emerald-500" />
              Employer Verification Profile
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Target Employer Name</span>
                <span className="font-bold text-slate-800">{borrowerMetadata.currentEmployer}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Employment Start Date</span>
                <span className="font-bold text-slate-800">{borrowerMetadata.employmentStartDate} ({monthsAtCurrentJob} mos elapsed)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">USDA Eligibility Zone</span>
                <span className="font-bold text-slate-800">Zone-A Conventional Standard</span>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ==================== RIGHT PANEL: TAB-DRIVEN CALCULATION ENGINES ==================== */}
        <div className={`space-y-6 ${docPopout ? 'xl:col-span-12' : 'xl:col-span-8'}`}>
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
          
          {/* Main Workspace Navigation Tab Array */}
          <div className="flex flex-wrap gap-1 rounded-lg border-b border-slate-200 bg-white p-1.5 shadow-sm">
            {availableTabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  setHighlightFieldId(null);
                  setCanvasYearIndex(0);
                }}
                className={`flex min-w-[120px] flex-1 items-center justify-center gap-1.5 rounded-md py-2.5 text-[11px] font-bold uppercase transition-all ${
                  activeTab === id ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* ==================== TAB 1: 4-WAY BASE WAGE RECONCILIATION ==================== */}
          {activeTab === 'PAYSTUB_RECONCILIATION' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">4-Way Base Wage Reconciliation</h3>
                  <p className="text-xs text-slate-400 mt-1">Cross-references paystub hourly pay rates against annualized parameters and YTD balances</p>
                </div>
                <span className="text-xs font-bold uppercase text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Verified Base: $3,600.00 / Semi-Monthly
                </span>
              </div>

              {/* Core interactive variable modification boxes */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Hourly Rate of Pay</label>
                  <input
                    type="number"
                    value={currentHourlyRate}
                    onChange={(e) => setCurrentHourlyRate(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={() => handleInspectField('ps-hourly-rate')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Standard Weekly Hours</label>
                  <input
                    type="number"
                    value={currentWeeklyHours}
                    onChange={(e) => setCurrentWeeklyHours(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={() => handleInspectField('ps-hours-week')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Current Period Base Pay</label>
                  <input
                    type="number"
                    value={currentPeriodBasePay}
                    onChange={(e) => setCurrentPeriodBasePay(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={() => handleInspectField('ps-current-base')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Base Wages YTD</label>
                  <input
                    type="number"
                    value={currentBaseYtd}
                    onChange={(e) => setCurrentBaseYtd(Number(e.target.value))}
                    className={`w-full rounded border p-2 font-semibold focus:outline-none focus:border-indigo-500 ${
                      currentBaseYtd < 50000 ? 'border-rose-300 bg-rose-50' : 'border-slate-300'
                    }`}
                  />
                  <button onClick={() => handleInspectField('ps-base-ytd')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Prior Year W-2 Box 1</label>
                  <input
                    type="number"
                    value={prevEmployerW2.box1Wages}
                    onChange={(e) => setPrevEmployerW2({ ...prevEmployerW2, box1Wages: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Other Income YTD</label>
                  <input
                    type="number"
                    value={currentOtherYtd}
                    onChange={(e) => setCurrentOtherYtd(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <IncomeChoicePanel
                options={w2BasePicks.options}
                recommendedId={w2BasePicks.recommendedId}
                reason={w2BasePicks.reason}
                selectedId={w2BaseChoice}
                onSelect={setW2BaseChoice}
              />

              {/* Other Income Warning Panel */}
              {currentOtherYtd > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-xs leading-relaxed text-amber-800">
                  <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold uppercase block tracking-wider text-amber-950">Other Income Detected</span>
                    Other income of ${currentOtherYtd.toLocaleString()} found. Please validate the continuance of this other income type (e.g., probability of continued receipt for at least 3 years) per guidelines.
                  </div>
                </div>
              )}

              {/* Critical Wage Deficit Alert Panel */}
              {currentBaseYtd < 50000.00 && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex gap-3 text-xs leading-relaxed text-rose-800">
                  <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold uppercase block tracking-wider text-rose-950">Critical Wage Deficit Highlighted</span>
                    The YTD base wage of ${currentBaseYtd.toLocaleString()} is significantly lower than expected for a semi-monthly payroll schedule processed in mid-August (expected base wage ~ $54,000.00). Check if the borrower recently changed compensation, had unpaid leave, or was hired mid-year.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 2: VARIABLE & JOB CONTINUITY PORTAL ==================== */}
          {activeTab === 'W2_CONTINUITY' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Variable Income Continuity & Rolling Average</h3>
                  <p className="text-xs text-slate-400 mt-1">Aggregates short-term variable earnings across job transitions when similar compensation history exists</p>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Months at Current Job (Hire Date: Dec 2025)</label>
                  <input
                    type="number"
                    value={monthsAtCurrentJob}
                    onChange={(e) => setMonthsAtCurrentJob(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-slate-400 block mt-1">Less than 12 months at current job mandates prior job variable history.</span>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Months at Previous Job (Rolling Window)</label>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Current Job variable inputs */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5 border-b pb-1">
                    <Activity className="h-4 w-4 text-indigo-500" />
                    Current Job YTD Variable Extractions
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Bonus Income YTD</label>
                      <input
                        type="number"
                        value={currentBonusYtd}
                        onChange={(e) => setCurrentBonusYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Overtime Income YTD</label>
                      <input
                        type="number"
                        value={currentOtYtd}
                        onChange={(e) => setCurrentOtYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded p-3 text-xs flex justify-between items-center">
                    <span className="font-semibold text-slate-500">Current Monthly Variable Avg:</span>
                    <span className="font-black text-slate-800">${variableContinuityCalculations.currentMonthlyVariableAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                  </div>
                </div>

                {/* Prior Job Variable inputs */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5 border-b pb-1">
                    <Link className="h-4 w-4 text-indigo-500" />
                    Prior Job 2025 W-2 Variable Extractions
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Box 12 Bonus History</label>
                      <input
                        type="number"
                        value={prevEmployerW2.box12Bonus}
                        onChange={(e) => setPrevEmployerW2({ ...prevEmployerW2, box12Bonus: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                        disabled={!mergePreviousEmployerVariable}
                      />
                    </div>
                    <div>
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
                  <div className="bg-slate-50 rounded p-3 text-xs flex justify-between items-center">
                    <span className="font-semibold text-slate-500">Prior Monthly Variable Avg:</span>
                    <span className={`font-black text-slate-800 ${!mergePreviousEmployerVariable ? 'opacity-40' : ''}`}>
                      ${variableContinuityCalculations.previousMonthlyVariableAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo
                    </span>
                  </div>
                </div>
              </div>

              <IncomeChoicePanel
                options={w2VarPicks.options}
                recommendedId={w2VarPicks.recommendedId}
                reason={w2VarPicks.reason}
                selectedId={w2VarChoice}
                onSelect={setW2VarChoice}
              />
            </div>
          )}

          {activeTab === 'SCHEDULE_C' && (
            <SelfEmployedPanel
              title="Schedule C · sole proprietor"
              subtitle="Form 1084 cash flow. No Schedule L liquidity test — that applies to 1120-S / 1065 only."
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            </SelfEmployedPanel>
          )}

          {activeTab === 'SCORP' && (
            <SelfEmployedPanel
              title="S-Corp · Form 1120-S / K-1"
              subtitle="Two-year K-1 analysis first. Schedule L liquidity sits underneath — if it fails, only officer W-2 qualifies."
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
                </label>
              }
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {sCorpYears.slice(0, twoYearScorp ? 2 : 1).map((row, index) => (
                  <YearStack key={row.year} title={`${row.year} K-1`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    <CorpLines
                      row={row}
                      yearKey={index === 0 ? 'y1' : 'y2'}
                      kind="scorp"
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
                    <p className="pt-1 text-right font-mono text-xs font-black text-slate-900">
                      Share of cash flow{' '}
                      {usd(
                        (sCorpShareholderPct < 25
                          ? corpMinorityAnnual(row, sCorpShareholderPct).capped
                          : corpBusinessAnnual(row, sCorpShareholderPct)) + row.w2Wages,
                      )}
                    </p>
                  </YearStack>
                ))}
              </div>
              <LiquidityBlock sheet={sCorpL} onChange={setSCorpL} selectedId={highlightFieldId} onSelect={handleInspectField} />
            </SelfEmployedPanel>
          )}

          {activeTab === 'PARTNERSHIP' && (
            <SelfEmployedPanel
              title="Partnership · Form 1065 / K-1"
              subtitle="Two-year K-1 first. Schedule L liquidity below. Guaranteed payments still count if liquidity fails."
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
                  {partnershipPct < 25 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800">
                      &lt;25% · not self-employed
                    </span>
                  )}
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {partnershipYears.slice(0, twoYearPartnership ? 2 : 1).map((row, index) => (
                  <YearStack key={row.year} title={`${row.year} K-1`} subtitle={index === 0 ? 'Most recent' : 'Prior year'}>
                    <CorpLines
                      row={row}
                      yearKey={index === 0 ? 'y1' : 'y2'}
                      kind="partnership"
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
                    <p className="pt-1 text-right font-mono text-xs font-black text-slate-900">
                      Share of cash flow{' '}
                      {usd(
                        partnershipPct < 25
                          ? corpMinorityAnnual(row, partnershipPct).capped
                          : corpBusinessAnnual(row, partnershipPct),
                      )}
                    </p>
                  </YearStack>
                ))}
              </div>
              <LiquidityBlock
                sheet={partnershipL}
                onChange={setPartnershipL}
                selectedId={highlightFieldId}
                onSelect={handleInspectField}
              />
            </SelfEmployedPanel>
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
                  <p className="mt-1 text-xs text-slate-500">
                    Form 1084 / 1038 worksheet · Rents (L3) − Total Expenses (L20) + Insurance (L9) + Mortgage Interest (L12) + Taxes (L16) + Depreciation (L18) + HOA (L19) ÷ rental months − PITIA
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Loan Program Badge */}
                  <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-[10px] font-black uppercase text-indigo-700">
                    {borrowerMetadata.loanProgram} Rules
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
                    <span className="hidden text-[10px] text-slate-500 sm:inline">2 yrs required unless 5+ yr history</span>
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
                        {/* Address */}
                        <input
                          type="text"
                          value={prop.address}
                          placeholder="Property address"
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
                          {prop.isSubjectProperty ? 'Proposed PITIA (subject loan)' : 'Full monthly housing expense'}
                          <span className="ml-1 font-normal text-slate-400">
                            {prop.isSubjectProperty
                              ? '· proposed payment on the new loan'
                              : '· principal, interest, taxes, insurance, association dues'}
                          </span>
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
                                { line: 'Line 3', label: 'Rents received', key: 'rentsReceived' as const, hint: 'Gross rental income' },
                                { line: 'Line 9', label: 'Insurance', key: 'insurance' as const, hint: 'Add-back' },
                                { line: 'Line 12', label: 'Mortgage interest', key: 'mortgageInterest' as const, hint: 'Add-back' },
                                { line: 'Line 16', label: 'Taxes', key: 'taxes' as const, hint: 'Add-back' },
                                { line: 'Line 18', label: 'Depreciation', key: 'depreciation' as const, hint: 'Add-back' },
                                { line: 'Line 19', label: 'HOA dues', key: 'hoaDues' as const, hint: 'Add-back if in PITIA' },
                                { line: 'Line 20', label: 'Total expenses', key: 'totalExpenses' as const, hint: 'Sum of lines 5–19' },
                                { line: 'Line 2', label: 'Fair rental days', key: 'fairRentalDays' as const, hint: '0 = full year' },
                              ].map(({ line, label, key, hint }) => (
                                <div key={key} className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2.5 py-2">
                                  <span className="w-[4.5rem] shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">{line}</span>
                                  <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800 truncate">
                                    {label}
                                    <span className="ml-1 font-normal text-slate-400">· {hint}</span>
                                  </span>
                                  <input
                                    type="number"
                                    value={y[key]}
                                    onChange={(e) => patchRentalYear(prop.id, yk, { [key]: Number(e.target.value) })}
                                    className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                                  />
                                </div>
                              ))}

                              {/* Annual 1084 adjusted cash flow summary */}
                              <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs space-y-1">
                                <div className="flex items-center justify-between text-[10px] text-slate-400">
                                  <span>Add-backs (L9 + L12 + L16 + L18 + L19)</span>
                                  <span className="font-mono font-bold text-slate-500">
                                    +{cf.addBacks.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500 font-semibold">
                                    1084 adjusted annual cash flow
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

              {/* Loan-program guidance note */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
                <p className="font-black uppercase text-slate-800 text-[10px] tracking-wider">Loan-Program Guidelines Applied</p>
                {borrowerMetadata.loanProgram === 'FHA' && (
                  <p><strong>FHA / HUD 4000.1:</strong> Multi-family subject-property decline ≤ 5% → 24-month avg; 5–20% → most recent year; &gt;20% → disqualified. One-year tax return acceptable only if property owned &lt; 12 months.</p>
                )}
                {borrowerMetadata.loanProgram === 'CONVENTIONAL' && (
                  <p><strong>Conventional / Fannie Mae SEL 2014-07:</strong> Two-year Schedule E required. Declining income → use lower year. Depreciation add-back always applied. Vacancy factor not deducted on investment properties using tax returns.</p>
                )}
                {borrowerMetadata.loanProgram === 'VA' && (
                  <p><strong>VA / VA Lender's Handbook Ch. 4:</strong> Two-year average when income stable/increasing; otherwise lower year. Depreciation add-back applies. Property must have 12-month history of rental receipts.</p>
                )}
                {borrowerMetadata.loanProgram === 'USDA' && (
                  <p><strong>USDA / HB-1-3555 Ch. 9:</strong> Same two-year averaging rule as Conventional. Rental income from the subject property requires a two-year history unless the subject is a new purchase with a new rental agreement.</p>
                )}
                <p>
                  <strong>Subject vs non-subject:</strong> Non-subject (REO) rentals use Schedule E history against the property's actual PITIA; an aggregate loss {borrowerMetadata.loanProgram === 'VA' ? 'reduces gross income directly (VA)' : 'is clamped to $0 income and redirected as a proposed liability'}. The subject property uses the proposed PITIA of the new loan — with Schedule E history on a refinance, or 75% of Form 1007/1025 market rent on a purchase. A subject deficit on a 2–4 unit primary adjusts the housing expense; a subject investment deficit maps to a proposed liability.
                </p>
              </div>
            </div>
          )}

          {/* ==================== TAB 4: ENCOMPASS SYNC INTERFACE ==================== */}
          {activeTab === 'ENCOMPASS_SYNC' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="border-b pb-3">
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                  <Lock className="h-5 w-5 text-indigo-600" />
                  Authorize & Commit Encompass REST Sync
                </h3>
                <p className="text-xs text-slate-400 mt-1">Locks and writes-back processed values to standard Ellie Mae/ICE field registries</p>
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
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 112</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Partnership · {partnershipChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.partnershipMonthly)}/mo</span>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4 ring-2 ring-indigo-200">
                  <span className="text-[10px] font-black uppercase text-slate-400">Field 113</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">Rental Income · {rentalChosen.label}</span>
                  <span className="mt-1 block text-lg font-black text-indigo-700">{usd(form1084CashFlow.rentalMonthly)}/mo</span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-between bg-slate-900 text-white p-5 rounded-xl border border-slate-800 gap-4">
                <div>
                  <h4 className="font-bold text-sm">Lock, Release & Sync Final NOV</h4>
                  <p className="text-xs text-slate-400 mt-1">Commits {activeIncomeWarnings.length} outstanding variables directly as prior-to-approval milestones.</p>
                </div>
                <button
                  onClick={handleExportSync}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 text-xs font-bold uppercase tracking-wider transition shadow-lg self-end"
                >
                  Sign & Sync Encompass eFolder <ArrowRight className="h-4 w-4" />
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
                  <div key={alert.id} className="flex gap-2.5 bg-white p-3 rounded-lg border border-rose-100 text-xs shadow-sm">
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
  );
}

