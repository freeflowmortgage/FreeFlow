import type { MappedIncomeField, ParsePage } from './parseTypes';

export const IRA_CONTINUANCE_MONTHS = 36;

export type RetirementProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
export type IraContinuanceDecision = 'CONFIRMED_GROSS_UP' | 'CONFIRMED' | 'NOT_CONFIRMED';

/** Form 1040 lines 4a/4b, 5a/5b, and 6a/6b from one return. */
export type RetirementReturnLines = {
  year: number | null;
  entityId?: string;
  documentId?: string;
  pageIndex?: number;
  iraTotal: number;
  iraTaxable: number;
  pensionTotal: number;
  pensionTaxable: number;
  ssTotal: number;
  ssTaxable: number;
};

export type RetirementReview = {
  /** Customer-entered vested balance from the most recent retirement account statement. */
  iraAccountBalance: number | null;
  iraContinuance: IraContinuanceDecision | null;
};

export type RetirementAlert = { id: string; type: 'ERROR' | 'WARNING'; message: string };

export type IraResult = {
  totalDistributions: number;
  taxableDistributions: number;
  nonTaxableDistributions: number;
  monthlyDistribution: number;
  monthsOfContinuance: number | null;
  confirmed: boolean;
  grossedUp: boolean;
  qualifyingMonthly: number;
  /** Qualifying monthly amount for each underwriter decision, for the decision picker. */
  monthlyIfConfirmed: { grossUp: number; noGrossUp: number };
};

export type RetirementIncomeResult = {
  multiplier: number;
  socialSecurityMonthly: number;
  pensionMonthly: number;
  ira: IraResult | null;
  /** Pension plus qualifying IRA, matching the CX.FREEFLOW.RETIREMENT export component. */
  retirementIncomeMonthly: number;
  alerts: RetirementAlert[];
};

export const RETIREMENT_SOURCE_FIELD_IDS = [
  'f1040-ira-total', 'f1040-ira-taxable', 'f1040-pensions-total', 'f1040-pensions-taxable', 'f1040-ss-total', 'f1040-ss-taxable',
] as const;

const SOURCE_IDS = {
  iraTotal: 'f1040-ira-total',
  iraTaxable: 'f1040-ira-taxable',
  pensionTotal: 'f1040-pensions-total',
  pensionTaxable: 'f1040-pensions-taxable',
  ssTotal: 'f1040-ss-total',
  ssTaxable: 'f1040-ss-taxable',
} as const;

export const EMPTY_RETIREMENT_RETURN: RetirementReturnLines = {
  year: null, iraTotal: 0, iraTaxable: 0, pensionTotal: 0, pensionTaxable: 0, ssTotal: 0, ssTaxable: 0,
};

export function programGrossUpMultiplier(program: string | null | undefined): number {
  return program?.toUpperCase() === 'FHA' ? 1.15 : 1.25;
}

/** The tax year printed in the Form 1040 header, read from the top of the page. */
export function taxYearFromPage(page: Pick<ParsePage, 'words'> | undefined): number | null {
  const years = (page?.words ?? [])
    .filter((word) => word.y < 0.12 && /^20\d{2}$/.test(word.text.trim()))
    .map((word) => Number(word.text.trim()));
  return years.length ? Math.max(...years) : null;
}

export function hasRetirementLines(lines: RetirementReturnLines): boolean {
  return [lines.iraTotal, lines.iraTaxable, lines.pensionTotal, lines.pensionTaxable, lines.ssTotal, lines.ssTaxable]
    .some((amount) => amount > 0);
}

/** One entry per Form 1040 entity that reports any retirement line. */
export function retirementReturnsFromFields(
  fields: readonly MappedIncomeField[],
  pageFor: (documentId: string | undefined, pageIndex: number) => Pick<ParsePage, 'words'> | undefined = () => undefined,
): RetirementReturnLines[] {
  const wanted = new Set<string>(Object.values(SOURCE_IDS));
  const groups = new Map<string, MappedIncomeField[]>();
  for (const field of fields) {
    const sourceId = field.sourceFieldId ?? field.id;
    if (field.form !== 'Form 1040' || !wanted.has(sourceId)) continue;
    const key = `${field.documentId ?? ''}|${field.entityId ?? `p${field.pageIndex}`}`;
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }
  return [...groups.values()]
    .map((group) => {
      const amount = (sourceId: string) => {
        const field = group.find((item) => (item.sourceFieldId ?? item.id) === sourceId);
        return field && Number.isFinite(field.numericValue) ? Math.max(0, field.numericValue) : 0;
      };
      const first = group[0];
      return {
        year: taxYearFromPage(pageFor(first.documentId, first.pageIndex)),
        entityId: first.entityId,
        documentId: first.documentId,
        pageIndex: first.pageIndex,
        iraTotal: amount(SOURCE_IDS.iraTotal),
        iraTaxable: amount(SOURCE_IDS.iraTaxable),
        pensionTotal: amount(SOURCE_IDS.pensionTotal),
        pensionTaxable: amount(SOURCE_IDS.pensionTaxable),
        ssTotal: amount(SOURCE_IDS.ssTotal),
        ssTaxable: amount(SOURCE_IDS.ssTaxable),
      };
    })
    .filter(hasRetirementLines);
}

