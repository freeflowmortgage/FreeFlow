import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION,
  normalizeLoan,
} from '@mortgage-pos/mortgage-engine';
import type { RequestContext } from '../auth/requestContext';
import { withTenantTransaction } from '../database/client';
import {
  AUDIT_ACTIONS,
  appendAuditEvent,
  hashAuditResult,
} from '../audit/appendEvent';
import {
  resolveIdempotencyKey,
  storeIdempotencyResult,
} from '../audit/idempotency';
import { ApiError, sendApiError } from '../http/apiError';
import { hashCanonical } from '../http/canonical';
import { isIdempotencyKey } from '../http/identifiers';
import {
  BORROWER_KEY,
  persistLoanBorrowerRoster,
  type BorrowerRosterSlot,
  type PersistedBorrower,
} from './loanBorrowerRoster';

export const STANDALONE_LOAN_SCHEMA_VERSION = 'freeflow-standalone-loan-v1' as const;
const STANDALONE_LOAN_OPERATION = 'standalone-loans';
const MAX_BORROWERS = 4;
const ALLOWED_TOP_LEVEL_FIELDS = new Set(['schemaVersion', 'loanProgram', 'borrowers']);
const ALLOWED_BORROWER_FIELDS = new Set(['borrowerKey', 'role']);
const SUPPORTED_PROGRAMS = new Set(['CONVENTIONAL', 'FHA', 'VA']);

export type StandaloneLoanInput = Readonly<{
  schemaVersion: typeof STANDALONE_LOAN_SCHEMA_VERSION;
  loanProgram: 'CONVENTIONAL' | 'FHA' | 'VA';
  borrowers: readonly BorrowerRosterSlot[];
}>;

type StandaloneLoanResult = Readonly<{
  loanId: string;
  loanVersion: number;
  integrationMode: 'NONE';
  schemaVersion: typeof STANDALONE_LOAN_SCHEMA_VERSION;
  borrowers: readonly PersistedBorrower[];
  auditEventId: string;
}>;

export function parseStandaloneLoanInput(value: unknown): StandaloneLoanInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED_TOP_LEVEL_FIELDS.has(key))) {
    throw new ApiError(400, 'INVALID_STANDALONE_LOAN', 'The standalone loan file contains unsupported fields.');
  }
  if (value.schemaVersion !== STANDALONE_LOAN_SCHEMA_VERSION) {
    throw new ApiError(400, 'UNSUPPORTED_STANDALONE_LOAN_VERSION', 'The standalone loan schema version is not supported.');
  }
  if (typeof value.loanProgram !== 'string' || !SUPPORTED_PROGRAMS.has(value.loanProgram)) {
    if (value.loanProgram === 'USDA') {
      throw new ApiError(422, 'UNSUPPORTED_STANDALONE_PROGRAM', 'USDA is not supported by the authoritative document calculation workflow.');
    }
    throw new ApiError(400, 'INVALID_LOAN_PROGRAM', 'The standalone loan program must be CONVENTIONAL, FHA, or VA.');
  }
  if (!Array.isArray(value.borrowers) || value.borrowers.length < 1 || value.borrowers.length > MAX_BORROWERS) {
    throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'A standalone loan requires an ordered roster of 1 to 4 borrowers.');
  }
  const borrowers = value.borrowers.map((item, ordinal): BorrowerRosterSlot => {
    if (!isRecord(item) || Object.keys(item).some((key) => !ALLOWED_BORROWER_FIELDS.has(key))) {
      throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'Borrower entries accept only a stable key and role.');
    }
    if (typeof item.borrowerKey !== 'string' || !BORROWER_KEY.test(item.borrowerKey)) {
      throw new ApiError(400, 'INVALID_BORROWER_KEY', 'Borrower identity must be a stable borrower key.');
    }
    const expectedKey = `borrower-${ordinal + 1}`;
    if (item.borrowerKey !== expectedKey) {
      throw new ApiError(400, 'INVALID_BORROWER_ROSTER', `Borrower keys must be ordered from borrower-1; expected ${expectedKey}.`);
    }
    const expectedRole = ordinal === 0 ? 'PRIMARY' : 'CO_BORROWER';
    if (item.role !== expectedRole) {
      throw new ApiError(400, 'INVALID_BORROWER_ROLE', ordinal === 0
        ? 'The first borrower must be PRIMARY.'
        : 'Only the first borrower may be PRIMARY.');
    }
    return { borrowerKey: item.borrowerKey, role: expectedRole };
  });
  return {
    schemaVersion: STANDALONE_LOAN_SCHEMA_VERSION,
    loanProgram: value.loanProgram as StandaloneLoanInput['loanProgram'],
    borrowers,
  };
}

