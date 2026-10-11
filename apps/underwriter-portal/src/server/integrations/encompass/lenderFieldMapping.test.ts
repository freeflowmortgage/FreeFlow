import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LenderFieldMappingConfigurationError,
  fieldMapForAuthoritativeBinding,
  parseLenderFieldMappingConfiguration,
} from './lenderFieldMapping';

const BINDING = { lenderId: 'synthetic-lender', deploymentId: 'synthetic-deployment' };

test('mapping overrides resolve only for the authoritative lender/deployment binding', () => {
  const configuration = parseLenderFieldMappingConfiguration(JSON.stringify({
    schemaVersion: 'encompass-lender-field-mappings-v1',
    mappings: [{
      ...BINDING,
      fields: {
        FREEFLOW_W2_VARIABLE: 'CX.SYNTHETIC.W2.VARIABLE',
        FREEFLOW_ASSET_INCOME: 'CX.SYNTHETIC.ASSET.INCOME',
      },
    }],
  }));
  assert.deepEqual(fieldMapForAuthoritativeBinding(configuration, BINDING), {
    FREEFLOW_W2_VARIABLE: 'CX.SYNTHETIC.W2.VARIABLE',
    FREEFLOW_ASSET_INCOME: 'CX.SYNTHETIC.ASSET.INCOME',
  });
  assert.throws(
    () => fieldMapForAuthoritativeBinding(configuration, { ...BINDING, lenderId: 'request-claimed-lender' }),
    (error: unknown) => error instanceof LenderFieldMappingConfigurationError
      && error.safeCode === 'ENCOMPASS_LENDER_FIELD_MAPPING_MISSING',
  );
});

test('invalid, colliding, duplicate, unknown, and historical unsupported numeric mappings fail closed', () => {
  const invalidFields = [
    { UNKNOWN_FIELD: 'CX.SYNTHETIC.VALUE' },
    { FREEFLOW_W2_VARIABLE: 'CX.FREEFLOW.W2.BASE' },
    { FREEFLOW_W2_VARIABLE: 'CX.FREEFLOW.APPROVAL.ID' },
    { FREEFLOW_W2_VARIABLE: 'CX.FREEFLOW.BORROWER.1.INCOME' },
    { FREEFLOW_W2_VARIABLE: '108' },
    { FREEFLOW_W2_VARIABLE: 'unsafe field' },
  ];
  for (const fields of invalidFields) {
    assert.throws(
      () => parseLenderFieldMappingConfiguration(JSON.stringify({
        schemaVersion: 'encompass-lender-field-mappings-v1',
        mappings: [{ ...BINDING, fields }],
      })),
      (error: unknown) => error instanceof LenderFieldMappingConfigurationError
        && error.safeCode === 'ENCOMPASS_LENDER_FIELD_MAPPING_INVALID',
    );
  }
  assert.throws(
    () => parseLenderFieldMappingConfiguration(JSON.stringify({
      schemaVersion: 'encompass-lender-field-mappings-v1',
      mappings: [{ ...BINDING, fields: {} }, { ...BINDING, fields: {} }],
    })),
    LenderFieldMappingConfigurationError,
  );
});
