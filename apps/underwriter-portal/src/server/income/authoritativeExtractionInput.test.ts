import assert from 'node:assert/strict';
import test from 'node:test';
import { annualizePaystub } from '@mortgage-pos/mortgage-engine';
import { ExtractionMetadataRequiredError, mergeAuthoritativeExtractionInputs } from './authoritativeExtractionInput';
import { hasCurrentCalculationExtractions } from './extractionFreshness';

test('merges only validated persisted extraction input and namespaces local entity ids', () => {
  const result = mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: {
      w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 120000 }],
    },
    metadataAssignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' }],
  }]);
  assert.equal(result.w2Employers?.[0].annualWages, 120000);
  assert.equal(result.w2Employers?.[0].entityId, '00000000-0000-4000-8000-000000000101:w2-p0-0');
});

test('returns exact reviewed metadata requirements and projects supported non-W2 records', () => {
  const record = {
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { formRecords: [{ entityId: 'Schedule C:business-1', form: 'Schedule C', pageIndex: 1, fields: [
      { sourceFieldId: 'ent1-name', value: 'Synthetic Consulting' }, { sourceFieldId: 'ent1-net', numericValue: 96000 },
    ] }] },
  };
  assert.throws(() => mergeAuthoritativeExtractionInputs([record]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{ extractionId: record.extractionId, entityId: 'Schedule C:business-1', field: 'taxYear', form: 'Schedule C' }]);
    return true;
  });
  const projected = mergeAuthoritativeExtractionInputs([{ ...record, metadataAssignments: [{ entityId: 'Schedule C:business-1', taxYear: 2025 }] }]);
  assert.equal(projected.scheduleC?.[0].netProfitLoss, 96000);
  assert.equal(projected.scheduleC?.[0].year, 2025);
});

test('skips return-only Form 1065 records and calculates from the reviewed K-1 record', () => {
  const extractionId = '00000000-0000-4000-8000-000000000106';
  const returnEntityId = 'Form 1065:partnership-return-p0';
  const k1EntityId = 'Form 1065:partnership-k1-p1';
  const result = mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput: { formRecords: [
      {
        entityId: returnEntityId,
        form: 'Form 1065',
        pageIndex: 0,
        fields: [
          { sourceFieldId: 'pt-return-name', value: 'Synthetic Partnership' },
          { sourceFieldId: 'pt-return-ord', numericValue: 12000 },
        ],
      },
      {
        entityId: k1EntityId,
        form: 'Form 1065',
        pageIndex: 1,
        fields: [
          { sourceFieldId: 'pt-name', value: 'Synthetic Partnership' },
          { sourceFieldId: 'pt-ord', numericValue: 96000 },
          { sourceFieldId: 'pt-profit-pct', numericValue: 50 },
          { sourceFieldId: 'pt-dist', numericValue: 60000 },
        ],
      },
    ] },
    metadataAssignments: [{ entityId: k1EntityId, taxYear: 2025, ownershipPercentage: 50 }],
  }]);

  assert.equal(result.form1065?.length, 1);
  assert.equal(result.form1065?.[0].entityId, `${extractionId}:${k1EntityId}`);
  assert.equal(result.form1065?.[0].k1OrdinaryIncome, 96000);
});

test('rejects unknown or malformed persisted calculation fields', () => {
  assert.throws(() => mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { rawOcrText: 'must never be accepted' },
  }]));
});

test('incomplete paystub stays GAPS and a reviewed stub projects annualizePaystub', () => {
  const extractionId = '00000000-0000-4000-8000-000000000101';
  const normalizedInput = { formRecords: [{
    entityId: 'Paystub:paystub-p0', form: 'Paystub', pageIndex: 0,
    fields: [
      { sourceFieldId: 'ps-employer-name', value: 'Synthetic Employer' },
      { sourceFieldId: 'ps-base-ytd', numericValue: 54000 },
    ],
  }] };
  const gapped = annualizePaystub({ baseYtd: 54000 });
  assert.equal(gapped.status, 'GAPS');
  assert.ok(gapped.gaps.includes('ELAPSED_MONTHS_REQUIRED'));
  assert.throws(() => mergeAuthoritativeExtractionInputs([{ extractionId, normalizedInput }], { borrowerRoster: ['borrower-1', 'borrower-2'] }), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements.map((item) => item.field), ['borrowerAssignment', 'elapsedMonths', 'employmentRole', 'taxYear']);
    return true;
  });
  const cited = annualizePaystub({ baseYtd: 54000, elapsedMonths: 7.5, baseMethod: 'ytd' });
  const projected = mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput,
    metadataAssignments: [{ entityId: 'Paystub:paystub-p0', employmentRole: 'CURRENT' as const, taxYear: 2025, borrowerKey: 'borrower-1', elapsedMonths: 7.5, baseIncomeMethod: 'ytd' as const }],
  }], { borrowerRoster: ['borrower-1', 'borrower-2'] });
  const row = projected.w2Employers?.[0];
  assert.equal(row?.annualBaseIncome, cited.annualBase);
  assert.equal(row?.annualVariableIncome, cited.annualVariable);
  assert.equal(row?.annualWages, undefined);
  assert.notEqual(row?.annualBaseIncome, 54000);
  assert.equal(row?.entityId, `${extractionId}:Paystub:paystub-p0`);
});

test('calculation extraction freshness binds active hash and source document version', () => {
  const current = [{
    extractionId: 'extraction', extractionHash: 'a'.repeat(64), sourceDocumentId: 'document',
    sourceDocumentVersion: 2, sourceContentHash: 'b'.repeat(64),
    extraction: {
      status: 'ACTIVE' as const, canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 2,
      sourceContentHash: 'b'.repeat(64), sourceDocument: { version: 2, sourceContentHash: 'b'.repeat(64) },
    },
  }];
  assert.equal(hasCurrentCalculationExtractions(current), true);
  assert.equal(hasCurrentCalculationExtractions([{ ...current[0], extraction: { ...current[0].extraction, status: 'SUPERSEDED' } }]), false);
  assert.equal(hasCurrentCalculationExtractions([{ ...current[0], extraction: { ...current[0].extraction, sourceDocument: { version: 3, sourceContentHash: 'b'.repeat(64) } } }]), false);
});

test('a newer reviewed metadata version invalidates calculation provenance', () => {
  const binding = {
    extractionId: 'extraction', extractionHash: 'a'.repeat(64), sourceDocumentId: 'document', sourceDocumentVersion: 2,
    sourceContentHash: 'b'.repeat(64), metadataReviewId: 'review-1', metadataReviewVersion: 1, metadataReviewHash: 'c'.repeat(64),
    extraction: { status: 'ACTIVE' as const, canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 2, sourceContentHash: 'b'.repeat(64),
      sourceDocument: { version: 2, sourceContentHash: 'b'.repeat(64) }, metadataReviews: [{ id: 'review-2', metadataVersion: 2, canonicalHash: 'd'.repeat(64) }],
    },
  };
  assert.equal(hasCurrentCalculationExtractions([binding]), false);
});