export function createStandaloneLoanHandler(dependencies = { withTenantTransaction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.', requestId: context.requestId },
      });
    }
    try {
      const input = parseStandaloneLoanInput(req.body);
      const normalizedLoan = normalizeLoan({
        loanProgram: input.loanProgram,
        borrowers: input.borrowers,
      });
      const idempotencyKey = readIdempotencyKey(req);
      const requestHash = hashCanonical(input);
      const result = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        async (transaction) => {
          const decision = await resolveIdempotencyKey(transaction, context, {
            operation: STANDALONE_LOAN_OPERATION,
            key: idempotencyKey,
            requestHash,
          });
          if (decision.kind === 'replay') return parseStoredResult(decision.stored.responseReference);

          const loan = await transaction.loanApplication.create({
            data: {
              tenantId: context.tenantId,
              loanProgram: normalizedLoan.loanProgram,
              encompassIntegrationMode: 'NONE',
              status: 'DRAFT',
            },
            select: { id: true, version: true },
          });
          const borrowers = await persistLoanBorrowerRoster(
            transaction,
            context.tenantId,
            loan.id,
            normalizedLoan.borrowers,
          );
          const event = await appendAuditEvent(transaction, context, {
            loanId: loan.id,
            entityType: 'LOAN_APPLICATION',
            entityId: loan.id,
            expectedLoanVersion: loan.version,
            action: AUDIT_ACTIONS.STANDALONE_LOAN_CREATED,
            reasonCode: 'STANDALONE_INTAKE',
            ruleVersion: FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION,
            schemaVersion: 'audit-event-v1',
            resultHash: hashAuditResult({
              intakeSchemaVersion: input.schemaVersion,
              normalizedLoan,
              integrationMode: 'NONE',
            }),
          });
          const created: StandaloneLoanResult = {
            loanId: loan.id,
            loanVersion: loan.version,
            integrationMode: 'NONE',
            schemaVersion: STANDALONE_LOAN_SCHEMA_VERSION,
            borrowers,
            auditEventId: event.id,
          };
          await storeIdempotencyResult(transaction, context, {
            operation: STANDALONE_LOAN_OPERATION,
            key: idempotencyKey,
            requestHash,
            responseCode: 201,
            responseReference: JSON.stringify(created),
          });
          return created;
        },
      );
      return res.status(201).json({ ...result, requestId: context.requestId });
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      throw error;
    }
  };
}

function readIdempotencyKey(req: NextApiRequest): string {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || !isIdempotencyKey(value)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  }
  return value;
}

function parseStoredResult(value: string): StandaloneLoanResult {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The stored standalone loan result is unusable.'); }
  if (!isRecord(parsed)
    || typeof parsed.loanId !== 'string'
    || typeof parsed.loanVersion !== 'number'
    || parsed.integrationMode !== 'NONE'
    || parsed.schemaVersion !== STANDALONE_LOAN_SCHEMA_VERSION
    || typeof parsed.auditEventId !== 'string'
    || !Array.isArray(parsed.borrowers)) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The stored standalone loan result is unusable.');
  }
  return parsed as unknown as StandaloneLoanResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
