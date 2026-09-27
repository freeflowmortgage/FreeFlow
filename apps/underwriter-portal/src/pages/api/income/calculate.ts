import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { dispatchIncomeCalculation, type LoanProgram } from '@mortgage-pos/mortgage-engine';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';
import { withTenantTransaction } from '../../../server/database/client';
import { appendAuditEvent, hashAuditResult } from '../../../server/audit/appendEvent';
import { hashCanonical } from '../../../server/http/canonical';
import { isUuid } from '../../../server/http/identifiers';
import { ExtractionMetadataRequiredError, mergeAuthoritativeExtractionInputs } from '../../../server/income/authoritativeExtractionInput';
import { INCOME_EXTRACTION_SCHEMA_VERSION } from '../../../server/integrations/encompass/persistedParserExtraction';

const MAX_EXTRACTIONS = 20;

type Dependencies = Readonly<{ withTenantTransaction: typeof withTenantTransaction }>;

export function createIncomeCalculationHandler(dependencies: Dependencies = { withTenantTransaction }) {
  return async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: safeError('METHOD_NOT_ALLOWED', 'Only POST is supported.', context) });
  }

  try {
    const body = isRecord(req.body) ? req.body : {};
    if ('documentData' in body || 'loanProgram' in body || 'sourceDocumentIds' in body) {
      return res.status(400).json({
        error: safeError(
          'CALLER_CALCULATION_INPUT_FORBIDDEN',
          'Calculation input and loan program are loaded from authoritative server-side state.',
          context,
        ),
      });
    }
    const loanId = typeof body.loanId === 'string' && isUuid(body.loanId) ? body.loanId : null;
    const extractionIds = readExtractionIds(body.extractionIds);
    if (!loanId) {
      return res.status(400).json({ error: safeError('INVALID_LOAN_ID', 'loanId must be a valid identifier.', context) });
    }
    if (!extractionIds) {
      return res.status(400).json({
        error: safeError('INVALID_EXTRACTION_SELECTION', 'Provide 1 to 20 unique extractionIds.', context),
      });
    }

    const authority = await dependencies.withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      async (transaction) => {
        const loan = await transaction.loanApplication.findFirst({
          where: { id: loanId, tenantId: context.tenantId },
          select: { id: true, version: true, loanProgram: true },
        });
        if (!loan) return null;
        const extractions = await transaction.incomeExtraction.findMany({
          where: { id: { in: extractionIds }, tenantId: context.tenantId, loanId },
          select: {
            id: true, status: true, schemaVersion: true, parserVersion: true, warnings: true,
            normalizedInput: true, canonicalHash: true, sourceDocumentId: true,
            sourceDocumentVersion: true, sourceContentHash: true, sourceAttachmentId: true,
            sourceDocument: { select: { version: true, sourceContentHash: true, sourceAttachmentId: true } },
            metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { id: true, metadataVersion: true, assignments: true, canonicalHash: true, extractionHash: true, sourceDocumentVersion: true, sourceContentHash: true } },
          },
          orderBy: { id: 'asc' },
        });
        return { loan, extractions };
      },
    );
    if (!authority) {
      return res.status(404).json({ error: safeError('LOAN_NOT_FOUND', 'The requested loan was not found.', context) });
    }
    if (authority.extractions.length !== extractionIds.length) {
      return res.status(404).json({
        error: safeError('EXTRACTION_NOT_FOUND', 'One or more selected extractions were not found for this loan.', context),
      });
    }
    if (authority.extractions.some((item) => item.schemaVersion !== INCOME_EXTRACTION_SCHEMA_VERSION)) {
      return res.status(422).json({
        error: safeError('UNSUPPORTED_EXTRACTION_SCHEMA', 'A selected extraction uses an unsupported schema.', context),
      });
    }
    if (authority.extractions.some((item) => item.status !== 'ACTIVE')) {
      return res.status(409).json({
        error: safeError('EXTRACTION_SUPERSEDED', 'A selected extraction has been superseded.', context),
      });
    }
    if (authority.extractions.some((item) =>
      item.sourceDocument.version !== item.sourceDocumentVersion
      || item.sourceDocument.sourceContentHash !== item.sourceContentHash
      || item.sourceDocument.sourceAttachmentId !== item.sourceAttachmentId)) {
      return res.status(409).json({
        error: safeError('STALE_EXTRACTION_SOURCE', 'A selected extraction no longer matches its source document.', context),
      });
    }
    if (authority.loan.loanProgram === 'USDA') {
      return res.status(422).json({
        error: safeError('UNSUPPORTED_EXTRACTION_PROGRAM', 'USDA requires a separate authoritative household eligibility input.', context),
      });
    }

    let calculationInput;
    try {
      calculationInput = mergeAuthoritativeExtractionInputs(authority.extractions.map((item) => ({
        extractionId: item.id,
        normalizedInput: item.normalizedInput,
        metadataAssignments: item.metadataReviews[0]?.assignments as never,
      })));
    } catch (error) {
      if (error instanceof ExtractionMetadataRequiredError) {
        return res.status(422).json({
          error: { ...safeError('EXTRACTION_REVIEW_DATA_REQUIRED', 'A selected extraction requires authoritative reviewed metadata or parser fields.', context), requirements: error.requirements },
        });
      }
      return res.status(422).json({
        error: safeError('INVALID_PERSISTED_EXTRACTION', 'A selected extraction failed server-side validation.', context),
      });
    }
    const loanProgram = authority.loan.loanProgram as Exclude<LoanProgram, 'USDA'>;
    const extractionProvenance = authority.extractions.map((item) => ({
      extractionId: item.id,
      extractionHash: item.canonicalHash,
      parserVersion: item.parserVersion,
      sourceDocumentId: item.sourceDocumentId,
      sourceDocumentVersion: item.sourceDocumentVersion,
      sourceContentHash: item.sourceContentHash,
      sourceAttachmentId: item.sourceAttachmentId,
      metadataReviewId: item.metadataReviews[0]?.id ?? null,
      metadataReviewVersion: item.metadataReviews[0]?.metadataVersion ?? null,
      metadataReviewHash: item.metadataReviews[0]?.canonicalHash ?? null,
    }));
    const canonicalInputHash = hashCanonical({
      loanId: authority.loan.id,
      loanVersion: authority.loan.version,
      loanProgram,
      extractionProvenance,
      calculationInput,
    });
    const mortgageRuleVersion = 'form-1084-v9';
    const dispatched = dispatchIncomeCalculation({ loanProgram, form1084Input: calculationInput });
    const result = dispatched.result;
    const qualifyingMonthlyIncome = result.summary.qualifyingMonthlyIncome;
    const mapperOutputs = deriveMapperOutputs(result);

    const persisted = await dependencies.withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      async (transaction) => {
        const lockedLoans = await transaction.$queryRaw<Array<{ version: number }>>`
          SELECT "version" FROM "loan_applications"
          WHERE "id" = CAST(${loanId} AS uuid) AND "tenantId" = CAST(${context.tenantId} AS uuid)
          FOR UPDATE
        `;
        const locked = await transaction.$queryRaw<Array<{
          id: string; status: string; canonicalHash: string; sourceDocumentId: string;
          sourceDocumentVersion: number; sourceContentHash: string; documentVersion: number;
          documentHash: string | null; sourceAttachmentId: string; documentAttachmentId: string | null;
        }>>(Prisma.sql`
          SELECT e."id", e."status"::text, e."canonicalHash", e."sourceDocumentId",
            e."sourceDocumentVersion", e."sourceContentHash", e."sourceAttachmentId",
            d."version" AS "documentVersion", d."sourceContentHash" AS "documentHash",
            d."sourceAttachmentId" AS "documentAttachmentId"
          FROM "income_extractions" e
          JOIN "loan_documents" d
            ON d."tenantId" = e."tenantId" AND d."loanId" = e."loanId" AND d."id" = e."sourceDocumentId"
          WHERE e."tenantId" = CAST(${context.tenantId} AS uuid)
            AND e."loanId" = CAST(${loanId} AS uuid)
            AND e."id" = ANY(${extractionIds}::uuid[])
          ORDER BY e."id" ASC
        `);
        const lockedReviews = await transaction.incomeExtractionMetadataReview.findMany({
          where: { tenantId: context.tenantId, loanId, extractionId: { in: extractionIds } },
          orderBy: [{ extractionId: 'asc' }, { metadataVersion: 'desc' }],
          select: { id: true, extractionId: true, metadataVersion: true, canonicalHash: true },
        });
        const latestReviewByExtraction = new Map<string, typeof lockedReviews[number]>();
        for (const review of lockedReviews) if (!latestReviewByExtraction.has(review.extractionId)) latestReviewByExtraction.set(review.extractionId, review);
        if (lockedLoans[0]?.version !== authority.loan.version
          || locked.length !== authority.extractions.length
          || locked.some((item, index) => {
            const original = authority.extractions[index];
            return item.id !== original.id || item.status !== 'ACTIVE' || item.canonicalHash !== original.canonicalHash
              || item.sourceDocumentId !== original.sourceDocumentId
              || item.sourceDocumentVersion !== item.documentVersion
              || item.sourceDocumentVersion !== original.sourceDocumentVersion
              || item.sourceContentHash !== item.documentHash
              || item.sourceContentHash !== original.sourceContentHash
              || item.sourceAttachmentId !== item.documentAttachmentId
              || latestReviewByExtraction.get(item.id)?.id !== original.metadataReviews[0]?.id;
          })) {
          throw new StaleCalculationInputError();
        }

        const audit = await transaction.form1084Audit.create({
          data: {
            tenantId: context.tenantId,
            loanId,
            totalAnnualCashFlow: qualifyingMonthlyIncome * 12,
            qualifyingMonthlyIncome,
            calculationSchemaVersion: 'authoritative-extractions-v1',
            calculationSource: 'persisted-parser-extractions',
            calculatedLoanVersion: authority.loan.version,
            canonicalInputHash,
            sourceDocumentHashes: extractionProvenance.map((item) => item.sourceContentHash),
            mortgageRuleVersion,
            trendingResult: normalizeTrendingResult(result.summary.trendingResult),
            yearsAnalyzed: result.summary.yearsAnalyzed,
            ...mapperOutputs,
          },
          select: { id: true },
        });
        await transaction.incomeCalculationExtraction.createMany({
          data: extractionProvenance.map((item) => ({
            tenantId: context.tenantId,
            loanId,
            calculationId: audit.id,
            extractionId: item.extractionId,
            extractionHash: item.extractionHash,
            sourceDocumentId: item.sourceDocumentId,
            sourceDocumentVersion: item.sourceDocumentVersion,
            sourceContentHash: item.sourceContentHash,
            metadataReviewId: item.metadataReviewId,
            metadataReviewVersion: item.metadataReviewVersion,
            metadataReviewHash: item.metadataReviewHash,
          })),
        });
        const event = await appendAuditEvent(transaction, context, {
          loanId,
          entityType: 'FORM_1084_AUDIT',
          entityId: audit.id,
          expectedLoanVersion: authority.loan.version,
          action: 'INCOME_CALCULATION_COMPLETED',
          reasonCode: 'SYSTEM_CALCULATION',
          ruleVersion: mortgageRuleVersion,
          schemaVersion: 'audit-event-v1',
          resultHash: hashAuditResult({
            calculationEngine: dispatched.engine,
            loanProgram,
            qualifyingMonthlyIncome,
            trendingResult: result.summary.trendingResult,
            yearsAnalyzed: result.summary.yearsAnalyzed,
            canonicalInputHash,
            extractions: extractionProvenance.map(({ extractionId, extractionHash }) => ({ extractionId, extractionHash })),
          }),
        });
        return { calculationId: audit.id, auditEventId: event.id };
      },
    );

    return res.status(200).json({
      success: true,
      loanId,
      calculationId: persisted.calculationId,
      calculatedMonthlyIncome: qualifyingMonthlyIncome,
      trendingResult: result.summary.trendingResult,
      calculationEngine: dispatched.engine,
      calculationDetails: result,
      extractionWarnings: Array.from(new Set(authority.extractions.flatMap((item) => item.warnings)
        .filter((warning) => warning !== 'AUTHORITATIVE_TAX_YEAR_REQUIRED' && warning !== 'W2_EMPLOYMENT_ROLE_REVIEW_REQUIRED'))).sort(),
      auditEventId: persisted.auditEventId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof StaleCalculationInputError) {
      return res.status(409).json({
        success: false,
        error: safeError('STALE_CALCULATION_INPUT', 'The loan, extraction, or source document changed during calculation.', context),
      });
    }
    console.error('[income-calculate] calculation failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    return res.status(503).json({
      success: false,
      error: safeError('CALCULATION_DEPENDENCY_UNAVAILABLE', 'The income calculation is temporarily unavailable.', context),
    });
  }
  };
}

function readExtractionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EXTRACTIONS
    || value.some((id) => typeof id !== 'string' || !isUuid(id))
    || new Set(value).size !== value.length) return null;
  return [...value].sort() as string[];
}

function deriveMapperOutputs(result: ReturnType<typeof dispatchNonUsda>) {
  const latestYear = result.summary.yearsAnalyzed[0];
  const sum = (rows: ReadonlyArray<Record<string, unknown>>, field: string) => rows
    .filter((row) => row.year === latestYear)
    .reduce((total, row) => total + (typeof row[field] === 'number' ? row[field] as number : 0), 0) / 12;
  return {
    w2BaseMonthly: sum(result.w2EmployerBreakdown, 'annualBaseIncome'),
    w2VariableMonthly: sum(result.w2EmployerBreakdown, 'annualVariableIncome'),
    scheduleCMonthlyTotal: sum(result.scheduleCBreakdown, 'totalAdjustedIncome'),
    scheduleFMonthlyTotal: sum(result.scheduleFBreakdown, 'totalAdjustedIncome'),
    form1120SMonthlyTotal: sum(result.form1120SBreakdown, 'totalCombinedQualifying'),
    form1065MonthlyTotal: sum(result.form1065Breakdown, 'totalCombinedQualifying'),
    form1120MonthlyTotal: sum(result.form1120Breakdown, 'totalCombinedQualifying'),
    assetIncomeMonthly: sum(result.assetIncomeBreakdown, 'totalQualifyingIncome'),
    rentalMonthly: sum(result.scheduleEPropertiesBreakdown, 'totalCashFlow'),
    rentalLiabilityMonthly: result.summary.proposedRentalLossDebt,
    housingExpenseAdjustment: result.summary.subjectHousingExpenseAdjustment,
  };
}

function dispatchNonUsda(input: Parameters<typeof dispatchIncomeCalculation>[0] & { loanProgram: Exclude<LoanProgram, 'USDA'> }) {
  return dispatchIncomeCalculation(input).result;
}

function normalizeTrendingResult(value: string) {
  const supported = new Set([
    'CONVENTIONAL_STABLE_OR_INCREASING', 'CONVENTIONAL_DECLINING',
    'FHA_STABLE_OR_INCREASING', 'FHA_DECLINE_WARNING', 'FHA_CRITICAL_DECLINE',
    'VA_STABLE_OR_INCREASING', 'VA_DECLINING', 'USDA_STABLE_OR_INCREASING',
    'USDA_DECLINING', 'SINGLE_YEAR', 'INSUFFICIENT_DATA',
  ]);
  return supported.has(value) ? value as never : 'INSUFFICIENT_DATA' as const;
}

function safeError(code: string, message: string, context: RequestContext) {
  return { code, message, requestId: context.requestId };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
class StaleCalculationInputError extends Error {}

export default withRequestContext('income:calculate', createIncomeCalculationHandler());