/** Retirement income uses the most recent return only. Unknown years rank below known ones, later uploads first. */
export function mostRecentRetirementReturn(returns: readonly RetirementReturnLines[]): RetirementReturnLines | null {
  if (!returns.length) return null;
  return returns.reduce((best, candidate) => ((candidate.year ?? -1) >= (best.year ?? -1) ? candidate : best));
}

/**
 * Mirrors the Form 1084 engine: Social Security and pension non-taxable
 * portions are always grossed up by program; IRA distributions qualify only
 * after the underwriter confirms 36-month continuance, and their non-taxable
 * portion is grossed up only when the underwriter elects it.
 */
export function calculateRetirementIncome(
  lines: RetirementReturnLines,
  review: RetirementReview,
  program: RetirementProgram,
): RetirementIncomeResult {
  const multiplier = programGrossUpMultiplier(program);
  const grossedUp = (total: number, taxable: number) => taxable + Math.max(0, total - taxable) * multiplier;
  const socialSecurityMonthly = grossedUp(lines.ssTotal, lines.ssTaxable) / 12;
  const pensionMonthly = grossedUp(lines.pensionTotal, lines.pensionTaxable) / 12;
  const alerts: RetirementAlert[] = [];
  const yearLabel = lines.year ? `${lines.year} ` : '';

  let ira: IraResult | null = null;
  const iraTotal = Math.max(lines.iraTotal, lines.iraTaxable);
  if (iraTotal > 0) {
    const taxable = Math.min(iraTotal, Math.max(0, lines.iraTaxable));
    const nonTaxable = iraTotal - taxable;
    const monthlyDistribution = iraTotal / 12;
    const balance = review.iraAccountBalance != null && review.iraAccountBalance >= 0 ? review.iraAccountBalance : null;
    const monthsOfContinuance = balance == null ? null : Math.floor((balance / monthlyDistribution) * 10) / 10;
    const confirmed = review.iraContinuance === 'CONFIRMED' || review.iraContinuance === 'CONFIRMED_GROSS_UP';
    const grossUp = review.iraContinuance === 'CONFIRMED_GROSS_UP' && nonTaxable > 0;
    const round = (value: number) => Math.round(value * 100) / 100;
    const monthlyIfConfirmed = {
      grossUp: round((taxable + nonTaxable * multiplier) / 12),
      noGrossUp: round(iraTotal / 12),
    };
    ira = {
      totalDistributions: iraTotal,
      taxableDistributions: taxable,
      nonTaxableDistributions: nonTaxable,
      monthlyDistribution,
      monthsOfContinuance,
      confirmed,
      grossedUp: grossUp,
      qualifyingMonthly: confirmed ? (grossUp ? monthlyIfConfirmed.grossUp : monthlyIfConfirmed.noGrossUp) : 0,
      monthlyIfConfirmed,
    };

    if (taxable === 0) {
      alerts.push({
        id: 'IRA_DISTRIBUTION_NOT_TAXABLE',
        type: 'WARNING',
        message: `The ${yearLabel}Form 1040 reports ${usd(iraTotal)} on Line 4a with nothing taxable on Line 4b. A rollover, Roth conversion, or qualified charitable distribution is not recurring income; confirm the distributions are ongoing.`,
      });
    }
    if (!confirmed) {
      alerts.push({
        id: 'IRA_DISTRIBUTION_EXCLUDED_PENDING_CONTINUANCE',
        type: 'WARNING',
        message: `IRA distributions of ${usd(iraTotal)} (${yearLabel}Line 4a) are excluded until the underwriter confirms at least ${IRA_CONTINUANCE_MONTHS} months of continuance.`,
      });
    } else if (balance == null) {
      alerts.push({
        id: 'IRA_BALANCE_REQUIRED',
        type: 'WARNING',
        message: `Continuance was confirmed without an IRA account balance. Enter the vested balance from the most recent retirement account statement.`,
      });
    } else if (monthsOfContinuance != null && monthsOfContinuance < IRA_CONTINUANCE_MONTHS) {
      alerts.push({
        id: 'IRA_CONTINUANCE_BALANCE_SHORTFALL',
        type: 'ERROR',
        message: `The IRA balance of ${usd(balance)} supports ${monthsOfContinuance} months at ${usd(monthlyDistribution)}/mo, short of the ${IRA_CONTINUANCE_MONTHS} months confirmed.`,
      });
    }
  }

  return {
    multiplier,
    socialSecurityMonthly,
    pensionMonthly,
    ira,
    retirementIncomeMonthly: pensionMonthly + (ira?.qualifyingMonthly ?? 0),
    alerts,
  };
}

export function retirementMethodLabel(year: number | null, lines: string): string {
  return `${year ? `${year} ` : ''}Form 1040 ${lines} · most recent return`;
}

function usd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
