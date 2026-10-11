import { createHash } from 'node:crypto';
import type { EncompassConnector } from './connector';
import { EncompassConnectorError } from './errors';
import type {
  EncompassApprovedIncomeUpdate,
  EncompassConnectorContext,
  EncompassFieldReadbackReport,
  EncompassFieldWrite,
  EncompassProviderFieldDisposition,
  EncompassWritePreview,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_NAME = /^(?:CX\.[A-Z0-9][A-Z0-9._-]{0,99}|10[1-7])$/;

/** Creates the immutable field-level preview a reviewer explicitly approves. */
export function buildEncompassWritePreview(update: EncompassApprovedIncomeUpdate): EncompassWritePreview {
  validateUpdate(update);
  const fields = [...update.fields]
    .map((field) => Object.freeze({ fieldName: field.fieldName, value: field.value }))
    .sort((left, right) => left.fieldName.localeCompare(right.fieldName));
  const canonical = JSON.stringify({
    schemaVersion: 'encompass-write-preview-v1',
    approvalEventId: update.approvalEventId,
    fields,
  });
  return Object.freeze({
    schemaVersion: 'encompass-write-preview-v1',
    approvalEventId: update.approvalEventId,
    previewHash: sha256(canonical),
    fields: Object.freeze(fields),
  });
}

/**
 * Compares an independent provider read with the exact approved update. Raw
 * values and deterministic value digests are intentionally omitted from the
 * durable-safe report.
 */
export function compareEncompassFieldReadback(
  expectedFields: ReadonlyArray<EncompassFieldWrite>,
  actualFields: Readonly<Record<string, string>>,
  providerResults: ReadonlyArray<EncompassProviderFieldDisposition> = [],
): EncompassFieldReadbackReport {
  validateFields(expectedFields);
  const expectedNames = new Set(expectedFields.map((field) => field.fieldName));
  validateProviderResults(providerResults, expectedNames);
  const dispositions = new Map(providerResults.map((result) => [result.fieldName, result.status]));
  const fields = expectedFields.map((expected) => {
    const providerStatus = dispositions.get(expected.fieldName);
    const actual = actualFields[expected.fieldName];
    if (providerStatus === 'REJECTED') {
      return { fieldName: expected.fieldName, status: 'REJECTED', reasonCode: 'PROVIDER_REJECTED' } as const;
    }
    if (providerStatus === 'UNAVAILABLE' || typeof actual !== 'string') {
      return { fieldName: expected.fieldName, status: 'UNAVAILABLE', reasonCode: 'FIELD_UNAVAILABLE' } as const;
    }
    if (actual !== expected.value) {
      return { fieldName: expected.fieldName, status: 'CONFLICT', reasonCode: 'VALUE_CONFLICT' } as const;
    }
    return { fieldName: expected.fieldName, status: 'SUCCESS', reasonCode: 'VALUE_CONFIRMED' } as const;
  });
  return Object.freeze({
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: fields.every((field) => field.status === 'SUCCESS'),
    fields: Object.freeze(fields),
  });
}

/**
 * Mutates only after the caller supplies an approval that matches the exact
 * preview, then requires a separate read of every intended field.
 */
export async function executeApprovedIncomeRoundTrip(input: Readonly<{
  connector: EncompassConnector;
  context: EncompassConnectorContext;
  loanGuid: string;
  preview: EncompassWritePreview;
  reviewerApproval: Readonly<{ approvalEventId: string; previewHash: string }>;
}>): Promise<Readonly<{
  providerRevision?: string;
  readback: EncompassFieldReadbackReport;
}>> {
  const rebuilt = buildEncompassWritePreview({
    approvalEventId: input.preview.approvalEventId,
    fields: input.preview.fields,
  });
  if (
    input.preview.schemaVersion !== rebuilt.schemaVersion
    || input.preview.previewHash !== rebuilt.previewHash
    || input.reviewerApproval.approvalEventId !== rebuilt.approvalEventId
    || input.reviewerApproval.previewHash !== rebuilt.previewHash
  ) {
    throw new EncompassConnectorError(
      'ENCOMPASS_WRITE_APPROVAL_MISMATCH',
      'The reviewer approval does not match the write preview.',
      false,
    );
  }

  const writeResult = await input.connector.applyApprovedIncomeUpdate(
    input.context,
    input.loanGuid,
    { approvalEventId: rebuilt.approvalEventId, fields: rebuilt.fields },
  );
  const actual = await input.connector.readFields(
    input.context,
    input.loanGuid,
    rebuilt.fields.map((field) => field.fieldName),
  );
  return {
    ...(writeResult.providerRevision ? { providerRevision: writeResult.providerRevision } : {}),
    readback: compareEncompassFieldReadback(rebuilt.fields, actual, writeResult.fieldResults),
  };
}

function validateUpdate(update: EncompassApprovedIncomeUpdate): void {
  if (!UUID.test(update.approvalEventId)) {
    throw new EncompassConnectorError('ENCOMPASS_WRITE_PREVIEW_INVALID', 'The write preview is invalid.', false);
  }
  validateFields(update.fields);
}

function validateFields(fields: ReadonlyArray<EncompassFieldWrite>): void {
  if (
    fields.length < 1
    || fields.length > 32
    || new Set(fields.map((field) => field.fieldName)).size !== fields.length
    || fields.some((field) => !FIELD_NAME.test(field.fieldName) || typeof field.value !== 'string' || field.value.length > 500)
  ) {
    throw new EncompassConnectorError('ENCOMPASS_WRITE_PREVIEW_INVALID', 'The write preview is invalid.', false);
  }
}

function validateProviderResults(
  results: ReadonlyArray<EncompassProviderFieldDisposition>,
  expectedNames: ReadonlySet<string>,
): void {
  const allowed = new Set(['APPLIED', 'REJECTED', 'UNAVAILABLE']);
  if (
    results.length > expectedNames.size
    || new Set(results.map((result) => result.fieldName)).size !== results.length
    || results.some((result) => !expectedNames.has(result.fieldName) || !allowed.has(result.status))
  ) {
    throw new EncompassConnectorError('ENCOMPASS_WRITE_RESULT_INVALID', 'The provider field result is invalid.', false);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
