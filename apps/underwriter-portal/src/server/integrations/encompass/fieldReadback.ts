import type { EncompassFieldReadbackReport } from '@mortgage-pos/encompass-connector-contract';

const FIELD_NAME = /^(?:CX\.[A-Z0-9][A-Z0-9._-]{0,99}|10[1-7])$/;
const LEGACY_SHA_256 = /^[0-9a-f]{64}$/;
const REASON_FOR_STATUS = {
  SUCCESS: 'VALUE_CONFIRMED',
  REJECTED: 'PROVIDER_REJECTED',
  UNAVAILABLE: 'FIELD_UNAVAILABLE',
  CONFLICT: 'VALUE_CONFLICT',
} as const;

export class FieldReadbackValidationError extends Error {
  readonly safeCode = 'ENCOMPASS_FIELD_READBACK_INVALID';

  constructor() {
    super('The Encompass field readback report is invalid.');
    this.name = 'FieldReadbackValidationError';
  }
}

/**
 * Reconstructs a closed, value-free report before persistence or output.
 * Legacy deterministic value hashes are validated and discarded so existing
 * records remain readable without exposing low-entropy value digests.
 */
export function sanitizeFieldReadback(
  value: unknown,
  options: Readonly<{
    allowedFieldNames?: ReadonlySet<string>;
    expectedOutcome?: 'SUCCEEDED' | 'FAILED';
  }> = {},
): EncompassFieldReadbackReport {
  if (!isRecord(value)
    || !onlyKeys(value, ['schemaVersion', 'allSucceeded', 'fields'])
    || value.schemaVersion !== 'encompass-field-readback-v1'
    || typeof value.allSucceeded !== 'boolean'
    || !Array.isArray(value.fields)
    || value.fields.length < 1
    || value.fields.length > 32) {
    throw new FieldReadbackValidationError();
  }

  const fields = value.fields.map((field) => {
    if (!isRecord(field)
      || !onlyKeys(field, ['fieldName', 'status', 'reasonCode', 'expectedValueSha256', 'actualValueSha256'])
      || typeof field.fieldName !== 'string'
      || !FIELD_NAME.test(field.fieldName)
      || !isStatus(field.status)
      || field.reasonCode !== REASON_FOR_STATUS[field.status]
      || (field.expectedValueSha256 !== undefined
        && (typeof field.expectedValueSha256 !== 'string' || !LEGACY_SHA_256.test(field.expectedValueSha256)))
      || (field.actualValueSha256 !== undefined
        && (typeof field.actualValueSha256 !== 'string' || !LEGACY_SHA_256.test(field.actualValueSha256)))) {
      throw new FieldReadbackValidationError();
    }
    return {
      fieldName: field.fieldName,
      status: field.status,
      reasonCode: REASON_FOR_STATUS[field.status],
    };
  });
  const names = fields.map((field) => field.fieldName);
  const calculatedSuccess = fields.every((field) => field.status === 'SUCCESS');
  if (new Set(names).size !== names.length
    || value.allSucceeded !== calculatedSuccess
    || (options.allowedFieldNames && (
      names.length !== options.allowedFieldNames.size
      || names.some((name) => !options.allowedFieldNames?.has(name))
    ))
    || (options.expectedOutcome && ((options.expectedOutcome === 'SUCCEEDED') !== calculatedSuccess))) {
    throw new FieldReadbackValidationError();
  }
  return {
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: calculatedSuccess,
    fields,
  };
}

function isStatus(value: unknown): value is keyof typeof REASON_FOR_STATUS {
  return typeof value === 'string' && Object.hasOwn(REASON_FOR_STATUS, value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
