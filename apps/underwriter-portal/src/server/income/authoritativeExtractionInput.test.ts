import assert from 'node:assert/strict';
import test from 'node:test';
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

test('rejects unknown or malformed persisted calculation fields', () => {
  assert.throws(() => mergeAuthoritativeExtractionInputs([{
    extractionId: '00000000-0000-4000-8000-000000000101',
    normalizedInput: { rawOcrText: 'must never be accepted' },
  }]));
});

test('keeps persisted paystub evidence fail-closed until authoritative annualization exists', () => {
  const extractionId = '00000000-0000-4000-8000-000000000101';
  assert.throws(() => mergeAuthoritativeExtractionInputs([{
    extractionId,
    normalizedInput: { formRecords: [{
      entityId: 'Paystub:paystub-p0', form: 'Paystub', pageIndex: 0,
      fields: [
        { sourceFieldId: 'ps-employer-name', value: 'Synthetic Employer' },
        { sourceFieldId: 'ps-base-ytd', numericValue: 54000 },
      ],
    }] },
  }]), (error) => {
    assert.ok(error instanceof ExtractionMetadataRequiredError);
    assert.deepEqual(error.requirements, [{
      extractionId, entityId: 'Paystub:paystub-p0', field: 'unsupportedCalculation', form: 'Paystub',
    }]);
    return true;
  });
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
