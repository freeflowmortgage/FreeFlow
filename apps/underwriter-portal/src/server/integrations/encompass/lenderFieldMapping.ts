import {
  resolveEncompassIncomeFieldMap,
  type EncompassIncomeFieldMapOverrides,
} from '@mortgage-pos/mortgage-engine';

export const LENDER_FIELD_MAPPING_SCHEMA_VERSION = 'encompass-lender-field-mappings-v1' as const;

type MappingEntry = Readonly<{
  lenderId: string;
  deploymentId: string;
  fields: EncompassIncomeFieldMapOverrides;
}>;

export type LenderFieldMappingConfiguration = Readonly<{
  schemaVersion: typeof LENDER_FIELD_MAPPING_SCHEMA_VERSION;
  mappings: ReadonlyArray<MappingEntry>;
}>;

export class LenderFieldMappingConfigurationError extends Error {
  readonly safeCode: 'ENCOMPASS_LENDER_FIELD_MAPPING_INVALID' | 'ENCOMPASS_LENDER_FIELD_MAPPING_MISSING';

  constructor(safeCode: LenderFieldMappingConfigurationError['safeCode']) {
    super('The lender-specific Encompass field mapping is unavailable.');
    this.name = 'LenderFieldMappingConfigurationError';
    this.safeCode = safeCode;
  }
}

/**
 * Parses non-secret deployment configuration. Configured entries are keyed by
 * the same lender/deployment pair that was authoritatively resolved from the
 * tenant-bound database record; request-provided lender identifiers are never
 * accepted here.
 */
export function parseLenderFieldMappingConfiguration(
  serialized: string | undefined,
): LenderFieldMappingConfiguration | undefined {
  if (!serialized?.trim()) return undefined;
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { throw new LenderFieldMappingConfigurationError('ENCOMPASS_LENDER_FIELD_MAPPING_INVALID'); }
  if (!isRecord(value)
    || value.schemaVersion !== LENDER_FIELD_MAPPING_SCHEMA_VERSION
    || !Array.isArray(value.mappings)
    || !onlyKeys(value, ['schemaVersion', 'mappings'])) {
    throw new LenderFieldMappingConfigurationError('ENCOMPASS_LENDER_FIELD_MAPPING_INVALID');
  }
  const mappings: MappingEntry[] = value.mappings.map((entry) => {
    if (!isRecord(entry)
      || !onlyKeys(entry, ['lenderId', 'deploymentId', 'fields'])
      || !identifier(entry.lenderId)
      || !identifier(entry.deploymentId)
      || !isRecord(entry.fields)) {
      throw new LenderFieldMappingConfigurationError('ENCOMPASS_LENDER_FIELD_MAPPING_INVALID');
    }
    try { resolveEncompassIncomeFieldMap(entry.fields); }
    catch { throw new LenderFieldMappingConfigurationError('ENCOMPASS_LENDER_FIELD_MAPPING_INVALID'); }
    return {
      lenderId: entry.lenderId,
      deploymentId: entry.deploymentId,
      fields: Object.freeze({ ...entry.fields }) as EncompassIncomeFieldMapOverrides,
    };
  });
  const keys = mappings.map((entry) => `${entry.lenderId}\u0000${entry.deploymentId}`);
  if (new Set(keys).size !== keys.length) {
    throw new LenderFieldMappingConfigurationError('ENCOMPASS_LENDER_FIELD_MAPPING_INVALID');
  }
  return Object.freeze({
    schemaVersion: LENDER_FIELD_MAPPING_SCHEMA_VERSION,
    mappings: Object.freeze(mappings),
  });
}

export function fieldMapForAuthoritativeBinding(
  configuration: LenderFieldMappingConfiguration | undefined,
  binding: Readonly<{ lenderId: string; deploymentId: string }>,
): EncompassIncomeFieldMapOverrides | undefined {
  if (!configuration) return undefined;
  const match = configuration.mappings.find((entry) => (
    entry.lenderId === binding.lenderId && entry.deploymentId === binding.deploymentId
  ));
  if (!match) throw new LenderFieldMappingConfigurationError('ENCOMPASS_LENDER_FIELD_MAPPING_MISSING');
  return match.fields;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
