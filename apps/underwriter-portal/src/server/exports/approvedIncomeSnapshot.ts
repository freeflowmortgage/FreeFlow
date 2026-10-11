import { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';
import { hashCanonical } from '../http/canonical';
import { readBorrowerIncome } from '../income/loanBorrowerRoster';

export const APPROVED_INCOME_SNAPSHOT_VERSION = 'freeflow-approved-income-snapshot-v1' as const;

export type ApprovedIncomeSnapshot = Readonly<{
  schemaVersion: typeof APPROVED_INCOME_SNAPSHOT_VERSION;
  snapshotHash: string;
  loan: Readonly<{
    id: string;
    version: number;
    program: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
    integrationMode: 'NONE' | 'ENCOMPASS_HOSTED' | 'CUSTOM_CONNECTOR';
  }>;
  approval: Readonly<{
    eventId: string;
    calculationId: string;
    action: 'INCOME_APPROVED' | 'INCOME_OVERRIDE';
    approvedAt: string;
    approvedLoanVersion: number;
  }>;
  calculation: Readonly<{
    schemaVersion: string;
    source: string;
    mortgageRuleVersion: string;
    canonicalInputHash: string;
    sourceDocumentHashes: readonly string[];
    qualifyingMonthlyIncome: string;
    totalAnnualCashFlow: string;
    trendingResult: string;
    yearsAnalyzed: readonly number[];
    components: Readonly<{
      w2BaseMonthly: string | null;
      w2VariableMonthly: string | null;
      scheduleCMonthly: string | null;
      scheduleFMonthly: string | null;
      form1120SMonthly: string | null;
      form1065Monthly: string | null;
      form1120Monthly: string | null;
      assetIncomeMonthly: string | null;
      rentalMonthly: string | null;
      rentalLiabilityMonthly: string | null;
      housingExpenseAdjustment: string | null;
    }>;
    borrowers: readonly Readonly<{
      borrowerKey: string;
      ordinal: number;
      role: 'PRIMARY' | 'CO_BORROWER';
      qualifyingMonthlyIncome: string;
    }>[];
  }>;
  provenance: Readonly<{
    extractions: readonly Readonly<{
      extractionId: string;
      extractionHash: string;
      sourceDocumentId: string;
      sourceDocumentVersion: number;
      sourceContentHash: string;
      metadataReviewId: string | null;
      metadataReviewVersion: number | null;
      metadataReviewHash: string | null;
    }>[];
  }>;
}>;

type ApprovedIncomeSnapshotCore = Omit<ApprovedIncomeSnapshot, 'snapshotHash'>;

export async function loadApprovedIncomeSnapshot(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  loanId: string,
): Promise<ApprovedIncomeSnapshot> {
  const loan = await transaction.loanApplication.findFirst({
    where: { id: loanId, tenantId: context.tenantId },
    select: {
      id: true,
      version: true,
      loanProgram: true,
      encompassIntegrationMode: true,
      loanBorrowers: {
        orderBy: { ordinal: 'asc' },
        select: { borrowerKey: true, ordinal: true, role: true },
      },
      form1084Audits: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      },
      auditEvents: {
        where: { action: { in: ['INCOME_APPROVED', 'INCOME_OVERRIDE'] } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          id: true,
          action: true,
          entityId: true,
          expectedLoanVersion: true,
          actorUserId: true,
          occurredAt: true,
        },
      },
    },
  });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  const approval = loan.auditEvents[0];
  const latestCalculationId = loan.form1084Audits[0]?.id;
  if (!approval || !latestCalculationId) {
    throw new ApiError(409, 'APPROVED_CALCULATION_REQUIRED', 'A current approved income calculation is required for export.');
  }
  if (approval.entityId !== latestCalculationId || approval.expectedLoanVersion + 1 !== loan.version) {
    throw new ApiError(409, 'STALE_APPROVED_CALCULATION', 'The approved income calculation is no longer current.');
  }

  const calculation = await transaction.form1084Audit.findFirst({
    where: {
      id: approval.entityId,
      tenantId: context.tenantId,
      loanId: loan.id,
      isHumanVerified: true,
    },
    select: {
      id: true,
      calculatedLoanVersion: true,
      calculationSchemaVersion: true,
      calculationSource: true,
      mortgageRuleVersion: true,
      canonicalInputHash: true,
      sourceDocumentHashes: true,
      qualifyingMonthlyIncome: true,
      totalAnnualCashFlow: true,
      trendingResult: true,
      yearsAnalyzed: true,
      w2BaseMonthly: true,
      w2VariableMonthly: true,
      scheduleCMonthlyTotal: true,
      scheduleFMonthlyTotal: true,
      form1120SMonthlyTotal: true,
      form1065MonthlyTotal: true,
      form1120MonthlyTotal: true,
      assetIncomeMonthly: true,
      rentalMonthly: true,
      rentalLiabilityMonthly: true,
      housingExpenseAdjustment: true,
      borrowerIncome: true,
      verifiedAt: true,
      verifiedByUserId: true,
      extractionBindings: {
        orderBy: { extractionId: 'asc' },
        select: {
          extractionId: true,
          extractionHash: true,
          sourceDocumentId: true,
          sourceDocumentVersion: true,
          sourceContentHash: true,
          metadataReviewId: true,
          metadataReviewVersion: true,
          metadataReviewHash: true,
        },
      },
    },
  });
  if (!calculation
    || calculation.calculatedLoanVersion !== approval.expectedLoanVersion
    || calculation.verifiedByUserId !== approval.actorUserId
    || calculation.verifiedAt?.getTime() !== approval.occurredAt.getTime()) {
    throw new ApiError(409, 'STALE_APPROVED_CALCULATION', 'The approved income calculation is no longer current.');
  }

  const borrowerIncome = readBorrowerIncome(calculation.borrowerIncome);
  const roster = loan.loanBorrowers as Array<{ borrowerKey: string; ordinal: number; role: 'PRIMARY' | 'CO_BORROWER' }>;
  let borrowers = borrowerIncome;
  if (roster.length === 1 && borrowerIncome.length === 0) {
    borrowers = [{ ...roster[0], qualifyingMonthlyIncome: requiredMoney(calculation.qualifyingMonthlyIncome) }];
  }
  if (roster.length > 0 && (borrowers.length !== roster.length || borrowers.some((line, index) => (
    line.borrowerKey !== roster[index]?.borrowerKey
    || line.ordinal !== roster[index]?.ordinal
    || line.role !== roster[index]?.role
  )))) {
    throw new ApiError(409, 'APPROVED_SNAPSHOT_INCOMPLETE', 'The approved borrower income does not match the current roster.');
  }

  const core: ApprovedIncomeSnapshotCore = {
    schemaVersion: APPROVED_INCOME_SNAPSHOT_VERSION,
    loan: {
      id: loan.id,
      version: loan.version,
      program: loan.loanProgram,
      integrationMode: loan.encompassIntegrationMode,
    },
    approval: {
      eventId: approval.id,
      calculationId: calculation.id,
      action: approval.action as 'INCOME_APPROVED' | 'INCOME_OVERRIDE',
      approvedAt: approval.occurredAt.toISOString(),
      approvedLoanVersion: approval.expectedLoanVersion,
    },
    calculation: {
      schemaVersion: calculation.calculationSchemaVersion,
      source: calculation.calculationSource,
      mortgageRuleVersion: calculation.mortgageRuleVersion,
      canonicalInputHash: calculation.canonicalInputHash.trim(),
      sourceDocumentHashes: calculation.sourceDocumentHashes.map((value) => value.trim()).sort(),
      qualifyingMonthlyIncome: requiredMoney(calculation.qualifyingMonthlyIncome),
      totalAnnualCashFlow: requiredMoney(calculation.totalAnnualCashFlow),
      trendingResult: calculation.trendingResult,
      yearsAnalyzed: [...calculation.yearsAnalyzed].sort((left, right) => right - left),
      components: {
        w2BaseMonthly: optionalMoney(calculation.w2BaseMonthly),
        w2VariableMonthly: optionalMoney(calculation.w2VariableMonthly),
        scheduleCMonthly: optionalMoney(calculation.scheduleCMonthlyTotal),
        scheduleFMonthly: optionalMoney(calculation.scheduleFMonthlyTotal),
        form1120SMonthly: optionalMoney(calculation.form1120SMonthlyTotal),
        form1065Monthly: optionalMoney(calculation.form1065MonthlyTotal),
        form1120Monthly: optionalMoney(calculation.form1120MonthlyTotal),
        assetIncomeMonthly: optionalMoney(calculation.assetIncomeMonthly),
        rentalMonthly: optionalMoney(calculation.rentalMonthly),
        rentalLiabilityMonthly: optionalMoney(calculation.rentalLiabilityMonthly),
        housingExpenseAdjustment: optionalMoney(calculation.housingExpenseAdjustment),
      },
      borrowers: borrowers.map((line) => ({ ...line })),
    },
    provenance: {
      extractions: calculation.extractionBindings.map((binding) => ({
        extractionId: binding.extractionId,
        extractionHash: binding.extractionHash.trim(),
        sourceDocumentId: binding.sourceDocumentId,
        sourceDocumentVersion: binding.sourceDocumentVersion,
        sourceContentHash: binding.sourceContentHash.trim(),
        metadataReviewId: binding.metadataReviewId,
        metadataReviewVersion: binding.metadataReviewVersion,
        metadataReviewHash: binding.metadataReviewHash?.trim() ?? null,
      })),
    },
  };
  return Object.freeze({ ...core, snapshotHash: hashCanonical(core) });
}

function requiredMoney(value: Prisma.Decimal | number | string): string {
  try { return new Prisma.Decimal(value).toDecimalPlaces(2).toFixed(2); }
  catch { throw new ApiError(409, 'APPROVED_SNAPSHOT_INCOMPLETE', 'The approved calculation contains an invalid monetary value.'); }
}

function optionalMoney(value: Prisma.Decimal | number | string | null): string | null {
  return value == null ? null : requiredMoney(value);
}
