import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../audit/appendEvent';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../audit/idempotency';
import { ApiError } from '../http/apiError';
import { hashCanonical } from '../http/canonical';
import type { ExtractionMetadataAssignment } from './authoritativeExtractionInput';
import { BORROWER_KEY } from './loanBorrowerRoster';

export const EXTRACTION_METADATA_REVIEW_OPERATION = 'income-extraction-metadata-reviews';
const SOURCES = new Set(['DOCUMENT_VISUAL_REVIEW', 'ENCOMPASS_VERIFIED_METADATA', 'WORKFLOW_VERIFIED_METADATA']);
const REASONS = new Set(['DOCUMENT_METADATA_CONFIRMED', 'LOS_METADATA_CONFIRMED', 'WORKFLOW_METADATA_CONFIRMED']);
const ROLES = new Set(['CURRENT', 'CONCURRENT', 'PRIOR', 'PRIMARY', 'SECONDARY']);
const FREQUENCIES = new Set(['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY']);
const BASE_METHODS = new Set(['hourly', 'period', 'ytd', 'prior']);
const WVOE_BASE_METHODS = new Set(['current', 'ytd']);
const WVOE_VARIABLE_METHODS = new Set(['current', 'avg24']);
const ASSIGNMENT_FIELDS = ['entityId', 'taxYear', 'employmentRole', 'ownershipPercentage', 'borrowerKey', 'elapsedMonths', 'payFrequency', 'baseIncomeMethod', 'wvoeBaseMethod', 'wvoeVariableMethod', 'includeInQualifyingIncome', 'hasThreeYearAssetSupport', 'hasStableDistributions', 'cash', 'currentLiabilities', 'iraAccountBalance', 'hasThreeYearIraContinuance', 'grossUpIraNonTaxable'];
/** Forms whose year-to-date figures are divided by a reviewed elapsed-months count. */
const YTD_FORMS = ['Paystub', 'WVOE'];

export type MetadataReviewRequest = Readonly<{
  loanId: string; extractionId: string; expectedLoanVersion: number; expectedMetadataVersion: number;
  source: 'DOCUMENT_VISUAL_REVIEW' | 'ENCOMPASS_VERIFIED_METADATA' | 'WORKFLOW_VERIFIED_METADATA';
  reasonCode: string; reasonNarrative: string | null; assignments: readonly ExtractionMetadataAssignment[]; idempotencyKey: string;
}>;

export function parseMetadataReviewBody(body: unknown): Omit<MetadataReviewRequest, 'loanId' | 'extractionId' | 'idempotencyKey'> {
  if (!isRecord(body)) throw new ApiError(400, 'INVALID_REQUEST', 'A metadata review body is required.');
  const expectedLoanVersion = positiveInteger(body.expectedLoanVersion, 'expectedLoanVersion');
  const expectedMetadataVersion = nonnegativeInteger(body.expectedMetadataVersion, 'expectedMetadataVersion');
  if (typeof body.source !== 'string' || !SOURCES.has(body.source)) throw new ApiError(400, 'INVALID_METADATA_SOURCE', 'The metadata source is not allowed.');
  if (typeof body.reasonCode !== 'string' || !REASONS.has(body.reasonCode)) throw new ApiError(400, 'INVALID_REASON_CODE', 'The metadata reason is not allowed.');
  const reasonNarrative = body.reasonNarrative == null ? null : typeof body.reasonNarrative === 'string' ? body.reasonNarrative.trim() : null;
  if (reasonNarrative !== null && (reasonNarrative.length < 1 || reasonNarrative.length > 500)) throw new ApiError(400, 'INVALID_REASON_NARRATIVE', 'reasonNarrative must contain 1 to 500 characters.');
  if (!Array.isArray(body.assignments) || body.assignments.length < 1 || body.assignments.length > 100) throw new ApiError(400, 'INVALID_METADATA_ASSIGNMENTS', 'Provide 1 to 100 metadata assignments.');
  const assignments = body.assignments.map(parseAssignment);
  if (new Set(assignments.map((item) => item.entityId)).size !== assignments.length) throw new ApiError(400, 'DUPLICATE_METADATA_ENTITY', 'Each entity may be assigned once per request.');
  return { expectedLoanVersion, expectedMetadataVersion, source: body.source as MetadataReviewRequest['source'], reasonCode: body.reasonCode, reasonNarrative, assignments };
}

