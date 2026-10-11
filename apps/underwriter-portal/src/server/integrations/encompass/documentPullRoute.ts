import type { NextApiRequest, NextApiResponse } from 'next';
import { withTenantTransaction } from '../../database/client';
import type { RequestContext } from '../../auth/requestContext';
import { ApiError, sendApiError } from '../../http/apiError';
import { isIdempotencyKey, isUuid } from '../../http/identifiers';
import {
  createDocumentPullJob,
  markDocumentPullQueueFailure,
  publishDocumentPullJob,
  type DocumentPullQueueMessage,
} from './documentPull';

type DocumentPullHandlerDependencies = {
  withTenantTransaction: typeof withTenantTransaction;
  publishJob: (message: DocumentPullQueueMessage) => Promise<void>;
};

const defaultDependencies: DocumentPullHandlerDependencies = {
  withTenantTransaction,
  publishJob: publishDocumentPullJob,
};

export function createDocumentPullHandler(
  dependencies: DocumentPullHandlerDependencies = defaultDependencies,
) {
  return async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
    context: RequestContext,
  ) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.', requestId: context.requestId },
      });
    }

    try {
      const loanId = readPathUuid(req.query.loanId);
      const idempotencyKey = readIdempotencyKey(req);
      const expectedLoanVersion = readExpectedLoanVersion(req.body);
      const attachmentIds = readAttachmentIds(req.body);
      const selectionBindingHash = readSelectionBindingHash(req.body);
      const result = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => createDocumentPullJob(transaction, context, {
          loanId,
          expectedLoanVersion,
          attachmentIds,
          selectionBindingHash,
          idempotencyKey,
        }),
      );

      if (!result.replayed) {
        try {
          await dependencies.publishJob({
            jobId: result.jobId,
            tenantId: context.tenantId,
            loanId,
            expectedLoanVersion: result.expectedLoanVersion,
            correlationId: result.correlationId,
          });
        } catch {
          await dependencies.withTenantTransaction(
            { tenantId: context.tenantId, principalId: context.membershipId },
            (transaction) => markDocumentPullQueueFailure(transaction, context, result.jobId),
          );
          return res.status(503).json({
            error: {
              code: 'DOCUMENT_PULL_QUEUE_UNAVAILABLE',
              message: 'The document pull could not be queued. It is safe to retry later.',
              requestId: context.requestId,
            },
          });
        }
      }

      return res.status(202).json({
        jobId: result.jobId,
        status: result.status,
        replayed: result.replayed,
        requestId: context.requestId,
      });
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      throw error;
    }
  };
}

function readPathUuid(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ApiError(400, 'INVALID_IDENTIFIER', 'The loanId is not a valid identifier.');
  }
  return value;
}

function readIdempotencyKey(req: NextApiRequest): string {
  const value = req.headers['idempotency-key'];
  if (Array.isArray(value) || typeof value !== 'string' || !isIdempotencyKey(value)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  }
  return value;
}

function readExpectedLoanVersion(body: unknown): number {
  const value = (body as { expectedLoanVersion?: unknown } | null)?.expectedLoanVersion;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ApiError(400, 'INVALID_LOAN_VERSION', 'expectedLoanVersion must be a positive integer.');
  }
  return value as number;
}

function readAttachmentIds(body: unknown): string[] {
  const value = (body as { attachmentIds?: unknown } | null)?.attachmentIds;
  if (!Array.isArray(value) || value.length < 1 || value.length > 20
    || value.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id))
    || new Set(value).size !== value.length) {
    throw new ApiError(400, 'INVALID_ATTACHMENT_SELECTION', 'attachmentIds must contain 1 to 20 unique attachment identifiers.');
  }
  return value as string[];
}

function readSelectionBindingHash(body: unknown): string {
  const value = (body as { selectionBindingHash?: unknown } | null)?.selectionBindingHash;
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ApiError(400, 'INVALID_ATTACHMENT_SELECTION_BINDING', 'A valid attachment selection binding is required.');
  }
  return value;
}