export async function reviewExtractionMetadata(
  transaction: Prisma.TransactionClient, context: RequestContext, input: MetadataReviewRequest,
) {
  const requestHash = hashCanonical({
    loanId: input.loanId, extractionId: input.extractionId, expectedLoanVersion: input.expectedLoanVersion,
    expectedMetadataVersion: input.expectedMetadataVersion, source: input.source, reasonCode: input.reasonCode,
    reasonNarrative: input.reasonNarrative, assignments: input.assignments,
  });
  const decision = await resolveIdempotencyKey(transaction, context, { operation: EXTRACTION_METADATA_REVIEW_OPERATION, key: input.idempotencyKey, requestHash });
  if (decision.kind === 'replay') return { ...JSON.parse(decision.stored.responseReference), replayed: true };
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${input.extractionId}`}, 2))`;
  const loan = await transaction.loanApplication.findFirst({ where: { id: input.loanId, tenantId: context.tenantId }, select: { id: true, version: true } });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  if (loan.version !== input.expectedLoanVersion) throw new ApiError(409, 'VERSION_CONFLICT', 'The loan changed. Reload and retry.');
  const extraction = await transaction.incomeExtraction.findFirst({
    where: { id: input.extractionId, loanId: input.loanId, tenantId: context.tenantId },
    select: { id: true, status: true, normalizedInput: true, canonicalHash: true, sourceDocumentId: true, sourceDocumentVersion: true, sourceContentHash: true,
      sourceDocument: { select: { version: true, sourceContentHash: true } },
      metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { metadataVersion: true, assignments: true } },
    },
  });
  if (!extraction) throw new ApiError(404, 'EXTRACTION_NOT_FOUND', 'The requested extraction was not found for this loan.');
  if (extraction.status !== 'ACTIVE' || extraction.sourceDocument.version !== extraction.sourceDocumentVersion || extraction.sourceDocument.sourceContentHash !== extraction.sourceContentHash) {
    throw new ApiError(409, 'STALE_EXTRACTION_SOURCE', 'The extraction no longer matches its source document.');
  }
  const latest = extraction.metadataReviews[0];
  if ((latest?.metadataVersion ?? 0) !== input.expectedMetadataVersion) throw new ApiError(409, 'METADATA_VERSION_CONFLICT', 'Metadata changed. Reload and retry.');
  const entities = readMetadataEntities(extraction.normalizedInput);
  for (const assignment of input.assignments) validateAssignment(assignment, entities);
  const merged = new Map<string, ExtractionMetadataAssignment>();
  for (const assignment of readStoredAssignments(latest?.assignments)) merged.set(assignment.entityId, assignment);
  for (const assignment of input.assignments) merged.set(assignment.entityId, { ...merged.get(assignment.entityId), ...assignment });
  const assignments = Array.from(merged.values()).sort((a, b) => a.entityId.localeCompare(b.entityId));
  await assertBorrowerKeys(transaction, context.tenantId, input.loanId, assignments);
  const metadataVersion = input.expectedMetadataVersion + 1;
  const canonicalHash = hashCanonical({ tenantId: context.tenantId, loanId: input.loanId, extractionId: input.extractionId, extractionHash: extraction.canonicalHash, sourceDocumentId: extraction.sourceDocumentId, sourceDocumentVersion: extraction.sourceDocumentVersion, sourceContentHash: extraction.sourceContentHash, metadataVersion, assignments, source: input.source, reasonCode: input.reasonCode, reasonNarrative: input.reasonNarrative, reviewedByUserId: context.membershipId });
  const review = await transaction.incomeExtractionMetadataReview.create({ data: {
    tenantId: context.tenantId, loanId: input.loanId, extractionId: input.extractionId, sourceDocumentId: extraction.sourceDocumentId,
    sourceDocumentVersion: extraction.sourceDocumentVersion, sourceContentHash: extraction.sourceContentHash, extractionHash: extraction.canonicalHash,
    metadataVersion, assignments: assignments as Prisma.InputJsonValue, source: input.source, reasonCode: input.reasonCode,
    reasonNarrative: input.reasonNarrative, reviewedByUserId: context.membershipId, canonicalHash,
  }, select: { id: true } });
  const updated = await transaction.loanApplication.updateMany({ where: { id: input.loanId, tenantId: context.tenantId, version: input.expectedLoanVersion }, data: { version: { increment: 1 } } });
  if (updated.count !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'The loan changed. Reload and retry.');
  const event = await appendAuditEvent(transaction, context, { loanId: input.loanId, entityType: 'INCOME_EXTRACTION_METADATA_REVIEW', entityId: review.id, expectedLoanVersion: input.expectedLoanVersion, action: AUDIT_ACTIONS.EXTRACTION_METADATA_REVIEWED, reasonCode: input.reasonCode, reasonNarrative: input.reasonNarrative, ruleVersion: 'extraction-metadata-v1', schemaVersion: 'audit-event-v1', resultHash: hashAuditResult({ extractionId: input.extractionId, metadataVersion, canonicalHash }) });
  const result = { reviewId: review.id, extractionId: input.extractionId, metadataVersion, canonicalHash, loanVersion: input.expectedLoanVersion + 1, auditEventId: event.id };
  await storeIdempotencyResult(transaction, context, { operation: EXTRACTION_METADATA_REVIEW_OPERATION, key: input.idempotencyKey, requestHash, responseCode: 201, responseReference: JSON.stringify(result) });
  return { ...result, replayed: false };
}

function parseAssignment(value: unknown): ExtractionMetadataAssignment {
  if (!isRecord(value) || typeof value.entityId !== 'string' || value.entityId.length < 1 || value.entityId.length > 160) throw new ApiError(400, 'INVALID_METADATA_ASSIGNMENT', 'Each assignment requires a valid entityId.');
  const keys = Object.keys(value); if (keys.some((key) => !ASSIGNMENT_FIELDS.includes(key))) throw new ApiError(400, 'INVALID_METADATA_ASSIGNMENT', 'An assignment contains an unsupported field.');
  const assignment: {
    entityId: string; taxYear?: number; employmentRole?: ExtractionMetadataAssignment['employmentRole']; ownershipPercentage?: number;
    borrowerKey?: string; elapsedMonths?: number; payFrequency?: ExtractionMetadataAssignment['payFrequency'];
    baseIncomeMethod?: ExtractionMetadataAssignment['baseIncomeMethod']; includeInQualifyingIncome?: boolean;
    wvoeBaseMethod?: ExtractionMetadataAssignment['wvoeBaseMethod']; wvoeVariableMethod?: ExtractionMetadataAssignment['wvoeVariableMethod'];
    hasThreeYearAssetSupport?: boolean; hasStableDistributions?: boolean; cash?: number; currentLiabilities?: number;
    iraAccountBalance?: number; hasThreeYearIraContinuance?: boolean; grossUpIraNonTaxable?: boolean;
  } = { entityId: value.entityId };
  if (value.taxYear !== undefined) assignment.taxYear = boundedInteger(value.taxYear, 1990, 2100, 'taxYear');
  if (value.employmentRole !== undefined) { if (typeof value.employmentRole !== 'string' || !ROLES.has(value.employmentRole)) throw new ApiError(400, 'INVALID_EMPLOYMENT_ROLE', 'The employment role is not allowed.'); assignment.employmentRole = value.employmentRole as ExtractionMetadataAssignment['employmentRole']; }
  if (value.ownershipPercentage !== undefined) { if (typeof value.ownershipPercentage !== 'number' || !Number.isFinite(value.ownershipPercentage) || value.ownershipPercentage < 0 || value.ownershipPercentage > 100) throw new ApiError(400, 'INVALID_OWNERSHIP_PERCENTAGE', 'ownershipPercentage must be between 0 and 100.'); assignment.ownershipPercentage = value.ownershipPercentage; }
  if (value.borrowerKey !== undefined) { if (typeof value.borrowerKey !== 'string' || !BORROWER_KEY.test(value.borrowerKey)) throw new ApiError(400, 'INVALID_BORROWER_KEY', 'Borrower identity must be a stable borrower key.'); assignment.borrowerKey = value.borrowerKey; }
  if (value.elapsedMonths !== undefined) { if (typeof value.elapsedMonths !== 'number' || !Number.isFinite(value.elapsedMonths) || value.elapsedMonths <= 0 || value.elapsedMonths > 12) throw new ApiError(400, 'INVALID_ELAPSED_MONTHS', 'Elapsed months must be greater than 0 and at most 12.'); assignment.elapsedMonths = value.elapsedMonths; }
  if (value.payFrequency !== undefined) { if (typeof value.payFrequency !== 'string' || !FREQUENCIES.has(value.payFrequency)) throw new ApiError(400, 'INVALID_PAY_FREQUENCY', 'The pay frequency is not allowed.'); assignment.payFrequency = value.payFrequency as ExtractionMetadataAssignment['payFrequency']; }
  if (value.baseIncomeMethod !== undefined) { if (typeof value.baseIncomeMethod !== 'string' || !BASE_METHODS.has(value.baseIncomeMethod)) throw new ApiError(400, 'INVALID_BASE_METHOD', 'The base income method is not allowed.'); assignment.baseIncomeMethod = value.baseIncomeMethod as ExtractionMetadataAssignment['baseIncomeMethod']; }
  if (value.wvoeBaseMethod !== undefined) { if (typeof value.wvoeBaseMethod !== 'string' || !WVOE_BASE_METHODS.has(value.wvoeBaseMethod)) throw new ApiError(400, 'INVALID_BASE_METHOD', 'The verification base method is not allowed.'); assignment.wvoeBaseMethod = value.wvoeBaseMethod as ExtractionMetadataAssignment['wvoeBaseMethod']; }
  if (value.wvoeVariableMethod !== undefined) { if (typeof value.wvoeVariableMethod !== 'string' || !WVOE_VARIABLE_METHODS.has(value.wvoeVariableMethod)) throw new ApiError(400, 'INVALID_VARIABLE_METHOD', 'The verification variable method is not allowed.'); assignment.wvoeVariableMethod = value.wvoeVariableMethod as ExtractionMetadataAssignment['wvoeVariableMethod']; }
  if (value.includeInQualifyingIncome !== undefined) { if (typeof value.includeInQualifyingIncome !== 'boolean') throw new ApiError(400, 'INVALID_ASSET_ELECTION', 'Asset inclusion must be true or false.'); assignment.includeInQualifyingIncome = value.includeInQualifyingIncome; }
  if (value.hasThreeYearAssetSupport !== undefined) { if (typeof value.hasThreeYearAssetSupport !== 'boolean') throw new ApiError(400, 'INVALID_ASSET_ELECTION', 'Asset continuance must be true or false.'); assignment.hasThreeYearAssetSupport = value.hasThreeYearAssetSupport; }
  if (value.hasStableDistributions !== undefined) { if (typeof value.hasStableDistributions !== 'boolean') throw new ApiError(400, 'INVALID_METADATA_ASSIGNMENT', 'Distribution stability must be true or false.'); assignment.hasStableDistributions = value.hasStableDistributions; }
  if (value.cash !== undefined) assignment.cash = boundedMoney(value.cash, 'cash');
  if (value.currentLiabilities !== undefined) assignment.currentLiabilities = boundedMoney(value.currentLiabilities, 'currentLiabilities');
  if (value.iraAccountBalance !== undefined) assignment.iraAccountBalance = boundedMoney(value.iraAccountBalance, 'iraAccountBalance');
  if (value.hasThreeYearIraContinuance !== undefined) { if (typeof value.hasThreeYearIraContinuance !== 'boolean') throw new ApiError(400, 'INVALID_IRA_CONTINUANCE', 'IRA continuance must be true or false.'); assignment.hasThreeYearIraContinuance = value.hasThreeYearIraContinuance; }
  if (value.grossUpIraNonTaxable !== undefined) { if (typeof value.grossUpIraNonTaxable !== 'boolean') throw new ApiError(400, 'INVALID_IRA_CONTINUANCE', 'IRA gross-up must be true or false.'); assignment.grossUpIraNonTaxable = value.grossUpIraNonTaxable; }
  if (assignment.grossUpIraNonTaxable === true && assignment.hasThreeYearIraContinuance === false) throw new ApiError(400, 'INVALID_IRA_CONTINUANCE', 'IRA distributions cannot be grossed up without confirmed continuance.');
  if (keys.length === 1) throw new ApiError(400, 'EMPTY_METADATA_ASSIGNMENT', 'Each assignment must supply metadata.');
  return assignment;
}
function readMetadataEntities(value: unknown): Map<string, string> {
  if (!isRecord(value)) throw new ApiError(422, 'INVALID_PERSISTED_EXTRACTION', 'The extraction metadata contract is invalid.');
  const result = new Map<string, string>();
  for (const row of [...array(value.w2Records), ...array(value.formRecords)]) if (isRecord(row) && typeof row.entityId === 'string') result.set(row.entityId, typeof row.form === 'string' ? row.form : 'W-2');
  array(value.scheduleEProperties).forEach((_, index) => result.set(`schedule-e-${index}`, 'Schedule E'));
  return result;
}
function validateAssignment(item: ExtractionMetadataAssignment, entities: Map<string, string>): void {
  const form = entities.get(item.entityId); if (!form) throw new ApiError(422, 'UNKNOWN_EXTRACTION_ENTITY', 'An assignment does not match this extraction.');
  if (form === 'W-2' && (item.taxYear !== undefined || item.ownershipPercentage !== undefined || item.elapsedMonths !== undefined || item.payFrequency !== undefined || item.includeInQualifyingIncome !== undefined)) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'W-2 metadata only accepts employment role and borrower assignment.');
  if (form !== 'W-2' && !YTD_FORMS.includes(form) && item.employmentRole !== undefined) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Employment role only applies to W-2, paystub, and verification records.');
  if (!YTD_FORMS.includes(form) && item.elapsedMonths !== undefined) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Elapsed months only applies to a year-to-date wage document.');
  if (form !== 'Paystub' && (item.payFrequency !== undefined || item.baseIncomeMethod !== undefined)) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Paystub annualization metadata only applies to paystubs.');
  if (form !== 'WVOE' && (item.wvoeBaseMethod !== undefined || item.wvoeVariableMethod !== undefined)) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Verification annualization metadata only applies to a verification of employment.');
  if (item.ownershipPercentage !== undefined && !['Form 1120-S', 'Form 1065', 'Form 1120'].includes(form)) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Ownership metadata is not accepted for this form.');
  if ((item.includeInQualifyingIncome !== undefined || item.hasThreeYearAssetSupport !== undefined) && !['Schedule B', 'Schedule D'].includes(form)) throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Asset election only applies to Schedule B or D.');
  if ((item.iraAccountBalance !== undefined || item.hasThreeYearIraContinuance !== undefined || item.grossUpIraNonTaxable !== undefined) && form !== 'Form 1040') throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'IRA continuance only applies to Form 1040.');
  if ((item.cash !== undefined || item.currentLiabilities !== undefined) && form !== 'Form 1120') throw new ApiError(422, 'METADATA_FIELD_NOT_ALLOWED', 'Balance-sheet facts only apply to Form 1120.');
}
async function assertBorrowerKeys(
  transaction: Prisma.TransactionClient, tenantId: string, loanId: string, assignments: readonly ExtractionMetadataAssignment[],
): Promise<void> {
  const keys = assignments.flatMap((item) => item.borrowerKey ? [item.borrowerKey] : []);
  if (!keys.length) return;
  const roster = await transaction.loanBorrower.findMany({ where: { tenantId, loanId }, select: { borrowerKey: true } });
  const allowed = new Set(roster.map((item) => item.borrowerKey));
  if (keys.some((key) => !allowed.has(key))) throw new ApiError(422, 'UNKNOWN_BORROWER', 'An assignment names a borrower that is not on this loan.');
}
function readStoredAssignments(value: unknown): ExtractionMetadataAssignment[] { return Array.isArray(value) ? value.map(parseAssignment) : []; }
function positiveInteger(value: unknown, field: string): number { return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, field); }
function nonnegativeInteger(value: unknown, field: string): number { return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER, field); }
function boundedInteger(value: unknown, min: number, max: number, field: string): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ApiError(400, 'INVALID_METADATA_VERSION', `${field} is invalid.`); return value; }
function boundedMoney(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new ApiError(400, 'INVALID_METADATA_ASSIGNMENT', `${field} is invalid.`); return value; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
